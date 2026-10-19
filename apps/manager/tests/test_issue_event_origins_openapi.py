"""Published reverse-origin and existing Issue/query contracts match production."""

from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from sop_manager.routers.delivery import router


@pytest.mark.parametrize("path,verb", [
    ("/api/v1/delivery/issues/{issue_id}/origins", "get"),
    ("/api/v1/delivery/issues/{issue_id}/origins/{origin_id}", "get"),
    ("/api/v1/delivery/issues/{issue_id}", "get"),
    ("/api/v1/delivery/issues", "get"),
    ("/api/v1/delivery/query/rebuild", "post"),
])
def test_published_origin_contracts_match_current_production(path, verb):
    app = FastAPI()
    app.include_router(router)
    actual = app.openapi()
    published = yaml.safe_load((Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml").read_bytes())
    source = actual["paths"][path][verb]
    target = published["paths"][path][verb]
    assert len(target["parameters"]) == len(source["parameters"])
    for documented, generated in zip(target["parameters"], source["parameters"], strict=True):
        if generated["name"] == "X-Project-Id":
            # FastAPI's empty default preserves the canonical runtime 400 for
            # missing scope. The public protocol correctly requires that scope.
            assert documented["required"] is True
            assert generated["required"] is False
            assert {**documented, "required": False} == generated
        else:
            assert documented == generated
    # HTTPExceptions are real runtime responses, but FastAPI does not discover
    # them from handler code. Keep every generated success/validation contract
    # exact, and separately assert the published runtime error documentation.
    for code, response in source["responses"].items():
        assert target["responses"][code] == response
    errors = {"400": {"description": "Explicit project required"},
        "401": {"description": "Active authenticated identity required"},
        "403": {"description": "Current project or operation permission denied"},
        "404": {"description": "Exact scoped record not found"}}
    if path == "/api/v1/delivery/issues/{issue_id}":
        errors = {"400": {"description": "Explicit project context is required"},
            "401": {"description": "Authenticated active account required"},
            "403": {"description": "Project permission denied"},
            "404": {"description": "Scoped project, Issue or exact proposal not found"}}
    if path in {"/api/v1/delivery/issues", "/api/v1/delivery/query/rebuild"}:
        errors["409"] = {"description": "Query index requires explicit rebuild or cursor generation changed; do not mix pages"}
    assert {code: response for code, response in target["responses"].items()
        if code not in source["responses"]} == errors
    seen = set()

    def verify(value):
        if isinstance(value, dict):
            reference = value.get("$ref", "")
            if reference.startswith("#/components/schemas/"):
                name = reference.rsplit("/", 1)[-1]
                if name not in seen:
                    seen.add(name)
                    model = actual["components"]["schemas"][name]
                    assert published["components"]["schemas"][name] == model, name
                    verify(model)
            for item in value.values():
                verify(item)
        elif isinstance(value, list):
            for item in value:
                verify(item)

    verify(source["responses"])
