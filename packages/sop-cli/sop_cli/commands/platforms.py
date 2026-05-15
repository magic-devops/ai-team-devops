"""
@module: sop_cli.commands.platforms
@purpose: 列举 / 自检 / 安装各 AI Agent·CLI·IDE 平台适配（Cursor/Codex/Claude/WorkBuddy/Hermes…）
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="AI 平台：list / doctor / install-shims")


def _project_root() -> Path:
    return get_config().project_path


@app.command("list")
def platforms_list() -> None:
    try:
        r = get_client(get_config()).platforms_list()
        rows = r.get("platforms") if isinstance(r, dict) else []
    except Exception:
        rows = _local_registry_rows()
    tbl = Table(title="AI 平台（sop 统一控制平面）", show_header=True, header_style="bold")
    tbl.add_column("id")
    tbl.add_column("name")
    tbl.add_column("category")
    tbl.add_column("integration")
    tbl.add_column("cli")
    tbl.add_column("ready")
    for p in rows or []:
        if not isinstance(p, dict):
            continue
        cli_ok = "✓" if p.get("cli_available") else "—"
        tbl.add_row(
            str(p.get("id", "")),
            str(p.get("name", "")),
            str(p.get("category", "")),
            str(p.get("integration", "")),
            cli_ok,
            "✓" if p.get("ready") else "—",
        )
    console.print(tbl)


def _local_registry_rows() -> list[dict]:
    reg_path = _project_root() / "ai-sop-ops" / "platforms" / "registry.json"
    if not reg_path.is_file():
        return []
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    return reg.get("platforms") or []


@app.command("doctor")
def platforms_doctor() -> None:
    root = _project_root()
    reg_path = root / "ai-sop-ops" / "platforms" / "registry.json"
    if not reg_path.is_file():
        warn(f"缺少 {reg_path}")
        raise typer.Exit(1)
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    failed = 0
    for p in reg.get("platforms") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id", ""))
        entries = [str(x) for x in (p.get("entry_files") or [])]
        shim = str(p.get("hook_shim") or "")
        has_entry = any((root / e).exists() for e in entries)
        has_shim = bool(shim) and (root / shim).is_file()
        integration = str(p.get("integration") or "")
        if integration == "hooks" and not has_shim:
            warn(f"{pid}: 缺少 hook shim {shim} → sop platforms install-shims {pid}")
            failed += 1
        elif not has_entry:
            warn(f"{pid}: 缺少入口文件（{', '.join(entries[:2])}…）")
            failed += 1
        else:
            ok(f"{pid}: 入口就绪" + (", shim 就绪" if has_shim else ""))
    if failed:
        raise typer.Exit(1)
    ok("平台适配检查通过")


@app.command("install-shims")
def install_shims(
    platform_id: str = typer.Argument(..., help="cursor|workbuddy|hermes|windsurf|opencode|…"),
) -> None:
    root = _project_root()
    gen = root / "ai-sop-ops" / "platforms" / "sop_hook_shim.py"
    if not gen.is_file():
        warn("缺少 ai-sop-ops/platforms/sop_hook_shim.py")
        raise typer.Exit(1)
    plat = next((p for p in _local_registry_rows() if p.get("id") == platform_id), None)
    shim_rel = str((plat or {}).get("hook_shim") or "")
    if not shim_rel:
        warn(f"平台 {platform_id} 无 hook_shim 定义")
        raise typer.Exit(1)
    dest_dir = (root / shim_rel).parent
    r = subprocess.run(
        ["python3", str(gen), platform_id, str(dest_dir)],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        warn(r.stderr or r.stdout)
        raise typer.Exit(2)
    ok(r.stdout.strip() or f"shim → {dest_dir / 'sop_hook.py'}")


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：list | doctor | install-shims[/dim]")
