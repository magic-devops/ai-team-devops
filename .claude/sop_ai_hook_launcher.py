#!/usr/bin/env python3
"""从仓库根执行 ``ai-sop-ops/sop_ai_hook.py``（唯一权威实现）。

用法（Claude Code / 兼容 hooks）::
  python3 .claude/sop_ai_hook_launcher.py claude PreToolUse

stdin 转发各工具 JSON payload。
"""
from __future__ import annotations

import runpy
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).strip()
        return Path(out).resolve()
    except Exception:
        return Path.cwd().resolve()


def main() -> None:
    root = _repo_root()
    target = root / "ai-sop-ops" / "sop_ai_hook.py"
    if not target.is_file():
        sys.stderr.write(
            "SOP: 未找到 ai-sop-ops/sop_ai_hook.py。请执行: git submodule update --init --recursive\n"
        )
        sys.exit(0)
    tool = sys.argv[1] if len(sys.argv) > 1 else "claude"
    event = sys.argv[2] if len(sys.argv) > 2 else ""
    sys.argv = [str(target), tool, event]
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
