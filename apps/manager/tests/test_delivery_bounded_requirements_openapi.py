"""The one bounded requirement contract matches actual inputs and live routes."""

from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from pydantic import ValidationError
from sop_manager.routers.delivery import router
from sop_manager.routers.delivery_activity_contract import DefinitionChanges


def test_definition_changes_schema_matches_omitted_and_nonnullable_inputs():
    assert DefinitionChanges.model_validate({}).model_dump(exclude_unset=True) == {}
    schema = DefinitionChanges.model_json_schema()
    for field, value in (("title", "Changed"), ("description", ""), ("acceptance_criteria", [])):
        assert DefinitionChanges.model_validate({field: value}).model_dump(exclude_unset=True) == {
            field: value
        }
        with pytest.raises(ValidationError):
            DefinitionChanges.model_validate({field: None})
        assert "null" not in str(schema["properties"][field]), field
        assert field not in schema.get("required", [])


def test_bounded_requirement_public_contract_matches_every_reachable_live_model():
    app = FastAPI()
    app.include_router(router)
    actual = app.openapi()
    published = yaml.safe_load(
        (Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml").read_bytes()
    )
    paths = {
        path: "post" if path.endswith("/change-preview") else "get"
        for path in actual["paths"]
        if path.startswith("/api/v1/delivery/requirements/")
    }
    assert len(paths) == 10
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
                # Empty runtime default deliberately supplies canonical HTTP400.
                assert generated["required"] is False and documented["required"] is True
                assert {**documented, "required": False} == generated
            else:
                assert documented == generated
        for code, response in live["responses"].items():
            assert public["responses"][code] == response
        assert {"400", "401", "403", "404"} <= public["responses"].keys()
        verify(live)
    for old in ("RequirementDetail", "RequirementHistory", "RequirementLinks", "ChangeImpact"):
        assert old not in actual["components"]["schemas"] and old not in published["components"]["schemas"]
