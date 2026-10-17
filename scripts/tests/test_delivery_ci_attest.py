"""Exercise the producer with real Git, subprocesses, JUnit and Ed25519 files."""

# ruff: noqa: S603,S607 - explicit fixture Git/Python argv, no shell or remote input.

import base64
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sop_manager.routers.delivery_ci import policy_value, verify_envelope

SCRIPT = Path(__file__).resolve().parents[1] / "delivery-ci-attest.py"


def git(root, *argv):
    return subprocess.run(
        ["git", "-c", "core.hooksPath=" + os.devnull, *argv],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


@pytest.fixture
def producer(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / "source.txt").write_text("Controlled source", encoding="utf-8")
    (root / ".gitignore").write_text("build/\n", encoding="utf-8")
    git(root, "init", "-q")
    git(root, "add", ".")
    git(
        root,
        "-c",
        "user.name=CI test",
        "-c",
        "user.email=ci@example.test",
        "commit",
        "-qm",
        "Controlled input",
    )
    key = Ed25519PrivateKey.generate()
    private = tmp_path / "private.pem"
    private.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    private.chmod(0o600)
    arguments = [
        sys.executable,
        str(SCRIPT),
        "--repo",
        str(root),
        "--cwd",
        ".",
        "--private-key",
        str(private),
        "--artifact",
        "build/app.bin",
        "--junit",
        "build/tests.xml",
        "--out",
        "build/ci.json",
        "--repository",
        "https://example.test/team/repo",
        "--workflow",
        "build",
        "--tenant-id",
        "tenant",
        "--project-id",
        "project",
        "--policy-generation",
        "1",
        "--run-uri",
        "https://example.test/runs/1",
        "--run-number",
        "1",
        "--run-attempt",
        "1",
        "--scope-basis",
        "a" * 64,
    ]
    return root, key, private, arguments


def run(producer, *, build=None, tests=None, extra=()):
    root, _, _, arguments = producer
    build = (
        build
        or "from pathlib import Path; Path('build').mkdir(exist_ok=True); Path('build/app.bin').write_bytes(b'new artifact')"
    )
    tests = (
        tests
        or 'from pathlib import Path; Path(\'build/tests.xml\').write_text(\'<testsuites><testsuite tests="2" failures="0" errors="0" skipped="0"><testcase name="first"/><testcase name="second"/></testsuite></testsuites>\')'
    )
    return subprocess.run(
        [
            *arguments,
            "--build-command",
            json.dumps([sys.executable, "-c", build]),
            "--test-command",
            json.dumps([sys.executable, "-c", tests]),
            *extra,
        ],
        capture_output=True,
        text=True,
        timeout=40,
    )


def proof(producer):
    root, key, _, _ = producer
    text = (root / "build/ci.json").read_text(encoding="utf-8")
    policy = policy_value(
        {
            "repository": "https://example.test/team/repo",
            "workflow": "build",
            "public_keys": [base64.b64encode(key.public_key().public_bytes_raw()).decode()],
        },
        1,
    )
    return verify_envelope(
        text,
        policy,
        tenant_id="tenant",
        project_id="project",
        scope_basis="a" * 64,
        now=datetime.now(timezone.utc),
    )


def test_actual_clean_checkout_build_test_artifact_and_signature(producer):
    result = run(producer)
    assert result.returncode == 0, result.stderr
    facts = proof(producer)
    assert facts["passed"] is True
    assert facts["statement"]["predicate"]["commit_sha"] == git(producer[0], "rev-parse", "HEAD")
    assert facts["statement"]["subject"][0]["digest"]["sha256"] == hashlib.sha256(b"new artifact").hexdigest()
    assert facts["statement"]["predicate"]["tests"] == {"total": 2, "failed": 0, "errors": 0, "skipped": 0}
    assert "PRIVATE KEY" not in result.stdout + result.stderr


@pytest.mark.parametrize("flag", ["assume-unchanged", "skip-worktree"])
@pytest.mark.parametrize("changed", [False, True])
def test_initial_hidden_index_flags_are_rejected_before_build(producer, flag, changed):
    root = producer[0]
    git(root, "update-index", "--" + flag, "source.txt")
    if changed:
        (root / "source.txt").write_text("Hidden preexisting source change", encoding="utf-8")
    assert git(root, "status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none") == ""
    result = run(producer)
    assert result.returncode != 0
    # Rejection must occur before any build or test side effect.
    assert not (root / "build").exists()


@pytest.mark.parametrize("flag", ["assume-unchanged", "skip-worktree"])
def test_initial_hidden_index_flags_inside_submodules_are_rejected(producer, tmp_path, flag):
    root = producer[0]
    module = tmp_path / "module-source"
    module.mkdir()
    (module / "source.txt").write_text("Committed module", encoding="utf-8")
    git(module, "init", "-q")
    git(module, "add", ".")
    git(module, "-c", "user.name=CI test", "-c", "user.email=ci@example.test", "commit", "-qm", "Module")
    git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", str(module), "modules/lib")
    git(root, "-c", "user.name=CI test", "-c", "user.email=ci@example.test", "commit", "-qam", "Pin module")
    checkout = root / "modules/lib"
    git(checkout, "update-index", "--" + flag, "source.txt")
    (checkout / "source.txt").write_text("Hidden module change", encoding="utf-8")
    assert git(root, "status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none") == ""
    result = run(producer)
    assert result.returncode != 0
    assert not (root / "build").exists()


def test_clean_windows_crlf_checkout_remains_supported(producer):
    root = producer[0]
    git(root, "config", "core.autocrlf", "true")
    (root / "source.txt").write_bytes(b"Controlled source\n")
    git(root, "add", "source.txt")
    git(
        root,
        "-c",
        "user.name=CI test",
        "-c",
        "user.email=ci@example.test",
        "commit",
        "-qm",
        "Normalize source",
    )
    (root / "source.txt").unlink()
    git(root, "checkout-index", "--force", "--index", "--", "source.txt")
    assert (root / "source.txt").read_bytes() == b"Controlled source\r\n"
    assert git(root, "status", "--porcelain=v1") == ""
    result = run(producer)
    assert result.returncode == 0, result.stderr
    assert proof(producer)["passed"] is True
    assert (root / "source.txt").read_bytes() == b"Controlled source\r\n"


@pytest.mark.parametrize(
    "mode",
    ["dirty", "untracked", "old_artifact", "old_report", "source_changed", "head_changed", "index_changed"],
)
def test_producer_refuses_uncontrolled_source_and_stale_outputs(producer, mode):
    root = producer[0]
    build = None
    if mode == "dirty":
        (root / "source.txt").write_text("edited")
    elif mode == "untracked":
        (root / "untracked.py").write_text("uncontrolled")
    elif mode in {"old_artifact", "old_report"}:
        (root / "build").mkdir()
        (root / "build" / ("app.bin" if mode == "old_artifact" else "tests.xml")).write_text("old")
    else:
        build = "from pathlib import Path; import subprocess; Path('build').mkdir(); Path('build/app.bin').write_bytes(b'new'); "
        if mode == "source_changed":
            build += "Path('source.txt').write_text('changed')"
        elif mode == "head_changed":
            build += "subprocess.run(['git','-c','user.name=CI test','-c','user.email=ci@example.test','commit','--allow-empty','-qm','changed'],check=True)"
        else:
            build += "subprocess.run(['git','update-index','--assume-unchanged','source.txt'],check=True); Path('source.txt').write_text('hidden edit')"
    result = run(producer, build=build)
    assert result.returncode != 0
    assert not (root / "build/ci.json").exists()


@pytest.mark.parametrize("mode", ["failed_build", "failed_test", "zero", "all_skipped", "test_exit_failed"])
def test_failed_or_empty_real_checks_never_emit_a_passing_proof(producer, mode):
    build = None
    tests = None
    if mode == "failed_build":
        build = "from pathlib import Path; import sys; Path('build').mkdir(); Path('build/app.bin').write_bytes(b'failed build artifact'); sys.exit(1)"
    elif mode == "failed_test":
        tests = 'from pathlib import Path; import sys; Path(\'build/tests.xml\').write_text(\'<testsuite tests="1" failures="1" errors="0" skipped="0"><testcase name="bad"><failure/></testcase></testsuite>\'); sys.exit(1)'
    elif mode == "zero":
        tests = "from pathlib import Path; Path('build/tests.xml').write_text('<testsuite tests=\"0\"/>')"
    elif mode == "all_skipped":
        tests = 'from pathlib import Path; Path(\'build/tests.xml\').write_text(\'<testsuite tests="1" skipped="1"><testcase name="skip"><skipped/></testcase></testsuite>\')'
    else:
        tests = "from pathlib import Path; import sys; Path('build/tests.xml').write_text('<testsuite><testcase name=\"apparently passed\"/></testsuite>'); sys.exit(1)"
    result = run(producer, build=build, tests=tests)
    assert result.returncode != 0
    assert proof(producer)["passed"] is False


@pytest.mark.parametrize(
    "report",
    [
        '<testsuite tests="10"><testcase name="one"/></testsuite>',
        '<testsuite><testcase name="bad"><failure/><error/></testcase></testsuite>',
        '<!DOCTYPE testsuite [<!ENTITY x "expanded">]><testsuite><testcase name="&x;"/></testsuite>',
        '<testsuite><testcase name="unfinished"></testsuite>',
    ],
)
def test_junit_must_contain_real_consistent_cases(producer, report):
    tests = "from pathlib import Path; Path('build/tests.xml').write_text(" + repr(report) + ")"
    result = run(producer, tests=tests)
    assert result.returncode != 0
    assert not (producer[0] / "build/ci.json").exists()


def test_utf16_junit_cannot_bypass_dtd_rejection(producer):
    report = '<!DOCTYPE testsuite [<!ENTITY x "expanded">]><testsuite><testcase name="&x;"/></testsuite>'
    tests = (
        "from pathlib import Path; Path('build/tests.xml').write_bytes(" + repr(report.encode("utf-16")) + ")"
    )
    result = run(producer, tests=tests)
    assert result.returncode != 0
    assert not (producer[0] / "build/ci.json").exists()


def test_commands_are_json_argv_and_cannot_escape_the_checkout(producer):
    result = run(producer, extra=("--build-command", "echo unsafe && touch marker"))
    assert result.returncode != 0
    assert not (producer[0] / "build/ci.json").exists()
    result = run(producer, extra=("--cwd", ".."))
    assert result.returncode != 0
    assert not (producer[0] / "build/ci.json").exists()
