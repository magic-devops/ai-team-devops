from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopForbiddenError
from sop_sdk.security import BearerAuth


@contextmanager
def progress_client(handler):
    with ManagerClient(
        "https://manager.example", auth=BearerAuth("test-only"), project_id="selected", max_retries=0
    ) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        yield client


def test_progress_preserves_real_gaps_baseline_and_scope_over_http():
    seen = []
    expected = {
        "project_id": "selected",
        "days": [{"date": "2026-10-16", "metrics": None}],
        "current": {"scope": {"kind": "milestone", "id": "milestone-one", "label": "Milestone"}, "metrics": {"tasks_total": 3}},
        "baseline": {"id": "baseline-one"},
    }

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json=expected)

    with progress_client(handle) as client:
        result = client.delivery_progress(
            starts_on="2026-10-15",
            ends_on="2026-10-17",
            scope="milestone",
            scope_id="milestone-one",
            baseline_id="baseline-one",
        )
    assert result == expected
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "GET" and request.url.path == "/api/v1/delivery/progress"
    assert dict(request.url.params) == {
        "starts_on": "2026-10-15",
        "ends_on": "2026-10-17",
        "scope": "milestone",
        "scope_id": "milestone-one",
        "baseline_id": "baseline-one",
    }
    assert request.headers["X-Project-Id"] == "selected"
    assert request.headers["Authorization"] == "Bearer test-only"


@pytest.mark.parametrize("kind", ["observation", "baseline"])
def test_history_metadata_is_an_exact_scoped_read_without_item_arrays(kind):
    seen = []
    expected = {
        "project_id": "selected",
        kind: {"id": f"{kind}-one", "task_count": 500, "requirement_count": 80, "available": True,
               "scope": {"kind": "sprint", "id": "sprint-one", "label": "Frozen sprint"}},
    }

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json=expected)

    with progress_client(handle) as client:
        if kind == "observation":
            result = client.delivery_progress_observation(
                "observation-one", scope="sprint", scope_id="sprint-one"
            )
        else:
            result = client.delivery_baseline("baseline-one")
    assert result == expected
    assert not {"tasks", "requirements", "task_ids", "comparison"} & set(result[kind])
    assert seen[0].method == "GET"
    assert (
        seen[0].url.path
        == f"/api/v1/delivery/progress/{'observations' if kind == 'observation' else 'baselines'}/{kind}-one"
    )
    assert seen[0].headers["X-Project-Id"] == "selected"
    if kind == "observation":
        assert dict(seen[0].url.params) == {"scope": "sprint", "scope_id": "sprint-one"}


@pytest.mark.parametrize(
    "options",
    [
        {"scope": "all"},
        {"scope": "sprint"},
        {"scope_id": "unexpected"},
        {"starts_on": "2026-02-30"},
        {"starts_on": "20261017"},
        {"starts_on": "2026-10-18", "ends_on": "2026-10-17"},
        {"starts_on": "2025-01-01", "ends_on": "2026-10-17"},
    ],
)
def test_invalid_progress_filters_fail_before_transport(options):
    with progress_client(lambda _: pytest.fail("Invalid filters must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_progress(**options)


def test_detail_ids_cannot_change_the_resource_path_and_403_is_not_synthetic_history():
    with progress_client(lambda _: pytest.fail("Invalid detail ID must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_baseline("../other")
        with pytest.raises(ValueError):
            client.delivery_progress_observation("one/two")
    with progress_client(lambda _: httpx.Response(403, json={"detail": "Project access denied"})) as client:
        with pytest.raises(SopForbiddenError):
            client.delivery_progress()
