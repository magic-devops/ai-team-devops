"""~/.sop/credentials 合并读写（Bearer + API Key 共存，chmod 600）。"""
from __future__ import annotations

from pathlib import Path


def credentials_path() -> Path:
    return Path.home() / ".sop" / "credentials"


def read_credentials() -> dict[str, str]:
    p = credentials_path()
    if not p.is_file():
        return {}
    out: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip()
    return out


def write_credentials(updates: dict[str, str]) -> Path:
    """合并写入；保留未更新的键。"""
    p = credentials_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    merged = read_credentials()
    for k, v in updates.items():
        if v is not None and str(v).strip():
            merged[k] = str(v).strip()
    lines = [f"{k}={v}" for k, v in sorted(merged.items())]
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    p.chmod(0o600)
    return p
