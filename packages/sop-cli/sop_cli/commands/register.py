"""
@module: sop_cli.commands.register
@purpose: One-command project onboarding: init local files, register to Manager, enable tool adapters.
@ai_safe_edit:
  - Keep this command as orchestration only; concrete file generation stays in init/platforms modules.
  - Registration must be safe to re-run and must not overwrite user-authored tool files by default.
"""
from __future__ import annotations

import getpass
import os
import subprocess
import sys
from pathlib import Path

import typer

from .._util import console, err, kv, ok, warn

app = typer.Typer(help="一键注册工程到 Manager，并接入 CLI/IDE/Agent 工具")


@app.callback(invoke_without_command=True)
def register(
    project_name: str = typer.Argument("", help="项目名；留空则读取 memory/current_state.json 或目录名"),
    manager: str = typer.Option("http://localhost:8765", "--manager", help="Manager URL"),
    code: str = typer.Option("", "--code", help="已有配对 code；提供后无需账号密码"),
    username: str = typer.Option("", "--username", "-u", help="Manager 用户名；用于自动生成配对 code"),
    tenant: str = typer.Option("", "--tenant", help="租户 slug（密码登录时使用）"),
    no_init: bool = typer.Option(False, "--no-init", help="跳过 sop init，仅执行注册和工具接入补齐"),
    no_platforms: bool = typer.Option(False, "--no-platforms", help="跳过 sop platforms init all"),
    start_agentd: bool = typer.Option(False, "--start-agentd", help="注册完成后启动 sop-agentd"),
    doctor: bool = typer.Option(True, "--doctor/--no-doctor", help="注册完成后运行 sop doctor"),
) -> None:
    root = Path.cwd().resolve()
    project_name = project_name or _project_name(root)
    manager_url = manager.rstrip("/")

    console.rule("[bold]sop register")
    kv("project", project_name)
    kv("project_path", root)
    kv("manager", manager_url)

    if not no_init:
        _run_init(project_name, manager_url)

    if not no_platforms:
        _run_platforms_init()

    pair_code = code.strip()
    token = ""
    if not pair_code and username:
        token = _login_for_token(manager_url, username, tenant)
        pair_code = _create_pair_code(manager_url, token, root, project_name)
    if not pair_code:
        console.print(f"打开 [bold]{manager_url}/pair[/bold]，登录后复制 code；或下次使用 `--username <user>` 自动生成。")
        pair_code = typer.prompt("配对 code").strip()
    _pair_project(manager_url, pair_code, root)

    if start_agentd:
        _run_optional(["agentd", "start"], "启动 sop-agentd")
    if doctor:
        _run_optional(["doctor"], "运行 sop doctor")

    console.rule("[bold green]注册完成")
    console.print("现在该工程已经具备 Manager 注册、统一平台接入、agent.toml 与鉴权配置。")
    console.print("日常入口：`sop status`、`sop sync`、`sop task list`、`sop copilot ask`、`sop platforms doctor`。")


def _project_name(root: Path) -> str:
    state = root / "memory" / "current_state.json"
    if state.is_file():
        try:
            import json

            return str(json.loads(state.read_text(encoding="utf-8")).get("project_id") or root.name)
        except Exception:
            return root.name
    return root.name


def _run_sop(args: list[str], label: str) -> int:
    cmd = [os.environ.get("SOP_CLI_PYTHON", sys.executable), "-m", "sop_cli", *args]
    kv(label, " ".join(cmd))
    r = subprocess.run(cmd, cwd=str(Path.cwd()), text=True)
    return r.returncode


def _run_init(project_name: str, manager_url: str) -> None:
    if _run_sop(["init", project_name, "--manager", manager_url], "初始化") != 0:
        err("sop init 失败")
        raise typer.Exit(1)


def _run_platforms_init() -> None:
    if _run_sop(["platforms", "init", "all"], "平台接入") != 0:
        err("sop platforms init all 失败")
        raise typer.Exit(1)


def _login_for_token(manager_url: str, username: str, tenant: str) -> str:
    from sop_sdk import ManagerClient, NoAuth

    password = getpass.getpass("Manager 密码: ")
    cli = ManagerClient(manager_url, auth=NoAuth())
    try:
        out = cli.login(username, password, tenant_slug=tenant or None)
    except Exception as e:
        err(f"登录失败：{e}")
        raise typer.Exit(1)
    token = str(out.get("access_token") or out.get("token") or "").strip()
    if not token:
        err("Manager 未返回 token")
        raise typer.Exit(1)
    from .login import _save_token

    _save_token(token)
    ok("登录成功，已保存 Bearer token")
    return token


def _create_pair_code(manager_url: str, token: str, root: Path, project_name: str) -> str:
    from sop_sdk import BearerAuth, ManagerClient

    cli = ManagerClient(manager_url, auth=BearerAuth(token))
    try:
        out = cli.create_pair_code(local_path=str(root), preferred_project_id=project_name)
    except Exception as e:
        err(f"生成配对码失败：{e}")
        raise typer.Exit(1)
    code = str(out.get("pair_code") or "").strip()
    if not code:
        err("Manager 未返回 pair_code")
        raise typer.Exit(1)
    ok("已自动生成配对码")
    return code


def _pair_project(manager_url: str, pair_code: str, root: Path) -> None:
    from sop_sdk import ManagerClient, NoAuth

    cli = ManagerClient(manager_url, auth=NoAuth())
    try:
        out = cli.pair_project(pair_code, hostname=os.uname().nodename, local_path=str(root))
    except Exception as e:
        err(f"配对失败：{e}")
        raise typer.Exit(1)

    from ._agent_toml import project_id_from_memory, update_agent_toml_manager
    from .init import _save_api_key

    pid = project_id_from_memory(root) or str(out.get("project_id") or "")
    _save_api_key(str(out.get("api_key") or ""))
    update_agent_toml_manager(
        root,
        project_id=pid,
        tenant_id=str(out.get("tenant_id") or "") or None,
        manager_url=manager_url,
        auth_method="apikey",
    )
    ok("Manager 注册/配对成功")
    kv("project_id", pid)
    kv("tenant_id", out.get("tenant_id"))


def _run_optional(args: list[str], label: str) -> None:
    rc = _run_sop(args, label)
    if rc != 0:
        warn(f"{label} 未通过；可稍后手动执行 `sop {' '.join(args)}`")
