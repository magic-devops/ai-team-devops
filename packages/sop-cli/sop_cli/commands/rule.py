"""
@module: sop_cli.commands.rule
@purpose: 规则操作：list / propose / apply
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="规则库操作")


def _rules_file() -> Path:
    return get_config().project_path / ".ai-memory" / "rules" / "RULES.md"


def _proposals_path() -> Path:
    return get_config().project_path / ".sop-runtime" / "rules" / "proposals.jsonl"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows),
        encoding="utf-8",
    )


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _local_rules() -> list[dict]:
    f = _rules_file()
    if not f.is_file():
        return []
    rows: list[dict] = []
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        s = line.strip()
        if s.startswith("- ") and "规则数" not in s and "活跃规则" not in s:
            category = "local"
            rule = s[2:].strip()
            if rule.startswith("[") and "]" in rule:
                category = rule[1:rule.index("]")].strip() or "local"
            rows.append({"id": f"local-{i}", "category": category, "confidence": 1.0, "rule": rule})
    return rows


def _append_local_rule(rule: str, category: str, source: str, confidence: float) -> Path:
    f = _rules_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    if not f.exists():
        f.write_text("# 项目规则库\n\n## 活跃规则\n\n", encoding="utf-8")
    text = f.read_text(encoding="utf-8")
    entry = (
        f"- [{category}] {rule} "
        f"(source={source}, confidence={confidence:.2f}, created_at={_now()})"
    )
    if entry in text:
        return f
    if "## 活跃规则" in text:
        text = text.replace("## 活跃规则", "## 活跃规则\n\n" + entry, 1)
    else:
        text += "\n## 活跃规则\n\n" + entry + "\n"
    f.write_text(text, encoding="utf-8")
    return f


def _enqueue_rules_file() -> None:
    from .sync import _enqueue_item

    f = _rules_file()
    if not f.is_file():
        return
    rel = f.relative_to(get_config().project_path).as_posix()
    _enqueue_item("rules", {"path": rel, "content": f.read_text(encoding="utf-8")}, action="upsert")


def _build_proposal(rule: str, category: str, source: str, confidence: float) -> dict[str, Any]:
    cfg = get_config()
    return {
        "id": f"rule-local-{uuid.uuid4().hex}",
        "rule": rule,
        "category": category,
        "source": source,
        "confidence": confidence,
        "status": "proposed",
        "created_at": _now(),
        "tenant_code": cfg.tenant_code or cfg.tenant_id,
        "business_code": cfg.business_code,
        "project_code": cfg.project_code or cfg.project_id,
        "project_id": cfg.project_id,
    }


def _proposal_by_id(rule_id: str) -> dict[str, Any] | None:
    rid = rule_id.strip()
    for row in _read_jsonl(_proposals_path()):
        if str(row.get("id") or "") == rid:
            return row
    return None


@app.command(name="list")
def list_rules(
    local: bool = typer.Option(False, "--local", help="只读取本地 RULES.md 与 proposals"),
    proposals: bool = typer.Option(False, "--proposals", help="同时列出本地待审核提案"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """列出当前活跃规则（GET /api/v1/rules）。"""
    try:
        if local:
            raise RuntimeError("--local")
        rows = get_client()._request("GET", "/api/v1/rules")
        source = "Manager"
    except Exception as e:
        if str(e) != "--local":
            warn(f"Manager 规则接口不可用，回退本地 RULES.md：{e}")
        rows = _local_rules()
        source = "local"
    rows = rows if isinstance(rows, list) else []
    proposal_rows = _read_jsonl(_proposals_path()) if proposals or local else []
    if json_output:
        console.print_json(data={"ok": True, "source": source, "items": rows, "proposals": proposal_rows})
        return
    tbl = Table(title=f"rules total={len(rows)} source={source}", show_header=True, header_style="bold")
    for col in ("id", "category", "confidence", "rule"):
        tbl.add_column(col)
    for r in rows[:200]:
        tbl.add_row(str(r.get("id", "")), str(r.get("category", "")),
                    f"{r.get('confidence', 0):.2f}", (r.get("rule", "") or "")[:100])
    console.print(tbl)
    if proposal_rows:
        pt = Table(title=f"proposals total={len(proposal_rows)}", show_header=True, header_style="bold")
        for col in ("id", "status", "category", "confidence", "rule"):
            pt.add_column(col)
        for r in proposal_rows[:200]:
            pt.add_row(str(r.get("id", "")), str(r.get("status", "")), str(r.get("category", "")),
                       f"{float(r.get('confidence') or 0):.2f}", str(r.get("rule", ""))[:100])
        console.print(pt)


@app.command()
def propose(
    rule: str,
    category: str = typer.Option("coding"),
    source: str = typer.Option("human"),
    confidence: float = typer.Option(0.75),
    local: bool = typer.Option(False, "--local", help="只写本地 proposal/RULES.md/sync 队列"),
    apply: bool = typer.Option(True, "--apply/--no-apply", help="提案后立即应用到本地 RULES.md"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    proposal = _build_proposal(rule, category, source, confidence)
    _append_jsonl(_proposals_path(), proposal)
    try:
        if local:
            raise RuntimeError("--local")
        out = get_client()._request(
            "POST",
            "/api/v1/rules",
            json_body={
                "rule": rule,
                "category": category,
                "source": source,
                "confidence": confidence,
            },
        )
    except Exception as e:
        if str(e) != "--local":
            warn(f"Manager 规则写入失败，落本地 proposal/RULES.md：{e}")
        p = None
        if apply:
            p = _append_local_rule(rule, category, source, confidence)
            _mark_proposal(proposal["id"], "applied")
            _enqueue_rules_file()
        if json_output:
            console.print_json(data={"ok": True, "item": proposal, "applied": bool(p), "queued": apply})
            return
        ok(f"rule proposed locally: {proposal['id']}")
        if p:
            ok(f"rule applied locally: {p.relative_to(get_config().project_path)}")
            warn("连接 Manager 后可执行 sop sync flush 或 sop rule flush")
        return
    _mark_proposal(proposal["id"], "remote")
    if json_output:
        console.print_json(data={"ok": True, "remote": out, "local": proposal})
    else:
        ok(f"rule proposed: {out.get('id', '-')}")


def _mark_proposal(rule_id: str, status: str) -> None:
    rows = _read_jsonl(_proposals_path())
    changed = False
    for row in rows:
        if str(row.get("id") or "") == rule_id:
            row["status"] = status
            row["updated_at"] = _now()
            changed = True
    if changed:
        _write_jsonl(_proposals_path(), rows)


@app.command()
def apply(
    rule_id: str = typer.Argument(..., help="本地 proposal id；可用 sop rule list --local --proposals 查看"),
    enqueue: bool = typer.Option(True, "--enqueue/--no-enqueue", help="应用后写入 sync push_queue"),
) -> None:
    """把本地规则提案应用到 .ai-memory/rules/RULES.md。"""
    row = _proposal_by_id(rule_id)
    if not row:
        warn(f"未找到 proposal: {rule_id}")
        raise typer.Exit(2)
    p = _append_local_rule(
        str(row.get("rule") or ""),
        str(row.get("category") or "coding"),
        str(row.get("source") or "human"),
        float(row.get("confidence") or 0.75),
    )
    _mark_proposal(rule_id, "applied")
    if enqueue:
        _enqueue_rules_file()
    ok(f"rule applied: {p.relative_to(get_config().project_path)}")


@app.command()
def flush() -> None:
    """直连 Manager 推送本地 RULES.md。"""
    f = _rules_file()
    if not f.is_file():
        ok("RULES.md empty")
        return
    rel = f.relative_to(get_config().project_path).as_posix()
    out = get_client().sync_push("rules", {"path": rel, "content": f.read_text(encoding="utf-8")}, action="upsert")
    console.print_json(data=out)
    ok(f"rules flushed: {rel}")
