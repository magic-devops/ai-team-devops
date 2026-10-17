#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any


def _load_openapi(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if path.suffix in {".json", ""}:
        return json.loads(text)
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("PyYAML is required for YAML OpenAPI input") from exc
    loaded = yaml.safe_load(text)
    if not isinstance(loaded, dict):
        raise SystemExit("OpenAPI document must be an object")
    return loaded


def _load_hermes_core_openapi() -> dict[str, Any]:
    from hermes_core.api import create_app

    return create_app(Path(tempfile.mkdtemp()), "token").openapi()


def _schemas(doc: Mapping[str, Any]) -> dict[str, Any]:
    components = doc.get("components")
    if not isinstance(components, Mapping):
        return {}
    schemas = components.get("schemas")
    return dict(schemas) if isinstance(schemas, Mapping) else {}


def _properties(schema: Mapping[str, Any]) -> dict[str, Any]:
    props = schema.get("properties")
    return dict(props) if isinstance(props, Mapping) else {}


def _ordered_props(schema: Mapping[str, Any]) -> list[tuple[str, Any]]:
    props = _properties(schema)
    required = set(schema.get("required") or [])
    return sorted(props.items(), key=lambda item: (item[0] not in required, item[0]))


def _ref_name(schema: Mapping[str, Any]) -> str | None:
    ref = schema.get("$ref")
    return str(ref).rsplit("/", 1)[-1] if ref else None


def _string_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _split_any_of(schema: Mapping[str, Any]) -> tuple[list[Mapping[str, Any]], bool]:
    variants = schema.get("anyOf") or schema.get("oneOf")
    if not isinstance(variants, list):
        return [schema], schema.get("nullable") is True
    nullable = schema.get("nullable") is True
    non_null: list[Mapping[str, Any]] = []
    for variant in variants:
        if not isinstance(variant, Mapping):
            continue
        if variant.get("type") == "null":
            nullable = True
        else:
            non_null.append(variant)
    return non_null or [{}], nullable


def _enum_values(schema: Mapping[str, Any]) -> list[Any]:
    values = schema.get("enum")
    return list(values) if isinstance(values, list) else []


def _py_type(schema: Mapping[str, Any]) -> str:
    variants, nullable = _split_any_of(schema)
    if len(variants) > 1:
        rendered = " | ".join(dict.fromkeys(_py_type(variant).replace(" | None", "") for variant in variants))
        return f"{rendered} | None" if nullable else rendered
    schema = variants[0]
    ref_name = _ref_name(schema)
    if ref_name:
        return f"{ref_name} | None" if nullable else ref_name
    enum_values = _enum_values(schema)
    if enum_values:
        rendered = "Literal[" + ", ".join(_string_literal(value) for value in enum_values) + "]"
        return f"{rendered} | None" if nullable else rendered
    typ = schema.get("type")
    if typ == "string":
        rendered = "str"
    elif typ == "integer":
        rendered = "int"
    elif typ == "number":
        rendered = "float"
    elif typ == "boolean":
        rendered = "bool"
    elif typ == "array":
        rendered = f"list[{_py_type(schema.get('items') if isinstance(schema.get('items'), Mapping) else {})}]"
    elif typ == "object":
        rendered = "dict[str, Any]"
    else:
        rendered = "Any"
    return f"{rendered} | None" if nullable and "None" not in rendered else rendered


def _ts_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _ts_type(schema: Mapping[str, Any]) -> str:
    variants, nullable = _split_any_of(schema)
    if len(variants) > 1:
        rendered = " | ".join(dict.fromkeys(_ts_type(variant).replace(" | null", "") for variant in variants))
        return f"{rendered} | null" if nullable else rendered
    schema = variants[0]
    ref_name = _ref_name(schema)
    if ref_name:
        return f"{ref_name} | null" if nullable else ref_name
    enum_values = _enum_values(schema)
    if enum_values:
        rendered = " | ".join(_ts_literal(value) for value in enum_values)
        return f"{rendered} | null" if nullable else rendered
    typ = schema.get("type")
    if typ == "string":
        rendered = "string"
    elif typ == "integer":
        rendered = "number"
    elif typ == "number":
        rendered = "number"
    elif typ == "boolean":
        rendered = "boolean"
    elif typ == "array":
        item_schema = schema.get("items") if isinstance(schema.get("items"), Mapping) else {}
        rendered = f"Array<{_ts_type(item_schema)}>"
    elif typ == "object":
        rendered = "Record<string, unknown>"
    else:
        rendered = "unknown"
    return f"{rendered} | null" if nullable and "null" not in rendered else rendered


def _dart_type(schema: Mapping[str, Any]) -> str:
    variants, nullable = _split_any_of(schema)
    if len(variants) > 1:
        rendered = "Object"
        return f"{rendered}?" if nullable else rendered
    schema = variants[0]
    ref_name = _ref_name(schema)
    if ref_name:
        return f"{ref_name}?" if nullable else ref_name
    if _enum_values(schema):
        return "String?" if nullable else "String"
    typ = schema.get("type")
    if typ == "string":
        rendered = "String"
    elif typ == "integer":
        rendered = "int"
    elif typ == "number":
        rendered = "double"
    elif typ == "boolean":
        rendered = "bool"
    elif typ == "array":
        item_schema = schema.get("items") if isinstance(schema.get("items"), Mapping) else {}
        rendered = f"List<{_dart_type(item_schema).removesuffix('?')}>"
    elif typ == "object":
        rendered = "Map<String, Object?>"
    else:
        rendered = "Object"
    return f"{rendered}?" if nullable else rendered


def _python(schemas: Mapping[str, Any]) -> str:
    has_enum = any(
        _enum_values(prop_schema if isinstance(prop_schema, Mapping) else {})
        for schema in schemas.values()
        if isinstance(schema, Mapping)
        for _prop, prop_schema in _properties(schema).items()
    )
    typing_imports = "Any, Literal" if has_enum else "Any"
    lines = ["from __future__ import annotations", "", "from dataclasses import dataclass", f"from typing import {typing_imports}", "", ""]
    for name, schema in schemas.items():
        if not isinstance(schema, Mapping):
            continue
        required = set(schema.get("required") or [])
        lines.append("@dataclass")
        lines.append(f"class {name}:")
        props = _ordered_props(schema)
        if not props:
            lines.append("    value: dict[str, Any]")
        for prop, prop_schema in props:
            annotation = _py_type(prop_schema if isinstance(prop_schema, Mapping) else {})
            default = "" if prop in required else " = None" if "None" in annotation else " | None = None"
            lines.append(f"    {prop}: {annotation}{default}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _typescript(schemas: Mapping[str, Any]) -> str:
    lines = []
    for name, schema in schemas.items():
        if not isinstance(schema, Mapping):
            continue
        required = set(schema.get("required") or [])
        lines.append(f"export interface {name} {{")
        props = _ordered_props(schema)
        if not props:
            lines.append("  value: Record<string, unknown>;")
        for prop, prop_schema in props:
            marker = "" if prop in required else "?"
            lines.append(f"  {prop}{marker}: {_ts_type(prop_schema if isinstance(prop_schema, Mapping) else {})};")
        lines.append("}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _dart(schemas: Mapping[str, Any]) -> str:
    lines = []
    for name, schema in schemas.items():
        if not isinstance(schema, Mapping):
            continue
        required = set(schema.get("required") or [])
        props = _ordered_props(schema)
        lines.append(f"class {name} {{")
        if not props:
            lines.append("  final Map<String, Object?> value;")
        for prop, prop_schema in props:
            rendered = _dart_type(prop_schema if isinstance(prop_schema, Mapping) else {})
            field_type = rendered if prop in required or rendered.endswith("?") else f"{rendered}?"
            lines.append(f"  final {field_type} {prop};")
        lines.append(f"  const {name}({{")
        if not props:
            lines.append("    required this.value,")
        for prop, _prop_schema in props:
            prefix = "required " if prop in required else ""
            lines.append(f"    {prefix}this.{prop},")
        lines.append("  });")
        lines.append("}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("openapi", type=Path, nargs="?")
    parser.add_argument("--from-hermes-core", action="store_true")
    parser.add_argument("--out-dir", type=Path, default=Path("apis/generated/hermes-v1"))
    args = parser.parse_args()
    if args.from_hermes_core:
        doc = _load_hermes_core_openapi()
    elif args.openapi is not None:
        doc = _load_openapi(args.openapi)
    else:
        raise SystemExit("Provide an OpenAPI path or --from-hermes-core")
    schemas = _schemas(doc)
    if not schemas:
        raise SystemExit("OpenAPI document has no components.schemas")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "python").mkdir(exist_ok=True)
    (args.out_dir / "typescript").mkdir(exist_ok=True)
    (args.out_dir / "dart").mkdir(exist_ok=True)
    (args.out_dir / "python" / "wire_types.py").write_text(_python(schemas), encoding="utf-8", newline="\n")
    (args.out_dir / "typescript" / "wire-types.ts").write_text(_typescript(schemas), encoding="utf-8", newline="\n")
    (args.out_dir / "dart" / "wire_types.dart").write_text(_dart(schemas), encoding="utf-8", newline="\n")
    (args.out_dir / "openapi.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"ok": True, "schemas": len(schemas), "out_dir": str(args.out_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
