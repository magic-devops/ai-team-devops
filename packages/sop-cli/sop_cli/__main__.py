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
from rich.panel import Panel

from . import __version__
from .commands import (
    agentd as agentd_cmd,
    commands_cmd,
    completion as completion_cmd,
    context as context_cmd,
    copilot as copilot_cmd,
    data as data_cmd,
    db_config as db_config_cmd,
    dev_flow as dev_flow_cmd,
    doctor as doctor_cmd,
    event as event_cmd,
    graph_loop as graph_loop_cmd,
    hermes as hermes_cmd,
    init as init_cmd,
    issue as issue_cmd,
    kb as kb_cmd,
    llm as llm_cmd,
    login as login_cmd,
    memory as memory_cmd,
    ops as ops_cmd,
    pages as pages_cmd,
    platforms as platforms_cmd,
    plugins as plugins_cmd,
    project as project_cmd,
    register as register_cmd,
    requirement as requirement_cmd,
    rule as rule_cmd,
    skills as skills_cmd,
    sprint as sprint_cmd,
    status as status_cmd,
    sync as sync_cmd,
    system as system_cmd,
    task as task_cmd,
    usage as usage_cmd,
    work as work_cmd,
    workflow as workflow_cmd,
)
from .commands_info import (
    COMMAND_TREE,
    QUICK_START_GROUP_NAMES,
    SHORT_HELP_EPILOG,
    command_detail_panel,
    command_tree_table,
    quick_start_panels,
)

app = typer.Typer(
    name="sop",
    help="ai-team-devops 统一命令行（项目初始化 / 接入 / 同步 / 自检 / LLM）",
    add_completion=True,
    invoke_without_command=True,
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog=SHORT_HELP_EPILOG.strip(),
)

app.add_typer(init_cmd.app,    name="init",    help="初始化项目（取代 init-ai-project.sh）")
app.add_typer(register_cmd.app, name="register", help="一键初始化并注册工程到 Manager")
app.add_typer(login_cmd.app,   name="login",   help="OAuth 配对 / Bearer 登录")
app.add_typer(context_cmd.app, name="context", help="v4 三码上下文与 Manager 探活回显")
app.add_typer(memory_cmd.app,   name="memory",   help="v4 记忆：add/search/recent/forget/summarize/attach-run/flush")
app.add_typer(kb_cmd.app,       name="kb",       help="知识库：search / rag / add / flush / index")
app.add_typer(copilot_cmd.app, name="copilot", help="AI Copilot：ask / sessions / show / classify / summarize / suggest")
app.add_typer(data_cmd.app, name="data", help="数据智能：blueprint / nlq / tasks")
app.add_typer(dev_flow_cmd.app, name="dev-flow", help="研发全流程：ops-plan/ops-tasks")
app.add_typer(system_cmd.app, name="system", help="系统全域 readiness")
app.add_typer(graph_loop_cmd.app, name="graph-loop", help="Graph Loop：runs/detail/events/transition/interrupt/replay/export/doctor/slo")
app.add_typer(db_config_cmd.app, name="db-config", help="数据库配置：OceanBase/PG/MySQL")
app.add_typer(ops_cmd.app,      name="ops",      help="运维：health/stack/deploy/snapshot/notify/worker")
app.add_typer(pages_cmd.app, name="pages", help="页面菜单与能力：list/manifest/capabilities")
app.add_typer(skills_cmd.app, name="skills", help="技能运行目录：runtime")
app.add_typer(plugins_cmd.app, name="plugins", help="插件治理：governance")
app.add_typer(platforms_cmd.app, name="platforms", help="AI 平台：Cursor/Codex/Claude/WorkBuddy/Hermes…")
app.add_typer(project_cmd.app, name="project", help="项目：list/review/ops-plan/ops-tasks/onboarding")
app.add_typer(status_cmd.app,  name="status",  help="本地 + Manager 状态概览")
app.add_typer(agentd_cmd.app,  name="agentd",  help="sop-agentd 守护进程：start/stop/status/install")
app.add_typer(requirement_cmd.app, name="requirement", help="需求：list/create/update/delete")
app.add_typer(issue_cmd.app, name="issue", help="问题：list/create/update/resolve/delete")
app.add_typer(task_cmd.app,    name="task",    help="任务：list/schedule/feed/report/create/update/pull/done/fail/delete/issue")
app.add_typer(sprint_cmd.app, name="sprint", help="迭代：list/create/update/complete/progress/delete")
app.add_typer(workflow_cmd.app, name="workflow", help="工作流：instances/events/ops-plan/ops-tasks")
app.add_typer(hermes_cmd.workspace_app, name="workspace", help="Hermes 工作空间：list/create")
app.add_typer(hermes_cmd.build_resource_app("devices"), name="device", help="Hermes 设备：list/get/create/patch/delete")
app.add_typer(hermes_cmd.build_resource_app("sessions"), name="session", help="Hermes 会话：list/get/create/patch")
app.add_typer(hermes_cmd.build_resource_app("runs"), name="run", help="Hermes 运行：list/get/create/patch/events/action")
app.add_typer(hermes_cmd.approval_app, name="approval", help="Hermes 审批：list/decision")
app.add_typer(hermes_cmd.build_resource_app("assets"), name="asset", help="Hermes 资产：list/get/create/patch/delete")
app.add_typer(hermes_cmd.system_app, name="hermes", help="Hermes 系统：health/actions/readiness/sync")
app.add_typer(work_cmd.app, name="work", help="工作台：summary/list/next/export")
app.add_typer(event_cmd.app, name="event", help="事件：emit/flush/list")
app.add_typer(usage_cmd.app, name="usage", help="用量：record/flush/summary/quota")
app.add_typer(rule_cmd.app,    name="rule",    help="规则：list/propose/apply/flush")
app.add_typer(sync_cmd.app,    name="sync",    help="双向同步规约 / 规则 / 知识")
app.add_typer(doctor_cmd.app,  name="doctor",  help="端到端连通性自检")
app.add_typer(llm_cmd.app,     name="llm",     help="通过 LLM Gateway 调用模型 / 嵌入 / 检索")
app.add_typer(commands_cmd.app, name="commands", help="列出全部子命令与常用示例")
app.add_typer(completion_cmd.app, name="completion", help="Shell 自动补全 install / show / doctor")


@app.command("help")
def help_command(
    topic: str | None = typer.Argument(None, help="可选：查看指定顶层命令摘要"),
    examples: bool = typer.Option(False, "--examples", "-e", help="附带分组常用示例"),
    group: str | None = typer.Option(
        None,
        "--group",
        "-g",
        help=f"只显示指定示例分组：{', '.join(QUICK_START_GROUP_NAMES)}",
    ),
) -> None:
    """显示 sop 帮助总览。"""
    console = Console()
    if topic:
        if topic not in COMMAND_TREE:
            console.print(f"[yellow]未知命令：{topic}[/yellow]")
            console.print("运行 [cyan]sop help[/cyan] 查看全部顶层命令。")
            raise typer.Exit(1)
        console.print(command_detail_panel(topic))
        return
    console.print(
        Panel(
            "子命令帮助: [cyan]sop <command> --help[/cyan]\n"
            "常用示例: [cyan]sop commands --examples[/cyan]\n"
            "按场景过滤: [cyan]sop help --group 同步[/cyan]",
            title="sop 帮助",
            border_style="cyan",
        )
    )
    if not group:
        console.print(command_tree_table())
    if examples or group:
        panels = quick_start_panels(group)
        if not panels:
            console.print(f"[yellow]未找到示例分组：{group}[/yellow]")
            console.print(f"可选分组：{', '.join(QUICK_START_GROUP_NAMES)}")
            raise typer.Exit(1)
        for panel in panels:
            console.print(panel)


@app.callback(invoke_without_command=True)
def _root(
    ctx: typer.Context,
    version: bool = typer.Option(False, "--version", "-V", help="显示版本", is_eager=True),
) -> None:
    if version:
        Console().print(f"sop {__version__}")
        raise typer.Exit(0)
    if ctx.invoked_subcommand is None:
        Console().print(ctx.get_help())
        raise typer.Exit(0)


def main() -> None:
    try:
        app()
    except KeyboardInterrupt:  # pragma: no cover
        sys.exit(130)


if __name__ == "__main__":  # pragma: no cover
    main()
