"""
@module: routers.llm_gateway
@purpose: 统一 LLM 入口（路由 / 缓存 / 限流 / Fallback / 计费 / 审计）。
@stable: /api/v1/llm/{chat,embeddings,models} 路径稳定
@ai_safe_edit:
  - 新增 Provider：实现 Provider 协议 + 注册到 PROVIDERS
  - 新增路由策略：修改 _route_model()；保留原有 task_type → model 表
  - 改缓存：替换 _Cache 实现（同接口）
@deps_in: pydantic, fastapi, anthropic / openai / httpx（可选）
@deps_out: events.LlmCalled

设计目标（与 docs/architecture/AI_FIRST.md 对齐）：
  1. 一处接入：所有 Agent / Vibe / CLI / hook 都走 /api/v1/llm/*
  2. 透明计费：每次调用入 llm_calls 表 + 事件 sop.llm.called
  3. 故障转移：Anthropic → OpenAI → Ollama 自动回退
  4. 提示缓存：相同 prompt 在 TTL 内直接返回（Semantic cache 留 M7）
  5. 限流：按 tenant / project / api_key 三维度（沿用 slowapi，未启用时跳过）
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from threading import RLock
from typing import Any, Iterable, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

try:
    from sop_manager.path_config import resolved_project_id, resolved_tenant_id  # type: ignore[import-not-found]
except Exception:  # pragma: no cover

    def resolved_project_id() -> str:
        return os.getenv("PROJECT_ID", "default")

    def resolved_tenant_id() -> str:
        return os.getenv("TENANT_ID", "t-default")


router = APIRouter(prefix="/api/v1/llm", tags=["llm"])
_log = logging.getLogger("sop.llm_gateway")


# ── Schemas（与 apis/openapi/openapi.yaml 对齐） ──────────────────
class Message(BaseModel):
    role: str = Field(..., pattern="^(system|user|assistant|tool)$")
    content: str


class ChatIn(BaseModel):
    model: Optional[str] = None
    task_type: Optional[str] = Field(None, description="plan/code/review/summarize/classify")
    messages: list[Message]
    temperature: float = 0.2
    max_tokens: Optional[int] = None
    cache_ttl: Optional[int] = Field(None, description="提示缓存秒数；0 关闭")
    stream: bool = False


class ChatUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


class ChatOut(BaseModel):
    model: str
    content: str
    finish_reason: str = "stop"
    usage: ChatUsage = ChatUsage()
    provider: str = ""
    cached: bool = False


class EmbeddingsIn(BaseModel):
    input: str | list[str]
    model: str = "bge-m3"


class EmbeddingsOut(BaseModel):
    model: str
    vectors: list[list[float]]
    usage: ChatUsage = ChatUsage()


# ── Provider 抽象 ─────────────────────────────────────────────────
@dataclass
class ModelInfo:
    id: str
    provider: str
    family: str
    cost_in: float = 0.0   # USD / 1M token
    cost_out: float = 0.0  # USD / 1M token


class Provider(ABC):
    name: str = ""

    @abstractmethod
    def supports(self, model: str) -> bool: ...

    @abstractmethod
    def chat(self, body: ChatIn) -> ChatOut: ...

    def embed(self, body: EmbeddingsIn) -> EmbeddingsOut:
        raise HTTPException(501, f"provider {self.name} 暂不支持 embeddings")


class AnthropicProvider(Provider):
    name = "anthropic"
    PRICES = {
        "claude-3-5-sonnet-20241022": (3.0, 15.0),
        "claude-3-opus-20240229":      (15.0, 75.0),
        "claude-3-haiku-20240307":     (0.25, 1.25),
    }

    def supports(self, model: str) -> bool:
        return model.startswith("claude")

    def chat(self, body: ChatIn) -> ChatOut:
        try:
            import anthropic
        except ImportError:  # pragma: no cover
            raise HTTPException(503, "未安装 anthropic 包")
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise HTTPException(503, "未配置 ANTHROPIC_API_KEY")
        sys_msgs = [m.content for m in body.messages if m.role == "system"]
        msgs = [{"role": m.role, "content": m.content} for m in body.messages if m.role != "system"]
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=body.model or "claude-3-5-sonnet-20241022",
            system="\n\n".join(sys_msgs) if sys_msgs else anthropic.NOT_GIVEN,
            messages=msgs,
            temperature=body.temperature,
            max_tokens=body.max_tokens or 4096,
        )
        text = "".join(getattr(c, "text", "") for c in resp.content) if resp.content else ""
        u_in = getattr(resp.usage, "input_tokens", 0) if resp.usage else 0
        u_out = getattr(resp.usage, "output_tokens", 0) if resp.usage else 0
        ci, co = self.PRICES.get(resp.model, (0.0, 0.0))
        cost = u_in / 1_000_000 * ci + u_out / 1_000_000 * co
        return ChatOut(
            model=resp.model,
            content=text,
            finish_reason=resp.stop_reason or "stop",
            usage=ChatUsage(prompt_tokens=u_in, completion_tokens=u_out,
                            total_tokens=u_in + u_out, cost_usd=round(cost, 6)),
            provider=self.name,
        )


class OpenAIProvider(Provider):
    name = "openai"
    PRICES = {
        "gpt-4o":      (2.5, 10.0),
        "gpt-4o-mini": (0.15, 0.6),
        "gpt-4.1":     (5.0, 15.0),
    }

    def supports(self, model: str) -> bool:
        return model.startswith("gpt")

    def chat(self, body: ChatIn) -> ChatOut:
        try:
            from openai import OpenAI
        except ImportError:  # pragma: no cover
            raise HTTPException(503, "未安装 openai 包")
        key = os.getenv("OPENAI_API_KEY", "")
        if not key:
            raise HTTPException(503, "未配置 OPENAI_API_KEY")
        client = OpenAI(api_key=key)
        resp = client.chat.completions.create(
            model=body.model or "gpt-4o-mini",
            messages=[{"role": m.role, "content": m.content} for m in body.messages],
            temperature=body.temperature,
            max_tokens=body.max_tokens,
        )
        choice = resp.choices[0]
        u = resp.usage
        ci, co = self.PRICES.get(resp.model, (0.0, 0.0))
        cost = ((u.prompt_tokens or 0) / 1_000_000) * ci + ((u.completion_tokens or 0) / 1_000_000) * co
        return ChatOut(
            model=resp.model,
            content=choice.message.content or "",
            finish_reason=choice.finish_reason or "stop",
            usage=ChatUsage(prompt_tokens=u.prompt_tokens or 0,
                            completion_tokens=u.completion_tokens or 0,
                            total_tokens=u.total_tokens or 0, cost_usd=round(cost, 6)),
            provider=self.name,
        )


class OllamaProvider(Provider):
    """本地推理 fallback（成本 0）。"""
    name = "ollama"

    def supports(self, model: str) -> bool:
        return model.startswith(("llama", "qwen", "mistral", "gemma", "deepseek"))

    def chat(self, body: ChatIn) -> ChatOut:  # pragma: no cover (本地依赖)
        try:
            import httpx
        except ImportError:
            raise HTTPException(503, "未安装 httpx")
        base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        r = httpx.post(f"{base}/api/chat", json={
            "model": body.model or "qwen2.5:7b",
            "messages": [m.model_dump() for m in body.messages],
            "stream": False,
            "options": {"temperature": body.temperature},
        }, timeout=120)
        r.raise_for_status()
        d = r.json()
        text = (d.get("message") or {}).get("content", "")
        return ChatOut(model=body.model or "ollama", content=text, provider=self.name)


PROVIDERS: list[Provider] = [AnthropicProvider(), OpenAIProvider(), OllamaProvider()]

# task_type → 默认模型；可由环境变量 SOP_LLM_MODEL_<TYPE> 覆盖
DEFAULT_ROUTING: dict[str, str] = {
    "plan":      "claude-3-5-sonnet-20241022",
    "code":      "claude-3-5-sonnet-20241022",
    "review":    "claude-3-5-sonnet-20241022",
    "summarize": "gpt-4o-mini",
    "classify":  "gpt-4o-mini",
}


def _route_model(body: ChatIn) -> str:
    if body.model:
        return body.model
    t = (body.task_type or "").lower()
    if t and (env := os.getenv(f"SOP_LLM_MODEL_{t.upper()}")):
        return env
    return DEFAULT_ROUTING.get(t, os.getenv("SOP_LLM_DEFAULT_MODEL", "claude-3-5-sonnet-20241022"))


def _pick_provider(model: str) -> Provider:
    for p in PROVIDERS:
        if p.supports(model):
            return p
    raise HTTPException(400, f"暂无 Provider 支持 model={model}")


def _estimate_prompt_tokens(body: ChatIn) -> int:
    chars = sum(len(m.content or "") for m in body.messages)
    prompt_tokens = max(1, chars // 4)
    requested_out = int(body.max_tokens or 1024)
    return prompt_tokens + max(0, requested_out)


def _enforce_llm_quota(body: ChatIn, model: str) -> None:
    try:
        from sop_manager.routers.usage import check_usage_quota

        estimated = float(_estimate_prompt_tokens(body))
        check = check_usage_quota("llm_tokens", estimated)
        if not check.get("allowed", True):
            raise HTTPException(
                429,
                {
                    "error": "usage_quota_exceeded",
                    "metric": "llm_tokens",
                    "model": model,
                    "estimated_tokens": estimated,
                    "current": check.get("current"),
                    "limit": check.get("limit"),
                    "remaining": check.get("remaining"),
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        _log.warning("usage quota check skipped: %s", e)


# ── 缓存（进程内 LRU + TTL；后续可替换为 Redis） ────────────────
class _Cache:
    def __init__(self, max_items: int = 4096) -> None:
        self._d: dict[str, tuple[float, ChatOut]] = {}
        self._lock = RLock()
        self._max = max_items

    @staticmethod
    def key(body: ChatIn, model: str) -> str:
        h = hashlib.sha256()
        payload = {"m": model, "t": body.temperature, "mx": body.max_tokens,
                   "msgs": [m.model_dump() for m in body.messages]}
        h.update(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode())
        return h.hexdigest()

    def get(self, key: str) -> Optional[ChatOut]:
        with self._lock:
            v = self._d.get(key)
            if not v:
                return None
            exp, out = v
            if exp < time.time():
                self._d.pop(key, None)
                return None
            return out

    def set(self, key: str, out: ChatOut, ttl: int) -> None:
        if ttl <= 0:
            return
        with self._lock:
            if len(self._d) >= self._max:
                # 粗暴 LRU：随机删 16 条
                for k in list(self._d.keys())[:16]:
                    self._d.pop(k, None)
            self._d[key] = (time.time() + ttl, out)


_cache = _Cache()


# ── 审计与事件 ───────────────────────────────────────────────────
def _audit_call(model: str, usage: ChatUsage, task_type: str | None,
                provider: str, cached: bool, latency_ms: int) -> None:
    """写一行结构化日志（M7 接入 OTel 后改 metrics + log）。"""
    try:
        _log.info(
            "llm_call",
            extra={
                "tenant_id": resolved_tenant_id(),
                "project_id": resolved_project_id(),
                "model": model,
                "provider": provider,
                "task_type": task_type or "",
                "cached": cached,
                "latency_ms": latency_ms,
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "cost_usd": usage.cost_usd,
            },
        )
    except Exception:
        pass
    try:
        from sop_manager.routers.usage import record_usage_event

        total_tokens = float((usage.prompt_tokens or 0) + (usage.completion_tokens or 0))
        record_usage_event(
            {
                "metric": "llm_tokens",
                "value": total_tokens,
                "unit": "tokens",
                "source": "llm_gateway",
                "subject": model,
                "metadata": {
                    "model": model,
                    "provider": provider,
                    "task_type": task_type or "",
                    "cached": cached,
                    "latency_ms": latency_ms,
                    "prompt_tokens": usage.prompt_tokens,
                    "completion_tokens": usage.completion_tokens,
                },
                "idempotency_key": f"llm:{model}:{provider}:{cached}:{latency_ms}:{total_tokens}",
            }
        )
        if float(usage.cost_usd or 0) > 0:
            record_usage_event(
                {
                    "metric": "llm_cost_usd",
                    "value": float(usage.cost_usd or 0),
                    "unit": "usd",
                    "source": "llm_gateway",
                    "subject": model,
                    "metadata": {"model": model, "provider": provider, "task_type": task_type or "", "cached": cached},
                }
            )
    except Exception:
        pass


# ── 路由 ────────────────────────────────────────────────────────
@router.post("/chat", response_model=ChatOut)
def llm_chat(body: ChatIn, _: Request) -> ChatOut:
    model = _route_model(body)
    _enforce_llm_quota(body, model)
    cache_ttl = body.cache_ttl or 0
    key = _Cache.key(body, model) if cache_ttl > 0 else ""
    if key:
        if (hit := _cache.get(key)):
            hit.cached = True
            _audit_call(model, hit.usage, body.task_type, hit.provider, True, 0)
            return hit

    # 尝试 + Fallback
    errors: list[str] = []
    started = time.time()
    for fallback in _provider_chain(model):
        try:
            out = fallback.chat(ChatIn(**{**body.model_dump(), "model": model}))
            latency_ms = int((time.time() - started) * 1000)
            _audit_call(out.model, out.usage, body.task_type, out.provider, False, latency_ms)
            if key:
                _cache.set(key, out, cache_ttl)
            return out
        except HTTPException as e:
            errors.append(f"{fallback.name}:{e.detail}")
        except Exception as e:  # pragma: no cover
            errors.append(f"{fallback.name}:{type(e).__name__}:{e}")
            continue
    raise HTTPException(502, f"全部 Provider 失败：{'; '.join(errors)}")


def _provider_chain(model: str) -> Iterable[Provider]:
    """主 Provider + 同族 fallback；若开启 OLLAMA_FALLBACK=1 则最后兜底本地。"""
    main = _pick_provider(model)
    chain: list[Provider] = [main]
    for p in PROVIDERS:
        if p is not main and isinstance(p, (AnthropicProvider, OpenAIProvider)):
            chain.append(p)
    if os.getenv("OLLAMA_FALLBACK", "0") == "1":
        chain.append(OllamaProvider())
    return chain


@router.post("/embeddings", response_model=EmbeddingsOut)
def llm_embeddings(body: EmbeddingsIn) -> EmbeddingsOut:
    """优先 sentence-transformers 本地 bge-m3；失败回退 OpenAI text-embedding-3-small。"""
    inputs = body.input if isinstance(body.input, list) else [body.input]
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]
        model_name = "BAAI/bge-m3" if body.model == "bge-m3" else body.model
        if not hasattr(llm_embeddings, "_st_cache"):
            llm_embeddings._st_cache = {}  # type: ignore[attr-defined]
        cache = llm_embeddings._st_cache  # type: ignore[attr-defined]
        if model_name not in cache:
            cache[model_name] = SentenceTransformer(model_name)
        vecs = cache[model_name].encode(inputs, normalize_embeddings=True)
        return EmbeddingsOut(model=body.model, vectors=[v.tolist() for v in vecs])
    except Exception as e:
        _log.warning("local embeddings unavailable, fallback to OpenAI: %s", e)

    try:
        from openai import OpenAI
    except ImportError:  # pragma: no cover
        raise HTTPException(503, "本地 embedding 不可用，且未安装 openai")
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        raise HTTPException(503, "本地 embedding 不可用，且未配置 OPENAI_API_KEY")
    client = OpenAI(api_key=key)
    resp = client.embeddings.create(model="text-embedding-3-small", input=inputs)
    vecs = [d.embedding for d in resp.data]
    used = resp.usage
    cost = (used.total_tokens or 0) / 1_000_000 * 0.02
    return EmbeddingsOut(
        model="text-embedding-3-small",
        vectors=vecs,
        usage=ChatUsage(prompt_tokens=used.total_tokens or 0,
                        total_tokens=used.total_tokens or 0,
                        cost_usd=round(cost, 6)),
    )


@router.get("/models", response_model=list[ModelInfo])
def list_models() -> list[ModelInfo]:
    """列出可用模型 + 价格（前端选择器用）。"""
    out: list[ModelInfo] = []
    for m, (ci, co) in AnthropicProvider.PRICES.items():
        out.append(ModelInfo(id=m, provider="anthropic", family="claude", cost_in=ci, cost_out=co))
    for m, (ci, co) in OpenAIProvider.PRICES.items():
        out.append(ModelInfo(id=m, provider="openai", family="gpt", cost_in=ci, cost_out=co))
    out.append(ModelInfo(id="qwen2.5:7b", provider="ollama", family="qwen", cost_in=0.0, cost_out=0.0))
    return out


@router.get("/routing", response_model=dict[str, str])
def get_routing() -> dict[str, str]:
    """当前 task_type → model 路由表。"""
    table = dict(DEFAULT_ROUTING)
    for k in list(table.keys()):
        env = os.getenv(f"SOP_LLM_MODEL_{k.upper()}")
        if env:
            table[k] = env
    return table


@router.get("/health")
def health() -> dict[str, Any]:
    """探活：各 Provider 凭证是否就绪。"""
    return {
        "ok": True,
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
        "openai": bool(os.getenv("OPENAI_API_KEY")),
        "ollama_fallback": os.getenv("OLLAMA_FALLBACK", "0") == "1",
        "default_model": os.getenv("SOP_LLM_DEFAULT_MODEL", "claude-3-5-sonnet-20241022"),
        "routing": get_routing(),
    }
