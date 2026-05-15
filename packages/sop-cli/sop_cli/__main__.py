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
    commands_cmd,
    completion as completion_cmd,
    context as context_cmd,
    copilot as copilot_cmd,
    doctor as doctor_cmd,
    init as init_cmd,
    kb as kb_cmd,
    llm as llm_cmd,
    login as login_cmd,
    memory as memory_cmd,
    ops as ops_cmd,
    platforms as platforms_cmd,
    rule as rule_cmd,
    status as status_cmd,
    sync as sync_cmd,
    task as task_cmd,
)
from .commands_info import QUICK_START

app = typer.Typer(
    name="sop",
    help="ai-team-devops 统一命令行（项目初始化 / 接入 / 同步 / 自检 / LLM）",
    add_completion=True,
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog=QUICK_START.strip(),
)

app.add_typer(init_cmd.app,    name="init",    help="初始化项目（取代 init-ai-project.sh）")
app.add_typer(login_cmd.app,   name="login",   help="OAuth 配对 / Bearer 登录")
app.add_typer(context_cmd.app, name="context", help="v4 三码上下文与 Manager 探活回显")
app.add_typer(memory_cmd.app,   name="memory",   help="v4 记忆：health / recent / search / add")
app.add_typer(kb_cmd.app,       name="kb",       help="知识库：search / rag / add / index")
app.add_typer(copilot_cmd.app, name="copilot", help="AI Copilot：ask / classify / summarize / suggest")
app.add_typer(ops_cmd.app,      name="ops",      help="运维：notify / sync-pull / worker-health")
app.add_typer(platforms_cmd.app, name="platforms", help="AI 平台：Cursor/Codex/Claude/WorkBuddy/Hermes…")
app.add_typer(status_cmd.app,  name="status",  help="本地 + Manager 状态概览")
app.add_typer(agentd_cmd.app,  name="agentd",  help="sop-agentd 守护进程：start/stop/status/install")
app.add_typer(task_cmd.app,    name="task",    help="任务：list/pull/done/fail/issue")
app.add_typer(rule_cmd.app,    name="rule",    help="规则：list/propose/apply")
app.add_typer(sync_cmd.app,    name="sync",    help="双向同步规约 / 规则 / 知识")
app.add_typer(doctor_cmd.app,  name="doctor",  help="端到端连通性自检")
app.add_typer(llm_cmd.app,     name="llm",     help="通过 LLM Gateway 调用模型 / 嵌入 / 检索")
app.add_typer(commands_cmd.app, name="commands", help="列出全部子命令与常用示例")
app.add_typer(completion_cmd.app, name="completion", help="Shell 自动补全 install / show / doctor")


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
