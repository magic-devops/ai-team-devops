import hashlib
import os
import subprocess
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from hermes_core.models import Principal
from hermes_core.transactional import digest

BASE = "/api/hermes/v1"


@pytest.fixture
def git_delivery(tmp_path):
    agentd = os.environ.get("HERMES_TEST_AGENTD", "")
    if not agentd or not Path(agentd).is_file():
        pytest.skip("HERMES_TEST_AGENTD is required for real Git execution")
    root = tmp_path / "repo"
    root.mkdir()

    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()  # noqa: S603,S607 - fixed Git operations in an isolated test repository

    git("init", "-q")
    (root / "note.txt").write_text("base\n")
    git("add", "note.txt")
    git("-c", "user.name=Hermes QA", "-c", "user.email=qa@example.invalid", "commit", "-qm", "base")
    head = git("rev-parse", "HEAD")
    (root / "note.txt").write_text("user draft\n")
    app = create_app(
        tmp_path / "core",
        "owner",
        agentd=agentd,
        principals={
            "owner": Principal("owner"),
            "reader": Principal("reader", permissions=frozenset({"read"})),
            "other": Principal("other", tenant="other"),
        },
    )
    client = TestClient(app, headers={"Authorization": "Bearer owner"})
    workspace = client.post(
        BASE + "/workspaces", json={"data": {"name": "Code", "root": str(root)}, "idempotency_key": "ws"}
    ).json()["items"][0]["id"]
    client.headers["X-Workspace-Id"] = workspace
    task = client.post(
        BASE + "/tasks",
        json={
            "data": {"title": "Code change", "acceptance_criteria": "Review changed text"},
            "idempotency_key": "task",
        },
    ).json()["items"][0]
    return client, root, workspace, task, head


def dispatch(client, task, head, nodes, **overrides):
    return client.post(
        f"{BASE}/tasks/{task['id']}/dispatch",
        json={
            "expected_version": task["version"],
            "idempotency_key": "dispatch",
            "dry_run": False,
            "isolation": "git_worktree",
            "base_commit": head,
            "nodes": nodes,
            **overrides,
        },
    )


def test_isolated_code_evidence_approval_and_main_worktree_unchanged(git_delivery):
    client, root, workspace, task, head = git_delivery
    repo = client.get(f"{BASE}/workspaces/{workspace}/repository").json()["items"][0]
    assert repo["head_commit"] == head and repo["dirty"]
    nodes = [
        {
            "id": "write",
            "argv": ["workspace-file-write", "note.txt", hashlib.sha256(b"base\n").hexdigest(), "reviewed\n"],
        },
        {"id": "approval", "kind": "approval"},
        {"id": "verify", "argv": ["git", "diff", "--exit-code", "--quiet"], "expected_exit_code": 1},
    ]
    before = client.get(BASE + "/sync").json()["items"]
    assert dispatch(client, task, head, nodes, dry_run=True).status_code == 200
    assert client.get(BASE + "/sync").json()["items"] == before
    result = dispatch(client, task, head, nodes).json()["items"][0]
    run = result["run"]
    assert dispatch(client, task, head, nodes).json()["items"][0] == result
    client.post(
        f"{BASE}/runs/{run['id']}/start",
        json={"expected_version": 1, "idempotency_key": "start", "dry_run": False},
    )
    run = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert run["status"] == "interrupted", run
    approval = client.get(BASE + "/approvals").json()["items"][0]
    client.post(
        f"{BASE}/approvals/{approval['id']}/decision",
        json={"decision": "approve", "expected_version": approval["version"], "idempotency_key": "approve"},
    )
    run = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert run["status"] == "completed", run
    assert (root / "note.txt").read_text() == "user draft\n"
    target = Path(run["data"]["code_workspace"]["root"])
    assert target != root and (target / "note.txt").read_text() == "reviewed\n"
    evidence = run["data"]["code_evidence"]
    assert evidence["complete"] is True
    assert evidence["files"] == [{"status": "M", "path": "note.txt"}]
    assert "+reviewed" in evidence["patch"] and "user draft" not in evidence["patch"]
    assert evidence["sha256"] == digest({key: value for key, value in evidence.items() if key != "sha256"})
    changes = client.get(f"{BASE}/runs/{run['id']}/changes").json()
    assert changes["items"][0]["code_evidence"] == evidence
    events = client.get(f"{BASE}/runs/{run['id']}/events").json()["items"]
    assert any(event.get("data", {}).get("code_evidence") == evidence for event in events)
    review = client.post(
        f"{BASE}/tasks/{task['id']}/review",
        json={
            "expected_version": 2,
            "run_id": run["id"],
            "run_version": run["version"],
            "decision": "accept",
            "comment": "Code reviewed",
            "idempotency_key": "review",
            "dry_run": False,
        },
    )
    assert review.status_code == 200, review.text
    assert review.json()["items"][0]["phase"] == "accepted"


def test_untracked_code_cannot_be_accepted(git_delivery):
    client, _, _, task, head = git_delivery
    result = dispatch(
        client,
        task,
        head,
        [{"id": "new", "argv": ["workspace-file-write", "new.txt", "missing", "new code"]}],
    ).json()["items"][0]
    run = result["run"]
    client.post(
        f"{BASE}/runs/{run['id']}/start",
        json={"expected_version": 1, "idempotency_key": "start", "dry_run": False},
    )
    run = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert run["data"]["code_evidence"]["untracked"] == ["new.txt"]
    review = client.post(
        f"{BASE}/tasks/{task['id']}/review",
        json={
            "expected_version": 2,
            "run_id": run["id"],
            "run_version": run["version"],
            "decision": "accept",
            "comment": "Attempt",
            "idempotency_key": "review",
        },
    )
    assert review.status_code == 409
    assert review.json()["error"]["code"] == "code_evidence_incomplete"


def test_repository_scope_and_invalid_dispatch(git_delivery):
    client, _, workspace, task, head = git_delivery
    assert (
        client.get(
            f"{BASE}/workspaces/{workspace}/repository", headers={"Authorization": "Bearer other"}
        ).status_code
        == 404
    )
    assert client.get(f"{BASE}/workspaces/{uuid.uuid4().hex}/repository").status_code == 403
    nodes = [{"id": "x", "argv": ["echo", "test"]}]
    assert dispatch(client, task, "", nodes).status_code == 422
    assert dispatch(client, task, "HEAD", nodes).status_code == 422
    assert dispatch(client, task, "0" * 40, nodes).status_code == 422
    assert (
        client.post(
            f"{BASE}/tasks/{task['id']}/dispatch",
            headers={"Authorization": "Bearer reader"},
            json={
                "expected_version": 1,
                "idempotency_key": "denied",
                "nodes": nodes,
                "isolation": "git_worktree",
                "base_commit": head,
            },
        ).status_code
        == 403
    )
    assert client.get(BASE + "/runs").json()["items"] == []


def test_failed_node_retains_code_evidence(git_delivery):
    client, root, _, task, head = git_delivery
    nodes = [
        {
            "id": "write",
            "argv": [
                "workspace-file-write",
                "note.txt",
                hashlib.sha256(b"base\n").hexdigest(),
                "failed change\n",
            ],
        },
        {"id": "fail", "argv": ["git", "diff", "--exit-code", "--quiet"]},
    ]
    run = dispatch(client, task, head, nodes).json()["items"][0]["run"]
    client.post(
        f"{BASE}/runs/{run['id']}/start",
        json={"expected_version": 1, "idempotency_key": "start", "dry_run": False},
    )
    run = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert run["status"] == "failed"
    assert "+failed change" in run["data"]["code_evidence"]["patch"]
    assert (root / "note.txt").read_text() == "user draft\n"


def test_truncated_diff_blocks_acceptance(git_delivery):
    client, _, _, task, head = git_delivery
    nodes = [
        {
            "id": "large",
            "argv": ["workspace-file-write", "note.txt", hashlib.sha256(b"base\n").hexdigest(), "x" * 70000],
        }
    ]
    run = dispatch(client, task, head, nodes).json()["items"][0]["run"]
    client.post(
        f"{BASE}/runs/{run['id']}/start",
        json={"expected_version": 1, "idempotency_key": "start", "dry_run": False},
    )
    run = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert run["status"] == "completed"
    assert run["data"]["code_evidence"]["truncated"] is True
    assert run["data"]["code_evidence"]["complete"] is False
    review = client.post(
        f"{BASE}/tasks/{task['id']}/review",
        json={
            "expected_version": 2,
            "run_id": run["id"],
            "run_version": run["version"],
            "decision": "accept",
            "comment": "Attempt",
            "idempotency_key": "review",
        },
    )
    assert review.status_code == 409


def test_missing_recorded_worktree_is_not_recreated(git_delivery):
    client, _, _, task, head = git_delivery
    run = dispatch(
        client,
        task,
        head,
        [{"id": "approval", "kind": "approval"}, {"id": "verify", "argv": ["git", "status", "--porcelain"]}],
    ).json()["items"][0]["run"]
    client.post(
        f"{BASE}/runs/{run['id']}/start",
        json={"expected_version": 1, "idempotency_key": "start", "dry_run": False},
    )
    run = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    target = Path(run["data"]["code_workspace"]["root"])
    target.rename(target.with_name(target.name + "-held"))
    approval = client.get(BASE + "/approvals").json()["items"][0]
    client.post(
        f"{BASE}/approvals/{approval['id']}/decision",
        json={"decision": "approve", "expected_version": approval["version"], "idempotency_key": "approve"},
    )
    run = client.get(f"{BASE}/runs/{run['id']}").json()["items"][0]
    assert run["status"] == "failed"
    assert "missing" in run["data"]["error"]
    assert not target.exists()
    assert run["data"]["code_evidence"] is None
