"""Reflection originals and fixed inputs through the existing durable write protocols."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import typer

from sop_sdk.event_envelope import strict_json
from sop_sdk.delivery_ack import DeliveryAckError
from sop_sdk.errors import SopServerError, SopTransportError
from sop_sdk.reflection_ack import reflection_input_original
from sop_sdk.reflection_intake import freeze_reflection, parse_reflection_event

from .._util import console, get_client, get_config, warn
from ..local_intents import submit_frozen

app = typer.Typer(help="反思：收集陈述、核对原件与固定输入；收集不是测试或验收结论")


def _read_original(path: Path) -> str:
    with path.open("rb") as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError("原文件超过 64 KiB；请保留完整原件，不要截断")
    return raw.decode("utf-8", errors="strict")


def _read(method: str, *args: Any, **kwargs: Any) -> None:
    try:
        with get_client() as client:
            console.print_json(data=getattr(client, method)(*args, **kwargs))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("record")
def record(
    file: Path | None = typer.Option(None, "--file", exists=True, dir_okay=False, readable=True,
                                    help="typed data JSON；必须同时提供原 --id 和 --time"),
    event_file: Path | None = typer.Option(None, "--event-file", exists=True, dir_okay=False, readable=True,
                                          help="完整 CloudEvent 原件；保持原字节，不另传 ID/时间/来源"),
    event_id: str | None = typer.Option(None, "--id", help="显式原事件 ID；重发不得换 ID"),
    time: str | None = typer.Option(None, "--time", help="原 RFC3339 时间；不自动采用当前时间"),
    source: str | None = typer.Option(None, "--source", help="data 模式的来源，默认 sop-cli"),
    local: bool = typer.Option(False, "--local", help="只持久入队；后续用 sop event flush 投递"),
) -> None:
    """先保存同一 SQLite 原件，再投递；stored 与 collected 分别确认。"""
    try:
        if (file is None) == (event_file is None):
            raise ValueError("必须且只能选择 --file 或 --event-file")
        if event_file is not None:
            if event_id is not None or time is not None or source is not None:
                raise ValueError("--event-file 必须保留原 ID/时间/来源，不能另传 --id/--time/--source")
            frozen = parse_reflection_event(_read_original(event_file))
        else:
            if event_id is None or time is None:
                raise ValueError("--file 必须同时提供显式原 --id 和 --time")
            frozen = freeze_reflection(strict_json(_read_original(file)), event_id=event_id,
                                       time=time, source=source if source is not None else "sop-cli")
        result = submit_frozen(get_config(), frozen, local=local)
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc
    console.print_json(data=result)
    if not result["ok"]:
        raise typer.Exit(1)


@app.command("list")
def list_reflections(
    category: str = typer.Option("", "--category"),
    occurred_from: str = typer.Option("", "--from", help="声明发生时间，含时区，包含起点"),
    occurred_to: str = typer.Option("", "--to", help="声明发生时间，含时区，不含终点"),
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    cursor: str = typer.Option("", "--cursor"),
    json_output: bool = typer.Option(False, "--json", help="输出原服务器 JSON（默认同此）"),
) -> None:
    """只读指定窗口；total 包含原文受限的收集事实，不是可用样本数。"""
    _read("reflections", category=category, occurred_from=occurred_from,
          occurred_to=occurred_to, limit=limit, cursor=cursor)


@app.command("show")
def show_reflection(
    reflection_id: str,
    json_output: bool = typer.Option(False, "--json", help="输出原服务器 JSON（默认同此）"),
) -> None:
    """核对指定原件与 selection_reference；失源不会换用其他正文。"""
    _read("reflection", reflection_id)


@app.command("inputs")
def list_inputs(
    limit: int = typer.Option(20, "--limit", min=1, max=100),
    cursor: str = typer.Option("", "--cursor"),
    json_output: bool = typer.Option(False, "--json", help="输出原服务器 JSON（默认同此）"),
) -> None:
    """只读一页固定输入；prepared 仅表示已固定，尚未执行分析。"""
    _read("reflection_inputs", limit=limit, cursor=cursor)


@app.command("input")
def show_input(
    input_id: str,
    json_output: bool = typer.Option(False, "--json", help="输出原服务器 JSON（默认同此）"),
) -> None:
    """读取这个固定 manifest 的当前可用性，不内联或替换原件。"""
    _read("reflection_input", input_id)


@app.command("prepare")
def prepare(
    file: Path = typer.Option(..., "--file", exists=True, dir_okay=False, readable=True,
                              help="完整原 Delivery 命令，含原版本、键和有序 sources"),
) -> None:
    """提交 reflection.input.create 原命令；未知结果只能重用同一原文件恢复。"""
    try:
        body = strict_json(_read_original(file))
        body = reflection_input_original(body)
        with get_client() as client:
            console.print_json(data=client.delivery_command(body))
    except (DeliveryAckError, SopServerError, SopTransportError) as exc:
        warn(f"固定输入结果尚未确认：{exc}；请保留并重用同一原文件、原版本和原键恢复")
        raise typer.Exit(1) from exc
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc
