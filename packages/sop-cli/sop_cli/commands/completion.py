"""
@module: sop_cli.commands.completion
@purpose: Shell 补全安装 / 导出 / 自检
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import click
import typer
from rich.console import Console
from rich.panel import Panel

from ..commands_info import QUICK_START
from .._util import console, err, ok, warn

app = typer.Typer(help="Shell 自动补全（bash / zsh / fish）", no_args_is_help=True)

_SHELLS = ("bash", "zsh", "fish", "powershell", "pwsh")
_PROG = "sop"
_COMPLETE_VAR = "_SOP_COMPLETE"


def _completion_script_path() -> Path:
    return Path(__file__).resolve().parent.parent / "completions" / "sop.bash"


def _dynamic_script(shell: str) -> str:
    from typer._completion_shared import get_completion_script

    return get_completion_script(
        prog_name=_PROG,
        complete_var=_COMPLETE_VAR,
        shell=shell.lower().strip(),
    )


def _install_dynamic(shell: str, path: str = "") -> Path:
    shell = shell.lower().strip()
    if path:
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(_dynamic_script(shell), encoding="utf-8")
        return p
    from typer._completion_shared import install as typer_install

    _, installed = typer_install(shell=shell, prog_name=_PROG, complete_var=_COMPLETE_VAR)
    return installed


@app.command("install")
def install(
    shell: str = typer.Argument(..., help="bash | zsh | fish | powershell | pwsh"),
    path: str = typer.Option("", "--path", help="写入补全脚本路径（默认写入 shell 配置文件）"),
) -> None:
    """安装 Typer/Click 动态补全（子命令与选项随 CLI 自动更新）。"""
    shell = shell.lower().strip()
    if shell not in _SHELLS:
        err(f"不支持的 shell: {shell}（可选: {', '.join(_SHELLS)}）")
        raise typer.Exit(2)
    try:
        installed = _install_dynamic(shell, path=path)
    except click.exceptions.Exit as e:
        raise typer.Exit(e.exit_code or 1) from e
    ok(f"已安装 {shell} 补全 → {installed}")
    _print_shell_hint(shell)


@app.command("show")
def show(
    shell: str = typer.Argument(..., help="bash | zsh | fish | powershell | pwsh"),
    static: bool = typer.Option(False, "--static", help="输出仓库内置静态 bash 片段（仅 bash）"),
    both: bool = typer.Option(False, "--both", help="动态 + 静态 bash（仅 bash）"),
) -> None:
    """打印补全脚本（可 eval \"$(sop completion show bash)\"）。"""
    shell = shell.lower().strip()
    if static or both:
        if shell != "bash":
            err("--static / --both 仅支持 bash")
            raise typer.Exit(2)
        p = _completion_script_path()
        if not p.is_file():
            err(f"缺少静态补全文件: {p}")
            raise typer.Exit(1)
        static_body = p.read_text(encoding="utf-8")
        if static and not both:
            sys.stdout.write(static_body)
            return
        sys.stdout.write(_dynamic_script(shell))
        sys.stdout.write("\n\n# --- static enhancements ---\n")
        sys.stdout.write(static_body)
        return
    if shell not in _SHELLS:
        err(f"不支持的 shell: {shell}")
        raise typer.Exit(2)
    try:
        sys.stdout.write(_dynamic_script(shell))
    except click.exceptions.Exit as e:
        raise typer.Exit(e.exit_code or 1) from e


@app.command("doctor")
def completion_doctor(shell: str = typer.Option("bash", "--shell", "-s", help="检查的 shell")) -> None:
    """检查补全是否可用（Typer 动态 + 可选静态 bash）。"""
    shell = shell.lower().strip()
    issues: list[str] = []

    try:
        script = _dynamic_script(shell)
        ok(f"Typer 可生成 {shell} 补全脚本（{len(script.splitlines())} 行）")
    except click.exceptions.Exit:
        issues.append(f"无法生成 {shell} 动态补全")

    static_p = _completion_script_path()
    if static_p.is_file():
        ok(f"静态增强补全: {static_p}")
    else:
        issues.append(f"缺少静态文件: {static_p}")

    sop_bin = shutil.which("sop")
    if sop_bin:
        ok(f"sop 在 PATH: {sop_bin}")
    else:
        warn("sop 不在 PATH（补全仍可通过 python -m sop_cli 工作）")

    if shell == "bash" and os.environ.get("BASH_VERSION"):
        if shutil.which("complete"):
            ok("bash complete 命令可用")
        else:
            issues.append("bash 环境缺少 complete 内置命令")

    if issues:
        console.print(Panel("\n".join(f"• {x}" for x in issues), title="待处理", border_style="yellow"))
        console.print("\n安装示例:")
        console.print("  sop completion install bash")
        console.print('  eval "$(sop completion show bash)"')
        console.print(f"  source {static_p}")
        raise typer.Exit(1)
    ok("补全环境就绪；若 Tab 无效请执行 sop completion install " + shell)


def _print_shell_hint(shell: str) -> None:
    if shell == "bash":
        console.print('临时启用: eval "$(sop completion show bash)"')
        console.print("增强子命令: eval \"$(sop completion show bash --both)\"")
        console.print("持久化: sop completion install bash")
    elif shell == "zsh":
        console.print('临时启用: eval "$(sop completion show zsh)"')
        console.print("持久化: sop completion install zsh")
    else:
        console.print(f'临时启用: eval "$(sop completion show {shell})"')


@app.callback(invoke_without_command=True)
def _hint(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print(Panel(QUICK_START.strip(), title="sop completion", border_style="cyan"))
