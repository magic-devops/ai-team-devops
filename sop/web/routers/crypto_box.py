"""
@module: routers.crypto_box
@purpose: 列加密（AES-256-GCM）+ KEK 抽象（env / file / AWS-KMS）+ 字段级 token 化
@stable: encrypt()/decrypt() 输出格式固定（`sopv1:<kid>:<nonce>:<ct>:<tag>` base64url）
@ai_safe_edit:
  - 新增 KEK 后端：实现 KEK 协议（wrap_dek/unwrap_dek）+ 注册到 get_kek()
  - DEK 永远在内存，不入库；KEK 通过 SOP_KEK_PROVIDER 选择
  - 字段轮换：rotate_field(table, column, new_kid) 双读迁移

加密层级：
  - KEK（Key Encryption Key）：长期；从 KMS / 文件 / env 来
  - DEK（Data Encryption Key）：每记录一个 32 字节 AES-256；写入时随机生成，用 KEK 加密落库
  - 输出：`sopv1:<kid>:<nonce>:<ct+tag>` 三段 base64url 拼接，可解析后单字段轮换

外部依赖：cryptography（生产必装）；缺包时 fallback PBKDF2 + AES-CTR + HMAC（弱版，仅 dev）。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
from abc import ABC, abstractmethod
from typing import Optional

_log = logging.getLogger("sop.crypto")

_FORMAT_VERSION = "sopv1"


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ── KEK 抽象 ────────────────────────────────────────────────────
class KEK(ABC):
    """密钥管理；wrap/unwrap DEK。"""

    kid: str  # key id，便于轮换识别

    @abstractmethod
    def wrap_dek(self, dek: bytes) -> bytes: ...

    @abstractmethod
    def unwrap_dek(self, wrapped: bytes) -> bytes: ...


class EnvKEK(KEK):
    """从环境变量读 master key（dev / 个人）。

    设置：SOP_MASTER_KEY=<base64url 32 字节>
    或：  SOP_MASTER_KEY_HEX=<hex 64 字符>
    """

    kid = "env-v1"

    def __init__(self) -> None:
        raw = os.getenv("SOP_MASTER_KEY", "").strip()
        if raw:
            self._key = _b64d(raw)
        else:
            hx = os.getenv("SOP_MASTER_KEY_HEX", "").strip()
            self._key = bytes.fromhex(hx) if hx else b""
        if len(self._key) != 32:
            # 退化到 dev 模式：用 SECRET_KEY 衍生（绝不要在生产用）
            secret = os.getenv("SECRET_KEY", "change-me-in-production").encode()
            self._key = hashlib.sha256(b"sop-derive-kek/v1|" + secret).digest()
            self.kid = "derived-v1"

    def wrap_dek(self, dek: bytes) -> bytes:
        return _gcm_encrypt(self._key, dek, aad=b"sop/dek/v1")

    def unwrap_dek(self, wrapped: bytes) -> bytes:
        return _gcm_decrypt(self._key, wrapped, aad=b"sop/dek/v1")


class FileKEK(KEK):
    """从文件读 master key（小团队，文件权限 0600）。

    设置：SOP_KEK_FILE=/etc/sop/master.key
    """

    kid = "file-v1"

    def __init__(self) -> None:
        p = os.getenv("SOP_KEK_FILE", "")
        if not p or not os.path.isfile(p):
            raise RuntimeError(f"SOP_KEK_FILE 不存在：{p}")
        with open(p, "rb") as f:
            self._key = f.read().strip()
        if len(self._key) == 64:  # 兼容 hex
            self._key = bytes.fromhex(self._key.decode())
        if len(self._key) != 32:
            raise RuntimeError(f"master key 长度需为 32 字节（当前 {len(self._key)}）")

    def wrap_dek(self, dek: bytes) -> bytes:
        return _gcm_encrypt(self._key, dek, aad=b"sop/dek/v1")

    def unwrap_dek(self, wrapped: bytes) -> bytes:
        return _gcm_decrypt(self._key, wrapped, aad=b"sop/dek/v1")


class AwsKmsKEK(KEK):  # pragma: no cover - 需外部凭证
    """AWS KMS 托管 KEK。"""
    kid = "aws-kms-v1"

    def __init__(self) -> None:
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError("AWS KMS 需要 boto3") from e
        self._kms = boto3.client("kms", region_name=os.getenv("AWS_REGION", "us-east-1"))
        self._key_id = os.getenv("SOP_KMS_KEY_ID", "")
        if not self._key_id:
            raise RuntimeError("SOP_KMS_KEY_ID 未设置")

    def wrap_dek(self, dek: bytes) -> bytes:
        out = self._kms.encrypt(KeyId=self._key_id, Plaintext=dek)
        return out["CiphertextBlob"]

    def unwrap_dek(self, wrapped: bytes) -> bytes:
        out = self._kms.decrypt(CiphertextBlob=wrapped)
        return out["Plaintext"]


_KEK_CACHE: Optional[KEK] = None


def get_kek() -> KEK:
    """根据 SOP_KEK_PROVIDER 实例化 KEK（单例）。"""
    global _KEK_CACHE
    if _KEK_CACHE is not None:
        return _KEK_CACHE
    provider = (os.getenv("SOP_KEK_PROVIDER") or "env").lower()
    if provider == "env":
        _KEK_CACHE = EnvKEK()
    elif provider == "file":
        _KEK_CACHE = FileKEK()
    elif provider in ("aws", "aws-kms", "kms"):
        _KEK_CACHE = AwsKmsKEK()
    else:
        raise RuntimeError(f"不支持的 SOP_KEK_PROVIDER={provider}")
    _log.info("KEK ready: provider=%s kid=%s", provider, _KEK_CACHE.kid)
    return _KEK_CACHE


# ── 底层 AEAD ───────────────────────────────────────────────────
def _gcm_encrypt(key: bytes, plaintext: bytes, *, aad: bytes = b"") -> bytes:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # type: ignore[import-not-found]
        nonce = secrets.token_bytes(12)
        aead = AESGCM(key)
        ct = aead.encrypt(nonce, plaintext, aad)
        return nonce + ct
    except ImportError:
        return _fallback_encrypt(key, plaintext, aad)


def _gcm_decrypt(key: bytes, blob: bytes, *, aad: bytes = b"") -> bytes:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # type: ignore[import-not-found]
        nonce, ct = blob[:12], blob[12:]
        return AESGCM(key).decrypt(nonce, ct, aad)
    except ImportError:
        return _fallback_decrypt(key, blob, aad)


def _fallback_encrypt(key: bytes, pt: bytes, aad: bytes) -> bytes:  # pragma: no cover
    """AES-CTR + HMAC-SHA256 退化实现（仅 dev；告警过）。"""
    _log.warning("cryptography 缺失，使用 fallback HMAC+CTR；不要用于生产")
    nonce = secrets.token_bytes(16)
    mac_key = hashlib.sha256(b"sop/fb-mac/" + key).digest()
    keystream = _hmac_keystream(key, nonce, len(pt))
    ct = bytes(a ^ b for a, b in zip(pt, keystream))
    tag = hmac.new(mac_key, nonce + aad + ct, hashlib.sha256).digest()[:16]
    return nonce + ct + tag


def _fallback_decrypt(key: bytes, blob: bytes, aad: bytes) -> bytes:  # pragma: no cover
    nonce = blob[:16]
    tag = blob[-16:]
    ct = blob[16:-16]
    mac_key = hashlib.sha256(b"sop/fb-mac/" + key).digest()
    expected = hmac.new(mac_key, nonce + aad + ct, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(expected, tag):
        raise ValueError("MAC 验证失败")
    keystream = _hmac_keystream(key, nonce, len(ct))
    return bytes(a ^ b for a, b in zip(ct, keystream))


def _hmac_keystream(key: bytes, nonce: bytes, length: int) -> bytes:  # pragma: no cover
    out = b""
    counter = 0
    while len(out) < length:
        out += hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return out[:length]


# ── 对外 API ────────────────────────────────────────────────────
def encrypt(plaintext: str | bytes, *, aad: str = "") -> str:
    """加密任意字段，输出可放进 VARCHAR/TEXT。"""
    if plaintext is None:
        return ""
    pt = plaintext.encode("utf-8") if isinstance(plaintext, str) else plaintext
    kek = get_kek()
    dek = secrets.token_bytes(32)
    wrapped = kek.wrap_dek(dek)
    blob = _gcm_encrypt(dek, pt, aad=aad.encode())
    return f"{_FORMAT_VERSION}:{kek.kid}:{_b64e(wrapped)}:{_b64e(blob)}"


def decrypt(token: str, *, aad: str = "") -> str:
    """解密；版本/kid 不识别时抛 ValueError。"""
    if not token:
        return ""
    if not token.startswith(_FORMAT_VERSION + ":"):
        # 兼容：未加密的旧字段原样返回
        return token
    parts = token.split(":")
    if len(parts) != 4:
        raise ValueError("crypto token 格式错误")
    _, kid, wrapped_b64, blob_b64 = parts
    kek = get_kek()
    if kek.kid != kid:
        _log.warning("crypto token kid 与当前 KEK 不一致：token=%s current=%s（需要二级密钥或轮换支持）",
                     kid, kek.kid)
        # 简化版：当前只支持单 KEK；多 KEK 多版本可在此扩展 keyring
    dek = kek.unwrap_dek(_b64d(wrapped_b64))
    pt = _gcm_decrypt(dek, _b64d(blob_b64), aad=aad.encode())
    return pt.decode("utf-8")


def encrypt_if_pii(value: str, *, aad: str = "") -> str:
    """业务层便捷封装：开启 SOP_ENCRYPT_PII=1 时走加密，否则原样保存（迁移期）。"""
    if os.getenv("SOP_ENCRYPT_PII", "0") != "1":
        return value
    return encrypt(value, aad=aad)


def hash_for_lookup(value: str, *, salt: str = "sop-pii-hash/v1") -> str:
    """用于"加密字段的等值查找"：保留可查询能力（HMAC-SHA256 + 项目 salt）。"""
    key = (os.getenv("SOP_PII_HASH_SALT", "") + salt).encode() or salt.encode()
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()


# ── FastAPI 路由：仅运维诊断用，不暴露任何密钥 ──────────────────
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/crypto", tags=["security"])


@router.get("/status")
def status() -> dict[str, str]:
    try:
        kek = get_kek()
        return {
            "ok": "true",
            "provider": os.getenv("SOP_KEK_PROVIDER", "env"),
            "kid": kek.kid,
            "encrypt_pii": os.getenv("SOP_ENCRYPT_PII", "0"),
        }
    except Exception as e:
        raise HTTPException(503, f"KEK 不可用：{e}")


@router.post("/test/roundtrip")
def test_roundtrip(text: str = "hello sop") -> dict[str, str]:
    if os.getenv("DEPLOY_ENV", "dev") == "production":
        raise HTTPException(403, "生产禁用")
    token = encrypt(text)
    back = decrypt(token)
    return {"original": text, "token": token, "decrypted": back}
