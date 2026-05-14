#!/usr/bin/env python3
"""从仓库根执行 ``ai-sop-ops/sop_ai_hook.py``（唯一权威实现）。

供 Claude Code hook 使用固定路径 ``.claude/sop_ai_hook_launcher.py``。"""
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
    sys.argv[0] = str(target)
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
