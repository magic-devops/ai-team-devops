"""模型管理：多模型配置、提供商管理"""
import json
import re
import time
import urllib.request
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from .business_access import configure_business_access, read_business_access
from .runtime_model_config import (
    MODEL_ID_PATTERN,
    PROVIDER_ID_PATTERN,
    ROLE_PATTERN,
    SUPPORTED_PROVIDERS,
    configuration_source,
    load_saved_config,
    models_file,
    resolve_secret,
    validate_base_url,
    validate_secret_reference,
)

router = APIRouter(prefix="/api/v1/models", tags=["models"], dependencies=[Depends(read_business_access)])


def _models_file() -> Path:
    return models_file()

BUILTIN_MODELS = [
    {"id":"claude-opus-4-7","provider":"anthropic","name":"Claude Opus 4.7","context":200000,"recommended":True},
    {"id":"claude-sonnet-4-5","provider":"anthropic","name":"Claude Sonnet 4.5","context":200000,"recommended":False},
    {"id":"gpt-4o","provider":"openai","name":"GPT-4o","context":128000,"recommended":False},
    {"id":"gpt-4o-mini","provider":"openai","name":"GPT-4o Mini","context":128000,"recommended":False},
    {"id":"gemini-1.5-pro","provider":"google","name":"Gemini 1.5 Pro","context":1000000,"recommended":False},
    {"id":"deepseek-coder","provider":"deepseek","name":"DeepSeek Coder","context":128000,"recommended":False},
    {"id":"qwen2.5-coder","provider":"ollama","name":"Qwen2.5 Coder (本地)","context":32000,"recommended":False},
]

def _load():
    return load_saved_config() or {"providers": {}, "custom_models": [], "default_model": "claude-opus-4-7",
            "role_models": {}}  # role -> model_id

def _save(d):
    path = _models_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    d["revision"] = uuid4().hex
    pending = path.with_name(f"models.{uuid4().hex}.tmp")
    try:
        pending.write_text(json.dumps(d, indent=2), encoding="utf-8")
        pending.replace(path)
    finally:
        pending.unlink(missing_ok=True)

def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def _mask_secret(v: str | None) -> str:
    if not v:
        return ""
    if re.fullmatch(r"\$\{[A-Za-z_][A-Za-z0-9_]*\}", v):
        return v
    if len(v) <= 8:
        return "***"
    return f"{v[:4]}...{v[-4:]}"

def _all_model_ids(d: dict) -> set[str]:
    return {m["id"] for m in BUILTIN_MODELS} | {m["id"] for m in d.get("custom_models", [])}

def _public_provider(p: dict) -> dict:
    out = dict(p)
    raw = str(out.get("api_key") or "")
    out["api_key"] = _mask_secret(raw)
    out["has_api_key"] = bool(raw)
    return out

def _public_config(d: dict) -> dict:
    return {
        "builtin": [{**row, "adapter_supported": row["provider"] in SUPPORTED_PROVIDERS} for row in BUILTIN_MODELS],
        "custom": [{**_public_provider(row), "adapter_supported": row.get("provider") in SUPPORTED_PROVIDERS} for row in d.get("custom_models", [])],
        "providers": {k: _public_provider(v) for k, v in d.get("providers", {}).items()},
        "default": d.get("default_model"),
        "role_models": d.get("role_models", {}),
        "updated_at": d.get("updated_at", ""),
        "routing_source": configuration_source(),
    }

class ProviderConfig(BaseModel):
    name: str = Field(pattern=PROVIDER_ID_PATTERN)
    api_key: str = Field("", max_length=8192)
    base_url: str | None = Field(None, max_length=2048)
    enabled: bool = True

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        return validate_base_url(value)

    @field_validator("api_key")
    @classmethod
    def valid_secret(cls, value):
        return validate_secret_reference(value)

class CustomModel(BaseModel):
    id: str = Field(pattern=MODEL_ID_PATTERN)
    provider: str = Field(pattern=PROVIDER_ID_PATTERN)
    name: str = Field(min_length=1, max_length=200)
    context: int = Field(32000, ge=1, le=10000000)
    api_key: str | None = Field(None, max_length=8192)

    @field_validator("api_key")
    @classmethod
    def valid_secret(cls, value):
        return validate_secret_reference(value)

class RoleModelConfig(BaseModel):
    role: str = Field(pattern=ROLE_PATTERN)
    model_id: str = Field(pattern=MODEL_ID_PATTERN)  # 与 gateway task_type 同名

@router.get("")
def list_models():
    d = _load()
    return _public_config(d)

@router.put("/default", dependencies=[Depends(configure_business_access)])
def set_default(model_id: str):
    d = _load()
    if model_id not in _all_model_ids(d):
        raise HTTPException(404, "model not found")
    d["default_model"] = model_id
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "default": model_id}

@router.put("/providers/{name}", dependencies=[Depends(configure_business_access)])
def upsert_provider(name: str, body: ProviderConfig):
    if name != body.name:
        raise HTTPException(400, "provider path and name must match")
    d = _load()
    existing = d.setdefault("providers", {}).get(name, {})
    payload = body.model_dump()
    payload["name"] = payload.get("name") or name
    if (not payload.get("api_key") or payload.get("api_key") == _mask_secret(existing.get("api_key"))) and existing.get("api_key"):
        payload["api_key"] = existing.get("api_key")
    payload["updated_at"] = _now()
    d.setdefault("providers", {})[name] = payload
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "provider": _public_provider(payload)}

@router.delete("/providers/{name}", dependencies=[Depends(configure_business_access)])
def delete_provider(name: str):
    d = _load()
    d.get("providers", {}).pop(name, None)
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True}

@router.post("/providers/{name}/test", dependencies=[Depends(configure_business_access)])
def test_provider(name: str):
    d = _load()
    provider = d.get("providers", {}).get(name)
    if not provider:
        raise HTTPException(404, "provider not found")
    if not provider.get("enabled", True):
        return {"ok": False, "status": "disabled", "provider": name}
    if name not in SUPPORTED_PROVIDERS:
        return {"ok": False, "status": "unsupported_adapter", "provider": name, "live": False}
    try:
        base_url = validate_base_url(provider.get("base_url")) or ""
    except (ValueError, TypeError):
        return {"ok": False, "status": "invalid_endpoint", "provider": name, "live": False}
    if not resolve_secret(provider.get("api_key")) and name != "ollama":
        return {"ok": False, "status": "missing_api_key", "provider": name, "base_url": base_url}
    if not base_url:
        return {"ok": True, "status": "configured", "provider": name, "base_url": "", "live": False}
    try:
        req = urllib.request.Request(base_url, method="HEAD")  # noqa: S310 - validated HTTP(S) operator endpoint
        with urllib.request.urlopen(req, timeout=5) as res:  # noqa: S310 - operator-provided endpoint
            return {"ok": True, "status": "reachable", "provider": name, "base_url": base_url, "http_status": res.status, "live": True}
    except Exception:
        return {"ok": False, "status": "unreachable", "provider": name, "base_url": base_url, "error": "endpoint unavailable", "live": True}

@router.post("/custom", dependencies=[Depends(configure_business_access)])
def add_custom_model(body: CustomModel):
    d = _load()
    if body.id in _all_model_ids(d):
        raise HTTPException(409, "model already exists")
    row = body.model_dump()
    row["created_at"] = _now()
    d.setdefault("custom_models", []).append(row)
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "model": _public_provider(row)}

@router.delete("/custom/{model_id}", dependencies=[Depends(configure_business_access)])
def remove_custom_model(model_id: str):
    d = _load()
    d["custom_models"] = [m for m in d.get("custom_models", []) if m["id"] != model_id]
    d["role_models"] = {k: v for k, v in d.get("role_models", {}).items() if v != model_id}
    if d.get("default_model") == model_id:
        d["default_model"] = BUILTIN_MODELS[0]["id"]
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True}

@router.put("/role-model", dependencies=[Depends(configure_business_access)])
def set_role_model(body: RoleModelConfig):
    d = _load()
    if body.model_id not in _all_model_ids(d):
        raise HTTPException(404, "model not found")
    if not body.role.strip():
        raise HTTPException(400, "role required")
    d.setdefault("role_models", {})[body.role] = body.model_id
    d["updated_at"] = _now()
    _save(d)
    return {"ok": True, "role": body.role, "model_id": body.model_id}
