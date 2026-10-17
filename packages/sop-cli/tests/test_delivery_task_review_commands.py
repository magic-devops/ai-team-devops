import json
from contextlib import contextmanager

from sop_cli.commands import delivery
from sop_sdk.errors import SopForbiddenError
from typer.testing import CliRunner


def test_review_cli_preserves_original_snapshots_and_explicit_page(monkeypatch):
    expected = {
        "task_id": "T-one",
        "current": None,
        "reviews": [{"id": "review-old", "invalidated": True, "source": "manual"}],
        "next_cursor": "review-old",
    }
    seen = []

    class Client:
        def delivery_task_reviews(self, task_id, **options):
            seen.append((task_id, options))
            return expected

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(
        delivery.app, ["reviews", "T-one", "--limit", "1", "--cursor", "review-new", "--json"]
    )
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert seen == [("T-one", {"limit": 1, "cursor": "review-new"})]


def test_review_cli_denied_is_an_error_not_an_empty_approved_history(monkeypatch):
    class Client:
        def delivery_task_reviews(self, *args, **kwargs):
            raise SopForbiddenError("Review inaccessible", status=403)

    @contextmanager
    def client():
        yield Client()

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["reviews", "T-one", "--json"])
    assert output.exit_code == 1
    assert "Review inaccessible" in output.output


def test_review_cli_rejects_out_of_range_limit_before_constructing_client(monkeypatch):
    def client():
        raise AssertionError("Invalid limit must not construct client")

    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, ["reviews", "T-one", "--limit", "101"])
    assert output.exit_code == 2, output.output
