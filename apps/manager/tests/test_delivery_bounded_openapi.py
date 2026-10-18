from pathlib import Path

import yaml
from fastapi import FastAPI
from sop_manager.routers.delivery import router

PATHS = (
    "/api/v1/delivery/quality",
    "/api/v1/delivery/quality/catalogue",
    "/api/v1/delivery/releases",
    "/api/v1/delivery/release-pages",
    "/api/v1/delivery/release-evidence/{evidence_id}",
    "/api/v1/delivery/releases/{release_id}",
)


def test_bounded_read_openapi_matches_live_parameters_responses_and_all_referenced_models():
    app = FastAPI()
    app.include_router(router)
    actual = app.openapi()
    published = yaml.safe_load((Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml").read_bytes())
    assert published["components"]["schemas"]["QueryState"] == actual["components"]["schemas"]["QueryState"]
    seen = set()

    def verify_refs(value):
        if isinstance(value, dict):
            ref = value.get("$ref", "")
            if ref.startswith("#/components/schemas/"):
                name = ref.rsplit("/", 1)[-1]
                if name not in seen:
                    seen.add(name)
                    model = actual["components"]["schemas"][name]
                    assert published["components"]["schemas"][name] == model, name
                    verify_refs(model)
            for item in value.values():
                verify_refs(item)
        elif isinstance(value, list):
            for item in value:
                verify_refs(item)

    for path in PATHS:
        source = actual["paths"][path]["get"]
        target = published["paths"][path]["get"]
        assert target["parameters"] == source["parameters"], path
        assert target["responses"] == source["responses"], path
        verify_refs(source["responses"])
