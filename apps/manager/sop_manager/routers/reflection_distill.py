"""
@module: routers.reflection_distill
@purpose: 反思蒸馏 —— 扫描反思 → LLM 提案规则 → 人工/自动审核 → 写入规则库
@stable: /api/v1/reflections/distill 路径稳定
@ai_safe_edit:
  - 改提案策略：仅改 _SYS_DISTILL 和提示词
  - 改阈值：MIN_REFLECTIONS / SIMILAR_THRESHOLD 常量
@deps_in: routers.llm_gateway, routers.vector_store_iface

流程：
  1. 从 LanceDB / Qdrant 拉过去 N 天反思
  2. 按 category 分组；> 阈值 → 提案规则
  3. LLM 抽取共性 + 给出可执行规则 + 置信度
  4. 写 proposed_rules 表（人工审核 / 自动入库 by 置信度阈值）
"""
from __future__ import annotations

import json
import logging
import os
import time
import hashlib
import pathlib
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

_log = logging.getLogger("sop.distill")
router = APIRouter(prefix="/api/v1/reflections", tags=["reflection"])

MIN_REFLECTIONS = int(os.getenv("SOP_DISTILL_MIN", "3"))
AUTO_APPLY_THRESHOLD = float(os.getenv("SOP_DISTILL_AUTO_APPLY", "0.85"))


_SYS_DISTILL = """你是研发知识蒸馏师。给定多条历史反思（成败与教训），抽取**1 条**通用且可执行的规则。
输出严格 JSON：
{
  "rule": "一句话规则，命令式，可被 AI 在执行前对照",
  "category": "coding|testing|security|workflow|review|other",
  "confidence": 0.0-1.0,
  "evidence_count": 引用了多少条反思,
  "examples": ["简短引用 1", "..."]
}
若反思间无共性、或证据不足，返回 {"rule":"","confidence":0,"reason":"insufficient"}。"""


class DistillIn(BaseModel):
    days: int = 30
    category: str = ""
    limit: int = 100
    dry_run: bool = True


class ProposedRule(BaseModel):
    rule: str
    category: str
    confidence: float
    evidence_count: int = 0
    examples: list[str] = Field(default_factory=list)
    source_reflections: list[str] = Field(default_factory=list)


class ReviewIn(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    note: str = ""
    reviewer: str = "manager-web"


def _distill_dir() -> pathlib.Path:
    base = pathlib.Path(os.getenv("SOP_RUNTIME_DIR") or ".sop-runtime")
    out = base / "distill"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _proposal_id(row: dict[str, Any]) -> str:
    h = hashlib.sha1()
    h.update(str(row.get("rule", "")).encode("utf-8"))
    h.update(b"|")
    h.update(str(row.get("category", "")).encode("utf-8"))
    h.update(b"|")
    h.update(json.dumps(row.get("source_reflections", []), ensure_ascii=False, sort_keys=True).encode("utf-8"))
    return h.hexdigest()[:20]


def _load_reviews() -> dict[str, dict[str, Any]]:
    fp = _distill_dir() / "reviews.jsonl"
    out: dict[str, dict[str, Any]] = {}
    if not fp.exists():
        return out
    for line in fp.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        pid = str(row.get("id", ""))
        if pid:
            out[pid] = row
    return out


def _load_proposals(limit: int = 1000) -> list[dict[str, Any]]:
    p = _distill_dir()
    reviews = _load_reviews()
    out: list[dict[str, Any]] = []
    for fp in sorted(p.glob("proposed-*.jsonl"), reverse=True):
        for line in fp.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            pid = str(row.get("id") or _proposal_id(row))
            row["id"] = pid
            row.setdefault("status", "pending")
            row.setdefault("created_at", fp.stem.removeprefix("proposed-"))
            if pid in reviews:
                row.update(reviews[pid])
            out.append(row)
            if len(out) >= limit:
                return out
    return out


def _append_review(proposal: dict[str, Any], body: ReviewIn, applied_rule_id: str = "") -> dict[str, Any]:
    row = {
        "id": str(proposal["id"]),
        "status": body.status,
        "review_note": body.note,
        "reviewer": body.reviewer or "manager-web",
        "reviewed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "applied_rule_id": applied_rule_id,
    }
    with (_distill_dir() / "reviews.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def _load_reflections(days: int, category: str, limit: int) -> list[dict[str, Any]]:
    """优先从 LanceDB rules 集合捞 source=reflection 的；fallback 从内存。"""
    try:
        from sop_manager.routers.vector_store_iface import get_store
        store = get_store()
        # 简单实现：拉所有匹配前缀，逐条 metadata 过滤
        # 实际生产版应该走专门的 reflections collection
        hits = store.search(
            collection=os.getenv("SOP_REFLECTIONS_COLLECTION", "rules"),
            embedding=[0.0] * 1024,  # 占位；这条接口设计用查询；这里要的是"列出全部"
            limit=limit,
        )
        out: list[dict[str, Any]] = []
        cutoff = time.time() - days * 86400
        for h in hits:
            md = h.metadata or {}
            if md.get("source") != "reflection" and md.get("category") != "reflection":
                continue
            ts = float(md.get("ts", time.time()))
            if ts < cutoff:
                continue
            if category and md.get("category") and md.get("category") != category:
                continue
            out.append({"id": h.id, "text": h.text, "category": md.get("category", "other"),
                        "ts": ts, "confidence": md.get("confidence", 0.7)})
        return out[:limit]
    except Exception as e:
        _log.warning("load reflections via vector store failed: %s; fallback to empty", e)
        return []


def _distill_group(items: list[dict[str, Any]]) -> ProposedRule:
    try:
        from sop_manager.routers.llm_gateway import ChatIn, Message, llm_chat
    except Exception:
        raise HTTPException(503, "LLM Gateway 未就绪")
    bullets = "\n".join(f"- ({i.get('category','?')}) {i.get('text','')[:240]}" for i in items)
    out = llm_chat(ChatIn(
        messages=[
            Message(role="system", content=_SYS_DISTILL),
            Message(role="user", content=bullets),
        ],
        task_type="summarize", temperature=0.0, cache_ttl=120,
    ), None)  # type: ignore[arg-type]
    text = (out.content or "").strip()
    if text.startswith("```"):
        i0 = text.find("\n"); i1 = text.rfind("```")
        if i0 >= 0 and i1 > i0:
            text = text[i0 + 1: i1].strip()
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = {"rule": "", "confidence": 0.0, "category": "other"}
    return ProposedRule(
        rule=str(parsed.get("rule", "")).strip(),
        category=str(parsed.get("category", "other")),
        confidence=float(parsed.get("confidence", 0.0)),
        evidence_count=int(parsed.get("evidence_count", len(items))),
        examples=list(parsed.get("examples", [])),
        source_reflections=[i["id"] for i in items],
    )


def _persist_proposals(props: list[ProposedRule]) -> int:
    """写入 proposed_rules 文件（M11 终态接入 DB 表）。"""
    if not props:
        return 0
    out_dir = _distill_dir()
    fn = out_dir / f"proposed-{time.strftime('%Y-%m-%d')}.jsonl"
    with open(fn, "a", encoding="utf-8") as f:
        for p in props:
            row = p.model_dump()
            row["id"] = _proposal_id(row)
            row["status"] = "pending"
            row["created_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(props)


def _auto_apply(props: list[ProposedRule]) -> int:
    """置信度 ≥ 阈值的提案自动入库（写 LanceDB rules 集合）。"""
    if not props:
        return 0
    try:
        from sop_manager.routers.db import LanceOps  # type: ignore[import-not-found]
    except Exception:
        _log.warning("LanceOps 不可用，跳过 auto apply")
        return 0
    n = 0
    for p in props:
        if p.confidence < AUTO_APPLY_THRESHOLD:
            continue
        try:
            LanceOps().add_rule(
                rule=p.rule, category=p.category, source="distill", confidence=p.confidence,
            )
            n += 1
        except Exception as e:
            _log.warning("auto apply rule failed: %s", e)
    return n


@router.post("/distill")
def distill(body: DistillIn) -> dict[str, Any]:
    items = _load_reflections(body.days, body.category, body.limit)
    if len(items) < MIN_REFLECTIONS:
        return {"ok": True, "proposals": [], "skipped": "insufficient",
                "found": len(items), "min": MIN_REFLECTIONS}

    # 简单按 category 分组（每组 ≥ MIN_REFLECTIONS 才提案）
    groups: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        groups.setdefault(it.get("category", "other"), []).append(it)
    proposals: list[ProposedRule] = []
    for cat, lst in groups.items():
        if len(lst) < MIN_REFLECTIONS:
            continue
        try:
            p = _distill_group(lst)
        except Exception as e:
            _log.warning("distill group %s failed: %s", cat, e)
            continue
        if p.rule:
            proposals.append(p)

    saved = _persist_proposals(proposals) if not body.dry_run else 0
    applied = _auto_apply(proposals) if not body.dry_run else 0

    return {
        "ok": True,
        "found": len(items),
        "groups": {k: len(v) for k, v in groups.items()},
        "proposals": [p.model_dump() for p in proposals],
        "saved_to_review": saved,
        "auto_applied": applied,
        "auto_apply_threshold": AUTO_APPLY_THRESHOLD,
        "dry_run": body.dry_run,
    }


@router.get("/proposals")
def list_proposals(limit: int = 100) -> list[dict[str, Any]]:
    return _load_proposals(limit)


@router.post("/proposals/{proposal_id}/review")
def review_proposal(proposal_id: str, body: ReviewIn) -> dict[str, Any]:
    proposal = next((p for p in _load_proposals(5000) if str(p.get("id")) == proposal_id), None)
    if not proposal:
        raise HTTPException(404, "proposal not found")
    if proposal.get("status") in {"approved", "rejected"}:
        raise HTTPException(409, f"proposal already {proposal.get('status')}")

    applied_rule_id = ""
    if body.status == "approved":
        try:
            from sop_manager.path_config import ensure_lance_ops_import_path

            ensure_lance_ops_import_path()
            from knowledge.lancedb_ops import LanceOps

            applied_rule_id = str(LanceOps().add_rule(
                proposal.get("rule", ""),
                proposal.get("category", "coding"),
                "distill_review",
                float(proposal.get("confidence") or 0.75),
            ))
        except Exception as e:
            raise HTTPException(500, f"apply rule failed: {e}") from e

    review = _append_review(proposal, body, applied_rule_id)
    return {"ok": True, "proposal": {**proposal, **review}}
