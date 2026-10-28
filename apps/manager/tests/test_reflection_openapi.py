"""UNRUN: published reflection contract matches real DTOs and route response models."""
from pathlib import Path

import pytest
import yaml

from sop_manager.routers import reflection_contract as c
from test_event_handoff import env  # noqa: F401
from test_reflection_intake import reflection_env  # noqa: F401


def contract():
    path = Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", [
    "ReflectionReference", "ReflectionData", "ReflectionSelectionReference", "ReflectionInputCreate",
    "ReflectionPermissions", "ReflectionProducer", "ReflectionSummary", "ReflectionStatement", "ReflectionSource",
    "ReflectionVerified", "ReflectionLink", "ReflectionDetail", "ReflectionInputSummary", "ReflectionInputSource",
    "ReflectionInputDetail", "ReflectionPage", "ReflectionInputsPage",
])
def test_reflection_published_fields_and_constraints_match_actual_models(name):
    published = contract()["components"]["schemas"][name]
    actual = getattr(c, name).model_json_schema()
    assert published["additionalProperties"] is actual["additionalProperties"] is False
    assert set(published["properties"]) == set(actual["properties"])
    assert set(published["required"]) == set(actual["required"])
    for field, value in actual["properties"].items():
        for constraint in ("minLength", "maxLength", "minItems", "maxItems", "pattern", "const", "enum", "default"):
            if constraint in value:
                assert published["properties"][field][constraint] == value[constraint], (name, field, constraint)


def test_reflection_published_routes_and_action_match_actual_app(reflection_env):
    client, _, _, _ = reflection_env
    published, actual = contract(), client.app.openapi()
    names = {
        "/api/v1/reflections": "ReflectionPage",
        "/api/v1/reflections/{reflection_id}": "ReflectionDetail",
        "/api/v1/reflections/inputs": "ReflectionInputsPage",
        "/api/v1/reflections/inputs/{input_id}": "ReflectionInputDetail",
    }
    for path, name in names.items():
        operation = published["paths"][path]["get"]
        declared = published["components"]["securitySchemes"]
        assert all(scheme in declared for option in operation["security"] for scheme in option)
        assert {"bearerAuth": []} in operation["security"]
        assert {"apiKeyAuth": [], "sopTimestamp": [], "sopNonce": [], "sopSignature": []} in operation["security"]
        for source in (published, actual):
            assert source["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/" + name)
    command = published["components"]["schemas"]["DeliveryCommand"]
    assert "reflection.input.create" in command["properties"]["action"]["enum"]
    branch = next(value for value in command["allOf"] if value.get("if", {}).get("properties", {}).get("action", {}).get("const") == "reflection.input.create")
    assert branch["then"]["properties"]["payload"]["$ref"].endswith("/ReflectionInputCreate")
    effect = published["components"]["schemas"]["EventHandoffEffectResult"]["properties"]
    assert "reflection_recorded" in effect["kind"]["enum"]
    assert "reflection" in effect["target_kind"]["anyOf"][0]["enum"]


def test_published_operation_security_names_resolve_to_declared_schemes():
    source = contract()
    schemes = source["components"]["securitySchemes"]
    for path, item in source["paths"].items():
        for method in ("get", "post", "put", "patch", "delete", "head", "options"):
            for option in item.get(method, {}).get("security", []):
                assert set(option) <= set(schemes), (path, method, set(option) - set(schemes))
