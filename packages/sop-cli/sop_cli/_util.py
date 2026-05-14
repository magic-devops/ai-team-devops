"""
@module: sop_cli._util
@purpose: CLI 子命令共享工具：构建 SDK 客户端、控制台输出、Spinner
"""
from __future__ import annotations

import contextlib
from typing import Iterator

from rich.console import Console
from rich.theme import Theme

from sop_sdk import ManagerClient, build_default_client
from sop_sdk.config import AgentConfig, load_config

console = Console(theme=Theme({
    "ok": "bold green",
    "warn": "bold yellow",
    "err": "bold red",
    "muted": "dim",
    "kv": "cyan",
}))


def get_config() -> AgentConfig:
    return load_config()


def get_client(cfg: AgentConfig | None = None) -> ManagerClient:
    return build_default_client(cfg or get_config())


def ok(msg: str) -> None:
    console.print(f"[ok]✓[/ok] {msg}")


def warn(msg: str) -> None:
    console.print(f"[warn]![/warn] {msg}")


def err(msg: str) -> None:
    console.print(f"[err]✗[/err] {msg}")


def kv(key: str, value: object) -> None:
    console.print(f"[kv]{key}[/kv]: {value}")


@contextlib.contextmanager
def spinner(text: str) -> Iterator[None]:
    with console.status(text):
        yield
