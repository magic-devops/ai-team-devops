#!/usr/bin/env python3
"""Unified AI tool hook engine for sop projects.

Tool adapters should call this script instead of duplicating policy logic.
It accepts: sop_ai_hook.py <tool> <event>
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict


TOOL = sys.argv[1] if len(sys.argv) > 1 else "unknown"
EVENT = sys.argv[2] if len(sys.argv) > 2 else ""
ROOT = Path.cwd()


def _load_payload() -> Dict[str, Any]:
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def _now() -> str:
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append_activity(payload: Dict[str, Any], note: str = "") -> None:
    path = ROOT / ".ai-memory" / "activity.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    tool_name = payload.get("tool_name") or payload.get("matcher") or "-"
    line = f"{_now()} adapter={TOOL} event={EVENT} tool={tool_name}"
    if note:
        line += f" note={note}"
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def _touch_state() -> None:
    path = ROOT / "memory" / "current_state.json"
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["updated_at"] = _now()
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception:
        return


def _command_from_payload(payload: Dict[str, Any]) -> str:
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        cmd = tool_input.get("command") or tool_input.get("cmd") or ""
        return str(cmd)
    for key in ("command", "cmd", "input"):
        if payload.get(key):
            return str(payload.get(key))
    return ""


def _deny(reason: str) -> None:
    if TOOL == "codex" and EVENT == "PermissionRequest":
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {"behavior": "deny", "message": reason},
            }
        }
    elif TOOL == "codex":
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
    elif TOOL == "claude":
        out = {"decision": "block", "reason": reason}
    else:
        out = {"decision": "deny", "reason": reason}
    print(json.dumps(out, ensure_ascii=False))


def _guard(payload: Dict[str, Any]) -> bool:
    cmd = _command_from_payload(payload)
    patterns = [
        r"\brm\s+-rf\s+/(?:\s|$)",
        r"\bgit\s+reset\s+--hard\b",
        r"\bgit\s+clean\s+-fdx\b",
        r"\bchmod\s+-R\s+777\b",
        r"\bcurl\b.*\|\s*(?:sh|bash)\b",
        r"\bwget\b.*\|\s*(?:sh|bash)\b",
    ]
    for pat in patterns:
        if re.search(pat, cmd):
            _append_activity(payload, "blocked")
            _deny(f"Blocked by sop AI hook policy: {pat}")
            return False
    return True


def _session_context() -> None:
    msg = (
        "Before editing this sop project, read memory/current_state.json, "
        ".ai-memory/rules/RULES.md, and the tool entry file such as AGENTS.md or CLAUDE.md."
    )
    if TOOL == "codex":
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "SessionStart",
                        "additionalContext": msg,
                    }
                },
                ensure_ascii=False,
            )
        )
    else:
        print(msg)


def main() -> int:
    payload = _load_payload()
    if EVENT in {"PreToolUse", "PermissionRequest"} and not _guard(payload):
        return 0
    if EVENT in {"SessionStart", "Startup"}:
        _session_context()
    if EVENT in {"PostToolUse", "UserPromptSubmit", "Stop", "SessionStart", "Startup"}:
        _append_activity(payload)
    if EVENT in {"Stop", "SessionEnd"}:
        _touch_state()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
