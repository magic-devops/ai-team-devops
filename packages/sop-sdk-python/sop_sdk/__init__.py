"""
@module: sop_sdk
@purpose: 项目侧统一 SDK：Manager HTTP 客户端 + 本地 agentd IPC + 配置/密钥读写
@stable: ManagerClient 公开方法名 / 参数名在 v1 内稳定
@ai_safe_edit:
  - 新增接口方法：直接加在 ManagerClient；优先用 _request() 共享重试逻辑
  - 修改签名算法：security.py 单点修改；所有客户端共享
  - 新增鉴权方式：实现 Auth 抽象类，注册到 ManagerClient
@deps_in: httpx, pydantic, tenacity
@deps_out: 无外部业务依赖
"""
from __future__ import annotations

from .client import ManagerClient, build_default_client
from .config import AgentConfig, load_config
from .errors import (
    HermesContractError,
    HermesUnavailableError,
    SopAuthError,
    SopConflictError,
    SopError,
    SopForbiddenError,
    SopNotFoundError,
    SopServerError,
    SopTransportError,
)
from .event_envelope import EventIdentity, EventProtocolError, FrozenEvent
from .event_outbox import EventOutbox, QueueError
from .hermes import HermesClient
from .ipc import AgentdIpcClient
from .reflection_intake import freeze_reflection, parse_reflection_event
from .security import Auth, BearerAuth, HmacAuth, NoAuth

__version__ = "1.0.0"

__all__ = [
    "__version__",
    "ManagerClient",
    "HermesClient",
    "build_default_client",
    "AgentConfig",
    "load_config",
    "Auth",
    "BearerAuth",
    "HmacAuth",
    "NoAuth",
    "AgentdIpcClient",
    "FrozenEvent",
    "EventIdentity",
    "EventProtocolError",
    "EventOutbox",
    "QueueError",
    "freeze_reflection",
    "parse_reflection_event",
    "HermesContractError",
    "HermesUnavailableError",
    "SopError",
    "SopAuthError",
    "SopForbiddenError",
    "SopNotFoundError",
    "SopConflictError",
    "SopServerError",
    "SopTransportError",
]
