#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class Check:
    name: str
    required: bool
    status: str
    detail: str
    evidence: str = "static"
    duration_ms: int = 0


def run_check(name: str, command: list[str], required: bool, cwd: Path, env: dict[str, str], *, evidence="static", timeout=300) -> Check:
    started = time.monotonic()
    try:
        proc = subprocess.run(command, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    except FileNotFoundError:
        return Check(name, required, "unavailable", f"{command[0]} not found", evidence)
    except subprocess.TimeoutExpired:
        return Check(name, required, "failed", f"timeout after {timeout}s", evidence)
    output = (proc.stdout or "").strip()
    for secret_name in ("HERMES_TOKEN", "SECRET_KEY"):
        if env.get(secret_name):
            output = output.replace(env[secret_name], "[REDACTED_SECRET]")
    detail = output if len(output) <= 3000 else output[:1500] + "\n[output truncated]\n" + output[-1500:]
    return Check(name, required, "passed" if proc.returncode == 0 else "failed",
                 detail or f"exit {proc.returncode}", evidence, round((time.monotonic() - started) * 1000))


def checks_for(root: Path, full: bool) -> list[Check]:
    checks: list[Check] = []
    python = sys.executable
    flutter = os.environ.get("FLUTTER_BIN") or shutil.which("flutter")
    with tempfile.TemporaryDirectory(prefix="hermes-readiness-") as temporary:
        temp = Path(temporary)
        env = {**os.environ, "PROJECT_PATH": str(temp / "project"), "SOP_RUNTIME_DIR": str(temp / "runtime"),
               "HERMES_DATA_DIR": str(temp / "hermes"), "AI_MEMORY_ROOT": str(temp / "ai-memory")}
        env["PYTHONPATH"] = os.pathsep.join(str(root / path) for path in ("packages/hermes-core", "apps/manager", "packages/sop-cli", "packages/sop-sdk-python"))
        def run(name, command, *, directory=root, evidence="static", timeout=300):
            result = run_check(name, command, True, directory, env, evidence=evidence, timeout=timeout)
            checks.append(result)
            return result
        run("python.compile", [python, "-m", "compileall", "-q", "packages/hermes-core", "packages/sop-cli", "packages/sop-sdk-python", "apps/manager/sop_manager/routers/hermes_workspace.py"])
        runtime = root / "apps/agent-runtime"
        binary = temp / ("sop-agentd.exe" if os.name == "nt" else "sop-agentd")
        built = run("agentd.build", ["go", "build", "-o", str(binary), "./cmd/sop-agentd"], directory=runtime)
        run("agentd.tests", ["go", "test", "./..."], directory=runtime, evidence="execution")
        if built.status == "passed":
            env["HERMES_TEST_AGENTD"] = str(binary)
        run("core.tests", [python, "-m", "pytest", "packages/hermes-core/tests", "-q"], evidence="execution" if built.status == "passed" else "static")
        run("manager.scope-permissions-pages", [python, "-m", "pytest", "apps/manager/sop_manager/routers/test_hermes_workspace.py", "-q"], evidence="execution")
        run("sdk-cli.contracts", [python, "-m", "pytest", "packages/sop-sdk-python/tests/test_hermes_client.py", "packages/sop-cli/tests/test_hermes_cli_contract.py", "-q"], evidence="execution")
        run("sdk.generator", [python, "-m", "pytest", "apis/generated/hermes-v1/generator_regression_test.py", "-q"])
        run("distribution.contracts", [python, "-m", "pytest", "scripts/tests/test_hermes_distribution.py", "-q"], evidence="execution")
        run("cli.diagnostics.help", [python, "-m", "sop_cli", "hermes", "diagnostics", "--help"], evidence="execution")
        for command in ("workspace", "device", "session", "run", "approval", "asset", "system"):
            run(f"cli.{command}.help", [python, "-m", "sop_cli", command, "--help"], evidence="execution")
        for command in ("delivery", "dispatch", "review"):
            run(f"cli.task.{command}.help", [python, "-m", "sop_cli", "task", "v1", command, "--help"], evidence="execution")
        for group, command in (("workspace", "repository"), ("run", "changes")):
            run(f"cli.{group}.{command}.help", [python, "-m", "sop_cli", group, command, "--help"], evidence="execution")
        run("scripts.syntax", ["bash", "-n", "scripts/hermes-bootstrap.sh", "scripts/hermes-package.sh", "scripts/hermes-mobile-check.sh"])
        if full:
            web = root / "apps/manager-web"
            pnpm = shutil.which("pnpm") or "pnpm"
            run("web.typecheck", [pnpm, "run", "typecheck"], directory=web)
            run("web.tests", [pnpm, "test"], directory=web, evidence="execution", timeout=600)
            run("web.build", [pnpm, "run", "build"], directory=web, timeout=600)
            if flutter:
                client = root / "apps/hermes-client"
                version = run("flutter.runtime", [flutter, "--version"], directory=client, timeout=120)
                if version.status == "passed":
                    for name, args in (("analyze", ["analyze"]), ("tests", ["test"])):
                        run("flutter." + name, [flutter, *args], directory=client,
                            evidence="execution" if name == "tests" else "static", timeout=600)
                    target = {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}.get(platform.system())
                    if target:
                        run("flutter.build." + target, [flutter, "build", target, "--debug"], directory=client, timeout=900)
                else:
                    checks.append(Check("flutter.analyze-tests-build", True, "unavailable", "Flutter runtime is not usable"))
            else:
                checks.append(Check("flutter.analyze-tests-build", True, "unavailable", "Install Flutter or set FLUTTER_BIN"))
            run("packaging.pyinstaller", [python, "-c", "import PyInstaller; print(PyInstaller.__version__)"])
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(prog="hermes-readiness")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    checks = checks_for(root, args.full)
    missing = [check.name for check in checks if check.required and check.status != "passed"]
    payload = {
        "ok": not missing,
        "release_ready": False,
        "release_evidence": {target: "not_verified_by_this_gate" for target in ("windows", "macos", "linux", "ios", "android")},
        "summary": {
            "passed": sum(check.status == "passed" for check in checks),
            "failed": sum(check.status == "failed" for check in checks),
            "unavailable": sum(check.status == "unavailable" for check in checks),
            "required_missing": missing,
            "full": args.full,
            "host": platform.system(),
        },
        "items": [asdict(check) for check in checks],
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for check in checks:
            print(f"{check.status} required={check.required} {check.name}: {check.detail}")
    raise SystemExit(0 if payload["ok"] else 1)


if __name__ == "__main__":
    main()
