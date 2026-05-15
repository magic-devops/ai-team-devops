"""
@module: sop_cli.commands.rule
@purpose: 规则操作：list / propose / apply
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import typer
from rich.table import Table

from .._util import console, err, get_client, get_config, ok, warn

app = typer.Typer(help="规则库操作")


def _rules_file() -> Path:
    return get_config().project_path / ".ai-memory" / "rules" / "RULES.md"


def _local_rules() -> list[dict]:
    f = _rules_file()
    if not f.is_file():
        return []
    rows: list[dict] = []
    for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        s = line.strip()
        if s.startswith("- ") and "规则数" not in s and "活跃规则" not in s:
            rows.append({"id": f"local-{i}", "category": "local", "confidence": 1.0, "rule": s[2:].strip()})
    return rows


def _append_local_rule(rule: str, category: str, source: str, confidence: float) -> Path:
    f = _rules_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    if not f.exists():
        f.write_text("# 项目规则库\n\n## 活跃规则\n\n", encoding="utf-8")
    text = f.read_text(encoding="utf-8")
    entry = (
        f"- [{category}] {rule} "
        f"(source={source}, confidence={confidence:.2f}, created_at={datetime.utcnow().replace(microsecond=0).isoformat()}Z)"
    )
    if "## 活跃规则" in text:
        text = text.replace("## 活跃规则", "## 活跃规则\n\n" + entry, 1)
    else:
        text += "\n## 活跃规则\n\n" + entry + "\n"
    f.write_text(text, encoding="utf-8")
    return f


@app.command(name="list")
def list_rules() -> None:
    """列出当前活跃规则（GET /api/v1/rules）。"""
    cli = get_client()
    try:
        rows = cli._request("GET", "/api/v1/rules")
        source = "Manager"
    except Exception as e:
        warn(f"Manager 规则接口不可用，回退本地 RULES.md：{e}")
        rows = _local_rules()
        source = "local"
    rows = rows if isinstance(rows, list) else []
    tbl = Table(title=f"rules total={len(rows)} source={source}", show_header=True, header_style="bold")
    for col in ("id", "category", "confidence", "rule"):
        tbl.add_column(col)
    for r in rows[:200]:
        tbl.add_row(str(r.get("id", "")), str(r.get("category", "")),
                    f"{r.get('confidence', 0):.2f}", (r.get("rule", "") or "")[:100])
    console.print(tbl)


@app.command()
def propose(rule: str, category: str = typer.Option("coding"), source: str = typer.Option("human"),
            confidence: float = typer.Option(0.75)) -> None:
    cli = get_client()
    try:
        out = cli._request(
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
        warn(f"Manager 规则写入失败，落本地 RULES.md：{e}")
        p = _append_local_rule(rule, category, source, confidence)
        ok(f"rule proposed locally: {p.relative_to(get_config().project_path)}")
        warn("连接 Manager 后可执行 sop sync push-file rules .ai-memory/rules/RULES.md")
        return
    ok(f"rule proposed: {out.get('id', '-')}")
