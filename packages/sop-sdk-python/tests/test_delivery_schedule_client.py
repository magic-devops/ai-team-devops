"""The planning client preserves explicit quantities, unknowns and pinned scope."""

import json
from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError
from sop_sdk.security import BearerAuth


@contextmanager
def planning_client(handler, retries=0):
    with ManagerClient(
        "https://manager.example",
        auth=BearerAuth("test-only"),
        project_id="selected",
        tenant_code="tenant",
        max_retries=retries,
    ) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        yield client


def test_schedule_get_preserves_unknown_capacity_explicit_units_and_date_scope():
    seen = []
    expected = {
        "project_id": "selected",
        "planning_basis": "a" * 64,
        "resources": [
            {
                "unit": "hours",
                "calendar": {"weekly": [8, 8, 8, 8, 8, 0, None]},
                "cells": [{"date": "2028-02-29", "available": None, "active_load": 0.5, "overload": None}],
            }
        ],
    }
    with planning_client(
        lambda request: seen.append(request) or httpx.Response(200, json=expected)
    ) as client:
        assert client.delivery_schedule(starts_on="2028-02-28", ends_on="2028-03-01") == expected
    assert len(seen) == 1
    assert seen[0].url.path == "/api/v1/delivery/schedule" and seen[0].method == "GET"
    assert dict(seen[0].url.params) == {"starts_on": "2028-02-28", "ends_on": "2028-03-01"}
    assert seen[0].headers["X-Project-Id"] == "selected"
    assert seen[0].headers["Authorization"] == "Bearer test-only"


def test_schedule_defaults_are_left_to_server_without_invented_filters_or_dates():
    seen = []
    with planning_client(
        lambda request: seen.append(request) or httpx.Response(200, json={"tasks": []})
    ) as client:
        assert client.delivery_schedule() == {"tasks": []}
    assert not dict(seen[0].url.params)


def test_one_endpoint_and_exactly_92_dates_remain_explicit_server_queries():
    seen = []
    with planning_client(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        client.delivery_schedule(ends_on="2028-02-29")
        client.delivery_schedule(starts_on="2026-01-01", ends_on="2026-04-02")
    assert dict(seen[0].url.params) == {"ends_on": "2028-02-29"}
    assert dict(seen[1].url.params) == {"starts_on": "2026-01-01", "ends_on": "2026-04-02"}


@pytest.mark.parametrize(
    "options",
    [
        {"starts_on": "2026-02-30"},
        {"ends_on": "2026/10/17"},
        {"starts_on": 20261017},
        {"starts_on": "2026-10-20", "ends_on": "2026-10-19"},
        {"starts_on": "2026-01-01", "ends_on": "2026-04-03"},
    ],
)
def test_invalid_schedule_window_is_rejected_before_transport(options):
    with planning_client(lambda _: pytest.fail("Invalid date window must not request")) as client:
        with pytest.raises(ValueError):
            client.delivery_schedule(**options)


def test_schedule_preview_retries_the_exact_explicit_proposal_without_date_or_quantity_inference():
    seen = []
    body = {
        "planning_basis": "b" * 64,
        "changes": [
            {
                "task_id": "T-one",
                "starts_on": "2026-10-19",
                "ends_on": "2026-10-20",
                "allocations": [
                    {
                        "member_id": "user:one",
                        "starts_on": "2026-10-19",
                        "ends_on": "2026-10-20",
                        "quantity_per_day": 0.5,
                        "weekdays": [0, 1],
                    }
                ],
            }
        ],
    }

    def handle(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadError("connection interrupted", request=request)
        return httpx.Response(
            200, json={"planning_basis": body["planning_basis"], "changes": [], "affected_task_ids": []}
        )

    with planning_client(handle, retries=1) as client:
        result = client.delivery_schedule_preview(body)
    assert result["planning_basis"] == body["planning_basis"]
    assert len(seen) == 2 and seen[0].content == seen[1].content
    assert seen[0].method == "POST" and seen[0].url.path == "/api/v1/delivery/schedule-preview"
    assert json.loads(seen[0].content) == body
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (409, SopConflictError)])
def test_planning_failures_are_propagated_without_fake_availability_or_success(status, error):
    problem = {"detail": {"code": "planning_basis_changed", "message": "Planning scope changed"}}
    with planning_client(lambda _: httpx.Response(status, json=problem)) as client:
        with pytest.raises(error) as caught:
            client.delivery_schedule_preview({"planning_basis": "c" * 64, "changes": []})
    assert caught.value.status == status and caught.value.detail == problem
