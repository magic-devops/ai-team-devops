"""
@module: sop_manager.memory_store
@purpose: v4 可扩展记忆存储（默认文件 JSONL；预留 mem0 等后端切换）
@ai_safe_edit: 新增后端 → 实现 ``MemoryStore`` 子类 + ``get_memory_store()`` 分支
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_tenant_code,
)
from sop_manager.project_write_guard import project_file_write_scope


def _scope_dir() -> Path:
    return resolved_ai_memory_root() / "memory-v4"


def _scope_file() -> Path:
    t = resolved_tenant_code().replace("/", "_")[:80]
    b = (resolved_business_code() or "_").replace("/", "_")[:80]
    p = resolved_project_code().replace("/", "_")[:80]
    return _scope_dir() / f"{t}__{b}__{p}.jsonl"


@dataclass
class MemoryRecord:
    id: str
    content: str
    kind: str
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "content": self.content,
            "kind": self.kind,
            "metadata": self.metadata,
            "createdAt": self.created_at,
        }


class MemoryStore(ABC):
    @abstractmethod
    def append(self, content: str, kind: str, metadata: dict[str, Any]) -> MemoryRecord:
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str, *, limit: int) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def recent(self, *, limit: int) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def forget(self, *, ids: list[str] | None = None, query: str = "", kind: str = "") -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def summarize(self, *, query: str = "", limit: int = 50, metadata: dict[str, Any] | None = None) -> MemoryRecord:
        raise NotImplementedError

    @abstractmethod
    def attach_run(self, memory_id: str, run_id: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def update_lifecycle(self, memory_id: str, state: str, reason: str = "") -> dict[str, Any]:
        raise NotImplementedError


class FileJsonlMemoryStore(MemoryStore):
    """按 tenant/business/project 分文件；单机文件锁，适合默认部署。"""

    _lock = threading.Lock()
    _max_lines = int(os.getenv("MEMORY_FILE_MAX_LINES", "2000"))

    def append(self, content: str, kind: str, metadata: dict[str, Any]) -> MemoryRecord:
        md = dict(metadata or {})
        md.setdefault("lifecycle_state", "active")
        rec = MemoryRecord(
            id=str(uuid.uuid4()),
            content=content,
            kind=kind,
            metadata=md,
            created_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        )
        line = json.dumps(rec.to_json(), ensure_ascii=False) + "\n"
        path = _scope_file()
        with project_file_write_scope(), self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(line)
            self._trim_unlocked(path)
        return rec

    def _trim_unlocked(self, path: Path) -> None:
        if not path.is_file():
            return
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return
        if len(lines) <= self._max_lines:
            return
        keep = lines[-self._max_lines :]
        # append already owns Project -> thread locks. The project scope is
        # reentrant; trimming never reacquires the non-reentrant thread lock.
        with project_file_write_scope():
            path.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")

    def _read_all(self) -> list[dict[str, Any]]:
        path = _scope_file()
        if not path.is_file():
            return []
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            return []
        out: list[dict[str, Any]] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out

    def _write_all(self, rows: list[dict[str, Any]]) -> None:
        path = _scope_file()
        with project_file_write_scope(), self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            lines = [json.dumps(r, ensure_ascii=False) for r in rows]
            path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    def search(self, query: str, *, limit: int) -> list[dict[str, Any]]:
        q = query.lower().strip()
        rows = self._read_all()
        scored: list[tuple[float, dict[str, Any]]] = []
        for r in reversed(rows):
            text = f"{r.get('content', '')} {json.dumps(r.get('metadata', {}), ensure_ascii=False)}".lower()
            if not q or q in text:
                score = 2.0 if q and q in (r.get("content") or "").lower() else (1.0 if q else 0.5)
                scored.append((score, r))
            if len(scored) >= limit * 3:
                break
        scored.sort(key=lambda x: x[0], reverse=True)
        return [r for _, r in scored[:limit]]

    def recent(self, *, limit: int) -> list[dict[str, Any]]:
        rows = self._read_all()
        return list(reversed(rows[-limit:]))

    def forget(self, *, ids: list[str] | None = None, query: str = "", kind: str = "") -> dict[str, Any]:
        rows = self._read_all()
        id_set = {str(x).strip() for x in (ids or []) if str(x).strip()}
        q = query.lower().strip()
        k = kind.strip()

        def should_forget(row: dict[str, Any]) -> bool:
            if id_set and str(row.get("id") or "") in id_set:
                return True
            if k and str(row.get("kind") or "") != k:
                return False
            if q:
                hay = f"{row.get('content', '')} {json.dumps(row.get('metadata', {}), ensure_ascii=False)}".lower()
                return q in hay
            return False

        kept = [r for r in rows if not should_forget(r)]
        removed = len(rows) - len(kept)
        if removed:
            self._write_all(kept)
        return {"ok": True, "removed": removed}

    def summarize(self, *, query: str = "", limit: int = 50, metadata: dict[str, Any] | None = None) -> MemoryRecord:
        rows = self.search(query, limit=limit) if query.strip() else self.recent(limit=limit)
        snippets: list[str] = []
        for row in reversed(rows[-limit:]):
            content = str(row.get("content") or "").strip()
            if content:
                snippets.append(content[:500])
        if not snippets:
            summary = "No memory items available for summary."
        else:
            joined = "\n".join(f"- {x}" for x in snippets)
            summary = f"Summary of {len(snippets)} memory items:\n{joined}"
            if len(summary) > 8000:
                summary = summary[:8000] + "\n- ... truncated"
        md = {
            "source": "memory.summarize",
            "query": query,
            "item_count": len(snippets),
            **(metadata or {}),
        }
        return self.append(summary, "long", md)

    def attach_run(self, memory_id: str, run_id: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        mid = memory_id.strip()
        rid = run_id.strip()
        if not mid or not rid:
            return {"ok": False, "updated": 0}
        rows = self._read_all()
        updated = 0
        for row in rows:
            if str(row.get("id") or "") != mid:
                continue
            md = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            runs = md.get("runs") if isinstance(md.get("runs"), list) else []
            if rid not in runs:
                runs.append(rid)
            md["runs"] = runs[-50:]
            md["last_run_id"] = rid
            if metadata:
                md.setdefault("run_metadata", {})[rid] = metadata
            row["metadata"] = md
            updated += 1
        if updated:
            self._write_all(rows)
        return {"ok": True, "updated": updated}

    def update_lifecycle(self, memory_id: str, state: str, reason: str = "") -> dict[str, Any]:
        mid = memory_id.strip()
        rows = self._read_all()
        updated = 0
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        for row in rows:
            if str(row.get("id") or "") != mid:
                continue
            md = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            md["lifecycle_state"] = state
            md["lifecycle_updated_at"] = now
            if reason:
                md["lifecycle_reason"] = reason
            row["metadata"] = md
            updated += 1
        if updated:
            self._write_all(rows)
        return {"ok": True, "updated": updated, "state": state}


_store_singleton: MemoryStore | None = None


def get_memory_store() -> MemoryStore:
    """MEMORY_BACKEND=file（默认）| http（mem0 兼容 HTTP 代理）。"""
    global _store_singleton
    backend = (os.getenv("MEMORY_BACKEND") or "file").strip().lower()
    if _store_singleton is not None:
        return _store_singleton
    if backend in ("file", ""):
        _store_singleton = FileJsonlMemoryStore()
    elif backend == "http":
        from sop_manager.memory_adapters.http import HttpMemoryStore

        _store_singleton = HttpMemoryStore()
    else:
        raise RuntimeError(
            f"MEMORY_BACKEND={backend!r} 尚未接入；支持 file | http，或扩展 get_memory_store()"
        )
    return _store_singleton
