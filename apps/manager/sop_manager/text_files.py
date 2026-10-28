"""Locale-independent text decoding for project files and document APIs."""
from pathlib import Path

from fastapi import HTTPException


def read_text_file(path: Path) -> str:
    """Prefer UTF-8 (including BOM); support files written by older Windows hosts."""
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return path.read_text(encoding="gb18030")


def read_document_text(path: Path) -> str:
    """Never return replacement characters that an editor could save over the source."""
    try:
        return read_text_file(path)
    except UnicodeDecodeError as exc:
        raise HTTPException(422, "文件编码无法识别，请使用 UTF-8 保存后重试") from exc
