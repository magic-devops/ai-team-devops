from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "hermes-readiness.py"
SPEC = importlib.util.spec_from_file_location("hermes_readiness", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
readiness = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = readiness
SPEC.loader.exec_module(readiness)


def test_full_gate_requires_native_build_when_toolchain_is_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("FLUTTER_BIN", "/test/flutter")
    monkeypatch.setattr(readiness.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(
        readiness, "native_flutter_toolchain_unavailable", lambda target: "xcodebuild unavailable"
    )
    monkeypatch.setattr(
        readiness, "run_check",
        lambda name, command, required, cwd, env, **kwargs: readiness.Check(
            name, required, "passed", "test fixture"
        ),
    )
    checks = readiness.checks_for(tmp_path, full=True)
    native = next(check for check in checks if check.name == "flutter.build.macos")
    assert native.required is True
    assert native.status == "unavailable"
    monkeypatch.setattr(readiness, "checks_for", lambda root, full: checks)
    report = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--full", "--json", "--output", str(report)])
    with pytest.raises(SystemExit) as exited:
        readiness.main()
    assert exited.value.code == 1
    payload = json.loads(report.read_text())
    assert payload["ok"] is False
    assert payload["release_ready"] is False
    assert payload["summary"]["required_missing"] == ["flutter.build.macos"]


def test_native_probe_reports_missing_xcrun(monkeypatch):
    monkeypatch.setattr(readiness.shutil, "which", lambda executable: None)
    assert "xcrun not found" in readiness.native_flutter_toolchain_unavailable("macos")
