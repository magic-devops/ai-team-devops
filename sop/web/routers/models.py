"""模型管理：多模型配置、提供商管理"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List
from pathlib import Path
import json, os
from path_config import resolved_ai_memory_root

router = APIRouter(prefix="/api/models", tags=["models"])


def _models_file() -> Path:
    return resolved_ai_memory_root() / "models.json"

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
    if _models_file().exists(): return json.loads(_models_file().read_text())
    return {"providers": {}, "custom_models": [], "default_model": "claude-opus-4-7",
            "role_models": {}}  # role -> model_id

def _save(d): _models_file().parent.mkdir(parents=True, exist_ok=True); _models_file().write_text(json.dumps(d, indent=2))

class ProviderConfig(BaseModel):
    name: str; api_key: str = ""; base_url: Optional[str] = None; enabled: bool = True

class CustomModel(BaseModel):
    id: str; provider: str; name: str; context: int = 32000; api_key: Optional[str] = None

class RoleModelConfig(BaseModel):
    role: str; model_id: str  # 为特定 Agent 角色指定模型

@router.get("")
def list_models():
    d = _load()
    return {"builtin": BUILTIN_MODELS, "custom": d.get("custom_models", []),
            "providers": d.get("providers", {}), "default": d.get("default_model"),
            "role_models": d.get("role_models", {})}

@router.put("/default")
def set_default(model_id: str):
    d = _load(); d["default_model"] = model_id; _save(d); return {"ok": True}

@router.put("/providers/{name}")
def upsert_provider(name: str, body: ProviderConfig):
    d = _load(); d.setdefault("providers", {})[name] = body.dict(); _save(d); return {"ok": True}

@router.delete("/providers/{name}")
def delete_provider(name: str):
    d = _load(); d.get("providers", {}).pop(name, None); _save(d); return {"ok": True}

@router.post("/custom")
def add_custom_model(body: CustomModel):
    d = _load(); d.setdefault("custom_models", []).append(body.dict()); _save(d); return {"ok": True}

@router.delete("/custom/{model_id}")
def remove_custom_model(model_id: str):
    d = _load(); d["custom_models"] = [m for m in d.get("custom_models",[]) if m["id"] != model_id]; _save(d); return {"ok": True}

@router.put("/role-model")
def set_role_model(body: RoleModelConfig):
    d = _load(); d.setdefault("role_models", {})[body.role] = body.model_id; _save(d); return {"ok": True}
