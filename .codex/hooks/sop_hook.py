#!/usr/bin/env python3
"""Codex adapter shim for the central sop AI hook engine."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

event = sys.argv[1] if len(sys.argv) > 1 else ""
engine = Path(__file__).resolve().parents[2] / "sop" / "tools" / "sop_ai_hook.py"
sys.argv = [str(engine), "codex", event]
runpy.run_path(str(engine), run_name="__main__")
