#!/usr/bin/env python3
"""Unified AI tool hook engine for sop projects.

Tool adapters should call this script instead of duplicating policy logic.
It accepts: sop_ai_hook.py <tool> <event>

Codex 借鉴点：生命周期全覆盖 + PreToolUse/PermissionRequest 结构化 deny +
可选 ``.ai-memory/hook_policy.json`` 团队自定义规则（与内置策略合并）。

stdin：各工具传入的 JSON payload（Codex/Claude 等）；无则按空对象处理。
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Set

TOOL = sys.argv[1] if len(sys.argv) > 1 else "unknown"
EVENT = sys.argv[2] if len(sys.argv) > 2 else ""
ROOT = Path.cwd()

_DEFAULT_BASH_DENY: List[str] = [
    r"\brm\s+-rf\s+/(?:\s|$)",
    r"\brm\s+-rf\s+~",
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+clean\s+-fdx\b",
    r"\bgit\s+push\s+--force\b",
    r"\bgit\s+push\s+-f\b",
    r"\bchmod\s+-R\s+777\b",
    r"\bcurl\b.*\|\s*(?:sh|bash)\b",
    r"\bwget\b.*\|\s*(?:sh|bash)\b",
    r"\bdd\s+if=\s*/dev/",
    r"\bmkfs\.",
]

_SECRET_IN_PROMPT = re.compile(
    r"(?i)(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*['\"]?[\w\-]{12,}|"
    r"sk-[A-Za-z0-9]{10,}|"
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)


def _repo_root() -> Path:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        if r.returncode == 0 and (r.stdout or "").strip():
            return Path((r.stdout or "").strip()).resolve()
    except Exception:
        pass
    return ROOT.resolve()


def _load_payload() -> Dict[str, Any]:
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def _now() -> str:
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_hook_policy() -> Dict[str, Any]:
    p = _repo_root() / ".ai-memory" / "hook_policy.json"
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


_POLICY: Dict[str, Any] | None = None


def hook_policy() -> Dict[str, Any]:
    global _POLICY
    if _POLICY is None:
        _POLICY = _load_hook_policy()
    return _POLICY


def _bash_deny_patterns() -> List[str]:
    pol = hook_policy()
    extra = pol.get("bash_deny_regex_extra") or pol.get("bash_deny_regex") or []
    out = list(_DEFAULT_BASH_DENY)
    if isinstance(extra, list):
        out.extend(str(x) for x in extra if x)
    return out


def _write_deny_substrings() -> List[str]:
    pol = hook_policy()
    base = [
        "/.ssh/id_rsa",
        "/.ssh/id_ed25519",
        "/.ssh/id_ecdsa",
        ".aws/credentials",
        ".gnupg/private-keys",
    ]
    extra = pol.get("write_path_deny_substrings") or []
    if isinstance(extra, list):
        base.extend(str(x) for x in extra if x)
    return base


def _patch_deny_substrings() -> List[str]:
    pol = hook_policy()
    base = [
        "+++ b/.ssh/",
        "+++ b/.gnupg/",
        "+++ b/.aws/credentials",
    ]
    extra = pol.get("patch_deny_substrings") or []
    if isinstance(extra, list):
        base.extend(str(x) for x in extra if x)
    return base


def _append_activity(payload: Dict[str, Any], note: str = "") -> None:
    path = _repo_root() / ".ai-memory" / "activity.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    tool_name = payload.get("tool_name") or payload.get("matcher") or "-"
    line = f"{_now()} adapter={TOOL} event={EVENT} tool={tool_name}"
    if note:
        line += f" note={note}"
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def _touch_state() -> None:
    path = _repo_root() / "memory" / "current_state.json"
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


def _collect_strings(obj: Any, out: List[str], depth: int = 0) -> None:
    if depth > 12:
        return
    if isinstance(obj, str):
        if len(obj) < 4096:
            out.append(obj)
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = str(k).lower()
            if lk in {
                "path",
                "file_path",
                "filepath",
                "target_path",
                "file",
                "rel_path",
                "relative_path",
            } and isinstance(v, str):
                out.append(v)
            _collect_strings(v, out, depth + 1)
    elif isinstance(obj, list):
        for it in obj:
            _collect_strings(it, out, depth + 1)


def _paths_from_payload(payload: Dict[str, Any]) -> List[str]:
    acc: List[str] = []
    _collect_strings(payload, acc)
    # 去重保序
    seen: Set[str] = set()
    uniq: List[str] = []
    for s in acc:
        s = s.strip()
        if not s or s in seen:
            continue
        seen.add(s)
        uniq.append(s)
    return uniq


def _patch_text_from_payload(payload: Dict[str, Any]) -> str:
    ti = payload.get("tool_input")
    if isinstance(ti, dict):
        for k in ("patch", "diff", "content", "input", "text"):
            v = ti.get(k)
            if isinstance(v, str) and v.strip():
                return v
    for k in ("patch", "diff", "input"):
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def _deny(reason: str) -> None:
    ev = EVENT or "PreToolUse"
    if TOOL == "codex":
        out: Dict[str, Any] = {
            "hookSpecificOutput": {
                "hookEventName": ev,
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
        if ev == "PermissionRequest":
            out["hookSpecificOutput"]["decision"] = {"behavior": "deny", "message": reason}
        print(json.dumps(out, ensure_ascii=False))
    elif TOOL == "claude":
        if ev == "PreToolUse":
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "permissionDecision": "deny",
                            "permissionDecisionReason": reason,
                        }
                    },
                    ensure_ascii=False,
                )
            )
        elif ev == "PermissionRequest":
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PermissionRequest",
                            "decision": {"behavior": "deny", "message": reason},
                        }
                    },
                    ensure_ascii=False,
                )
            )
        else:
            print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    else:
        print(json.dumps({"decision": "deny", "reason": reason}, ensure_ascii=False))


def _allow_codex_advisory(message: str) -> None:
    """UserPromptSubmit：不阻断，仅追加提醒（需 Codex 支持 additionalContext）。"""
    if TOOL != "codex" or EVENT != "UserPromptSubmit":
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": message,
                }
            },
            ensure_ascii=False,
        )
    )


def _allow_claude_advisory(message: str) -> None:
    """UserPromptSubmit：不阻断，仅追加 additionalContext（Claude Code）。"""
    if TOOL != "claude" or EVENT != "UserPromptSubmit":
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": message,
                }
            },
            ensure_ascii=False,
        )
    )


def _deny_prompt(reason: str) -> None:
    if TOOL == "codex":
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "UserPromptSubmit",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    }
                },
                ensure_ascii=False,
            )
        )
    elif TOOL == "claude":
        print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    else:
        print(json.dumps({"decision": "deny", "reason": reason}, ensure_ascii=False))


def _guard_bash(payload: Dict[str, Any]) -> bool:
    cmd = _command_from_payload(payload)
    if not cmd.strip():
        return True
    for pat in _bash_deny_patterns():
        try:
            if re.search(pat, cmd):
                _append_activity(payload, f"blocked_bash:{pat}")
                _deny(f"Blocked by sop AI hook policy (bash): {pat}")
                return False
        except re.error:
            continue
    return True


def _guard_write_paths(payload: Dict[str, Any]) -> bool:
    repo = _repo_root()
    bad_subs = _write_deny_substrings()
    for raw in _paths_from_payload(payload):
        p = raw.replace("\\", "/")
        low = p.lower()
        for frag in bad_subs:
            if frag.lower() in low:
                _append_activity(payload, f"blocked_path:{frag}")
                _deny(f"Blocked write path by sop policy: matched {frag!r} in {raw!r}")
                return False
        try:
            rp = (repo / p).resolve() if not Path(p).is_absolute() else Path(p).resolve()
            if repo in rp.parents or rp == repo:
                rel = str(rp.relative_to(repo)).replace("\\", "/")
                low2 = rel.lower()
                for frag in bad_subs:
                    if frag.lower() in ("/" + low2) or frag.lower() in low2:
                        _append_activity(payload, f"blocked_path_rel:{frag}")
                        _deny(f"Blocked write path by sop policy: {rel!r}")
                        return False
        except Exception:
            continue
    return True


def _guard_patch(payload: Dict[str, Any]) -> bool:
    patch = _patch_text_from_payload(payload)
    if not patch:
        return True
    for frag in _patch_deny_substrings():
        if frag in patch:
            _append_activity(payload, "blocked_patch")
            _deny(f"Blocked apply_patch by sop policy: matched {frag!r}")
            return False
    return True


def _guard_tools(payload: Dict[str, Any]) -> bool:
    if not _guard_bash(payload):
        return False
    if not _guard_patch(payload):
        return False
    tool_name = str(payload.get("tool_name") or payload.get("matcher") or "").lower()
    path_relevant = any(
        k in tool_name for k in ("write", "edit", "apply_patch", "patch")
    )
    if path_relevant and not _guard_write_paths(payload):
        return False
    return True


def _prompt_text(payload: Dict[str, Any]) -> str:
    for key in ("prompt", "user_prompt", "text", "message", "input"):
        v = payload.get(key)
        if isinstance(v, str) and v.strip():
            return v
    ti = payload.get("tool_input")
    if isinstance(ti, dict):
        for key in ("prompt", "text", "message"):
            v = ti.get(key)
            if isinstance(v, str) and v.strip():
                return v
    return ""


def _guard_prompt(payload: Dict[str, Any]) -> bool:
    pol = hook_policy()
    text = _prompt_text(payload)
    if not text:
        return True
    if not _SECRET_IN_PROMPT.search(text):
        return True
    if pol.get("block_secrets_in_prompt"):
        _append_activity(payload, "blocked_secret_prompt")
        _deny_prompt("User prompt appears to contain credentials or private key material; remove secrets before continuing.")
        return False
    if pol.get("warn_secrets_in_prompt"):
        _w = (
            "sop hook: user prompt may contain secrets or private key material; "
            "rotate any exposed credentials and avoid pasting keys into chat."
        )
        _allow_codex_advisory(_w)
        _allow_claude_advisory(_w)
    return True


def _session_context() -> None:
    msg = (
        "Before editing this sop project, read memory/current_state.json, "
        ".ai-memory/rules/RULES.md, and the tool entry file such as AGENTS.md or CLAUDE.md. "
        "Optional team hook rules: copy sop/tools/hook_policy.example.json to .ai-memory/hook_policy.json."
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
    elif TOOL == "claude":
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
    if EVENT in {"PreToolUse", "PermissionRequest"} and not _guard_tools(payload):
        return 0
    if EVENT == "UserPromptSubmit" and not _guard_prompt(payload):
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
