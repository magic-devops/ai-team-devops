from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from hermes_core.api import create_app
from sop_cli.__main__ import app as sop_app
from sop_cli.commands import hermes as hermes_cmd
from sop_sdk import HermesClient
from typer.testing import CliRunner

AUTH_TOKEN = "tok" + "en"


def test_task_delivery_cli_sdk_round_trip(live_core, runner, tmp_path):
    sdk = live_core["sdk"]
    task = sdk.create_resource("tasks", {"title": "CLI delivery", "acceptance_criteria": "Check evidence"})["items"][0]
    assert sdk.task_delivery(task["id"])["items"][0]["phase"] == "unplanned"
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"nodes": [{"id": "test", "argv": ["echo", "test"]}]}))
    command = ["task", "v1", "dispatch", task["id"], "--plan", str(plan), "--expected-version", "1", "--json"]
    preview = runner.invoke(sop_app, command)
    assert preview.exit_code == 0, preview.output
    assert json.loads(preview.output)["summary"]["dry_run"]
    applied = runner.invoke(sop_app, [*command, "--apply"])
    assert applied.exit_code == 0, applied.output
    run = json.loads(applied.output)["items"][0]["run"]
    sdk.run_action(run["id"], "cancel", expected_version=1, dry_run=False)
    review = runner.invoke(sop_app, ["task", "v1", "review", task["id"], "--run-id", run["id"],
        "--run-version", "2", "--expected-version", "2", "--decision", "request_changes",
        "--comment", "Revise the test", "--apply", "--json"])
    assert review.exit_code == 0, review.output
    assert json.loads(review.output)["items"][0]["phase"] == "changes_requested"
    exported = sdk.run_action(run["id"], "export", expected_version=2)["items"][0]
    assert exported["task"]["id"] == task["id"]
    assert any(event["action"] == "task.review_evidence" for event in exported["task_events"])
    for subcommand in ("delivery", "dispatch", "review"):
        assert runner.invoke(sop_app, ["task", "v1", subcommand, "--help"]).exit_code == 0


class LiveCoreTransport(httpx.BaseTransport):
    def __init__(self, client: TestClient) -> None:
        self.client = client

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self.client.request(
            request.method,
            request.url.raw_path.decode(),
            content=request.content,
            headers=dict(request.headers),
        )
        return httpx.Response(
            response.status_code,
            headers=response.headers,
            content=response.content,
            request=request,
        )


@pytest.fixture
def live_core(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    app = create_app(tmp_path / "data", AUTH_TOKEN)
    monkeypatch.setattr(app.state.hermes_execution, "available", lambda: True)
    test_client = TestClient(app)
    transport = LiveCoreTransport(test_client)
    sdk = HermesClient("https://hermes.test", token=AUTH_TOKEN, transport=transport)
    workspace = sdk.create_workspace(
        {"name": "SDK CLI QA", "root": str(tmp_path)},
        idempotency_key="workspace",
    )["items"][0]
    sdk.workspace_id = workspace["id"]
    return {"app": app, "client": test_client, "transport": transport, "sdk": sdk, "workspace": workspace}


@pytest.fixture
def runner(live_core: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> CliRunner:
    def client_factory() -> HermesClient:
        return HermesClient(
            "https://hermes.test",
            token=AUTH_TOKEN,
            workspace_id=live_core["workspace"]["id"],
            transport=live_core["transport"],
        )

    monkeypatch.setattr(hermes_cmd, "get_hermes_client", client_factory)
    return CliRunner()


def test_sdk_live_core_health_assets_export_replay_and_approvals(live_core: dict[str, Any]) -> None:
    sdk: HermesClient = live_core["sdk"]

    health = sdk.health()
    assert health["ok"] is True
    assert health["service"] == "hermes-core"
    assert "items" not in health

    created = sdk.create_resource(
        "assets",
        {"title": "Contract asset", "kind": "knowledge", "content": "evidence"},
        idempotency_key="asset-create",
    )["items"][0]
    patched = sdk.patch_resource(
        "assets",
        created["id"],
        {"title": "Contract asset patched"},
        expected_version=created["version"],
        idempotency_key="asset-patch",
    )["items"][0]
    preview_delete = sdk.delete_resource(
        "assets",
        patched["id"],
        expected_version=patched["version"],
        idempotency_key="asset-delete-preview",
    )
    assert preview_delete["summary"]["dry_run"] is True
    assert preview_delete["items"][0]["status"] == "active"
    deleted = sdk.delete_resource(
        "assets",
        patched["id"],
        expected_version=patched["version"],
        dry_run=False,
        idempotency_key="asset-delete-apply",
    )["items"][0]
    assert deleted["status"] == "archived"

    run = sdk.create_resource(
        "runs",
        {
            "title": "Export replay QA",
            "nodes": [{"id": "review", "kind": "approval", "title": "Approve QA"}],
        },
        idempotency_key="run-create",
    )["items"][0]
    export_preview = sdk.run_action(run["id"], "export", expected_version=run["version"], idempotency_key="export-preview")
    assert export_preview["summary"]["dry_run"] is True
    exported = sdk.run_action(
        run["id"],
        "export",
        expected_version=run["version"],
        dry_run=False,
        idempotency_key="export-apply",
    )["items"][0]
    assert exported["kind"] == "artifacts"
    assert exported["data"]["kind"] == "hermes.audit-package"
    replayed = sdk.run_action(
        run["id"],
        "replay",
        expected_version=run["version"],
        dry_run=False,
        idempotency_key="replay-apply",
    )["items"][0]
    assert replayed["kind"] == "runs"
    assert replayed["status"] == "planned"
    assert replayed["data"]["replay_of"] == run["id"]

    started = sdk.run_action(
        run["id"],
        "start",
        expected_version=run["version"],
        dry_run=False,
        idempotency_key="start-approval-run",
    )["items"][0]
    approval = sdk.approvals()["items"][0]
    assert started["status"] == "queued"
    dry_decision = sdk.approval_decision(
        approval["id"],
        decision="approve",
        expected_version=approval["version"],
        idempotency_key="approval-preview",
    )
    assert dry_decision["summary"]["dry_run"] is True
    applied_decision = sdk.approval_decision(
        approval["id"],
        decision="approve",
        expected_version=approval["version"],
        dry_run=False,
        idempotency_key="approval-apply",
    )["items"][0]
    assert applied_decision["status"] == "approved"
    assert sdk.get_resource("runs", run["id"])["items"][0]["status"] == "completed"


def test_cli_live_core_direct_aliases_assets_runs_and_approvals(
    live_core: dict[str, Any],
    runner: CliRunner,
) -> None:
    create_asset = runner.invoke(
        sop_app,
        [
            "asset",
            "create",
            "--field",
            "title=CLI Contract",
            "--field",
            "kind=knowledge",
            "--field",
            "content=cli",
            "--idempotency-key",
            "cli-asset-create",
            "--json",
        ],
    )
    assert create_asset.exit_code == 0, create_asset.output
    asset = json.loads(create_asset.output)["items"][0]

    patch_asset = runner.invoke(
        sop_app,
        [
            "asset",
            "patch",
            asset["id"],
            "--expected-version",
            str(asset["version"]),
            "--field",
            "title=CLI Contract Patched",
            "--idempotency-key",
            "cli-asset-patch",
            "--json",
        ],
    )
    assert patch_asset.exit_code == 0, patch_asset.output
    patched = json.loads(patch_asset.output)["items"][0]

    dry_delete = runner.invoke(
        sop_app,
        [
            "asset",
            "delete",
            patched["id"],
            "--expected-version",
            str(patched["version"]),
            "--idempotency-key",
            "cli-asset-delete-preview",
            "--json",
        ],
    )
    assert dry_delete.exit_code == 0, dry_delete.output
    assert json.loads(dry_delete.output)["summary"]["dry_run"] is True

    apply_delete = runner.invoke(
        sop_app,
        [
            "asset",
            "delete",
            patched["id"],
            "--expected-version",
            str(patched["version"]),
            "--apply",
            "--idempotency-key",
            "cli-asset-delete-apply",
            "--json",
        ],
    )
    assert apply_delete.exit_code == 0, apply_delete.output
    assert json.loads(apply_delete.output)["items"][0]["status"] == "archived"

    sdk: HermesClient = live_core["sdk"]
    run = sdk.create_resource(
        "runs",
        {
            "title": "CLI export replay approval",
            "nodes": [{"id": "review", "kind": "approval", "title": "CLI approval"}],
        },
        idempotency_key="cli-run-create",
    )["items"][0]

    export_preview = runner.invoke(
        sop_app,
        ["run", "export", run["id"], "--expected-version", str(run["version"]), "--idempotency-key", "cli-export-preview", "--json"],
    )
    assert export_preview.exit_code == 0, export_preview.output
    assert json.loads(export_preview.output)["summary"]["dry_run"] is True

    export_apply = runner.invoke(
        sop_app,
        [
            "run",
            "export",
            run["id"],
            "--expected-version",
            str(run["version"]),
            "--apply",
            "--idempotency-key",
            "cli-export-apply",
            "--json",
        ],
    )
    assert export_apply.exit_code == 0, export_apply.output
    assert json.loads(export_apply.output)["items"][0]["kind"] == "artifacts"

    replay_apply = runner.invoke(
        sop_app,
        [
            "run",
            "replay",
            run["id"],
            "--expected-version",
            str(run["version"]),
            "--apply",
            "--idempotency-key",
            "cli-replay-apply",
            "--json",
        ],
    )
    assert replay_apply.exit_code == 0, replay_apply.output
    replayed = json.loads(replay_apply.output)["items"][0]
    assert replayed["status"] == "planned"
    assert replayed["data"]["replay_of"] == run["id"]

    start = runner.invoke(
        sop_app,
        [
            "run",
            "start",
            run["id"],
            "--expected-version",
            str(run["version"]),
            "--apply",
            "--idempotency-key",
            "cli-start",
            "--json",
        ],
    )
    assert start.exit_code == 0, start.output
    approval = sdk.approvals()["items"][0]

    approval_preview = runner.invoke(
        sop_app,
        [
            "approval",
            "decision",
            approval["id"],
            "approve",
            "--expected-version",
            str(approval["version"]),
            "--idempotency-key",
            "cli-approval-preview",
            "--json",
        ],
    )
    assert approval_preview.exit_code == 0, approval_preview.output
    assert json.loads(approval_preview.output)["summary"]["dry_run"] is True

    approval_apply = runner.invoke(
        sop_app,
        [
            "approval",
            "decision",
            approval["id"],
            "approve",
            "--expected-version",
            str(approval["version"]),
            "--apply",
            "--idempotency-key",
            "cli-approval-apply",
            "--json",
        ],
    )
    assert approval_apply.exit_code == 0, approval_apply.output
    assert json.loads(approval_apply.output)["items"][0]["status"] == "approved"
