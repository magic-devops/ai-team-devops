"""Launch Python protocol fixtures portably without changing production execution."""

import os
import subprocess
import sys
from pathlib import Path


def install_python_script_launcher(monkeypatch):
    if os.name != "nt":
        return
    original = subprocess.Popen

    def launch(argv, *args, **kwargs):
        if isinstance(argv, (list, tuple)) and argv:
            path = Path(argv[0])
            if path.is_file() and path.read_bytes()[:2] == b"#!":
                argv = [sys.executable, *argv]
        return original(argv, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
