"""
@module: sop_sdk.security
@purpose: 鉴权策略（Auth 抽象 + 三种实现：Bearer JWT / API Key HMAC / 无鉴权）
@stable: Auth.attach() 签名稳定
@ai_safe_edit:
  - 改 HMAC 算法需同时改 Manager 端 verify
  - nonce 长度 / 时间戳窗口须与服务端一致（300s）
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from abc import ABC, abstractmethod
from typing import Mapping, MutableMapping


class Auth(ABC):
    """请求鉴权抽象。"""

    @abstractmethod
    def attach(self, method: str, path: str, headers: MutableMapping[str, str], body: bytes) -> None:
        """就地填充鉴权相关头。"""


class NoAuth(Auth):
    def attach(self, method, path, headers, body) -> None:  # noqa: D401
        return None


class BearerAuth(Auth):
    """`Authorization: Bearer <jwt>`。"""

    def __init__(self, token: str) -> None:
        if not token:
            raise ValueError("BearerAuth: token 不能为空")
        self.token = token.strip()

    def attach(self, method, path, headers, body) -> None:
        headers["Authorization"] = f"Bearer {self.token}"


class HmacAuth(Auth):
    """API Key + HMAC-SHA256 + Timestamp + Nonce 防重放鉴权。

    与 `docs/architecture/SECURITY.md §认证 2` 完全对齐。
    """

    NONCE_BYTES = 16

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("HmacAuth: api_key 不能为空")
        self.api_key = api_key.strip()

    def _nonce(self) -> str:
        return base64.urlsafe_b64encode(os.urandom(self.NONCE_BYTES)).rstrip(b"=").decode()

    def attach(self, method, path, headers, body) -> None:
        ts = str(int(time.time()))
        nonce = self._nonce()
        body_hash = hashlib.sha256(body or b"").hexdigest()
        canonical = f"{method.upper()}\n{path}\n{ts}\n{nonce}\n{body_hash}".encode()
        signature = hmac.new(self.api_key.encode(), canonical, hashlib.sha256).hexdigest()
        headers["X-Api-Key"] = self.api_key
        headers["X-Sop-Timestamp"] = ts
        headers["X-Sop-Nonce"] = nonce
        headers["X-Sop-Signature"] = f"sha256={signature}"


def _credentials_from_file() -> dict[str, str]:
    from pathlib import Path
    p = Path.home() / ".sop" / "credentials"
    if not p.is_file():
        return {}
    out: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    return out


def auth_from_env(env: Mapping[str, str] | None = None) -> Auth:
    """从环境变量 + ~/.sop/credentials 推断 Auth；优先 Bearer。"""
    env = env if env is not None else os.environ
    creds = _credentials_from_file()
    token = (
        (env.get("SOP_BEARER_TOKEN") or env.get("MANAGER_SOP_TOKEN") or creds.get("SOP_BEARER_TOKEN") or creds.get("MANAGER_SOP_TOKEN") or "")
        .strip()
    )
    if token:
        return BearerAuth(token)
    api_key = (env.get("MANAGER_API_KEY") or creds.get("MANAGER_API_KEY") or "").strip()
    if api_key:
        return HmacAuth(api_key)
    return NoAuth()
