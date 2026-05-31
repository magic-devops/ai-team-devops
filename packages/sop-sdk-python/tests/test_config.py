from __future__ import annotations

import sys

from sop_sdk.config import _resolve_api_key


class BrokenKeyring:
    @staticmethod
    def get_password(service: str, account: str) -> str:
        raise RuntimeError("keychain unavailable")


def test_resolve_api_key_falls_back_to_env_when_keyring_errors(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "keyring", BrokenKeyring)
    monkeypatch.setenv("MANAGER_API_KEY", "env-key")

    assert _resolve_api_key("keyring://sop/manager") == "env-key"
