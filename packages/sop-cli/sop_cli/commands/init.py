"""
@module: sop_cli.commands.init
@purpose: `sop init <project>` —— 取代 init-ai-project.sh 的可编程入口
@ai_safe_edit:
  - 初始化逻辑沿用 sop/tools/init-ai-project.sh，CLI 仅做编排 + 配对 + agent.toml
  - 任何流程变更需同步 docs/playbooks/PROJECT_ONBOARDING.md
"""
from __future__ import annotations

import os
import shlex
import subprocess
import textwrap
from pathlib import Path

import typer

from .._util import console, err, kv, ok, warn

app = typer.Typer(help="项目初始化（生成 memory/ .ai-memory/ + 多 AI 工具配置 + 与 Manager 配对）")


@app.callback(invoke_without_command=True)
def init(
    project_name: str = typer.Argument(..., help="项目名（写入 memory/current_state.json）"),
    manager_url: str = typer.Option("", "--manager", help="Manager URL；留空则跳过配对（离线初始化）"),
    pair_code: str = typer.Option("", "--code", help="Manager 配对页生成的一次性 code"),
    reinit: bool = typer.Option(False, "--reinit", help="清空旧记忆后再初始化（自动备份）"),
    no_backup: bool = typer.Option(False, "--no-backup", help="reinit 时不备份"),
    keep_claude: bool = typer.Option(False, "--keep-claude-md", help="reinit 时不覆盖 CLAUDE.md"),
) -> None:
    repo_tools = _locate_repo_tools()
    if not repo_tools:
        err("未找到 sop/tools 目录；请在仓库根或本机已安装 sop 的项目中执行。")
        raise typer.Exit(1)

    cmd = ["bash", str(repo_tools / "init-ai-project.sh")]
    if reinit:
        cmd.append("reinit")
        cmd.append("-y")
        if no_backup:
            cmd.append("--no-backup")
        if keep_claude:
            cmd.append("--keep-claude-md")
    cmd.append(project_name)

    console.rule("[bold]sop init")
    kv("项目名", project_name)
    kv("脚本", " ".join(shlex.quote(c) for c in cmd))
    rc = subprocess.call(cmd, env={**os.environ})
    if rc != 0:
        err(f"init-ai-project.sh 退出码 {rc}")
        raise typer.Exit(rc)
    ok("基础初始化完成（memory / .ai-memory / 多 AI 工具配置）")

    if manager_url and pair_code:
        _pair_with_manager(manager_url, pair_code, Path.cwd())
    elif manager_url:
        warn("提供了 --manager 但未提供 --code；浏览器打开:")
        console.print(f"  {manager_url.rstrip('/')}/pair  → 拿到 code 后再次运行 `sop init {project_name} --manager {manager_url} --code <CODE>`")
    else:
        warn("跳过 Manager 配对（离线初始化）。后续可执行: [bold]sop login --pair[/bold]")

    _write_agent_toml_skeleton(Path.cwd(), project_name, manager_url)
    ok("写入 .sop-runtime/agent.toml（骨架）")

    console.rule("[bold green]完成")
    console.print(textwrap.dedent(f"""
        下一步建议：
          1. 启动 agentd:    [bold]sop agentd install && sop agentd start[/bold]
          2. 健康自检:       [bold]sop doctor[/bold]
          3. 状态总览:       [bold]sop status[/bold]
          4. 启动 Manager:   [bold]bash sop/tools/start-manager.sh[/bold]
    """).strip())


def _locate_repo_tools() -> Path | None:
    cur = Path.cwd().resolve()
    for p in (cur, *cur.parents):
        cand = p / "sop" / "tools" / "init-ai-project.sh"
        if cand.is_file():
            return cand.parent
    home_cand = Path.home() / ".local" / "share" / "sop" / "tools" / "init-ai-project.sh"
    if home_cand.is_file():
        return home_cand.parent
    return None


def _pair_with_manager(manager_url: str, code: str, project_path: Path) -> None:
    try:
        from sop_sdk import ManagerClient, NoAuth
    except ImportError:  # pragma: no cover
        err("sop-sdk 未安装，跳过配对")
        return
    cli = ManagerClient(manager_url, auth=NoAuth())
    try:
        out = cli.pair_project(code, hostname=os.uname().nodename, local_path=str(project_path))
    except Exception as e:
        err(f"配对失败：{e}")
        return
    ok("Manager 配对成功")
    kv("project_id", out.get("project_id"))
    kv("tenant_id", out.get("tenant_id"))
    _save_api_key(out.get("api_key", ""))


def _save_api_key(api_key: str) -> None:
    if not api_key:
        return
    try:
        import keyring  # type: ignore[import-not-found]
        keyring.set_password("sop", "manager", api_key)
        ok("API Key 已写入 OS keyring（service=sop, account=manager）")
    except Exception:
        cred = Path.home() / ".sop" / "credentials"
        cred.parent.mkdir(parents=True, exist_ok=True)
        cred.write_text(f"MANAGER_API_KEY={api_key}\n", encoding="utf-8")
        cred.chmod(0o600)
        warn(f"keyring 不可用；API Key 已落盘到 {cred}（chmod 600）")


def _write_agent_toml_skeleton(project_path: Path, project_name: str, manager_url: str) -> None:
    rt = project_path / ".sop-runtime"
    rt.mkdir(parents=True, exist_ok=True)
    f = rt / "agent.toml"
    if f.exists():
        return
    f.write_text(textwrap.dedent(f"""
        # @module: sop-agentd configuration
        # @purpose: 项目侧 sop-agentd 与 Manager 通信配置
        # @ai_safe_edit: 修改字段后重启 agentd；旧字段缺失给默认值

        [manager]
        url = "{manager_url or 'http://localhost:8765'}"
        project_id = ""    # 由 `sop login --pair` 自动填充
        tenant_id  = "t-default"

        [auth]
        method = "apikey"
        api_key_ref = "keyring://sop/manager"
        verify_ssl = true

        [transport]
        ws = true
        grpc = false
        mcp_servers = ["lancedb", "knowledge", "tasks", "files"]
        a2a_port = 7741

        [reliability]
        outbox_path = ".sop-runtime/outbox.sqlite"
        batch_size = 50
        max_retries = 6
        dlq_path = ".sop-runtime/dlq/"
        timeout_seconds = 30

        [security]
        nonce_window_seconds = 300
        sign_body = true
    """).lstrip(), encoding="utf-8")
