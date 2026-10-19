"""The published review protocol must match the independent production reads."""

from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from sop_manager.routers.delivery import router


@pytest.mark.parametrize("suffix", ["review-current", "reviews", "reviews/{review_id}"])
def test_published_manual_review_reads_match_actual_contract(suffix):
    app = FastAPI()
    app.include_router(router)
    actual = app.openapi()
    published = yaml.safe_load((Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml").read_bytes())
    path = "/api/v1/delivery/tasks/{task_id}/" + suffix
    source = actual["paths"][path]["get"]
    target = published["paths"][path]["get"]
    assert target["parameters"] == source["parameters"]
    assert target["responses"] == source["responses"]
    seen = set()

    def verify(value):
        if isinstance(value, dict):
            reference = value.get("$ref", "")
            if reference.startswith("#/components/schemas/"):
                name = reference.rsplit("/", 1)[-1]
                if name not in seen:
                    seen.add(name)
                    schema = actual["components"]["schemas"][name]
                    assert published["components"]["schemas"][name] == schema, name
                    verify(schema)
            for item in value.values():
                verify(item)
        elif isinstance(value, list):
            for item in value:
                verify(item)

    verify(source["responses"])
