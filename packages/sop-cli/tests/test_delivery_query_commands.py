import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_bounded_query_commands_use_selected_reads(monkeypatch):
    calls = []

    class Client:
        def __getattr__(self, name):
            def invoke(*args, **options):
                calls.append((name, args, options))
                return {"query_generation": 8, "items": [], "total": 100}

            return invoke

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    cases = [
        ["context"],
        ["requirements", "--query", "Design", "--stage", "design", "--limit", "7"],
        ["requirement", "--id", "REQ-one"],
        ["tasks", "--requirement", "REQ-one", "--status", "verified_completed", "--cursor", "fixed"],
        ["task", "--id", "T-late"],
        ["issues", "--task", "T-late", "--severity", "P0"],
        ["execution", "--id", "execution-one"],
        ["references", "--kind", "member", "--ids", "user:one"],
        ["query-rebuild"],
    ]
    for args in cases:
        response = CliRunner().invoke(delivery.app, args)
        assert response.exit_code == 0, response.output
        assert json.loads(response.output)["query_generation"] == 8
    assert [c[0] for c in calls] == [
        "delivery_context",
        "delivery_requirements",
        "delivery_requirement",
        "delivery_tasks",
        "delivery_task",
        "delivery_issues",
        "delivery_execution",
        "delivery_references",
        "delivery_query_rebuild",
    ]
    assert calls[1][2]["q"] == "Design" and calls[1][2]["limit"] == 7
    assert calls[2][1] == ("REQ-one",)
    assert calls[3][2]["cursor"] == "fixed" and calls[3][2]["status"] == "verified_completed"
    assert calls[7][2]["ids"] == ["user:one"]
