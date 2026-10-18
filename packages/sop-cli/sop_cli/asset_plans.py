"""Read-only discovery and explicit, byte-preserving reviewed asset snapshots."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sop_sdk.event_envelope import strict_json, text_field, timestamp

SCHEMA = "sop.sync.asset-plan.v1"
MODULES = frozenset({"rules", "specs", "templates"})
MAX_ENTRIES = 50
MAX_PLAN_BYTES = 1024 * 1024
MAX_FILE_BYTES = 60 * 1024
_SUFFIXES = frozenset({".md", ".json", ".yaml", ".yml", ".toml"})
_MODULE_BASES = {"rules": ".ai-memory/rules", "specs": "sop/custom/specs", "templates": "sop/custom"}


def _reparse(info):
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def project_root(project_path: Path) -> Path:
    original = Path(os.path.abspath(Path(project_path).expanduser()))
    try:
        if _reparse(original.lstat()) or original.resolve(strict=True) != original or not original.is_dir():
            raise ValueError("Project root must be an existing directory without path redirection")
    except OSError as exc:
        raise ValueError("Project root is unavailable") from exc
    return original


def safe_project_path(project_path: Path, path: Path | str) -> Path:
    """Reject any link/redirection, including broken links; never follow their targets."""
    root = project_root(project_path)
    candidate = Path(path).expanduser()
    candidate = Path(os.path.abspath(candidate if candidate.is_absolute() else root / candidate))
    if not candidate.is_relative_to(root):
        raise ValueError("Path must remain inside the configured project")
    current = root
    for part in candidate.relative_to(root).parts:
        current /= part
        try:
            info = current.lstat()
        except FileNotFoundError:
            continue
        if _reparse(info):
            raise ValueError("Path redirection is not allowed: " + str(current.relative_to(root)))
    resolved = candidate.resolve(strict=False)
    if resolved != candidate or not resolved.is_relative_to(root):
        raise ValueError("Resolved path left its original project location")
    return candidate


def replace_project_bytes(project_path: Path, path: Path, content: bytes) -> None:
    """Replace the project directory entry; never overwrite another hardlink's bytes."""
    target = safe_project_path(project_path, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=target.parent, prefix=".sop-pull-", suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, safe_project_path(project_path, target))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def asset_path(module: str, relative: str) -> str:
    if module not in MODULES:
        raise ValueError("Asset module must be rules/specs/templates")
    text_field(relative, "asset path", maximum=1024)
    if Path(relative).suffix.lower() not in _SUFFIXES:
        raise ValueError("Unsupported Manager asset format; use md/json/yaml/yml/toml")
    if relative != relative.strip() or "\\" in relative or ":" in relative or relative.startswith("/"):
        raise ValueError("Asset path must be a canonical relative path")
    parts = relative.split("/")
    for part in parts:
        if (
            not part
            or part in {".", ".."}
            or part.endswith((".", " "))
            or any(ord(c) < 32 or c in '<>"|?*' for c in part)
        ):
            raise ValueError("Unsafe asset path")
        if re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", part.split(".", 1)[0]):
            raise ValueError("Reserved asset path")
    if module == "templates" and (parts[0] != "templates" or len(parts) < 2):
        raise ValueError("Template paths must start with templates/")
    return relative


def asset_target(project_path: Path, module: str, relative: str) -> Path:
    relative = asset_path(module, relative)
    base = safe_project_path(project_path, _MODULE_BASES[module])
    target = safe_project_path(project_path, base / relative)
    if not target.is_relative_to(base):
        raise ValueError("Asset target left its original module base")
    return target


def _read_utf8(project_path: Path, path: Path, maximum: int) -> str:
    target = safe_project_path(project_path, path)
    with target.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Asset source must be a regular file")
        raw = stream.read(maximum + 1)
    after = safe_project_path(project_path, target).stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise ValueError("Source changed while its original snapshot was read")
    if len(raw) > maximum:
        label = "60 KiB per asset" if maximum == MAX_FILE_BYTES else "1 MiB per asset plan"
        raise ValueError("Size exceeds " + label + "; choose a smaller explicit scope with --include")
    try:
        return raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ValueError("Asset source must contain valid UTF-8") from exc


def parse_expected_sha256(value: str) -> str | None:
    if value == "absent":
        return None
    if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{64}", value):
        raise ValueError("expected_sha256 requires 64 lowercase hex characters or explicit absent")
    return value


def selector(value: str) -> tuple[str, str]:
    module, separator, relative = value.partition(":")
    if not separator:
        raise ValueError("Asset selection requires module:path")
    return module, asset_path(module, relative)


def _walk_assets(root: Path, base: Path):
    pending = [base]
    while pending:
        directory = safe_project_path(root, pending.pop())
        with os.scandir(directory) as entries:
            children = sorted(entries, key=lambda entry: entry.name)
        for entry in children:
            info = entry.stat(follow_symlinks=False)
            if _reparse(info):
                continue
            path = Path(entry.path)
            if stat.S_ISDIR(info.st_mode):
                if entry.name not in {".git", ".sop-runtime", "__pycache__", "node_modules"}:
                    pending.append(path)
            elif stat.S_ISREG(info.st_mode) and path.suffix.lower() in _SUFFIXES:
                yield path


def scan_assets(
    project_path: Path, modules: set[str], *, include: list[str] | None = None, allow_missing: bool = False
) -> dict[str, dict]:
    root = project_root(project_path)
    if not modules or not modules <= MODULES:
        raise ValueError("modules must contain only rules,specs,templates")
    selected = {f"{module}:{relative}" for module, relative in map(selector, include or [])}
    if any(value.split(":", 1)[0] not in modules for value in selected):
        raise ValueError("--include selects a module outside --modules")
    found = {}
    for module in sorted(modules):
        module_base = safe_project_path(root, _MODULE_BASES[module])
        base = safe_project_path(root, module_base / "templates") if module == "templates" else module_base
        if not base.exists():
            continue
        if not base.is_dir():
            raise ValueError("Asset module root is not a directory: " + str(base.relative_to(root)))
        for path in _walk_assets(root, base):
            relative = asset_path(module, path.relative_to(module_base).as_posix())
            key = f"{module}:{relative}"
            if selected and key not in selected:
                continue
            content = _read_utf8(root, path, MAX_FILE_BYTES)
            found[key] = {
                "module": module,
                "path": relative,
                "action": "upsert",
                "content": content,
                "sha256": hashlib.sha256(content.encode()).hexdigest(),
            }
            if len(found) > MAX_ENTRIES:
                raise ValueError(
                    "Asset plan exceeds 50 entries; select explicit module:path values with --include"
                )
    if selected - found.keys() and not allow_missing:
        raise ValueError(
            "Selected asset was not safely discovered: " + ", ".join(sorted(selected - found.keys()))
        )
    return dict(sorted(found.items()))


def _encoded(plan: dict) -> bytes:
    return (json.dumps(plan, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()


def _entry_identity(entry: dict):
    if not isinstance(entry, dict):
        raise ValueError("Invalid asset plan entry")
    action = entry.get("action")
    fields = {"module", "path", "action", "sha256"} | ({"content"} if action == "upsert" else set())
    if action not in {"upsert", "delete"} or set(entry) != fields:
        raise ValueError("Invalid complete asset entry fields")
    relative = asset_path(entry["module"], entry["path"])
    if action == "delete":
        if entry["sha256"] is not None:
            raise ValueError("Delete snapshot sha256 must be null")
    else:
        if not isinstance(entry["content"], str):
            raise ValueError("Asset content must be original UTF-8 text")
        raw = entry["content"].encode("utf-8", errors="strict")
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("Asset content exceeds 60 KiB")
        if entry["sha256"] != hashlib.sha256(raw).hexdigest():
            raise ValueError("Asset original content sha256 mismatch")
    return entry["module"], relative.casefold()


def validate_plan(plan: dict, project_id: str) -> dict:
    if not isinstance(plan, dict) or set(plan) != {"schema", "project_id", "captured_at", "entries"}:
        raise ValueError("Invalid complete asset plan fields")
    if plan["schema"] != SCHEMA or plan["project_id"] != project_id:
        raise ValueError("Asset plan schema or project does not match the configured project")
    text_field(project_id, "project_id", maximum=64)
    timestamp(plan["captured_at"])
    entries = plan["entries"]
    if not isinstance(entries, list) or len(entries) > MAX_ENTRIES:
        raise ValueError("Asset plan allows at most 50 entries")
    seen = set()
    for entry in entries:
        identity = _entry_identity(entry)
        if identity in seen:
            raise ValueError("Duplicate asset module:path in plan")
        seen.add(identity)
    if len(_encoded(plan)) > MAX_PLAN_BYTES:
        raise ValueError("Asset plan exceeds 1 MiB; reduce its explicit scope with --include")
    return plan


def make_plan(project_path: Path, project_id: str, current: dict, previous: dict | None = None) -> dict:
    previous = previous or {}
    entries = [row for key, row in current.items() if previous.get(key, {}).get("sha256") != row["sha256"]]
    for key in sorted(previous.keys() - current.keys()):
        row = previous[key]
        # An inaccessible redirected subtree is not evidence that its original files were deleted.
        asset_target(project_path, row["module"], row["path"])
        entries.append({"module": row["module"], "path": row["path"], "action": "delete", "sha256": None})
    return validate_plan(
        {
            "schema": SCHEMA,
            "project_id": project_id,
            "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "entries": sorted(entries, key=lambda row: (row["module"], row["path"])),
        },
        project_id,
    )


def load_plan(project_path: Path, project_id: str, path: str) -> dict:
    return validate_plan(strict_json(_read_utf8(project_path, Path(path), MAX_PLAN_BYTES)), project_id)


def plan_directory(project_path: Path, directory: str) -> Path:
    target = safe_project_path(project_path, directory)
    for module, base in _MODULE_BASES.items():
        scanned = safe_project_path(project_path, base)
        if module == "templates":
            scanned /= "templates"
        if target.is_relative_to(scanned) or scanned.is_relative_to(target):
            raise ValueError("Snapshot output directory must not overlap an asset discovery root")
    return target


def save_plan(project_path: Path, project_id: str, plan: dict, directory: str) -> Path:
    validate_plan(plan, project_id)
    target = plan_directory(project_path, directory)
    target.mkdir(parents=True, exist_ok=True)
    target = safe_project_path(project_path, target)
    destination = target / ("asset-plan-" + uuid.uuid4().hex + ".json")
    with destination.open("xb") as stream:
        stream.write(_encoded(plan))
        stream.flush()
        os.fsync(stream.fileno())
    return destination


def file_record(project_path: Path, module: str, path: str, remote_path: str = "") -> dict:
    if module not in MODULES:
        raise ValueError("File sync requires rules/specs/templates")
    source = safe_project_path(project_path, path)
    base = safe_project_path(project_path, _MODULE_BASES[module])
    relative = remote_path or source.relative_to(base).as_posix()
    asset_target(project_path, module, relative)
    return {"path": relative, "content": _read_utf8(project_path, source, MAX_FILE_BYTES)}
