import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from sop_sdk.errors import SopConflictError
from typer.testing import CliRunner


def test_collaboration_cli_reads_exact_selection_and_preserves_unknown_history(monkeypatch):
    calls = []

    class Client:
        def delivery_activity(self, **options):
            calls.append(("activity", options))
            return {"items": [], "coverage": "recorded_only"}

        def delivery_activity_event(self, event_id):
            calls.append(("event", event_id))
            return {"id": event_id, "target": None}

        def delivery_requirement_history(self, requirement_id, **options):
            calls.append(("history", requirement_id, options))
            return {"items": [], "earlier_history_unknown": True}

        def delivery_requirement_version(self, requirement_id, version_id):
            calls.append(("version", requirement_id, version_id))
            return {"id": version_id, "observed_at": "2026-10-17T00:00:00Z"}

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    runner = CliRunner()
    cases = [
        ["activity", "--scope", "requirement", "--scope-id", "REQ-one", "--cursor", "fixed", "--limit", "7"],
        ["activity", "--event", "event-one"],
        ["requirement-history", "--id", "REQ-one", "--cursor", "observed", "--limit", "5"],
        ["requirement-history", "--id", "REQ-one", "--version", "version-one"],
    ]
    for args in cases:
        result = runner.invoke(delivery.app, args)
        assert result.exit_code == 0, result.output
        assert isinstance(json.loads(result.output), dict)
    assert calls == [
        ("activity", {"scope": "requirement", "scope_id": "REQ-one", "cursor": "fixed", "limit": 7}),
        ("event", "event-one"), ("history", "REQ-one", {"cursor": "observed", "limit": 5}),
        ("version", "REQ-one", "version-one"),
    ]


def test_preview_cli_keeps_fixed_file_on_conflict_and_never_commits(monkeypatch, tmp_path):
    body = {"requirement_basis": "b" * 64, "changes": {"title": "Explicit change"}}
    file = tmp_path / "proposal.json"
    original = json.dumps(body)
    file.write_bytes(original.encode())
    calls = []

    class Client:
        def delivery_requirement_change_preview(self, requirement_id, proposal):
            calls.append((requirement_id, proposal))
            raise SopConflictError("Requirement changed", status=409)

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    result = CliRunner().invoke(delivery.app, ["requirement-change-preview", "--id", "REQ-one", "--file", str(file)])
    assert result.exit_code == 1 and "Requirement changed" in result.output
    assert calls == [("REQ-one", body)] and file.read_text() == original
