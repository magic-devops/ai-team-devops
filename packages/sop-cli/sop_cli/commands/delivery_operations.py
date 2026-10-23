"""Prepare, review and explicitly send durable external delivery operations."""
from enum import Enum
from pathlib import Path
from typing import Optional

import typer

from sop_sdk.delivery_ack import DeliveryAckError, MAX_ORIGINAL_BYTES, canonical, strict_json
from sop_sdk.delivery_journal import DeliveryJournal, DeliveryJournalError
from sop_sdk.delivery_operations import DeliveryOperations, DeliveryScopeError, read_rework_draft
from sop_sdk.submission_rework import MAX_ADOPTION_BYTES, SubmissionReworkChanged, validate_adoption
from sop_sdk.errors import SopAuthError, SopConflictError, SopForbiddenError, SopServerError, SopTransportError
from .._util import console, get_client, warn

app = typer.Typer(help="外部交付操作：list 找回待处理操作；准备 → inspect 审阅 → send；结果未知用 resume。未发送草稿可 discard；确认后 finish，均保留完整历史。")
DEFAULT_JOURNAL = Path(".sop-runtime/delivery-operations")


class WorkOrderAction(str, Enum):
    create = "create"
    claim = "claim"
    progress = "progress"
    cancel = "cancel"
    release = "release"
    report = "report"


class ReviewDecision(str, Enum):
    accept = "accept"
    request_changes = "request_changes"


class ProgressStatus(str, Enum):
    running = "running"
    blocked = "blocked"


def _output(journal, method, *args, local=False, **kwargs):
    try:
        saved = DeliveryJournal(journal)
        if local:
            value = getattr(saved, method)(*args, **kwargs)
        else:
            with get_client() as client:
                value = getattr(DeliveryOperations(client, saved), method)(*args, **kwargs)
        console.print_json(data=value)
    except Exception as exc:
        # Never echo raw HTTP error bodies, headers, auth configuration or URLs.
        if isinstance(exc, SubmissionReworkChanged):
            message = "采用的返工来源或当前条件已变化。请用 rework-draft 重新预览并明确采用；原编辑内容与已保存操作均保留。"
        elif isinstance(exc, DeliveryAckError):
            message = "回执尚未通过原件校验，结果仍未知。请用 inspect 审阅，之后用 resume 恢复同一原件。"
        elif isinstance(exc, DeliveryScopeError):
            message = "当前账号、服务端或项目与保存原件不符。请切回原账号及项目，用 list/inspect 找回原操作后 resume。"
        elif isinstance(exc, DeliveryJournalError):
            message = "本地原件不可用、已结束或正被占用。请先用 list 找回操作并 inspect；未发送草稿可 discard，未知操作请 resume。"
        elif isinstance(exc, (SopAuthError, SopForbiddenError)):
            message = "当前登录或项目权限不足。请恢复原账号的访问权限后用 inspect 查看状态；未知操作仍须 resume。"
        elif isinstance(exc, SopConflictError):
            message = "服务端拒绝了当前请求。请用 inspect 查看状态；未知操作保留原件并用 resume，首次明确 refused 后才重新准备。"
        elif isinstance(exc, (SopTransportError, SopServerError)):
            message = "连接或回执未完成。请用 list/inspect 查看保存状态，结果未知时用 resume 恢复同一原件。"
        else:
            message = "输入或当前事实无法完成操作。请核对任务、执行人、证据及本次停止声明；已有操作可用 list/inspect 查看。"
        warn(message)
        raise typer.Exit(1) from exc


@app.command("prepare")
def prepare(file: Path = typer.Option(..., "--file", help="完整 prepared 操作记录，须含原 scope、binding 和摘要。wire 命令文件不够完整；unknown 只能在原 journal 用 resume。"),
            journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal")):
    """导入已准备的完整原件；只核当前事实，不补版本、请求键或历史 packet digest。"""
    _output(journal, "prepare_file", file)


@app.command("prepare-work-order")
def prepare_work_order(action: WorkOrderAction = typer.Option(..., "--action"),
        journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal"),
        id: str = typer.Option("", "--id", help="claim/progress/cancel/release/report 的固定 W 身份"),
        task: str = typer.Option("", "--task", help="create 的任务身份"),
        executor: str = typer.Option("", "--executor", help="create 的正式团队资源身份"),
        instructions: str = typer.Option("", "--instructions"),
        percent: Optional[int] = typer.Option(None, "--percent", min=0, max=100, help="省略表示进度未知，不代表零"),
        status: ProgressStatus = typer.Option(ProgressStatus.running, "--status"),
        message: str = typer.Option("", "--message"),
        comment: str = typer.Option("", "--comment"),
        submission: str = typer.Option("", "--submission", help="report 的精确 S 身份；不选最新记录"),
        stopped: bool = typer.Option(False, "--stopped", help="本次明确确认外部工作已停止；release/report 必须提供"),
        feedback_file: Optional[Path] = typer.Option(None, "--feedback-file", help="create 的精确原始反馈引用 JSON，可省略")):
    """读取当前权限与事实，准备完整 W 原件；不会执行外部工具。"""
    if action == WorkOrderAction.create:
        feedback = None
        if feedback_file is not None:
            try:
                with feedback_file.open("rb") as handle: feedback = strict_json(handle.read(MAX_ORIGINAL_BYTES + 1))
            except (OSError, ValueError):
                warn("反馈引用必须是完整、有界且无重复字段的 UTF-8 JSON。")
                raise typer.Exit(1)
        _output(journal, "prepare_work_order_create", task, executor, instructions, feedback_reference=feedback)
        return
    fields = {WorkOrderAction.claim: {},
        WorkOrderAction.progress: {"percent": percent, "status": status.value, "message": message},
        WorkOrderAction.cancel: {"comment": comment},
        WorkOrderAction.release: {"comment": comment, "stopped_attestation": stopped},
        WorkOrderAction.report: {"submission_id": submission, "stopped_attestation": stopped}}[action]
    _output(journal, "prepare_work_order_action", id, action.value, **fields)


@app.command("prepare-submit")
def prepare_submit(task: str = typer.Option(..., "--task"),
        file: Path = typer.Option(..., "--file", help="仅 source/summary/artifacts/criteria 结果/tests；当前基线、条件摘要、版本及请求键由 prepare 固定"),
        journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal"),
        work_order: Optional[str] = typer.Option(None, "--work-order"),
        stopped: bool = typer.Option(False, "--stopped", help="与 --work-order 同时明确给出；不继承上次停止声明")):
    """准备人工或工具提交；测试通过和验收结果必须由用户显式报告。"""
    try:
        with file.open("rb") as handle: authored = strict_json(handle.read(MAX_ORIGINAL_BYTES + 1))
    except (OSError, ValueError):
        warn("报告必须是完整、有界且无重复字段的 UTF-8 JSON。")
        raise typer.Exit(1)
    _output(journal, "prepare_submit", task, authored, work_order_id=work_order, stopped_attestation=stopped)


@app.command("rework-draft")
def rework_draft(task: str = typer.Option(..., "--task"), submission: str = typer.Option(..., "--submission"),
        output: Optional[Path] = typer.Option(None, "--output", help="将完整采用文档保存为 UTF-8 JSON；不覆盖已有文件。省略时输出 JSON。")):
    """预览选定退回报告，生成本次可编辑材料；不创建交付操作、不发送命令。"""
    try:
        if output is not None and (output.exists() or output.is_symlink()):
            raise FileExistsError()
        with get_client() as client:
            value = read_rework_draft(client, task, submission)
        if output is None:
            console.print_json(data=value)
        else:
            raw = canonical(value, MAX_ADOPTION_BYTES)
            with output.open("xb") as handle:
                handle.write(raw + b"\n")
            console.print_json(data={"saved": str(output), "next": "编辑 authored，再用 prepare-rework；保留完整 preview。"})
    except FileExistsError:
        warn("输出文件已存在，未覆盖。请选用新文件名，原材料保持不变。")
        raise typer.Exit(1) from None
    except Exception:
        warn("无法读取或保存完整返工来源。请核对选定报告、退回决定和访问权限，再用 rework-draft 重试。")
        raise typer.Exit(1) from None


@app.command("prepare-rework")
def prepare_rework(task: str = typer.Option(..., "--task"),
        file: Path = typer.Option(..., "--file", help="rework-draft 的完整采用文档；只编辑 authored，保留 preview。"),
        journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal"),
        work_order: Optional[str] = typer.Option(None, "--work-order"),
        stopped: bool = typer.Option(False, "--stopped", help="本次明确选择当前工单并确认外部工作已停止；不继承旧声明。")):
    """复核同一已采用来源，准备新报告原件；尚不发送。"""
    try:
        with file.open("rb") as handle:
            adopted = strict_json(handle.read(MAX_ADOPTION_BYTES + 1), MAX_ADOPTION_BYTES)
        adopted = validate_adoption(adopted, task_id=task)
    except (OSError, ValueError):
        warn("需要完整、有效的返工采用文档和本次作者。请用 rework-draft 预览，明确采用后只编辑 authored；原文件不变。")
        raise typer.Exit(1) from None
    _output(journal, "prepare_rework", task, adopted, work_order_id=work_order, stopped_attestation=stopped)


@app.command("prepare-review")
def prepare_review(task: str = typer.Option(..., "--task"), submission: str = typer.Option(..., "--submission"),
        decision: ReviewDecision = typer.Option(..., "--decision"), comment: str = typer.Option(..., "--comment"),
        journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal")):
    """针对选定原件准备人审决定；accept 会核对当前可验收权限。"""
    _output(journal, "prepare_review", task, submission, decision.value, comment)


@app.command("inspect")
def inspect(operation: str = typer.Option(..., "--operation"), journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal")):
    """本地审阅完整原件、固定作用域、状态及已验证回执，无需网络。"""
    _output(journal, "inspect", operation, local=True)


@app.command("list")
def list_operations(journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal"),
        all: bool = typer.Option(False, "--all", help="显式包括已结束历史；默认只列活动操作"),
        limit: int = typer.Option(20, "--limit", min=1, max=100),
        after: str = typer.Option("", "--after", help="上一页 next_cursor，固定本地操作身份")):
    """本地有界摘要：编号、动作、任务、状态及活动标记；不联网、不输出完整正文。"""
    _output(journal, "list", local=True, include_closed=all, limit=limit, after=after)


@app.command("send")
def send(operation: str = typer.Option(..., "--operation"), journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal")):
    """核当前账号与作用域后发送保存原件一次；不接受临时版本或请求键。"""
    _output(journal, "send", operation)


@app.command("resume")
def resume(operation: str = typer.Option(..., "--operation"), journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal")):
    """只恢复同一原件；后续 403/409 不能消除之前的未知结果。"""
    _output(journal, "resume", operation)


@app.command("finish")
def finish(operation: str = typer.Option(..., "--operation"), journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal")):
    """已验证确认后关闭本地活动标记，保留完整原件和回执，无需刷新工作区。"""
    _output(journal, "finish", operation, local=True)


@app.command("discard")
def discard(operation: str = typer.Option(..., "--operation"), journal: Path = typer.Option(DEFAULT_JOURNAL, "--journal")):
    """取消尚未发送的 prepared 草稿并保留原件；unknown 必须恢复，confirmed 请用 finish。"""
    _output(journal, "discard", operation, local=True)
