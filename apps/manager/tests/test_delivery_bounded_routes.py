"""Public HTTP catalogue boundaries; no workspace provisioning or eager proof payloads."""

from test_delivery_workbench import env as delivery_env
from test_delivery_workbench import requirement

env = delivery_env


def test_catalogue_and_release_context_are_separate_http_resources(env):
    client, _, _ = env
    rid = requirement(client)
    response = client.get("/api/v1/delivery/quality/catalogue", params={"kind": "requirement", "limit": 1})
    assert response.status_code == 200, response.text
    page = response.json()
    assert page["total"] == 1 and page["limit"] == 1
    assert page["items"][0]["id"] == rid
    assert "task_ids" not in page["items"][0] and "acceptance_criteria" not in page["items"][0]
    response = client.get("/api/v1/delivery/releases")
    assert response.status_code == 200, response.text
    context = response.json()
    assert not {"evidence", "candidates", "legacy_history"} & context.keys()
    assert context["query_generation"] == page["query_generation"]
    for kind in ("candidate", "evidence", "legacy"):
        response = client.get("/api/v1/delivery/release-pages", params={"kind": kind, "limit": 1})
        assert response.status_code == 200, response.text
        assert response.json()["items"] == []
        assert response.json()["total"] == 0


def test_proof_requires_explicit_scope_and_bounded_http_parameters(env):
    client, _, _ = env
    requirement(client)
    response = client.get("/api/v1/delivery/quality")
    assert response.status_code == 422, response.text
    for path, params in [
        ("quality/catalogue", {"limit": 101}),
        ("quality/catalogue", {"kind": "linked-task"}),
        ("quality/catalogue", {"readiness": "passed"}),
        ("release-pages", {"kind": "all"}),
        ("release-pages", {"limit": 0}),
    ]:
        response = client.get("/api/v1/delivery/" + path, params=params)
        assert response.status_code == 422, response.text


def test_unknown_and_other_project_originals_do_not_fallback_to_first(env):
    client, _, _ = env
    requirement(client)
    for path in ("release-evidence/ci-missing", "releases/release-missing"):
        response = client.get("/api/v1/delivery/" + path)
        assert response.status_code == 404, response.text
