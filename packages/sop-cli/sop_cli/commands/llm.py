"""
@module: sop_cli.commands.llm
@purpose: 通过 LLM Gateway 调用模型 / 嵌入 / 检索
"""
from __future__ import annotations

import json

import typer

from .._util import console, err, get_client, kv, ok

app = typer.Typer(help="LLM Gateway 客户端")


@app.command()
def chat(
    prompt: str = typer.Argument(..., help="用户消息"),
    system: str = typer.Option("", "--system", help="system 指令"),
    model: str = typer.Option("", "--model"),
    task_type: str = typer.Option("", "--task-type", help="plan/code/review/summarize/classify"),
    temperature: float = typer.Option(0.2, "--temperature"),
    cache_ttl: int = typer.Option(0, "--cache-ttl"),
) -> None:
    cli = get_client()
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt})
    try:
        out = cli.llm_chat(
            msgs, model=model or None, task_type=task_type or None,
            temperature=temperature, cache_ttl=cache_ttl or None,
        )
    except Exception as e:
        err(str(e)); raise typer.Exit(1)
    console.print(out.get("content", ""))
    u = out.get("usage", {})
    kv("model", out.get("model", "-"))
    kv("usage", f"in={u.get('prompt_tokens','?')} out={u.get('completion_tokens','?')} $={u.get('cost_usd','?')}")
    if out.get("cached"):
        ok("（命中缓存）")


@app.command()
def embed(text: str, model: str = typer.Option("bge-m3", "--model")) -> None:
    cli = get_client()
    out = cli.llm_embeddings(text, model=model)
    vs = out.get("vectors", [])
    kv("model", out.get("model", "-"))
    kv("dim", len(vs[0]) if vs else 0)
    kv("count", len(vs))


@app.command()
def search(query: str, k: int = typer.Option(8, "-k")) -> None:
    cli = get_client()
    out = cli.rag_search(query, limit=k)
    console.print(json.dumps(out, ensure_ascii=False, indent=2))
