"""The published protocol must describe the actual independent discussion API."""

from pathlib import Path

import yaml
from fastapi import FastAPI
from sop_manager.routers.delivery_discussions import router
from sop_manager.routers.delivery_source_contract import SOURCE_ACTIONS, DiscussionSourceReference


def public_name(value):
    return "Delivery" + value if value.startswith("Discussion") else "DeliveryDiscussion" + value


def refs(value):
    if isinstance(value, list):
        return [refs(item) for item in value]
    if isinstance(value, dict):
        return {
            key: "#/components/schemas/" + public_name(item.rsplit("/", 1)[-1])
            if key == "$ref" and item.startswith("#/components/schemas/") else refs(item)
            for key, item in value.items()
        }
    return value


def document():
    path = Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml"
    return yaml.safe_load(path.read_bytes())


def test_published_routes_requests_responses_and_models_match_real_handlers():
    app = FastAPI()
    app.include_router(router)
    actual = app.openapi()
    published = document()
    assert len(actual["paths"]) == 14
    assert sum(len(item) for item in actual["paths"].values()) == 18
    for path, methods in actual["paths"].items():
        for method, operation in methods.items():
            exposed = published["paths"][path][method]
            assert exposed.get("requestBody") == refs(operation.get("requestBody")), (method, path)
            assert exposed["responses"]["200"]["content"] == refs(operation["responses"]["200"]["content"])
            assert {"$ref": "#/components/parameters/RequiredBusinessProjectId"} in exposed["parameters"]
            for parameter in operation.get("parameters", []):
                if parameter.get("name") != "X-Project-Id":
                    assert refs(parameter) in exposed["parameters"], (method, path, parameter)
    for name, model in actual["components"]["schemas"].items():
        assert published["components"]["schemas"][public_name(name)] == refs(model), name


def test_selected_conclusion_is_optional_root_provenance_with_the_same_action_boundary():
    schemas = document()["components"]["schemas"]
    assert schemas["DeliveryDiscussionSourceReference"] == DiscussionSourceReference.model_json_schema()
    command = schemas["DeliveryCommand"]
    assert "source_reference" not in command["required"]
    assert command["properties"]["source_reference"]["anyOf"] == [
        {"$ref": "#/components/schemas/DeliveryDiscussionSourceReference"}, {"type": "null"},
    ]
    condition = next(item for item in command["allOf"] if item.get("if", {}).get("required") == ["source_reference"])
    assert set(condition["then"]["properties"]["action"]["enum"]) == SOURCE_ACTIONS
    assert condition["if"]["properties"]["source_reference"] == {"not": {"type": "null"}}
