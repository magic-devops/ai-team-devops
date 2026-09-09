from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping
from enum import Enum
from pathlib import Path
from typing import Any

import typer
from rich.table import Table
from sop_sdk import HermesClient, SopError

from .._util import console, err, kv

RESOURCE_NAMES = (
    "agents",
    "sessions",
    "runs",
    "assets",
    "devices",
    "tasks",
    "requirements",
    "schedules",
    "squads",
)
DELETE_NAMES = {"assets"}
CREATE_DISABLED_NAMES = {"artifacts", "schedules"}
PATCH_DISABLED_NAMES = {"artifacts", "devices", "schedules"}
FIELD_OPTION = typer.Option(None, "--field", help="Merge KEY=JSON_VALUE into body.data")
PLAN_OPTION = typer.Option(..., "--plan", exists=True, dir_okay=False, help="JSON file containing a nodes array")
CREDENTIAL_FILE_OPTION = typer.Option(..., "--credential-file")
TARGET_ROOT_OPTION = typer.Option(None, "--target-root", exists=True, file_okay=False)
WORKSPACE_MAP_OPTION = typer.Option(None, "--workspace-map")
OUTBOX_DIR_OPTION = typer.Option(None, "--outbox-dir", help="Private durable result outbox directory")


class DispatchIsolation(str, Enum):
    workspace = "workspace"
    git_worktree = "git_worktree"


class RuntimeCapability(str, Enum):
    command = "command"
    agent = "agent"


RUNTIME_CAPABILITY_OPTION = typer.Option(None, "--runtime-capability", help="Opt in to runtime kinds; repeat for command and agent")


DISPATCH_ISOLATION_OPTION = typer.Option(
    DispatchIsolation.workspace,
    "--isolation",
    help="Dispatch isolation",
)
BASE_COMMIT_OPTION = typer.Option("", "--base-commit", help="Pinned base commit SHA for git_worktree dispatch")
DEVICE_ID_OPTION = typer.Option("", "--device-id", help="Remote execution device id")


def get_hermes_client() -> HermesClient:
    base_url = os.environ.get("HERMES_URL", "").strip()
    token = os.environ.get("HERMES_TOKEN", "").strip()
    if not token and os.environ.get("HERMES_TOKEN_FILE"):
        token = Path(os.environ["HERMES_TOKEN_FILE"]).read_text(encoding="utf-8").strip()
    workspace = os.environ.get("HERMES_WORKSPACE", "").strip()
    if not base_url:
        raise typer.BadParameter("HERMES_URL is required")
    return HermesClient(base_url, token=token, workspace_id=workspace)


def _load_object(raw: str, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise typer.BadParameter(f"{label} must be valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise typer.BadParameter(f"{label} must be a JSON object")
    return value


def _field_value(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _merge_fields(data: dict[str, Any], fields: list[str] | None) -> dict[str, Any]:
    merged = dict(data)
    for item in fields or []:
        key, sep, value = item.partition("=")
        if not sep or not key.strip():
            raise typer.BadParameter("--field must be KEY=VALUE")
        merged[key.strip()] = _field_value(value)
    return merged


def _print_payload(payload: Mapping[str, Any], *, as_json: bool) -> None:
    if as_json:
        console.print_json(json.dumps(payload, ensure_ascii=False))
        return
    scope = payload.get("scope") or {}
    summary = payload.get("summary") or {}
    items = payload.get("items") or []
    kv("ok", payload.get("ok"))
    kv("trace_id", payload.get("trace_id", ""))
    if scope:
        kv("scope", json.dumps(scope, ensure_ascii=False, separators=(",", ":")))
    if summary:
        kv("summary", json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    if isinstance(items, list) and items:
        table = Table(show_header=True, header_style="bold")
        for column in ("id", "kind", "version", "status", "title", "updated_at"):
            table.add_column(column)
        for item in items:
            if not isinstance(item, Mapping):
                continue
            data = item.get("data") or {}
            if not isinstance(data, Mapping):
                data = {}
            table.add_row(
                str(item.get("id", "")),
                str(item.get("kind", "")),
                str(item.get("version", "")),
                str(item.get("status", "")),
                str(data.get("title") or data.get("name") or ""),
                str(item.get("updated_at", "")),
            )
        console.print(table)


def _run_call(call: Callable[[HermesClient], dict[str, Any]], *, as_json: bool) -> dict[str, Any]:
    try:
        with get_hermes_client() as client:
            result = call(client)
            _print_payload(result, as_json=as_json)
            return result
    except (SopError, ValueError, OSError, typer.BadParameter) as exc:
        status = getattr(exc, "status", None)
        if as_json:
            typer.echo(json.dumps({"ok": False, "error": {
                "code": type(exc).__name__, "message": str(exc), "status": status,
            }}, ensure_ascii=False))
        else:
            err(str(exc))
        raise typer.Exit(2 if status in {400, 401, 403, 404, 409, 422} else 1) from exc


def build_resource_app(resource: str, *, allow_delete: bool | None = None) -> typer.Typer:  # noqa: C901
    app = typer.Typer(help=f"Hermes {resource} /api/hermes/v1 commands", no_args_is_help=True)
    delete_enabled = (resource in DELETE_NAMES) if allow_delete is None else allow_delete

    @app.command("list")
    def list_items(
        q: str = typer.Option("", "--q"),
        status: str = typer.Option("", "--status"),
        kind: str = typer.Option("", "--kind"),
        limit: int = typer.Option(50, "--limit", min=1),
        cursor: str = typer.Option("", "--cursor"),
        json_output: bool = typer.Option(False, "--json"),
    ) -> None:
        _run_call(
            lambda client: client.list_resource(resource, q=q, status=status, kind=kind, limit=limit, cursor=cursor),
            as_json=json_output,
        )

    @app.command("get")
    def get_item(
        entity_id: str = typer.Argument(..., metavar="ID"),
        json_output: bool = typer.Option(False, "--json"),
    ) -> None:
        _run_call(lambda client: client.get_resource(resource, entity_id), as_json=json_output)

    if resource not in CREATE_DISABLED_NAMES:

        @app.command("create")
        def create_item(
            data: str = typer.Option("{}", "--data", help="JSON object for body.data"),
            field: list[str] | None = FIELD_OPTION,
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            parsed = _merge_fields(_load_object(data, label="--data"), field)
            def call(client):
                if resource == "agents":
                    return client.create_agent_profile(parsed, idempotency_key=idempotency_key or None)
                if resource == "squads":
                    return client.create_squad(parsed, idempotency_key=idempotency_key or None)
                return client.create_resource(resource, parsed, idempotency_key=idempotency_key or None)
            _run_call(call, as_json=json_output)

    if resource not in PATCH_DISABLED_NAMES:

        @app.command("patch")
        def patch_item(
            entity_id: str = typer.Argument(..., metavar="ID"),
            expected_version: int = typer.Option(..., "--expected-version"),
            data: str = typer.Option("{}", "--data", help="JSON object for body.data"),
            field: list[str] | None = FIELD_OPTION,
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            parsed = _merge_fields(_load_object(data, label="--data"), field)
            _run_call(
                lambda client: client.patch_resource(
                    resource,
                    entity_id,
                    parsed,
                    expected_version=expected_version,
                    idempotency_key=idempotency_key or None,
                ),
                as_json=json_output,
            )

    if delete_enabled:

        @app.command("delete")
        def delete_item(
            entity_id: str = typer.Argument(..., metavar="ID"),
            expected_version: int = typer.Option(..., "--expected-version", min=1),
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.delete_resource(
                resource, entity_id, expected_version=expected_version,
                dry_run=not apply, idempotency_key=idempotency_key or None,
            ), as_json=json_output)

    if resource in {"agents", "squads"}:

        @app.command("catalog")
        def catalog(json_output: bool = typer.Option(False, "--json")) -> None:
            if resource == "agents":
                _run_call(lambda client: client.agent_catalog(), as_json=json_output)
                return
            _run_call(lambda client: client.list_resource("squads", q="", status="", kind="", limit=50, cursor=""),
                      as_json=json_output)

    if resource == "devices":

        @app.command("pairing")
        def device_pairing(
            device_id: str = typer.Argument(..., metavar="ID"),
            expected_version: int = typer.Option(..., "--expected-version", min=1),
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.device_pairing(
                device_id,
                expected_version=expected_version,
                dry_run=not apply,
                idempotency_key=idempotency_key or None,
            ), as_json=json_output)

        @app.command("pair")
        def device_pair(
            device_id: str = typer.Argument(..., metavar="ID"),
            secret: str = typer.Option(..., "--secret", help="One-use pairing secret"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.device_pair(device_id, secret), as_json=json_output)

        @app.command("revoke")
        def device_revoke(
            device_id: str = typer.Argument(..., metavar="ID"),
            expected_version: int = typer.Option(..., "--expected-version", min=1),
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.device_revoke(
                device_id,
                expected_version=expected_version,
                dry_run=not apply,
                idempotency_key=idempotency_key or None,
            ), as_json=json_output)

    if resource == "schedules":

        @app.command("preview")
        def schedule_preview(
            data: str = typer.Option(..., "--data", help="Typed schedule configuration JSON"),
            runs: int = typer.Option(5, "--runs", min=1, max=20),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            parsed = _load_object(data, label="--data")
            _run_call(lambda client: client.schedule_preview(parsed, runs=runs), as_json=json_output)

        @app.command("webhook-test")
        def schedule_webhook_test(
            schedule_id: str,
            expected_version: int = typer.Option(..., "--expected-version", min=1),
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.schedule_webhook_test(schedule_id, expected_version=expected_version,
                      dry_run=not apply, idempotency_key=idempotency_key or None), as_json=json_output)

        @app.command("configure")
        def schedule_configure(
            schedule_id: str = typer.Argument(..., metavar="SCHEDULE_ID"),
            data: str = typer.Option("{}", "--data", help="JSON object for schedule configuration"),
            field: list[str] | None = FIELD_OPTION,
            expected_version: int | None = typer.Option(None, "--expected-version", min=1),
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            parsed = _merge_fields(_load_object(data, label="--data"), field)
            _run_call(lambda client: client.schedule_configure(
                schedule_id,
                parsed,
                expected_version=expected_version,
                dry_run=not apply,
                idempotency_key=idempotency_key or None,
            ), as_json=json_output)

        def register_schedule_action(action_name: str) -> None:
            @app.command(action_name)
            def named_schedule_action(
                schedule_id: str = typer.Argument(..., metavar="SCHEDULE_ID"),
                expected_version: int = typer.Option(..., "--expected-version", min=1),
                apply: bool = typer.Option(False, "--apply/--dry-run"),
                idempotency_key: str = typer.Option("", "--idempotency-key"),
                json_output: bool = typer.Option(False, "--json"),
            ) -> None:
                _run_call(lambda client: client.schedule_action(
                    schedule_id,
                    action_name,
                    expected_version=expected_version,
                    dry_run=not apply,
                    idempotency_key=idempotency_key or None,
                ), as_json=json_output)

        for schedule_action_name in ("trigger", "pause", "resume"):
            register_schedule_action(schedule_action_name)

        @app.command("history")
        def schedule_history(
            schedule_id: str = typer.Argument(..., metavar="SCHEDULE_ID"),
            limit: int = typer.Option(50, "--limit", min=1),
            cursor: str = typer.Option("", "--cursor"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.schedule_history(schedule_id, limit=limit, cursor=cursor), as_json=json_output)

    if resource == "tasks":

        @app.command("delivery")
        def task_delivery(task_id: str, json_output: bool = typer.Option(False, "--json")) -> None:
            _run_call(lambda client: client.task_delivery(task_id), as_json=json_output)

        @app.command("dispatch")
        def task_dispatch(
            task_id: str,
            plan: Path = PLAN_OPTION,
            expected_version: int = typer.Option(..., "--expected-version", min=1),
            isolation: DispatchIsolation = DISPATCH_ISOLATION_OPTION,
            base_commit: str = BASE_COMMIT_OPTION,
            device_id: str = DEVICE_ID_OPTION,
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            def call(client):
                nodes = _load_object(plan.read_text(encoding="utf-8"), label="--plan").get("nodes")
                if not isinstance(nodes, list):
                    raise ValueError("--plan must contain a nodes array")
                return client.task_dispatch(task_id, nodes, expected_version=expected_version,
                                            dry_run=not apply, idempotency_key=idempotency_key or None,
                                            isolation=isolation.value, base_commit=base_commit,
                                            target_device_id=device_id)
            _run_call(call, as_json=json_output)

        @app.command("agent-dispatch")
        def task_agent_dispatch(
            task_id: str,
            prompt: str = typer.Option(..., "--prompt", help="Instruction prompt for the selected agent or squad leader"),
            agent_id: str = typer.Option("", "--agent-id", help="Agent profile id to run"),
            squad_id: str = typer.Option("", "--squad-id", help="Squad id; only the leader wakes and routes members"),
            expected_version: int = typer.Option(..., "--expected-version", min=1),
            target_version: int = typer.Option(..., "--target-version", min=1, help="Selected agent/squad row.version"),
            device_id: str = DEVICE_ID_OPTION,
            isolation: DispatchIsolation = DISPATCH_ISOLATION_OPTION,
            base_commit: str = BASE_COMMIT_OPTION,
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.task_agent_dispatch(
                task_id,
                expected_version=expected_version,
                target_version=target_version,
                target_device_id=device_id,
                prompt=prompt,
                agent_id=agent_id,
                squad_id=squad_id,
                dry_run=not apply,
                idempotency_key=idempotency_key or None,
                isolation=isolation.value,
                base_commit=base_commit,
            ), as_json=json_output)

        @app.command("review")
        def task_review(
            task_id: str,
            run_id: str = typer.Option(..., "--run-id"),
            run_version: int = typer.Option(..., "--run-version", min=1),
            expected_version: int = typer.Option(..., "--expected-version", min=1),
            decision: str = typer.Option(..., "--decision"),
            comment: str = typer.Option(..., "--comment"),
            apply: bool = typer.Option(False, "--apply/--dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.task_review(task_id, run_id=run_id, run_version=run_version,
                expected_version=expected_version, decision=decision, comment=comment,
                dry_run=not apply, idempotency_key=idempotency_key or None), as_json=json_output)

    if resource == "runs":

        @app.command("events")
        def run_events(
            run_id: str = typer.Argument(..., metavar="RUN_ID"),
            after: int = typer.Option(0, "--after"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.run_events(run_id, after=after), as_json=json_output)

        @app.command("changes")
        def run_changes(
            run_id: str = typer.Argument(..., metavar="RUN_ID"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.run_changes(run_id), as_json=json_output)

        @app.command("action")
        def run_action(
            run_id: str = typer.Argument(..., metavar="RUN_ID"),
            action: str = typer.Argument(..., metavar="start|cancel|retry|replay|export"),
            expected_version: int = typer.Option(..., "--expected-version"),
            apply: bool = typer.Option(False, "--apply/--dry-run", help="Apply the action; default is dry-run"),
            idempotency_key: str = typer.Option("", "--idempotency-key"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(
                lambda client: client.run_action(
                    run_id,
                    action,
                    expected_version=expected_version,
                    dry_run=not apply,
                    idempotency_key=idempotency_key or None,
                ),
                as_json=json_output,
            )

        def register_action(action_name: str) -> None:
            @app.command(action_name)
            def named_action(
                run_id: str = typer.Argument(..., metavar="RUN_ID"),
                expected_version: int = typer.Option(..., "--expected-version", min=1),
                apply: bool = typer.Option(False, "--apply/--dry-run"),
                idempotency_key: str = typer.Option("", "--idempotency-key"),
                json_output: bool = typer.Option(False, "--json"),
            ) -> None:
                _run_call(lambda client: client.run_action(
                    run_id, action_name, expected_version=expected_version,
                    dry_run=not apply, idempotency_key=idempotency_key or None,
                ), as_json=json_output)

        for action_name in ("start", "cancel", "retry", "replay", "export"):
            register_action(action_name)

    return app


workspace_app = typer.Typer(help="Hermes workspaces /api/hermes/v1 commands", no_args_is_help=True)
approval_app = typer.Typer(help="Hermes approvals /api/hermes/v1 commands", no_args_is_help=True)


@workspace_app.command("list")
def list_workspaces(json_output: bool = typer.Option(False, "--json")) -> None:
    _run_call(lambda client: client.list_workspaces(), as_json=json_output)


@workspace_app.command("create")
def create_workspace(
    data: str = typer.Option("{}", "--data", help="JSON object for body.data"),
    field: list[str] | None = FIELD_OPTION,
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    parsed = _merge_fields(_load_object(data, label="--data"), field)
    _run_call(lambda client: client.create_workspace(parsed, idempotency_key=idempotency_key or None), as_json=json_output)


@workspace_app.command("repository")
def workspace_repository(
    workspace_id: str = typer.Argument(..., metavar="WORKSPACE_ID"),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    _run_call(lambda client: client.repository(workspace_id), as_json=json_output)


@approval_app.command("list")
def list_approvals(json_output: bool = typer.Option(False, "--json")) -> None:
    _run_call(lambda client: client.approvals(), as_json=json_output)


@approval_app.command("decision")
def approval_decision(
    approval_id: str = typer.Argument(..., metavar="ID"),
    decision: str = typer.Argument(..., metavar="approve|reject"),
    expected_version: int = typer.Option(..., "--expected-version"),
    apply: bool = typer.Option(False, "--apply/--dry-run"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    _run_call(
        lambda client: client.approval_decision(
            approval_id,
            decision=decision,
            expected_version=expected_version,
            dry_run=not apply,
            idempotency_key=idempotency_key or None,
        ),
        as_json=json_output,
    )


system_app = typer.Typer(help="Hermes runtime diagnostics, readiness and sync commands", no_args_is_help=True)
collaboration_app = typer.Typer(help="Membership-scoped team channels, threads and inbox", no_args_is_help=True)
system_app.add_typer(collaboration_app, name="collaboration")


@collaboration_app.command("channels")
def collaboration_channels(
    include_archived: bool = typer.Option(False, "--include-archived"),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    _run_call(lambda client: client.collaboration_channels(include_archived=include_archived), as_json=json_output)


@collaboration_app.command("members")
def collaboration_members(json_output: bool = typer.Option(False, "--json")) -> None:
    _run_call(lambda client: client.collaboration_members(), as_json=json_output)


@collaboration_app.command("configure")
def collaboration_configure(
    channel_id: str,
    data: str = typer.Option(..., "--data", help="Channel title, member identities and description JSON"),
    expected_version: int | None = typer.Option(None, "--expected-version", min=1),
    apply: bool = typer.Option(False, "--apply/--dry-run"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    parsed = _load_object(data, label="--data")
    _run_call(lambda client: client.collaboration_configure_channel(channel_id, parsed, expected_version=expected_version,
              dry_run=not apply, idempotency_key=idempotency_key or None), as_json=json_output)


@collaboration_app.command("threads")
def collaboration_threads(
    channel_id: str,
    include_archived: bool = typer.Option(False, "--include-archived"),
    cursor: str = typer.Option("", "--cursor"),
    limit: int = typer.Option(100, "--limit", min=1, max=500),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    _run_call(lambda client: client.collaboration_threads(channel_id, cursor=cursor, limit=limit, include_archived=include_archived), as_json=json_output)


@collaboration_app.command("messages")
def collaboration_messages(
    thread_id: str,
    after: int = typer.Option(0, "--after", min=0),
    limit: int = typer.Option(100, "--limit", min=1, max=500),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    _run_call(lambda client: client.collaboration_messages(thread_id, after=after, limit=limit), as_json=json_output)


@collaboration_app.command("inbox")
def collaboration_inbox(
    limit: int = typer.Option(100, "--limit", min=1, max=500),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    _run_call(lambda client: client.collaboration_inbox(limit=limit), as_json=json_output)


def _register_collaboration_write(name: str, call: Callable) -> None:
    @collaboration_app.command(name)
    def write(
        data: str = typer.Option(..., "--data", help="Typed collaboration action JSON"),
        apply: bool = typer.Option(False, "--apply/--dry-run"),
        idempotency_key: str = typer.Option("", "--idempotency-key"),
        json_output: bool = typer.Option(False, "--json"),
    ) -> None:
        parsed = _load_object(data, label="--data")
        _run_call(lambda client: call(client, parsed, dry_run=not apply, idempotency_key=idempotency_key or None), as_json=json_output)


_register_collaboration_write("thread-create", HermesClient.collaboration_create_thread)
_register_collaboration_write("send", HermesClient.collaboration_send_message)
_register_collaboration_write("read", HermesClient.collaboration_mark_read)


@collaboration_app.command("edit")
def collaboration_edit(
    message_id: str,
    data: str = typer.Option(..., "--data", help="Message body and mentions JSON"),
    expected_version: int = typer.Option(..., "--expected-version", min=1),
    apply: bool = typer.Option(False, "--apply/--dry-run"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    parsed = _load_object(data, label="--data")
    _run_call(lambda client: client.collaboration_edit_message(message_id, parsed, expected_version=expected_version,
              dry_run=not apply, idempotency_key=idempotency_key or None), as_json=json_output)


@collaboration_app.command("archive")
def collaboration_archive(
    resource: str,
    entity_id: str,
    expected_version: int = typer.Option(..., "--expected-version", min=1),
    apply: bool = typer.Option(False, "--apply/--dry-run"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    _run_call(lambda client: client.collaboration_archive(resource, entity_id, expected_version=expected_version,
              dry_run=not apply, idempotency_key=idempotency_key or None), as_json=json_output)


@system_app.command("diagnostics")
def system_diagnostics(json_output: bool = typer.Option(False, "--json")) -> None:
    result = _run_call(lambda client: client.system_diagnostics(), as_json=json_output)
    if not result.get("ok", False):
        raise typer.Exit(1)


@system_app.command("readiness")
def system_readiness(
    json_output: bool = typer.Option(False, "--json"),
    full: bool = typer.Option(False, "--full"),
) -> None:
    if not full:
        result = _run_call(lambda client: client.system_readiness(), as_json=json_output)
        if not result.get("ok", False):
            raise typer.Exit(1)
        return
    roots = [Path(os.environ["HERMES_SOURCE_ROOT"])] if os.environ.get("HERMES_SOURCE_ROOT") else Path(__file__).resolve().parents
    script = next((root / "scripts/hermes-readiness.py" for root in roots
                   if (root / "scripts/hermes-readiness.py").is_file()), None)
    if script is None:
        payload = {"ok": False, "error": {"code": "source_gate_unavailable",
                   "message": "Full source validation requires HERMES_SOURCE_ROOT"}}
        _print_payload(payload, as_json=json_output)
        raise typer.Exit(1)
    result = subprocess.run([sys.executable, str(script), "--full", "--json"], check=False)  # noqa: S603
    raise typer.Exit(result.returncode)


@system_app.command("sync")
def sync(after: int = typer.Option(0, "--after"), json_output: bool = typer.Option(False, "--json")) -> None:
    _run_call(lambda client: client.sync(after=after), as_json=json_output)


@system_app.command("actions")
def actions(json_output: bool = typer.Option(False, "--json")) -> None:
    _run_call(lambda client: client.actions(), as_json=json_output)


@system_app.command("health")
def health(json_output: bool = typer.Option(False, "--json")) -> None:
    _run_call(lambda client: client.health(), as_json=json_output)


@system_app.command("remote-worker")
def remote_worker(
    server: str = typer.Option(..., "--server"),
    credential_file: Path = CREDENTIAL_FILE_OPTION,
    device_id: str = typer.Option("", "--device-id"),
    pair_secret: str = typer.Option("", "--pair-secret"),
    pair_secret_stdin: bool = typer.Option(False, "--pair-secret-stdin"),
    workspace_id: str = typer.Option("", "--workspace-id"),
    target_root: Path | None = TARGET_ROOT_OPTION,
    workspace_map: list[str] | None = WORKSPACE_MAP_OPTION,
    agentd: str = typer.Option("", "--agentd"),
    runtime_capability: list[RuntimeCapability] | None = RUNTIME_CAPABILITY_OPTION,
    once: bool = typer.Option(False, "--once"),
    poll_interval: float = typer.Option(5.0, "--poll-interval"),
    outbox_dir: Path | None = OUTBOX_DIR_OPTION,
    outbox_status: bool = typer.Option(False, "--outbox-status", help="Print local recovery metadata as JSON"),
    flush_only: bool = typer.Option(False, "--flush-only", help="Retry saved results without claiming tasks"),
) -> None:
    maps = list(workspace_map or [])
    if target_root is not None:
        workspace = workspace_id or os.environ.get("HERMES_WORKSPACE", "").strip()
        if not workspace:
            raise typer.BadParameter("--workspace-id or HERMES_WORKSPACE is required with --target-root")
        maps.append(f"{workspace}={target_root.resolve()}")
    argv = [
        sys.executable,
        "-m",
        "hermes_core.remote_worker",
        "--server",
        server,
        "--credential-file",
        str(credential_file),
        "--poll-interval",
        str(poll_interval),
    ]
    if device_id:
        argv.extend(["--device-id", device_id])
    if pair_secret:
        argv.extend(["--pair-secret", pair_secret])
    for item in maps:
        argv.extend(["--workspace-map", item])
    if agentd:
        argv.extend(["--agentd", agentd])
    argv.extend(argument for capability in runtime_capability or [] for argument in ("--runtime-capability", capability.value))
    if once:
        argv.append("--once")
    if outbox_dir is not None:
        argv.extend(["--outbox-dir", str(outbox_dir)])
    if outbox_status:
        argv.append("--outbox-status")
    if flush_only:
        argv.append("--flush-only")
    if pair_secret_stdin:
        argv.append("--pair-secret-stdin")
    result = subprocess.run(argv, check=False)  # noqa: S603
    raise typer.Exit(result.returncode)
