#!/usr/bin/env python3
import importlib

from hermes_core.cli import main

for module in ("langgraph.checkpoint.sqlite", "aiosqlite"):
    importlib.import_module(module)

if __name__ == "__main__":
    main()
