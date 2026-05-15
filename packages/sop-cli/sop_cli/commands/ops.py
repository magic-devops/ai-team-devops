"""
@module: sop_cli.commands.ops
@purpose: 运维：通知通道、同步拉取、Worker 探活、health/stack/deploy/snapshot 脚本统一入口
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import typer
from rich.table import Table

from .._util import console, err, get_client, get_config, ok, warn

app = typer.Typer(help="运维：health/stack/deploy/snapshot/notify/worker")


def _repo_root() -> Path:
    cfg_root = get_config().project_path.resolve()
    for p in (cfg_root, *cfg_root.parents):
        if (p / "ai-sop-ops").is_dir() and ((p / "scripts").is_dir() or (p / "apps").is_dir()):
            return p
    return cfg_root


def _script(*parts: str) -> Path:
    return _repo_root().joinpath(*parts)


def _run_script(args: list[str], *, project_path: Path | None = None, extra_env: dict[str, str] | None = None) -> None:
    root = _repo_root()
    env = {**os.environ}
    cfg = get_config()
    env.setdefault("PROJECT_PATH", str(project_path or cfg.project_path))
    if extra_env:
        env.update(extra_env)
    kv = " ".join(args)
    console.print(f"[muted]$ {kv}[/muted]")
    r = subprocess.run(args, cwd=str(root), env=env)
    if r.returncode != 0:
        err(f"命令退出码 {r.returncode}")
        raise typer.Exit(r.returncode)


@app.command("notify-channels")
def notify_channels() -> None:
    try:
        rows = get_client(get_config()).notify_list_channels()
        tbl = Table(title="通知通道", show_header=True, header_style="bold")
        tbl.add_column("name")
        tbl.add_column("type")
        tbl.add_column("enabled")
        for ch in rows or []:
            if isinstance(ch, dict):
                tbl.add_row(str(ch.get("name", "")), str(ch.get("type", "")), str(ch.get("enabled", "")))
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("notify-test")
def notify_test(channel: str = typer.Argument(..., help="通道名称")) -> None:
    try:
        r = get_client(get_config()).notify_test_channel(channel)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("sync-pull")
def sync_pull(
    cursor: str = typer.Option("", "--cursor", help="ISO8601 游标"),
    modules: str = typer.Option("tasks,requirements,issues,sprints,rules,specs,templates", "--modules", "-m"),
    out: str = typer.Option("", "--out", "-o", help="写入 JSON 文件"),
) -> None:
    try:
        r = get_client(get_config()).sync_pull(cursor=cursor, modules=modules)
        if out:
            with open(out, "w", encoding="utf-8") as f:
                json.dump(r, f, ensure_ascii=False, indent=2)
            ok(f"已写入 {out}")
        else:
            console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("worker-health")
def worker_health() -> None:
    try:
        r = get_client(get_config()).worker_health()
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("health")
def health(
    strict: bool = typer.Option(False, "--strict", help="任一 FAIL 则返回非零"),
    port: int = typer.Option(8765, "--port", help="Manager 端口"),
) -> None:
    """运行 ai-sop-ops/health-check.sh。"""
    script = _script("ai-sop-ops", "health-check.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    _run_script(
        ["bash", str(script)],
        extra_env={"PORT": str(port), "HEALTH_CHECK_STRICT": "1" if strict else "0"},
    )


@app.command("stack")
def stack(
    action: str = typer.Argument("status", help="start|stop|status|doctor"),
    agentd: bool = typer.Option(False, "--agentd", help="stack start 时同时启动 agentd"),
    port: int = typer.Option(8765, "--port", help="Manager 端口"),
) -> None:
    """本地开发栈管理，封装 scripts/stack.sh。"""
    script = _script("scripts", "stack.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    args = ["bash", str(script), action, "--port", str(port), "--project-path", str(get_config().project_path)]
    if agentd:
        args.append("--agentd")
    _run_script(args)


@app.command("deploy")
def deploy(
    action: str = typer.Argument("print", help="print|up|down|logs|ps"),
    mode: str = typer.Option("single", "--mode", help="single|saas"),
    port: int = typer.Option(8765, "--port", help="宿主机端口"),
    project_path: str = typer.Option("", "--project-path", help="挂载到容器的工程目录"),
) -> None:
    """Docker 部署封装，支持 single/saas profile。"""
    script = _script("scripts", "deploy.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    pp = Path(project_path).expanduser().resolve() if project_path else get_config().project_path
    _run_script(
        ["bash", str(script), action, mode],
        project_path=pp,
        extra_env={"PORT": str(port), "PROJECT_PATH": str(pp)},
    )


@app.command("snapshot")
def snapshot(project_path: str = typer.Option("", "--project-path", help="要导出快照的工程目录")) -> None:
    """导出记忆/向量快照到 memory/snapshots。"""
    script = _script("ai-sop-ops", "snapshot.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    pp = Path(project_path).expanduser().resolve() if project_path else get_config().project_path
    _run_script(["bash", str(script)], project_path=pp)


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：health | stack | deploy | snapshot | notify-channels | notify-test | sync-pull | worker-health[/dim]")
