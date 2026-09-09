#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import queue
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

BASE = "/api/hermes/v1"
SECRET_ENV = "HERMES_AUTOMATION_SMOKE_SECRET"  # noqa: S105 - Environment variable name, not a credential.


class SmokeFailure(RuntimeError):
    pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Bounded real Hermes automation smoke.")
    parser.add_argument("--timeout", type=float, default=45.0)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    started = datetime.now(timezone.utc)
    report: dict[str, Any] = {
        "ok": False,
        "started_at": started.isoformat(),
        "repo": str(repo),
        "checks": [],
    }
    core: subprocess.Popen[str] | None = None
    temp = Path(tempfile.mkdtemp(prefix="hermes-automation-smoke-"))
    report_path = temp / "hermes-automation-smoke-report.json"
    secret = secrets.token_urlsafe(32)
    token = ""
    try:
        workspace_root = temp / "workspace"
        workspace_root.mkdir()
        (workspace_root / "counter.txt").write_text("0", encoding="utf-8")
        agentd = ensure_agentd(repo, temp, report)
        env = smoke_env(repo)
        env[SECRET_ENV] = secret
        core, ready = start_core(temp, agentd, env, args.timeout)
        url = ready["url"]
        token = (temp / "access-token").read_text(encoding="utf-8").strip()
        client = HttpClient(url, token)
        check(report, "core_started", url.startswith("http://127.0.0.1:"), {"url": url, "pid": ready["pid"], "agentd": str(agentd)})
        health = client.request("GET", "/health", auth=False)
        check(report, "health", health["status"] == 200 and health["json"].get("ok") is True, {"version": health["json"].get("version")})

        workspace_payload = client.request("POST", "/workspaces", body={
            "data": {"name": "automation-smoke", "root": str(workspace_root)},
            "idempotency_key": "automation-smoke-workspace",
        })
        workspace = workspace_payload["json"]["items"][0]["id"]
        client.workspace = workspace
        check(report, "create_workspace", workspace_payload["status"] == 201, {"workspace": workspace})

        interval_schedule = configure_interval(client, workspace_root)
        wait_for_file(workspace_root / "interval-fired.txt", args.timeout, expected="interval-ok")
        interval_run = wait_for_schedule_run(client, "interval-auto", args.timeout)
        check(report, "interval_due_command_writes_file", interval_run["status"] == "completed", {
            "schedule": interval_schedule["id"],
            "run": interval_run["id"],
            "file": "interval-fired.txt",
            "status": interval_run["status"],
        })

        cli_preview = run_cli_preview(repo, env, url, token, workspace)
        next_runs = cli_preview["summary"]["next_runs"]
        check(report, "cli_json_cron_preview_timezone_five_next", len(next_runs) == 5, {
            "count": len(next_runs),
            "first": next_runs[0],
            "last": next_runs[-1],
            "cli": cli_preview.get("cli", {}),
        })

        webhook_schedule = configure_webhook(client, workspace_root)
        webhook_report = exercise_webhook(client, workspace_root, webhook_schedule, env[SECRET_ENV], args.timeout)
        for name, evidence in webhook_report:
            check(report, name, evidence.pop("passed"), evidence)

        report["ok"] = all(item["passed"] for item in report["checks"])
        if not report["ok"]:
            raise SmokeFailure("one or more smoke checks failed")
        return 0
    except Exception as exc:
        report["error"] = {"type": type(exc).__name__, "message": str(exc)}
        return 1
    finally:
        try:
            if core is not None:
                stop_core(core)
        finally:
            report["finished_at"] = datetime.now(timezone.utc).isoformat()
            report["report_path"] = str(report_path)
            serialized = json.dumps(redact_report(report, (secret, token)), ensure_ascii=False, indent=2)
            report_path.write_text(serialized + "\n", encoding="utf-8")
            print(serialized)


class HttpClient:
    def __init__(self, url: str, token: str) -> None:
        validate_core_url(url)
        self.url = url.rstrip("/")
        self.token = token
        self.workspace = ""

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
        auth: bool = True,
    ) -> dict[str, Any]:
        request_headers = dict(headers or {})
        if auth:
            request_headers["Authorization"] = f"Bearer {self.token}"
        if self.workspace:
            request_headers["X-Workspace-Id"] = self.workspace
        data = content
        if body is not None:
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.url + BASE + path, data=data, headers=request_headers, method=method)  # noqa: S310 - Validated local Core URL.
        try:
            with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 - Owned loopback Core.
                raw = response.read()
                return {"status": response.status, "json": json.loads(raw.decode("utf-8"))}
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            parsed = json.loads(raw.decode("utf-8")) if raw else {}
            return {"status": exc.code, "json": parsed}


def ensure_agentd(repo: Path, temp: Path, report: dict[str, Any]) -> Path:
    configured = os.environ.get("HERMES_TEST_AGENTD")
    if configured:
        preferred = Path(configured).expanduser().resolve()
        if not preferred.is_file() or not os.access(preferred, os.X_OK):
            raise SmokeFailure("HERMES_TEST_AGENTD must name an executable file")
        report["agentd_source"] = "HERMES_TEST_AGENTD"
        return preferred
    go = shutil.which("go")
    if go is None:
        raise SmokeFailure("Go is required to build agentd; alternatively set HERMES_TEST_AGENTD")
    built = temp / ("sop-agentd.exe" if os.name == "nt" else "sop-agentd")
    command = [go, "-C", str(repo / "apps/agent-runtime"), "build", "-o", str(built), "./cmd/sop-agentd"]
    env = os.environ.copy()
    env["GOCACHE"] = str(temp / "go-cache")
    result = subprocess.run(command, capture_output=True, text=True, timeout=120, env=env)  # noqa: S603 - Fixed Go build argv, no shell.
    if result.returncode != 0:
        raise SmokeFailure("failed to build sop-agentd: " + (result.stderr or result.stdout)[-1000:])
    report["agentd_source"] = "built"
    return built


def smoke_env(repo: Path) -> dict[str, str]:
    env = os.environ.copy()
    paths = [
        str(repo / "packages/hermes-core"),
        str(repo / "packages/sop-sdk-python"),
        str(repo / "packages/sop-cli"),
    ]
    if env.get("PYTHONPATH"):
        paths.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(paths)
    env.pop("HERMES_DATABASE_URL", None)
    return env


def start_core(temp: Path, agentd: Path, env: dict[str, str], timeout: float) -> tuple[subprocess.Popen[str], dict[str, Any]]:
    command = [
        sys.executable,
        "-m",
        "hermes_core",
        "--data-dir",
        str(temp / "data"),
        "--token-file",
        str(temp / "access-token"),
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--agentd",
        str(agentd),
    ]
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env)  # noqa: S603 - Fixed local Core argv, no shell.
    try:
        deadline = time.monotonic() + timeout
        startup: queue.Queue[str | Exception] = queue.Queue(maxsize=1)

        def read_startup() -> None:
            assert proc.stdout is not None
            try:
                line = proc.stdout.readline()
            except Exception as exc:
                startup.put(exc)
                return
            startup.put(line)
            # Keep draining so later output cannot block the running Core.
            for _ in proc.stdout:
                pass

        threading.Thread(target=read_startup, daemon=True).start()
        try:
            line = startup.get(timeout=max(0, deadline - time.monotonic()))
        except queue.Empty as exc:
            raise SmokeFailure("Core did not print startup JSON before timeout") from exc
        if isinstance(line, Exception):
            raise SmokeFailure("Could not read Core startup JSON") from line
        if not line:
            raise SmokeFailure("Core exited before startup JSON")
        ready = json.loads(line)
        wait_health(ready["url"], deadline)
        return proc, ready
    except BaseException:
        stop_core(proc)
        raise


def stop_core(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is None:
        proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)
    finally:
        if proc.stdout is not None:
            proc.stdout.close()


def validate_core_url(url: str) -> None:
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
            or parsed.username is not None or parsed.password is not None
            or parsed.path or parsed.query or parsed.fragment):
        raise SmokeFailure("Core startup URL must be a loopback HTTP origin with an explicit port")


def wait_health(url: str, deadline: float) -> None:
    validate_core_url(url)
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url.rstrip("/") + BASE + "/health", timeout=1) as response:  # noqa: S310 - Validated local Core URL.
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise SmokeFailure("Core did not become healthy before timeout")


def configure_interval(client: HttpClient, workspace_root: Path) -> dict[str, Any]:
    starts_at = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat()
    payload = client.request("POST", "/schedules/interval-auto/configure", body={
        "title": "Automation interval smoke",
        "trigger": {"type": "interval", "interval_seconds": 10, "starts_at": starts_at},
        "nodes": [{
            "id": "write-interval",
            "argv": [
                sys.executable,
                "-c",
                "from pathlib import Path; Path('interval-fired.txt').write_text('interval-ok', encoding='utf-8')",
            ],
            "timeout_seconds": 10,
        }],
        "enabled": True,
        "misfire_coalesce": True,
        "idempotency_key": "automation-interval-configure",
        "dry_run": False,
    })
    assert_status(payload, 200, "configure interval")
    return payload["json"]["items"][0]


def run_cli_preview(repo: Path, env: dict[str, str], url: str, token: str, workspace: str) -> dict[str, Any]:
    data = {
        "title": "Automation cron preview",
        "trigger": {
            "type": "cron",
            "cron_expression": "30 2 * * *",
            "timezone": "America/New_York",
        },
        "nodes": [{"id": "noop", "argv": [sys.executable, "-c", "print('cron-preview')"], "timeout_seconds": 10}],
        "enabled": True,
        "misfire_coalesce": True,
    }
    cli_env = env.copy()
    cli_env.update({"HERMES_URL": url, "HERMES_TOKEN": token, "HERMES_WORKSPACE": workspace})
    result = subprocess.run(  # noqa: S603 - Fixed local CLI argv, no shell.
        [sys.executable, "-m", "sop_cli", "schedule", "preview", "--data", json.dumps(data), "--runs", "5", "--json"],
        cwd=repo,
        capture_output=True,
        text=True,
        timeout=20,
        env=cli_env,
    )
    if result.returncode != 0:
        raise SmokeFailure("CLI schedule preview failed: " + (result.stderr or result.stdout)[-1000:])
    return json.loads(result.stdout)


def configure_webhook(client: HttpClient, workspace_root: Path) -> dict[str, Any]:
    payload = client.request("POST", "/schedules/webhook-smoke/configure", body={
        "title": "Automation webhook smoke",
        "trigger": {"type": "webhook", "secret_ref": SECRET_ENV, "max_body_bytes": 64},
        "nodes": [{
            "id": "count-webhook",
            "argv": [
                sys.executable,
                "-c",
                "from pathlib import Path; p=Path('counter.txt'); p.write_text(str(int(p.read_text(encoding='utf-8'))+1), encoding='utf-8')",
            ],
            "timeout_seconds": 10,
        }],
        "enabled": True,
        "misfire_coalesce": True,
        "idempotency_key": "automation-webhook-configure",
        "dry_run": False,
    })
    assert_status(payload, 200, "configure webhook")
    return payload["json"]["items"][0]


def exercise_webhook(
    client: HttpClient,
    workspace_root: Path,
    schedule: dict[str, Any],
    secret: str,
    timeout: float,
) -> list[tuple[str, dict[str, Any]]]:
    body = b'{"event":"automation-smoke"}'
    timestamp = str(int(time.time()))
    first = post_webhook(client, "webhook-smoke", body, secret, "delivery-1", timestamp=timestamp)
    assert_status(first, 200, "first webhook delivery")
    wait_for_counter(workspace_root / "counter.txt", "1", timeout)
    first_run = first["json"]["items"][0]
    time.sleep(1.1)
    duplicate = post_webhook(client, "webhook-smoke", body, secret, "delivery-1", timestamp=timestamp)
    assert_status(duplicate, 200, "duplicate webhook delivery")
    resigned = post_webhook(client, "webhook-smoke", body, secret, "delivery-1")
    assert_status(resigned, 200, "re-signed webhook delivery")
    time.sleep(0.5)
    invalid = post_webhook(client, "webhook-smoke", body, "wrong-secret", "delivery-invalid")
    paused = client.request("POST", "/schedules/webhook-smoke/pause", body={
        "expected_version": schedule["version"] + 1,
        "idempotency_key": "automation-webhook-pause",
        "dry_run": False,
    })
    too_large = post_webhook(client, "webhook-smoke", b"x" * 65, secret, "delivery-large")
    paused_reject = post_webhook(client, "webhook-smoke", b"{}", secret, "delivery-paused")
    return [
        ("webhook_valid_hmac_counterwrite", {
            "passed": first["status"] == 200 and first["json"]["summary"]["queued"] is True and (workspace_root / "counter.txt").read_text(encoding="utf-8") == "1",
            "status": first["status"],
            "run": first_run["id"],
            "counter": (workspace_root / "counter.txt").read_text(encoding="utf-8"),
        }),
        ("webhook_duplicate_same_result_noextra", {
            "passed": duplicate["status"] == 200 and duplicate["json"]["items"] == first["json"]["items"] and duplicate["json"]["summary"]["duplicate"] is True and (workspace_root / "counter.txt").read_text(encoding="utf-8") == "1",
            "status": duplicate["status"],
            "same_run": duplicate["json"]["items"][0]["id"] == first_run["id"],
            "same_result": duplicate["json"]["items"] == first["json"]["items"],
            "replayed_after_timestamp_second": int(time.time()) > int(timestamp),
            "counter": (workspace_root / "counter.txt").read_text(encoding="utf-8"),
        }),
        ("webhook_invalid_hmac_401", {
            "passed": invalid["status"] == 401 and invalid["json"]["error"]["code"] == "webhook_signature_invalid",
            "status": invalid["status"],
            "code": invalid["json"].get("error", {}).get("code"),
        }),
        ("webhook_resigned_same_result_noextra", {
            "passed": resigned["json"]["items"] == first["json"]["items"] and resigned["json"]["summary"]["duplicate"] is True and (workspace_root / "counter.txt").read_text(encoding="utf-8") == "1",
            "status": resigned["status"],
            "same_run": resigned["json"]["items"][0]["id"] == first_run["id"],
            "counter": (workspace_root / "counter.txt").read_text(encoding="utf-8"),
        }),
        ("webhook_bounded_body_413", {
            "passed": too_large["status"] == 413 and too_large["json"]["error"]["code"] == "webhook_body_too_large",
            "status": too_large["status"],
            "code": too_large["json"].get("error", {}).get("code"),
        }),
        ("webhook_paused_reject", {
            "passed": paused["status"] == 200 and paused_reject["status"] == 409 and paused_reject["json"]["error"]["code"] == "schedule_paused",
            "pause_status": paused["status"],
            "webhook_status": paused_reject["status"],
            "code": paused_reject["json"].get("error", {}).get("code"),
        }),
    ]


def post_webhook(
    client: HttpClient, schedule_id: str, body: bytes, secret: str, delivery: str,
    *, timestamp: str | None = None,
) -> dict[str, Any]:
    if timestamp is None:
        timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode("utf-8"), timestamp.encode("ascii") + b"." + delivery.encode("ascii") + b"." + body, hashlib.sha256).hexdigest()
    return client.request("POST", f"/schedules/{schedule_id}/webhook", content=body, headers={
        "Content-Type": "application/json",
        "X-Hermes-Webhook-Timestamp": timestamp,
        "X-Hermes-Webhook-Delivery": delivery,
        "X-Hermes-Webhook-Signature": "sha256=" + signature,
    }, auth=False)


def wait_for_file(path: Path, timeout: float, *, expected: str) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists() and path.read_text(encoding="utf-8") == expected:
            return
        time.sleep(0.2)
    raise SmokeFailure(f"{path.name} was not written before timeout")


def wait_for_counter(path: Path, expected: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.read_text(encoding="utf-8") == expected:
            return
        time.sleep(0.2)
    raise SmokeFailure(f"{path.name} did not reach {expected} before timeout")


def wait_for_schedule_run(client: HttpClient, schedule_id: str, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        payload = client.request("GET", f"/schedules/{schedule_id}/history?limit=5")
        assert_status(payload, 200, f"history {schedule_id}")
        if payload["json"]["items"]:
            last = payload["json"]["items"][0]
            if last["status"] in {"completed", "failed", "interrupted", "cancelled"}:
                return last
        time.sleep(0.2)
    raise SmokeFailure(f"scheduled run for {schedule_id} did not finish; last={last}")


def assert_status(payload: dict[str, Any], status: int, label: str) -> None:
    if payload["status"] != status:
        raise SmokeFailure(f"{label} expected HTTP {status}, got {payload['status']}: {payload['json']}")


def check(report: dict[str, Any], name: str, passed: bool, evidence: dict[str, Any]) -> None:
    report["checks"].append({"name": name, "passed": bool(passed), "evidence": redact_report(evidence)})
    if not passed:
        raise SmokeFailure(f"check failed: {name}")


def redact_report(value: Any, sensitive_values: tuple[str, ...] = ()) -> Any:
    if isinstance(value, dict):
        return {key: ("[REDACTED]" if "token" in key.lower() or "secret" in key.lower() or "signature" in key.lower() else redact_report(item, sensitive_values)) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_report(item, sensitive_values) for item in value]
    if isinstance(value, str):
        for sensitive in sensitive_values:
            if sensitive:
                value = value.replace(sensitive, "[REDACTED]")
    return value


if __name__ == "__main__":
    raise SystemExit(main())
