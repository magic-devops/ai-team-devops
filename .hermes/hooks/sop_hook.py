#!/usr/bin/env python3
"""hermes adapter shim → ai-sop-ops/sop_ai_hook.py"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

event = sys.argv[1] if len(sys.argv) > 1 else ""
_root = Path(__file__).resolve().parents[2]
_engine = _root / "ai-sop-ops" / "sop_ai_hook.py"
if not _engine.is_file():
    sys.stderr.write(
        "SOP: missing ai-sop-ops/sop_ai_hook.py — run: git submodule update --init --recursive\n"
    )
    sys.exit(0)
sys.argv = [str(_engine), "hermes", event]
runpy.run_path(str(_engine), run_name="__main__")
