from sop_cli.commands import delivery
from typer.testing import CliRunner


def test_catalogue_commands_request_one_page_and_exact_evidence(monkeypatch):
    calls = []

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def delivery_quality_catalogue(self, **kwargs):
            calls.append(("quality-page", kwargs))
            return {"items": [], "total": 900, "next_cursor": "opaque"}

        def delivery_release_page(self, **kwargs):
            calls.append(("release-page", kwargs))
            return {"items": [], "total": 900, "next_cursor": "opaque"}

        def delivery_release_evidence(self, evidence_id):
            calls.append(("evidence", evidence_id))
            return {"id": evidence_id}

        def delivery_releases(self):
            calls.append(("context",))
            return {"project_id": "project"}

    monkeypatch.setattr(delivery, "get_client", lambda: Client())
    runner = CliRunner()
    for args in [
        ["quality", "--kind", "task", "--readiness", "attention", "--query", "alpha", "--limit", "3", "--cursor", "original"],
        ["releases", "--kind", "evidence", "--query", "commit", "--limit", "4", "--cursor", "next"],
        ["releases", "--kind", "evidence", "--id", "ci-original"],
        ["release-context"],
    ]:
        result = runner.invoke(delivery.app, args)
        assert result.exit_code == 0, result.output
    assert calls == [
        ("quality-page", {"kind": "task", "readiness": "attention", "q": "alpha", "limit": 3, "cursor": "original"}),
        ("release-page", {"kind": "evidence", "q": "commit", "limit": 4, "cursor": "next"}),
        ("evidence", "ci-original"),
        ("context",),
    ]


def test_exact_quality_cannot_silently_ignore_catalogue_filters(monkeypatch):
    monkeypatch.setattr(delivery, "get_client", lambda: (_ for _ in ()).throw(AssertionError("Must validate first")))
    result = CliRunner().invoke(delivery.app, ["quality", "--task-id", "task", "--query", "different"])
    assert result.exit_code != 0
    assert "catalogue" in result.output.lower()
