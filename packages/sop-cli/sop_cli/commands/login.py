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
        pid = str(out.get("project_id") or "")
        kv("project_id", pid)
        kv("tenant_id", out.get("tenant_id"))
        from .init import _save_api_key  # 复用
        from ._agent_toml import update_agent_toml_manager
        from pathlib import Path
        import json

        _save_api_key(out.get("api_key", ""))
        cwd = Path.cwd()
        from ._agent_toml import project_id_from_memory
        mem_pid = project_id_from_memory(cwd)
        if mem_pid:
            pid = mem_pid
        if update_agent_toml_manager(
            cwd,
            project_id=pid,
            tenant_id=str(out.get("tenant_id") or "") or None,
            manager_url=manager_url,
            auth_method="apikey",
        ):
            ok("已写入 .sop-runtime/agent.toml")
        state_f = cwd / "memory" / "current_state.json"
        if state_f.is_file():
            try:
                mem_pid = str(json.loads(state_f.read_text(encoding="utf-8")).get("project_id") or "")
                if mem_pid and mem_pid != pid:
                    from .._util import warn
                    warn(
                        f"memory 中为 {mem_pid}，配对为 {pid}。"
                        "配对页「项目 ID」请与 init 一致，或重新生成配对码后再执行 sop login --pair"
                    )
            except (OSError, json.JSONDecodeError):
                pass
        return

    if not username:
        username = typer.prompt("用户名")
    password = getpass.getpass("密码: ")
    try:
        out = cli.login(username, password, tenant_slug=tenant or None)
    except Exception as e:
        err(f"登录失败：{e}")
        raise typer.Exit(1)
    if not isinstance(out, dict):
        err(f"Manager 登录响应异常：{type(out).__name__}")
        raise typer.Exit(1)
    token = (out.get("access_token") or out.get("token") or "").strip()
    if not token:
        err(f"Manager 未返回 token（响应字段: {', '.join(sorted(out.keys()))}）")
        err("若刚改过代码，请重装 CLI: pip install -e packages/sop-cli -e packages/sop-sdk-python")
        raise typer.Exit(1)
    _save_token(token)
    ok("登录成功，Bearer token 已保存")
    from pathlib import Path
    import json
    from ._agent_toml import update_agent_toml_manager

    pid = str(out.get("default_project_id") or "").strip()
    state_f = Path.cwd() / "memory" / "current_state.json"
    if state_f.is_file():
        try:
            mem_pid = str(json.loads(state_f.read_text(encoding="utf-8")).get("project_id") or "").strip()
            if mem_pid:
                pid = mem_pid
        except (OSError, json.JSONDecodeError):
            pass
    if pid and update_agent_toml_manager(
        Path.cwd(),
        project_id=pid,
        tenant_id=str(out.get("tenant_id") or "") or None,
        manager_url=manager_url,
        auth_method="bearer",
    ):
        kv("project_id", pid)


def _save_token(token: str) -> None:
    try:
        import keyring  # type: ignore[import-not-found]
        keyring.set_password("sop", "bearer", token)
        ok("token → keyring(sop/bearer)")
    except Exception:
        from ._credentials import write_credentials
        write_credentials({"SOP_BEARER_TOKEN": token, "MANAGER_SOP_TOKEN": token})
        ok("token → ~/.sop/credentials")
