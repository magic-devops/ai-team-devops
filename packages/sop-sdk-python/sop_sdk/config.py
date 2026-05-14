"""
@module: sop_sdk.config
@purpose: 加载项目侧 .sop-runtime/agent.toml + 全局 ~/.sop/config.toml + 环境变量
@ai_safe_edit:
  - 新增配置字段：先改 AgentConfig dataclass + load_config() 解析；保持向后兼容（旧字段缺失给默认值）
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

if sys.version_info >= (3, 11):
    import tomllib  # type: ignore[attr-defined]
else:  # pragma: no cover
    import tomli as tomllib  # type: ignore[import-not-found]


@dataclass
class AgentConfig:
    manager_url: str = "http://localhost:8765"
    project_id: str = ""
    tenant_id: str = "t-default"
    api_key_ref: str = ""
    api_key: str = ""
    bearer_token: str = ""
    verify_ssl: bool = True
    timeout_seconds: int = 30
    max_retries: int = 3
    outbox_path: str = ".sop-runtime/outbox.sqlite"
    a2a_port: int = 7741
    mcp_servers: list[str] = field(default_factory=lambda: ["lancedb", "knowledge", "tasks", "files"])
    project_path: Path = field(default_factory=lambda: Path.cwd())
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def agentd_socket(self) -> Path:
        return self.project_path / ".sop-runtime" / "agentd.sock"


def _read_toml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except Exception:  # pragma: no cover
        return {}


def _resolve_api_key(ref: str, fallback_env: str = "MANAGER_API_KEY") -> str:
    """支持 ref："keyring://service/account" / "env://NAME" / "file:///path"。"""
    if not ref:
        return os.getenv(fallback_env, "")
    if ref.startswith("env://"):
        return os.getenv(ref[len("env://"):], "")
    if ref.startswith("file://"):
        p = Path(ref[len("file://"):]).expanduser()
        return p.read_text(encoding="utf-8").strip() if p.is_file() else ""
    if ref.startswith("keyring://"):
        try:
            import keyring  # type: ignore[import-not-found]
        except ImportError:
            return os.getenv(fallback_env, "")
        rest = ref[len("keyring://"):]
        service, _, account = rest.partition("/")
        return keyring.get_password(service or "sop", account or "manager") or ""
    return ""


def load_config(project_path: Path | None = None) -> AgentConfig:
    """从全局 + 项目 + 环境变量加载，优先级：env > project > global > default。"""
    project_path = (project_path or Path(os.getenv("PROJECT_PATH", "."))).expanduser().resolve()
    global_cfg = _read_toml(Path.home() / ".sop" / "config.toml")
    project_cfg = _read_toml(project_path / ".sop-runtime" / "agent.toml")

    def merge(*chain: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for d in chain:
            for k, v in (d or {}).items():
                if isinstance(v, dict):
                    out[k] = {**out.get(k, {}), **v}
                else:
                    out[k] = v
        return out

    cfg = merge(global_cfg, project_cfg)
    mgr = cfg.get("manager", {})
    auth = cfg.get("auth", {})
    trans = cfg.get("transport", {})
    rel = cfg.get("reliability", {})

    api_key_ref = auth.get("api_key_ref", "")
    api_key = _resolve_api_key(api_key_ref)

    bearer = os.getenv("SOP_BEARER_TOKEN", "") or os.getenv("MANAGER_SOP_TOKEN", "")

    return AgentConfig(
        manager_url=os.getenv("MANAGER_URL") or mgr.get("url") or "http://localhost:8765",
        project_id=os.getenv("PROJECT_ID") or mgr.get("project_id") or "",
        tenant_id=os.getenv("TENANT_ID") or mgr.get("tenant_id") or "t-default",
        api_key_ref=api_key_ref,
        api_key=api_key,
        bearer_token=bearer,
        verify_ssl=bool(auth.get("verify_ssl", True)),
        timeout_seconds=int(os.getenv("MANAGER_TIMEOUT") or rel.get("timeout_seconds", 30)),
        max_retries=int(os.getenv("MANAGER_MAX_RETRIES") or rel.get("max_retries", 3)),
        outbox_path=str(rel.get("outbox_path", ".sop-runtime/outbox.sqlite")),
        a2a_port=int(trans.get("a2a_port", 7741)),
        mcp_servers=list(trans.get("mcp_servers", ["lancedb", "knowledge", "tasks", "files"])),
        project_path=project_path,
        extra=cfg,
    )
