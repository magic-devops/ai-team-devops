"""Resolve a project's saved model settings without mutating process credentials."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_id, resolved_tenant_id

SUPPORTED_PROVIDERS = frozenset({"anthropic", "openai", "ollama"})
MODEL_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$"
PROVIDER_ID_PATTERN = r"^[a-z][a-z0-9_-]{0,49}$"
ROLE_PATTERN = r"^[a-z][a-z0-9_-]{0,79}$"
_ENV_REF = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")


def models_file() -> Path:
    return resolved_ai_memory_root() / "model-configs" / f"{_scope_digest()}.json"


def _scope_digest() -> str:
    identity = [resolved_tenant_id(), resolved_project_id()]
    return hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()


def credential_env_prefix() -> str:
    """Operator-managed credential namespace; project IDs never become path segments."""
    return f"SOP_LLM_CREDENTIAL_{_scope_digest()[:16].upper()}_"


def validate_secret_reference(raw: str | None) -> str | None:
    if raw is None or not raw.startswith("${"):
        return raw
    match = _ENV_REF.fullmatch(raw)
    prefix = credential_env_prefix()
    if not match or not match.group(1).startswith(prefix) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", match.group(1)[len(prefix):]):
        raise ValueError(f"environment credential reference must use current project namespace {prefix}<NAME>")
    return raw


def _config_path() -> Path | None:
    scoped = models_file()
    if scoped.exists():
        return scoped
    # Legacy files had no tenant/project ownership. Only an explicit operator
    # assignment permits one project to adopt one; all new writes are scoped.
    tenant = os.getenv("SOP_LEGACY_MODELS_TENANT_ID", "")
    project = os.getenv("SOP_LEGACY_MODELS_PROJECT_ID", "")
    legacy = resolved_ai_memory_root() / "models.json"
    if tenant and project and tenant == resolved_tenant_id() and project == resolved_project_id() and legacy.exists():
        return legacy
    return None


def configuration_source() -> str:
    path = _config_path()
    if path is None:
        return "environment"
    return "project" if path == models_file() else "legacy_project"


def validate_base_url(value: str | None) -> str | None:
    if not value:
        return None
    if value != value.strip() or any(ord(c) < 33 for c in value) or "\\" in value:
        raise ValueError("base_url must be an absolute HTTP(S) URL without whitespace")
    parsed = urlsplit(value)
    try:
        valid_port = parsed.port is None or 0 < parsed.port <= 65535
    except ValueError:
        valid_port = False
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not valid_port
    ):
        raise ValueError("base_url must be HTTP(S), without credentials, query or fragment")
    return value.rstrip("/")


def load_saved_config() -> dict | None:
    path = _config_path()
    if path is None:
        return None
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
        if (
            not isinstance(config, dict)
            or not isinstance(config.get("providers", {}), dict)
            or not isinstance(config.get("custom_models", []), list)
            or not isinstance(config.get("role_models", {}), dict)
            or any(not isinstance(row, dict) for row in config.get("custom_models", []))
        ):
            raise ValueError("invalid settings shape")
        for name, provider in config.get("providers", {}).items():
            if not re.fullmatch(PROVIDER_ID_PATTERN, name) or not isinstance(provider, dict):
                raise ValueError("invalid provider settings")
            if (provider.get("api_key") is not None and not isinstance(provider["api_key"], str)) or not isinstance(provider.get("enabled", True), bool):
                raise ValueError("invalid provider credentials or enabled flag")
            validate_secret_reference(provider.get("api_key"))
            if provider.get("base_url") is not None and not isinstance(provider["base_url"], str):
                raise ValueError("invalid provider endpoint")
        for row in config.get("custom_models", []):
            if (
                not isinstance(row.get("id"), str)
                or not re.fullmatch(MODEL_ID_PATTERN, row["id"])
                or not isinstance(row.get("provider"), str)
                or not re.fullmatch(PROVIDER_ID_PATTERN, row["provider"])
                or (row.get("api_key") is not None and not isinstance(row["api_key"], str))
            ):
                raise ValueError("invalid custom model settings")
            validate_secret_reference(row.get("api_key"))
        if any(not isinstance(model, str) or not re.fullmatch(MODEL_ID_PATTERN, model) for model in config.get("role_models", {}).values()):
            raise ValueError("invalid role model settings")
        return config
    except (OSError, ValueError, TypeError):
        raise HTTPException(503, "项目模型配置无法读取，请管理员检查配置") from None


def selected_model(config: dict, explicit: str | None, task_type: str | None) -> str:
    selected = explicit or config.get("role_models", {}).get((task_type or "").lower()) or config.get("default_model")
    if not isinstance(selected, str) or not re.fullmatch(MODEL_ID_PATTERN, selected):
        raise HTTPException(503, "项目尚未配置有效的默认模型或任务模型")
    return selected


def resolve_secret(raw: str | None) -> str:
    value = str(raw or "")
    validate_secret_reference(value)
    match = _ENV_REF.fullmatch(value)
    return os.getenv(match.group(1), "") if match else value


@dataclass(frozen=True)
class ModelRoute:
    model: str
    provider: str
    api_key: str = field(repr=False)
    base_url: str | None
    fingerprint: str


def resolve_saved_route(config: dict, explicit: str | None, task_type: str | None) -> ModelRoute:
    # Imported lazily so the settings API and gateway share a single catalogue.
    from sop_manager.routers.models import BUILTIN_MODELS

    model = selected_model(config, explicit, task_type)
    catalog = {row["id"]: row for row in [*BUILTIN_MODELS, *config.get("custom_models", [])] if row.get("id")}
    row = catalog.get(model)
    if not row:
        raise HTTPException(404, "模型未在当前项目注册")
    return resolve_provider_route(config, model, row.get("provider", ""), row.get("api_key"))


def resolve_provider_route(config: dict, model: str, provider_name: str, model_key: str | None = None) -> ModelRoute:
    """Resolve transport settings for chat or an explicitly selected embedding model."""
    if provider_name not in SUPPORTED_PROVIDERS:
        raise HTTPException(503, f"模型提供商 {provider_name} 尚无可用调用适配器")
    provider = config.get("providers", {}).get(provider_name)
    if not isinstance(provider, dict):
        raise HTTPException(503, f"项目未配置模型提供商 {provider_name}")
    if not provider.get("enabled", True):
        raise HTTPException(503, f"模型提供商 {provider_name} 已禁用")
    key = resolve_secret(model_key or provider.get("api_key"))
    if not key and provider_name != "ollama":
        raise HTTPException(503, f"模型提供商 {provider_name} 未配置可用凭证")
    try:
        base_url = validate_base_url(provider.get("base_url"))
    except (ValueError, TypeError):
        raise HTTPException(503, f"模型提供商 {provider_name} 的地址无效") from None
    if provider_name == "ollama" and not base_url:
        base_url = "http://localhost:11434"
    fingerprint = hashlib.sha256(
        json.dumps({"config": config, "model": model, "resolved_key": key, "base_url": base_url}, sort_keys=True).encode()
    ).hexdigest()
    return ModelRoute(model, provider_name, key, base_url, fingerprint)


def legacy_fingerprint() -> str:
    values = {key: os.getenv(key, "") for key in (
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OLLAMA_BASE_URL", "OLLAMA_FALLBACK",
    )}
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()
