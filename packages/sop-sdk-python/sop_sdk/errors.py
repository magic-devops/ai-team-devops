"""
@module: sop_sdk.errors
@purpose: 异常体系（与 Manager Problem Details 一一映射）
@ai_safe_edit: 新增异常类时同步 ManagerClient._raise_for_status 映射
"""
from __future__ import annotations

from typing import Any


class SopError(Exception):
    """所有 SDK 异常的基类。"""

    def __init__(self, message: str, *, status: int | None = None, detail: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail


class SopTransportError(SopError):
    """网络层 / 超时 / 重试耗尽。"""


class SopAuthError(SopError):
    """401 未认证。"""


class SopForbiddenError(SopError):
    """403 无权限。"""


class SopNotFoundError(SopError):
    """404 不存在。"""


class SopConflictError(SopError):
    """409 状态冲突。"""


class SopServerError(SopError):
    """5xx 服务端错误（外层会重试）。"""
