"""
@module: sop_cli.__main__
@purpose: `sop` 顶层命令；子命令通过 Typer 子 app 装载
@stable: 顶层命令名 v1 内稳定
@ai_safe_edit: 新增子命令 → 在 commands/ 增加文件 + 此处 add_typer
"""
from __future__ import annotations

import sys

import typer
from rich.console import Console

from . import __version__
from .commands import (
    agentd as agentd_cmd,
    doctor as doctor_cmd,
    init as init_cmd,
    llm as llm_cmd,
    login as login_cmd,
    rule as rule_cmd,
    status as status_cmd,
    sync as sync_cmd,
    task as task_cmd,
)

app = typer.Typer(
    name="sop",
    help="ai-team-devops 统一命令行（项目初始化 / 接入 / 同步 / 自检 / LLM）",
    add_completion=False,
    no_args_is_help=True,
    rich_markup_mode="rich",
)

app.add_typer(init_cmd.app,    name="init",    help="初始化项目（取代 init-ai-project.sh）")
app.add_typer(login_cmd.app,   name="login",   help="OAuth 配对 / Bearer 登录")
app.add_typer(status_cmd.app,  name="status",  help="本地 + Manager 状态概览")
app.add_typer(agentd_cmd.app,  name="agentd",  help="sop-agentd 守护进程：start/stop/status/install")
app.add_typer(task_cmd.app,    name="task",    help="任务：list/pull/done/fail/issue")
app.add_typer(rule_cmd.app,    name="rule",    help="规则：list/propose/apply")
app.add_typer(sync_cmd.app,    name="sync",    help="双向同步规约 / 规则 / 知识")
app.add_typer(doctor_cmd.app,  name="doctor",  help="端到端连通性自检")
app.add_typer(llm_cmd.app,     name="llm",     help="通过 LLM Gateway 调用模型 / 嵌入 / 检索")


@app.callback()
def _root(
    version: bool = typer.Option(False, "--version", "-V", help="显示版本"),
) -> None:
    if version:
        Console().print(f"sop {__version__}")
        raise typer.Exit(0)


def main() -> None:
    try:
        app()
    except KeyboardInterrupt:  # pragma: no cover
        sys.exit(130)


if __name__ == "__main__":  # pragma: no cover
    main()
