import json
from contextlib import contextmanager

import pytest
from sop_cli.commands import delivery
from sop_sdk.errors import SopForbiddenError
from typer.testing import CliRunner


@pytest.mark.parametrize(
    "command,method,arguments",
    [
        (
            [
                "progress",
                "--from",
                "2026-10-15",
                "--to",
                "2026-10-17",
                "--scope",
                "milestone",
                "--scope-id",
                "milestone-one",
                "--baseline",
                "baseline-one",
                "--json",
            ],
            "delivery_progress",
            {
                "starts_on": "2026-10-15",
                "ends_on": "2026-10-17",
                "scope": "milestone",
                "scope_id": "milestone-one",
                "baseline_id": "baseline-one",
            },
        ),
        (
            ["observation", "observation-one", "--scope", "sprint", "--scope-id", "sprint-one", "--json"],
            "delivery_progress_observation",
            {"id": "observation-one", "scope": "sprint", "scope_id": "sprint-one"},
        ),
        (["baseline", "baseline-one", "--json"], "delivery_baseline", {"id": "baseline-one"}),
    ],
)
def test_progress_cli_preserves_the_server_record_and_exact_filter_intent(
    monkeypatch, command, method, arguments
):
    seen = []
    expected = {"project_id": "selected"}
    if method == "delivery_progress":
        expected.update(days=[{"date": "2026-10-15", "metrics": None}],
                        current={"scope": {"kind": "milestone", "id": "milestone-one", "label": "Milestone"},
                                 "metrics": {"tasks_total": 500}})
    else:
        kind = "observation" if method == "delivery_progress_observation" else "baseline"
        expected[kind] = {"id": arguments["id"], "task_count": 500, "requirement_count": 80, "available": True}

    class Client:
        def __getattr__(self, name):
            assert name == method

            def call(*args, **kwargs):
                seen.append({**kwargs, **({"id": args[0]} if args else {})})
                return expected

            return call

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, command)
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert seen == [arguments]


def test_progress_cli_rejects_unknown_scope_and_never_invents_history_on_access_failure(monkeypatch):
    monkeypatch.setattr(
        delivery, "get_client", lambda: pytest.fail("Invalid scope must not construct client")
    )
    invalid = CliRunner().invoke(delivery.app, ["progress", "--scope", "all"])
    assert invalid.exit_code != 0

    class Client:
        def delivery_progress(self, **kwargs):
            raise SopForbiddenError("Project access denied", status=403)

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    denied = CliRunner().invoke(delivery.app, ["progress", "--json"])
    assert denied.exit_code == 1
    assert "Project access denied" in denied.output
