"""Fixed asset plans: durable intent first, bounded same-operation recovery."""

import hashlib
import os
import re
import tempfile
from pathlib import Path

from .event_common import digest, fail


def _basis(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def _asset_base(root, module):
    return {
        "rules": root / ".ai-memory" / "rules",
        "specs": root / "sop" / "custom" / "specs",
        "templates": root / "sop" / "custom",
    }[module].resolve()


def _original_asset_basis(record, target):
    if "expected_sha256" not in record:
        fail("event_asset_basis_required", "Original target digest or explicit null is required", 422)
    expected = record["expected_sha256"]
    if expected is not None and (
        not isinstance(expected, str) or re.fullmatch(r"[0-9a-f]{64}", expected) is None
    ):
        fail("event_asset_invalid", "Original target digest must be lowercase SHA-256 or null", 422)
    if expected != _basis(target):
        fail("event_asset_basis_changed", "Asset differs from the reviewed original target")
    return expected


def plan_asset(project, event):
    data = event.data
    if set(data) - {"module", "action", "record", "expected_version", "tenant_id", "project_id"}:
        fail("event_asset_invalid", "Unsupported asset input fields", 422)
    module = data["module"]
    record = data.get("record", {})
    if not isinstance(record, dict):
        fail("event_asset_invalid", "Asset record must be an object", 422)
    root = Path(project.project_path).resolve()
    base = _asset_base(root, module)
    if not base.is_relative_to(root):
        fail("event_asset_path_invalid", "Asset module escaped the project root", 422)
    raw = record.get("path") or record.get("id")
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        fail("event_asset_path_invalid", "A safe relative asset path is required", 422)
    rel = Path(raw)
    if rel.is_absolute() or ".." in rel.parts:
        fail("event_asset_path_invalid", "Asset path must be relative", 422)
    target = (root / rel).resolve()
    if not target.is_relative_to(base):
        target = (base / rel).resolve()
    if not target.is_relative_to(base) or target.suffix.lower() not in {
        ".md",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
    }:
        fail("event_asset_path_invalid", "Asset path is outside the allowed root", 422)
    action = data.get("action", "upsert")
    if not isinstance(action, str) or action not in {"upsert", "delete"}:
        fail("event_asset_invalid", "Unsupported asset action", 422)
    content = record.get("content") if action == "upsert" else None
    if action == "upsert" and not isinstance(content, str):
        fail("event_asset_invalid", "Asset content must be text", 422)
    if set(record) - {"id", "path", "content", "expected_sha256"}:
        fail("event_asset_invalid", "Unsupported asset fields", 422)
    expected = _original_asset_basis(record, target)
    return {
        "root": str(root),
        "module": module,
        "module_base": str(base),
        "resolved_target": str(target),
        "target": target.relative_to(root).as_posix(),
        "before": expected,
        "desired": digest(content) if content is not None else None,
        "content": content,
        "action": action,
        "handler_version": 1,
    }


def apply_asset(project, receipt_id, plan):
    root = Path(project.project_path).resolve()
    if str(root) != plan["root"]:
        fail("event_asset_root_changed", "The original project root changed")
    module = plan.get("module")
    if not isinstance(module, str) or module not in {"rules", "specs", "templates"}:
        fail("event_asset_plan_invalid", "Original asset module identity is missing", 422)
    base = _asset_base(root, module)
    target = (root / plan["target"]).resolve()
    if (
        str(base) != plan.get("module_base")
        or str(target) != plan.get("resolved_target")
        or not base.is_relative_to(root)
        or not target.is_relative_to(base)
    ):
        fail("event_asset_target_changed", "Original asset directory or target identity changed")
    current = _basis(target)
    if current != plan["desired"]:
        if current != plan["before"]:
            fail("event_asset_target_changed", "Asset changed since its fixed operation plan")
        if plan["action"] == "delete":
            target.unlink(missing_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            temp = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    dir=target.parent,
                    prefix=".event-" + receipt_id + "-",
                    suffix=".tmp",
                    delete=False,
                ) as handle:
                    temp = Path(handle.name)
                    handle.write(plan["content"].encode("utf-8"))
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp, target)
            finally:
                if temp is not None:
                    temp.unlink(missing_ok=True)
    return {"kind": "asset_materialized", "target_kind": "asset", "target_id": plan["target"]}
