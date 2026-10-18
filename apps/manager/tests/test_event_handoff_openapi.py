"""Published event protocol agrees with the actual response models and fixed-version mutations."""

from pathlib import Path

import yaml
from fastapi import FastAPI
from sop_manager.routers import events_ingest, sync_api
from sop_manager.routers.delivery_contract import PAYLOADS


def renamed(value):
    if isinstance(value, list):
        return [renamed(item) for item in value]
    if isinstance(value, dict):
        return {
            key: "#/components/schemas/EventHandoff" + item.rsplit("/", 1)[-1]
            if key == "$ref" and item.startswith("#/components/schemas/")
            else renamed(item)
            for key, item in value.items()
        }
    return value


def test_published_event_routes_models_and_explicit_project_header_match_service():
    app = FastAPI()
    app.include_router(events_ingest.router)
    app.include_router(sync_api.router)
    actual = app.openapi()
    published = yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml").read_bytes()
    )
    for path, methods in actual["paths"].items():
        if not path.startswith("/api/v1/events") and path != "/api/v1/sync/push":
            continue
        for method, operation in methods.items():
            public = published["paths"][path][method]
            assert public.get("requestBody") == renamed(operation.get("requestBody"))
            assert public["responses"]["200"]["content"] == renamed(operation["responses"]["200"]["content"])
            assert {"$ref": "#/components/parameters/RequiredBusinessProjectId"} in public["parameters"]
            for parameter in operation.get("parameters", []):
                if parameter["name"] != "X-Project-Id":
                    assert renamed(parameter) in public["parameters"]
    for action, name in [
        ("issue.create", "DeliveryIssueCreate"),
        ("sync.record.apply", "DeliverySyncRecordApply"),
    ]:
        assert published["components"]["schemas"][name] == PAYLOADS[action].model_json_schema()
        command = published["components"]["schemas"]["DeliveryCommand"]
        assert action in command["properties"]["action"]["enum"]
        assert any(
            item.get("if", {}).get("properties", {}).get("action", {}).get("const") == action
            and item["then"]["properties"]["payload"] == {"$ref": "#/components/schemas/" + name}
            for item in command["allOf"]
        )
