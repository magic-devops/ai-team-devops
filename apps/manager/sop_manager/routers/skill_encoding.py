"""UTF-8 JSON storage helpers for skill metadata."""
import json
from pathlib import Path
from typing import Any

from sop_manager.text_files import read_text_file


def read_persisted_json(path: Path) -> Any:
    """Read canonical UTF-8 JSON, with GB18030 fallback for legacy Windows files."""
    return json.loads(read_text_file(path))


def write_persisted_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def read_external_skill_json(path: Path) -> Any:
    """Read an imported skill.json strictly as UTF-8; never replace bad bytes."""
    return json.loads(path.read_text(encoding="utf-8-sig"))
