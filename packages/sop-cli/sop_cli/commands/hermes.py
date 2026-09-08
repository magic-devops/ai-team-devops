from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from collections.abc import Callable, Mapping
from typing import Any

import typer
from rich.table import Table
from sop_sdk import HermesClient, SopError

from .._util import console, err, kv

RESOURCE_NAMES = (
    "sessions",
    "runs",
    "assets",
    "devices",
    "tasks",
    "requirements",
    "schedules",
)
DELETE_NAMES = {"assets", "devices", "schedules"}
FIELD_OPTION = typer.Option(None, "--field", help="Merge KEY=JSON_VALUE into body.data")


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


def _run_call(call: Callable[[HermesClient], dict[str, Any]], *, as_json: bool) -> None:
    try:
        with get_hermes_client() as client:
            _print_payload(call(client), as_json=as_json)
    except (SopError, ValueError, OSError, typer.BadParameter) as exc:
        status = getattr(exc, "status", None)
        if as_json:
            typer.echo(json.dumps({"ok": False, "error": {
                "code": type(exc).__name__, "message": str(exc), "status": status,
            }}, ensure_ascii=False))
        else:
            err(str(exc))
        raise typer.Exit(2 if status in {400, 401, 403, 404, 409, 422} else 1) from exc


def build_resource_app(resource: str, *, allow_delete: bool | None = None) -> typer.Typer:
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

    @app.command("create")
    def create_item(
        data: str = typer.Option("{}", "--data", help="JSON object for body.data"),
        field: list[str] | None = FIELD_OPTION,
        idempotency_key: str = typer.Option("", "--idempotency-key"),
        json_output: bool = typer.Option(False, "--json"),
    ) -> None:
        parsed = _merge_fields(_load_object(data, label="--data"), field)
        _run_call(
            lambda client: client.create_resource(resource, parsed, idempotency_key=idempotency_key or None),
            as_json=json_output,
        )

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

    if resource == "runs":

        @app.command("events")
        def run_events(
            run_id: str = typer.Argument(..., metavar="RUN_ID"),
            after: int = typer.Option(0, "--after"),
            json_output: bool = typer.Option(False, "--json"),
        ) -> None:
            _run_call(lambda client: client.run_events(run_id, after=after), as_json=json_output)

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


system_app = typer.Typer(help="Hermes system/readiness and sync commands", no_args_is_help=True)


@system_app.command("readiness")
def system_readiness(
    json_output: bool = typer.Option(False, "--json"),
    full: bool = typer.Option(False, "--full"),
) -> None:
    if not full:
        _run_call(lambda client: client.system_readiness(), as_json=json_output)
        return
    roots = [Path(os.environ["HERMES_SOURCE_ROOT"])] if os.environ.get("HERMES_SOURCE_ROOT") else Path(__file__).resolve().parents
    script = next((root / "scripts/hermes-readiness.py" for root in roots
                   if (root / "scripts/hermes-readiness.py").is_file()), None)
    if script is None:
        payload = {"ok": False, "error": {"code": "source_gate_unavailable",
                   "message": "Full source validation requires HERMES_SOURCE_ROOT"}}
        _print_payload(payload, as_json=json_output)
        raise typer.Exit(1)
    result = subprocess.run([sys.executable, str(script), "--full", "--json"], check=False)
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
