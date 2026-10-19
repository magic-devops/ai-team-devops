"""The published small progress protocol matches every reachable live model."""

from pathlib import Path

import yaml
from fastapi import FastAPI
from sop_manager.routers.delivery import router


def test_bounded_progress_public_contract_matches_live_routes_and_referenced_models():
    app = FastAPI()
    app.include_router(router)
    actual = app.openapi()
    published = yaml.safe_load((Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml").read_bytes())
    paths = {path: "get" for path in actual["paths"] if path.startswith("/api/v1/delivery/progress") and path != "/api/v1/delivery/progress/summary"}
    paths.update({"/api/v1/delivery/tasks": "get", "/api/v1/delivery/query/rebuild": "post"})
    assert len(paths) == 18
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

    for path, verb in paths.items():
        live, public = actual["paths"][path][verb], published["paths"][path][verb]
        assert len(live["parameters"]) == len(public["parameters"])
        for generated, documented in zip(live["parameters"], public["parameters"], strict=True):
            if generated["name"] == "X-Project-Id":
                # The runtime empty default supplies canonical HTTP400, while
                # the published protocol requires explicit project selection.
                assert generated["required"] is False and documented["required"] is True
                assert {**documented, "required": False} == generated
            else:
                assert documented == generated
        for code, response in live["responses"].items():
            assert public["responses"][code] == response
        assert {"400", "401", "403", "404"} <= public["responses"].keys()
        verify(live)
    for old in ("ProgressScopes", "ProgressCurrent", "ProgressBaselineSummary", "ProgressBaseline", "ProgressTaskChange",
            "ProgressComparison", "ProgressResponse", "ProgressObservationResponse", "ProgressBaselineResponse"):
        assert old not in actual["components"]["schemas"] and old not in published["components"]["schemas"]
