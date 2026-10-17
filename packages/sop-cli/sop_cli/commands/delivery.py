"""Versioned project delivery commands shared by people, agents and tools."""

import json
from pathlib import Path
from typing import Annotated

import typer

from .._util import console, get_client, warn

app = typer.Typer(help="项目交付：workspace / inbox / targets / preview / command")


@app.command("workspace")
def workspace():
    """读取项目需求、任务、执行和审查快照。"""
    with get_client() as client:
        console.print_json(data=client.delivery_workspace())


@app.command("inbox")
def inbox(
    scope: Annotated[str, typer.Option("--scope", help="mine 或 team，当前项目的个人/团队事项")] = "mine",
    json_out: Annotated[bool, typer.Option("--json", help="保留服务端分类与定位信息")] = False,
):
    """查看待处理、阶段评审、执行验收及阻塞，不修改业务状态。"""
    try:
        if scope not in {"mine", "team"}:
            raise ValueError("scope must be mine or team")
        with get_client() as client:
            result = client.delivery_inbox(scope=scope)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc
    if json_out:
        console.print_json(data=result)
        return
    console.print(f"项目 {result.get('project_id', '')} · {scope}", markup=False)
    for item in result.get("items", []):
        categories = ", ".join(item.get("categories", []))
        console.print(f"[{categories}] {item.get('title', '')} ({item.get('resource_id', '')})", markup=False)
    if not result.get("items"):
        console.print("当前没有待处理事项。")


@app.command("targets")
def targets():
    """读取当前账户可访问的执行工作区、智能体与设备。"""
    with get_client() as client:
        console.print_json(data=client.delivery_execution_targets())


@app.command("command")
def command(file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]):
    """提交含 action/payload/expected_version/idempotency_key 的 JSON；重试复用原文件。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        required = {"action", "payload", "expected_version", "idempotency_key"}
        if not isinstance(body, dict) or set(body) != required or not isinstance(body["payload"], dict):
            raise ValueError("需要 action、payload、expected_version 和 idempotency_key")
        with get_client() as client:
            console.print_json(data=client.delivery_command(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("preview")
def preview(file: Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]):
    """预览任务计划；JSON 显式指定 generator=template 或 ai，重试复用原文件。"""
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        required = {"requirement_id", "expected_version", "idempotency_key", "generator"}
        allowed = required | {"mode", "max_items"}
        if not isinstance(body, dict) or not required <= set(body) <= allowed:
            raise ValueError("需要 requirement_id、expected_version、idempotency_key 和 generator")
        if body["generator"] not in ("template", "ai"):
            raise ValueError("generator 必须显式指定为 template 或 ai")
        with get_client() as client:
            console.print_json(data=client.delivery_task_plan_preview(body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc
