import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from sop_sdk.errors import SopConflictError
from typer.testing import CliRunner


def test_schedule_cli_preserves_unknowns_and_explicit_date_window(monkeypatch):
    seen = []
    expected = {
        "project_id": "selected",
        "resources": [{"cells": [{"available": None, "active_load": 0.5}]}],
        "tasks": [],
    }

    class Client:
        def delivery_schedule(self, **options):
            seen.append(options)
            return expected

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(
        delivery.app, ["schedule", "--from", "2026-10-19", "--to", "2026-10-25", "--json"]
    )
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert seen == [{"starts_on": "2026-10-19", "ends_on": "2026-10-25"}]


def test_schedule_preview_cli_sends_only_the_selected_fixed_proposal(monkeypatch, tmp_path):
    body = {
        "planning_basis": "a" * 64,
        "changes": [{"task_id": "T-one", "starts_on": None, "ends_on": None, "allocations": []}],
    }
    file = tmp_path / "proposal.json"
    file.write_text(json.dumps(body), encoding="utf-8")
    seen = []

    class Client:
        def delivery_schedule_preview(self, proposal):
            seen.append(proposal)
            return {
                "planning_basis": proposal["planning_basis"],
                "affected_task_ids": ["T-one"],
                "changes": [],
            }

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["schedule-preview", "--file", str(file)])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output)["affected_task_ids"] == ["T-one"] and seen == [body]


def test_schedule_preview_cli_conflict_is_an_error_with_input_left_unchanged(monkeypatch, tmp_path):
    original = json.dumps({"planning_basis": "b" * 64, "changes": [{"task_id": "T-one", "allocations": []}]})
    file = tmp_path / "proposal.json"
    file.write_text(original, encoding="utf-8")

    class Client:
        def delivery_schedule_preview(self, proposal):
            raise SopConflictError("Planning scope changed", status=409)

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["schedule-preview", "--file", str(file)])
    assert output.exit_code == 1 and "Planning scope changed" in output.output
    assert file.read_text(encoding="utf-8") == original


def test_schedule_preview_cli_rejects_extra_or_missing_fields_before_client(monkeypatch, tmp_path):
    file = tmp_path / "bad.json"
    file.write_text(json.dumps({"changes": [], "generator": "ai"}), encoding="utf-8")
    monkeypatch.setattr(
        delivery,
        "get_client",
        lambda: (_ for _ in ()).throw(AssertionError("Invalid proposal must not request")),
    )
    output = CliRunner().invoke(delivery.app, ["schedule-preview", "--file", str(file)])
    assert output.exit_code == 1, output.output
