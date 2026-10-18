"""Exact object discussions; all writes preserve a caller-owned JSON request."""

import json
from enum import Enum
from pathlib import Path
from typing import Annotated

import typer

from .._util import console, get_client, warn

app = typer.Typer(help="对象讨论、固定引用与明确来源；写入使用原JSON文件。")
Thread = Annotated[str, typer.Option("--thread")]
Message = Annotated[str, typer.Option("--message")]
File = Annotated[Path, typer.Option("--file", exists=True, dir_okay=False, readable=True)]
Limit = Annotated[int, typer.Option("--limit", min=1, max=50)]
Cursor = Annotated[str, typer.Option("--cursor", help="服务端返回的原始next_cursor")]


class SubjectKind(str, Enum):
    requirement = "requirement"
    task = "task"
    issue = "issue"


class ReferenceKind(str, Enum):
    requirement = "requirement"
    task = "task"
    issue = "issue"
    execution = "execution"


class ReferenceField(str, Enum):
    title = "title"
    description = "description"
    acceptance_criteria = "acceptance_criteria"
    summary = "summary"


class State(str, Enum):
    all = "all"
    open = "open"
    resolved = "resolved"
    archived = "archived"


def _query(method, *args, **options):
    try:
        with get_client() as client:
            console.print_json(data=getattr(client, method)(*args, **options))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


def _write(method, file, *args):
    try:
        body = json.loads(file.read_text(encoding="utf-8"))
        if (
            not isinstance(body, dict)
            or not isinstance(body.get("idempotency_key"), str)
            or not body["idempotency_key"].strip()
        ):
            raise ValueError("写入文件必须为JSON对象并包含原idempotency_key；重试复用原文件")
        with get_client() as client:
            console.print_json(data=getattr(client, method)(*args, body))
    except Exception as exc:
        warn(str(exc))
        raise typer.Exit(1) from exc


@app.command("list")
def discussions(
    subject_kind: Annotated[SubjectKind | None, typer.Option("--subject-kind")] = None,
    subject_id: Annotated[str, typer.Option("--subject-id")] = "",
    state: Annotated[State, typer.Option("--state")] = State.all,
    limit: Limit = 20,
    cursor: Cursor = "",
):
    """分页查询当前项目或精确对象讨论；total是筛选后的总数。"""
    if bool(subject_kind) != bool(subject_id):
        raise typer.BadParameter("--subject-kind 与 --subject-id 必须成对提供")
    _query(
        "delivery_discussions",
        subject_kind=subject_kind.value if subject_kind else "",
        subject_id=subject_id,
        state=state.value,
        limit=limit,
        cursor=cursor,
    )


@app.command("show")
def show(thread: Thread):
    """读取精确线程及当前能力；不替换为列表首项。"""
    _query("delivery_discussion", thread)


@app.command("messages")
def messages(thread: Thread, limit: Limit = 20, cursor: Cursor = ""):
    """分页读取当前消息；保留原游标。"""
    _query("delivery_discussion_messages", thread, limit=limit, cursor=cursor)


@app.command("message")
def message(thread: Thread, message: Message):
    """读取精确消息，支持页外深链。"""
    _query("delivery_discussion_message", thread, message)


@app.command("versions")
def versions(
    thread: Thread,
    message: Message,
    revision: Annotated[int | None, typer.Option("--revision", min=1)] = None,
    limit: Limit = 20,
    cursor: Cursor = "",
):
    """分页读取固定编辑历史，或使用--revision读取精确版本。"""
    if revision is not None:
        if cursor or limit != 20:
            raise typer.BadParameter("--revision 不能同时使用分页参数")
        _query("delivery_discussion_message_version", thread, message, revision)
    else:
        _query("delivery_discussion_message_versions", thread, message, limit=limit, cursor=cursor)


@app.command("reference")
def reference(
    kind: Annotated[ReferenceKind, typer.Option("--kind")],
    resource_id: Annotated[str, typer.Option("--id")],
    field: Annotated[ReferenceField, typer.Option("--field")],
    criterion_index: Annotated[int | None, typer.Option("--criterion-index", min=0)] = None,
    source_content_basis: Annotated[str | None, typer.Option("--source-content-basis")] = None,
):
    """读取服务端固定字段/运行摘要；写入refs使用返回的basis。"""
    options = {"field": field.value, "criterion_index": criterion_index}
    if source_content_basis is not None:
        options["source_content_basis"] = source_content_basis
    _query("delivery_discussion_reference", kind.value, resource_id, **options)


@app.command("links")
def links(
    thread: Thread,
    resolution_event: Annotated[str, typer.Option("--resolution-event")] = "",
    limit: Limit = 20,
    cursor: Cursor = "",
):
    """分页读取线程的原始来源关联与采纳记录。"""
    _query(
        "delivery_discussion_links", thread, resolution_event_id=resolution_event, limit=limit, cursor=cursor
    )


@app.command("sources")
def sources(
    kind: Annotated[SubjectKind, typer.Option("--kind")],
    resource_id: Annotated[str, typer.Option("--id")],
    limit: Limit = 20,
    cursor: Cursor = "",
):
    """分页读取精确业务对象来源，保留未知/受限事实。"""
    _query("delivery_sources", kind.value, resource_id, limit=limit, cursor=cursor)


@app.command("create")
def create(file: File):
    """从原JSON创建讨论和首消息；作者由服务端认证。"""
    _write("delivery_discussion_create", file)


@app.command("reply")
def reply(thread: Thread, file: File):
    """提交原回复文件；不会生成新重试键。"""
    _write("delivery_discussion_reply", file, thread)


@app.command("edit")
def edit(thread: Thread, message: Message, file: File):
    """提交含expected_message_revision的原编辑文件。"""
    _write("delivery_discussion_edit", file, thread, message)


@app.command("withdraw")
def withdraw(thread: Thread, message: Message, file: File):
    """提交明确撤回，保留历史和回复。"""
    _write("delivery_discussion_withdraw", file, thread, message)


@app.command("resolve")
def resolve(thread: Thread, file: File):
    """固定某消息版本为结论；不会进行业务验收。"""
    _write("delivery_discussion_resolve", file, thread)


@app.command("reopen")
def reopen(thread: Thread, file: File):
    """按原expected_thread_version明确重开。"""
    _write("delivery_discussion_reopen", file, thread)


@app.command("archive")
def archive(thread: Thread, file: File):
    """归档线程，历史仍保留。"""
    _write("delivery_discussion_archive", file, thread)


@app.command("restore")
def restore(thread: Thread, file: File):
    """明确恢复归档线程并清除当前结论。"""
    _write("delivery_discussion_restore", file, thread)


@app.command("link")
def link(thread: Thread, file: File):
    """仅关联现有对象；真正采用继续使用delivery command及source_reference。"""
    _write("delivery_discussion_link", file, thread)
