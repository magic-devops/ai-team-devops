"""
@module: sop_cli.commands.login
@purpose: `sop login` —— Bearer 登录 / OAuth 配对
"""
from __future__ import annotations

import getpass
import os

import typer

from .._util import console, err, kv, ok

app = typer.Typer(help="登录 / 配对 Manager")


@app.callback(invoke_without_command=True)
def login(
    pair: bool = typer.Option(False, "--pair", help="走配对流程（推荐用于自动化）"),
    manager: str = typer.Option("", "--manager", help="Manager URL"),
    code: str = typer.Option("", "--code", help="配对 code（若已知）"),
    username: str = typer.Option("", "--username", "-u", help="用户名（密码登录）"),
    tenant: str = typer.Option("", "--tenant", help="租户 slug（SaaS 模式）"),
) -> None:
    from sop_sdk import ManagerClient, NoAuth

    manager_url = manager or os.getenv("MANAGER_URL", "http://localhost:8765")
    cli = ManagerClient(manager_url, auth=NoAuth())

    if pair:
        if not code:
            console.print(f"打开浏览器访问 [bold]{manager_url.rstrip('/')}/pair[/bold]，登录后复制 code。")
            code = typer.prompt("配对 code")
        try:
            out = cli.pair_project(code, hostname=os.uname().nodename, local_path=os.getcwd())
        except Exception as e:
            err(f"配对失败：{e}")
            raise typer.Exit(1)
        ok("配对成功")
        kv("project_id", out.get("project_id"))
        kv("tenant_id", out.get("tenant_id"))
        from .init import _save_api_key  # 复用
        _save_api_key(out.get("api_key", ""))
        return

    if not username:
        username = typer.prompt("用户名")
    password = getpass.getpass("密码: ")
    try:
        out = cli.login(username, password, tenant_slug=tenant or None)
    except Exception as e:
        err(f"登录失败：{e}")
        raise typer.Exit(1)
    token = out.get("access_token", "")
    if not token:
        err("Manager 未返回 access_token")
        raise typer.Exit(1)
    _save_token(token)
    ok("登录成功，access_token 已保存")


def _save_token(token: str) -> None:
    try:
        import keyring  # type: ignore[import-not-found]
        keyring.set_password("sop", "bearer", token)
        ok("token → keyring(sop/bearer)")
        return
    except Exception:
        pass
    from pathlib import Path
    cred = Path.home() / ".sop" / "credentials"
    cred.parent.mkdir(parents=True, exist_ok=True)
    cred.write_text(f"SOP_BEARER_TOKEN={token}\n", encoding="utf-8")
    cred.chmod(0o600)
