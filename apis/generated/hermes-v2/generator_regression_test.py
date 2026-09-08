from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GENERATOR = ROOT / "scripts" / "generate-hermes-clients.py"


def _generator_module():
    spec = importlib.util.spec_from_file_location("generate_hermes_clients", GENERATOR)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_nullable_integer_and_dart_object_are_stable():
    generator = _generator_module()
    schemas = {
        "Example": {
            "type": "object",
            "required": ["id", "state"],
            "properties": {
                "id": {"type": "string"},
                "expected_version": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                "child": {"anyOf": [{"$ref": "#/components/schemas/Child"}, {"type": "null"}]},
                "tags": {"type": "array", "items": {"type": "string"}},
                "state": {"type": "string", "enum": ["approve", "reject"]},
                "unknown": {"anyOf": [{"type": "string"}, {"type": "integer"}, {"type": "null"}]},
            },
        },
        "Child": {"type": "object", "properties": {"count": {"type": "integer"}}},
    }

    python = generator._python(schemas)
    typescript = generator._typescript(schemas)
    dart = generator._dart(schemas)

    assert "expected_version: int | None = None" in python
    assert "child: Child | None = None" in python
    assert 'state: Literal["approve", "reject"]' in python
    assert "expected_version?: number | null;" in typescript
    assert 'state: "approve" | "reject";' in typescript
    assert "final int? expected_version;" in dart
    assert "final Child? child;" in dart
    assert "final String state;" in dart
    assert "??" not in dart
