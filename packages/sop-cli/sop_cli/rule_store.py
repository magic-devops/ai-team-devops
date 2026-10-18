"""Local reviewed rule documents; no network fallback or delivery queue."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import tempfile
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from sop_sdk.event_envelope import strict_json


def rules_target(config):
    root = config.project_path.resolve()
    base = root / ".ai-memory/rules"
    target = base / "RULES.md"
    if not base.resolve().is_relative_to(root) or not target.resolve().is_relative_to(base.resolve()):
        raise ValueError("Rules path escaped its original project directory")
    return target


def proposal_directory(config):
    target = config.project_path / ".sop-runtime/rules/proposals"
    if not target.resolve().is_relative_to(config.project_path.resolve()):
        raise ValueError("Rule proposal directory escaped its project")
    return target


def _text(value, field, maximum):
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > maximum
        or any(ord(c) < 32 or ord(c) == 127 for c in value)
    ):
        raise ValueError("Invalid rule " + field)
    return value.strip()


def _basis(row):
    values = {
        key: row[key]
        for key in ("id", "rule", "category", "source", "confidence", "created_at", "project_id")
    }
    return hashlib.sha256(
        json.dumps(values, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    ).hexdigest()


def _atomic(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=".rule-", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def create_proposal(config, rule, category, source, confidence, created_at):
    if type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
        raise ValueError("Rule confidence must be finite and between zero and one")
    row = {
        "id": "rule-local-" + uuid.uuid4().hex,
        "rule": _text(rule, "text", 2000),
        "category": _text(category, "category", 80),
        "source": _text(source, "source", 120),
        "confidence": confidence,
        "created_at": created_at,
        "project_id": config.project_id,
        "status": "proposed",
    }
    row["basis"] = _basis(row)
    directory = proposal_directory(config)
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / ("." + row["id"] + "-" + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write((json.dumps(row, ensure_ascii=False, indent=2) + "\n").encode())
            handle.flush()
            os.fsync(handle.fileno())
        # A complete durable document becomes visible at once, without replacing an existing proposal.
        os.link(temporary, directory / (row["id"] + ".json"))
    finally:
        temporary.unlink(missing_ok=True)
    return row


def proposal(config, rule_id):
    if not isinstance(rule_id, str) or not re.fullmatch("rule-local-[0-9a-f]{32}", rule_id):
        raise ValueError("Invalid local rule proposal ID")
    path = proposal_directory(config) / (rule_id + ".json")
    if not path.is_file():
        raise ValueError("Rule proposal not found")
    row = strict_json(path.read_bytes().decode("utf-8"))
    if not isinstance(row, dict) or row.get("id") != rule_id or row.get("project_id") != config.project_id:
        raise ValueError("Rule proposal project or identity changed")
    if row.get("basis") != _basis(row):
        raise ValueError("Rule proposal original content changed; create and review a new proposal")
    return row


def list_proposals(config, limit=200):
    directory = proposal_directory(config)
    paths = sorted(directory.glob("rule-local-*.json")) if directory.is_dir() else []
    return {
        "items": [proposal(config, p.stem) for p in paths[:limit]],
        "total": len(paths),
        "has_more": len(paths) > limit,
    }


@contextmanager
def _application_lock(config):
    directory = proposal_directory(config).parent
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "apply.lock").open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        deadline = time.monotonic() + 5
        while True:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if time.monotonic() >= deadline:
                    raise ValueError("Another rule application is still in progress") from exc
                time.sleep(0.02)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def apply_proposal(config, rule_id, updated_at):
    with _application_lock(config):
        return _apply_locked(config, rule_id, updated_at)


def _apply_locked(config, rule_id, updated_at):
    row = proposal(config, rule_id)
    target = rules_target(config)
    text = target.read_bytes().decode("utf-8") if target.is_file() else "# 项目规则库\n\n## 活跃规则\n\n"
    marker = "<!-- sop-rule-proposal:" + row["id"] + ":" + row["basis"] + " -->"
    if marker not in text:
        eol = "\r\n" if "\r\n" in text else "\n"
        entry = (
            marker
            + eol
            + f"- [{row['category']}] {row['rule']} (source={row['source']}, confidence={row['confidence']:.2f}, created_at={row['created_at']})"
        )
        heading = "## 活跃规则"
        text = (
            text.replace(heading, heading + eol + eol + entry, 1)
            if heading in text
            else text + eol + heading + eol + eol + entry + eol
        )
        _atomic(target, text.encode("utf-8"))
    row.update(status="applied", updated_at=updated_at)
    _atomic(
        proposal_directory(config) / (rule_id + ".json"),
        (json.dumps(row, ensure_ascii=False, indent=2) + "\n").encode(),
    )
    return row, target
