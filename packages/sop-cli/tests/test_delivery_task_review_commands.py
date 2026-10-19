import json
from contextlib import contextmanager

import httpx
import pytest
from sop_cli.commands import delivery
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopForbiddenError
from typer.testing import CliRunner


def test_review_cli_preserves_small_history_and_explicit_opaque_page(monkeypatch):
    expected = {
        "task_id": "T-one",
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
        delivery.app, ["reviews", "T-one", "--limit", "1", "--cursor", "opaque/+?=:window", "--json"]
    )
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert seen == [("T-one", {"limit": 1, "cursor": "opaque/+?=:window"})]


@pytest.mark.parametrize(
    "arguments,path,expected",
    [
        (["review-current", "T-one", "--json"], "/api/v1/delivery/tasks/T-one/review-current",
         {"task_id": "T-one", "query_generation": 4, "current": {"eligible": True}, "effective_review_id": "review-one"}),
        (["review", "T-deleted", "review-old", "--json"], "/api/v1/delivery/tasks/T-deleted/reviews/review-old",
         {"task_id": "T-deleted", "review": {"id": "review-old", "snapshot": {"task": {"title": "Deleted"}}, "comment": "Original", "invalidated": True}}),
        (["reviews", "T-one", "--json"], "/api/v1/delivery/tasks/T-one/reviews",
         {"task_id": "T-one", "reviews": [], "total": 0, "limit": 20, "next_cursor": None}),
    ],
)
def test_review_commands_read_only_the_selected_resource(monkeypatch, arguments, path, expected):
    seen = []
    @contextmanager
    def client():
        with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as manager:
            manager._client.close()
            manager._client = httpx.Client(transport=httpx.MockTransport(
                lambda request: seen.append(request) or httpx.Response(200, json=expected)
            ), base_url=manager.base_url)
            yield manager
    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, arguments)
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert seen[0].url.path == path
    assert dict(seen[0].url.params) == ({"limit": "20"} if arguments[0] == "reviews" else {})
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("arguments", [["review-current", "T-one", "--json"], ["review", "T-one", "review-one", "--json"]])
def test_exact_review_read_errors_remain_errors(monkeypatch, arguments):
    @contextmanager
    def client():
        with ManagerClient("https://manager.example", max_retries=0) as manager:
            manager._client.close()
            manager._client = httpx.Client(transport=httpx.MockTransport(
                lambda _: httpx.Response(403, json={"detail": "Review inaccessible"})
            ), base_url=manager.base_url)
            yield manager
    monkeypatch.setattr(delivery, "get_client", client)
    output = CliRunner().invoke(delivery.app, arguments)
    assert output.exit_code == 1
    assert "Review inaccessible" in output.output


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
