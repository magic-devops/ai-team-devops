"""
@module: sop_sdk.client
@purpose: ManagerClient — 与 Manager HTTP 通信的统一客户端
@stable: 方法签名稳定；新增接口直接加方法
@ai_safe_edit:
  - 新接口：复用 _request() 即可自动获得签名/重试/错误映射
  - 改鉴权：仅改 security.py
  - 改重试策略：调 _build_retry()
"""
from __future__ import annotations

import json
import logging
from typing import Any, Iterable, Mapping
from urllib.parse import urljoin, urlparse

import httpx
from tenacity import (
    Retrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import AgentConfig, load_config
from .errors import (
    SopAuthError,
    SopConflictError,
    SopForbiddenError,
    SopNotFoundError,
    SopServerError,
    SopTransportError,
)
from .security import Auth, BearerAuth, HmacAuth, NoAuth, auth_from_env

_log = logging.getLogger("sop_sdk")

_USER_AGENT = "sop-sdk/2.0"
_DEFAULT_HEADERS = {"Accept": "application/json"}


class ManagerClient:
    """同步 HTTP 客户端；如需异步用 AsyncManagerClient（M3+ 提供）。"""

    def __init__(
        self,
        base_url: str,
        *,
        auth: Auth | None = None,
        project_id: str = "",
        timeout: float = 30,
        max_retries: int = 3,
        verify: bool = True,
        user_agent: str = _USER_AGENT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth: Auth = auth or NoAuth()
        self.project_id = project_id
        self.timeout = timeout
        self.max_retries = max_retries
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            verify=verify,
            headers={**_DEFAULT_HEADERS, "User-Agent": user_agent},
            follow_redirects=False,
        )

    # ── lifecycle ──────────────────────────────────────────────────
    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "ManagerClient":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # ── 核心 _request ──────────────────────────────────────────────
    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Mapping[str, Any] | None = None,
        extra_headers: Mapping[str, str] | None = None,
        retry: bool = True,
    ) -> Any:
        url_path = path if path.startswith("/") else "/" + path
        body_bytes = b""
        if json_body is not None:
            body_bytes = json.dumps(json_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

        def _do() -> Any:
            headers: dict[str, str] = dict(extra_headers or {})
            if self.project_id:
                headers.setdefault("X-Project-Id", self.project_id)
            if body_bytes:
                headers["Content-Type"] = "application/json"
            self.auth.attach(method, url_path, headers, body_bytes)
            try:
                resp = self._client.request(
                    method,
                    url_path,
                    content=body_bytes if body_bytes else None,
                    params=params,
                    headers=headers,
                )
            except httpx.HTTPError as e:
                raise SopTransportError(f"网络错误：{e}") from e
            self._raise_for_status(resp)
            if resp.status_code == 204 or not resp.content:
                return None
            ct = resp.headers.get("content-type", "")
            if ct.startswith("application/json") or ct.startswith("application/problem+json"):
                return resp.json()
            return resp.text

        if not retry:
            return _do()

        try:
            for attempt in Retrying(
                stop=stop_after_attempt(self.max_retries + 1),
                wait=wait_exponential(multiplier=0.5, min=0.5, max=30),
                retry=retry_if_exception_type((SopTransportError, SopServerError)),
                reraise=True,
            ):
                with attempt:
                    return _do()
        except RetryError as e:  # pragma: no cover
            raise SopTransportError(f"重试耗尽：{e}") from e

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        if resp.is_success:
            return
        try:
            payload = resp.json()
        except Exception:
            payload = {"detail": resp.text}
        msg = payload.get("title") or payload.get("detail") or resp.text or "manager 请求失败"
        code = resp.status_code
        if code == 401:
            raise SopAuthError(msg, status=code, detail=payload)
        if code == 403:
            raise SopForbiddenError(msg, status=code, detail=payload)
        if code == 404:
            raise SopNotFoundError(msg, status=code, detail=payload)
        if code == 409:
            raise SopConflictError(msg, status=code, detail=payload)
        if 500 <= code < 600:
            raise SopServerError(msg, status=code, detail=payload)
        raise SopTransportError(msg, status=code, detail=payload)

    # ── 公开方法（与 openapi.yaml 一一对应；保持精简）──────────────
    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/health")

    def rag_backend(self) -> dict[str, Any]:
        """RAG 向量后端与 SQL 类型探测（无需鉴权时部分部署可能 401，doctor 内捕获）。"""
        return self._request("GET", "/api/v1/rag/health")

    # auth
    def login(self, username: str, password: str, tenant_slug: str | None = None) -> dict[str, Any]:
        body = {"username": username, "password": password}
        if tenant_slug:
            body["tenant_slug"] = tenant_slug
        return self._request("POST", "/api/v1/auth/login", json_body=body)

    def pair_project(self, pair_code: str, hostname: str = "", local_path: str = "") -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/auth/pair",
            json_body={"pair_code": pair_code, "hostname": hostname, "local_path": local_path},
        )

    # projects
    def list_projects(self, *, tenant_id: str | None = None, page: int = 1, size: int = 50) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "size": size}
        if tenant_id:
            params["tenant_id"] = tenant_id
        return self._request("GET", "/api/v1/projects", params=params)

    def create_project(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/projects", json_body=body)

    # tasks
    def list_tasks(self, *, status: str | None = None, priority: str | None = None,
                   page: int = 1, size: int = 50) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "size": size}
        if status:
            params["status"] = status
        if priority:
            params["priority"] = priority
        return self._request("GET", "/api/v1/tasks", params=params)

    def create_task(self, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/tasks", json_body=body)

    def update_task(self, task_id: str, body: Mapping[str, Any]) -> dict[str, Any]:
        return self._request("PATCH", f"/api/v1/tasks/{task_id}", json_body=body)

    def pull_task(self, task_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/tasks/{task_id}:pull")

    # llm gateway
    def llm_chat(
        self,
        messages: Iterable[Mapping[str, str]],
        *,
        model: str | None = None,
        task_type: str | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        cache_ttl: int | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"messages": list(messages), "temperature": temperature, "stream": stream}
        if model:
            body["model"] = model
        if task_type:
            body["task_type"] = task_type
        if max_tokens:
            body["max_tokens"] = max_tokens
        if cache_ttl is not None:
            body["cache_ttl"] = cache_ttl
        return self._request("POST", "/api/v1/llm/chat", json_body=body)

    def llm_embeddings(self, inputs: str | list[str], *, model: str = "bge-m3") -> dict[str, Any]:
        return self._request("POST", "/api/v1/llm/embeddings", json_body={"input": inputs, "model": model})

    def rag_search(self, query: str, *, collections: list[str] | None = None,
                   limit: int = 8, hybrid: bool = True, rerank: bool = True) -> dict[str, Any]:
        body: dict[str, Any] = {"query": query, "limit": limit, "hybrid": hybrid, "rerank": rerank}
        if collections:
            body["collections"] = collections
        return self._request("POST", "/api/v1/rag/search", json_body=body)

    # 工作台驾驶舱（原 console/overview 合并至此）
    def console_overview(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/dashboard")


def build_default_client(config: AgentConfig | None = None) -> ManagerClient:
    """根据项目配置 + 环境变量自动构建 ManagerClient。"""
    cfg = config or load_config()
    if cfg.bearer_token:
        auth: Auth = BearerAuth(cfg.bearer_token)
    elif cfg.api_key:
        auth = HmacAuth(cfg.api_key)
    else:
        auth = auth_from_env()
    return ManagerClient(
        base_url=cfg.manager_url,
        auth=auth,
        project_id=cfg.project_id,
        timeout=cfg.timeout_seconds,
        max_retries=cfg.max_retries,
        verify=cfg.verify_ssl,
    )
