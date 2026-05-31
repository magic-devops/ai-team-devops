from __future__ import annotations

from sop_worker import handlers


class _Resp:
    def __init__(self, data: dict, status_code: int = 200):
        self._data = data
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")

    def json(self) -> dict:
        return self._data


class _Client:
    calls: list[tuple[str, str, dict]] = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url: str, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return _Resp({"backend": "test-vector", "qdrant_url_set": False})

    def post(self, url: str, **kwargs):
        self.calls.append(("POST", url, kwargs))
        if url.endswith("/api/v1/rag/index"):
            return _Resp({"ok": True, "count": len(kwargs.get("json", {}).get("docs", [])), "dim": 3})
        return _Resp({"items": [{"id": "doc-1", "score": 0.9}]})


def test_rag_warmup_calls_health_search_and_optional_index(monkeypatch):
    _Client.calls = []
    monkeypatch.setattr(handlers.httpx, "Client", _Client)
    monkeypatch.setenv("MANAGER_URL", "http://manager.test")

    result = handlers._run_rag_warmup(
        {
            "collections": ["knowledge"],
            "queries": ["SOP"],
            "limit": 3,
            "index_collection": "knowledge",
            "docs": [{"id": "doc", "title": "Doc", "text": "Hermes SOP"}],
        }
    )

    assert result["ok"] is True
    assert result["searches"] == 1
    assert result["hits"] == 1
    assert result["indexed"]["count"] == 1
    assert [call[0] for call in _Client.calls] == ["GET", "POST", "POST"]
