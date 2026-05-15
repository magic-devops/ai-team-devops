"""
@module: sop_cli.commands.sync
@purpose: 双向同步规约/规则/知识（项目侧 ↔ Manager）
@ai_safe_edit:
  - 实际同步实现在 sop-agentd Reporter/Puller（M4）；本命令仅触发一次性同步
"""
from __future__ import annotations

import typer

from .._util import err, ok, warn
from sop_sdk import AgentdIpcClient

app = typer.Typer(help="一次性同步（规约/规则/知识）")


def _pull_result_payload(r: dict) -> dict:
    """Normalize agentd IPC result vs Manager HTTP body."""
    if not isinstance(r, dict):
        return {}
    if "total" in r or "cursor" in r:
        return r
    inner = r.get("result")
    return inner if isinstance(inner, dict) else r


@app.command("pull")
def sync_pull(
    cursor: str = typer.Option("", "--cursor", help="ISO8601 游标"),
    modules: str = typer.Option("tasks,requirements,issues,sprints", "--modules", "-m"),
    out: str = typer.Option("", "--out", "-o", help="写入 JSON 文件"),
    direct: bool = typer.Option(
        False,
        "--direct",
        help="跳过 agentd，直连 Manager（不写入 .sop-runtime 物化文件）",
    ),
) -> None:
    """从 Manager 拉取结构化变更（游标同步）。"""
    import json

    from .._util import console, get_client, get_config, ok, warn

    cfg = get_config()
    r: dict | None = None
    if not direct:
        ipc = AgentdIpcClient()
        if ipc.available():
            try:
                data: dict = {"modules": modules}
                if cursor:
                    data["cursor"] = cursor
                out_ipc = ipc.send("sync.pull", data=data)
                if out_ipc.get("ok"):
                    r = _pull_result_payload(out_ipc)
                    ok("已通过 sop-agentd 拉取")
                else:
                    warn(f"agentd pull 失败: {out_ipc.get('error', '-')}")
            except Exception as e:
                warn(f"agentd pull 异常: {e}")
        else:
            warn("sop-agentd 未运行")

    if r is None:
        if not direct:
            warn("回退直连 Manager（不更新本地 sync_state / entities）")
        try:
            r = get_client(cfg).sync_pull(cursor=cursor, modules=modules)
        except Exception as e:
            warn(str(e))
            raise typer.Exit(2) from e

    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False, indent=2)
        ok(f"已写入 {out}")
    else:
        console.print_json(data=r)


@app.command("status")
def sync_status() -> None:
    """查看本地同步游标与物化实体统计。"""
    import json

    from .._util import console, get_config, kv, ok, warn

    cfg = get_config()
    rt = cfg.project_path / ".sop-runtime" / "sync"
    state_path = cfg.project_path / ".sop-runtime" / "sync_state.json"
    if state_path.is_file():
        st = json.loads(state_path.read_text(encoding="utf-8"))
        kv("cursor", st.get("cursor") or "(空)")
        kv("last_pull_at", st.get("last_pull_at") or "-")
        kv("last_total", st.get("last_total", 0))
    else:
        kv("cursor", "(未拉取)")
    entities = rt / "entities"
    if entities.is_dir():
        for f in sorted(entities.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                console.print(f"  {f.stem}: {len(data)} 条")
            except Exception:
                console.print(f"  {f.stem}: (解析失败)")
    queue = rt / "push_queue.jsonl"
    if queue.is_file():
        lines = [ln for ln in queue.read_text(encoding="utf-8").splitlines() if ln.strip()]
        kv("push_queue_pending", len(lines))
    else:
        kv("push_queue_pending", 0)
    ipc = AgentdIpcClient()
    if ipc.available():
        h = ipc.send("health")
        if h.get("ok"):
            ok(f"agentd 在线 outbox_depth={((h.get('result') or {}).get('outbox_depth'))}")
    else:
        warn("sop-agentd 未运行 → sop agentd start")


@app.command("push")
def sync_push_cmd(
    module: str = typer.Argument(..., help="tasks|requirements|issues|sprints"),
    record_json: str = typer.Argument(..., help="JSON 记录（须含 id）"),
    action: str = typer.Option("upsert", "--action", help="upsert|delete"),
    idempotency_key: str = typer.Option("", "--idempotency-key"),
) -> None:
    """向 Manager 推送单条结构化变更（幂等键可选）。"""
    import json

    from .._util import console, get_client, get_config, ok, warn

    try:
        rec = json.loads(record_json)
        if not isinstance(rec, dict):
            raise ValueError("record 须为 JSON object")
        r = get_client(get_config()).sync_push(
            module, rec, action=action, idempotency_key=idempotency_key
        )
        console.print_json(data=r)
        ok(f"sync push {action} {module}/{rec.get('id', '-')}")
    except json.JSONDecodeError:
        warn("record 须为合法 JSON")
        raise typer.Exit(2) from None
    except Exception as e:
        warn(str(e))
        raise typer.Exit(2) from e


def _direct_sync_cycle() -> dict | None:
    """直连 Manager 执行 pull+push（login 后立即可用，不依赖 agentd 内存中的旧 token）。"""
    from .._util import get_client, get_config

    cfg = get_config()
    if not cfg.project_id:
        warn("agent.toml 未配置 project_id；可执行 sop login 或编辑 .sop-runtime/agent.toml")
        return None
    cli = get_client(cfg)
    pull = cli.sync_pull(cursor="", modules="tasks,requirements,issues,sprints")
    return {"pull": pull, "project_id": cfg.project_id}


@app.callback(invoke_without_command=True)
def sync(
    ctx: typer.Context,
    rules: bool = typer.Option(True, "--rules/--no-rules", help="同步规则库"),
    specs: bool = typer.Option(True, "--specs/--no-specs", help="同步规约文档"),
    knowledge: bool = typer.Option(False, "--knowledge", help="同步知识库（默认关闭，体量大）"),
    direct: bool = typer.Option(False, "--direct", help="跳过 agentd，直连 Manager"),
) -> None:
    if ctx.invoked_subcommand is not None:
        return

    if direct:
        r = _direct_sync_cycle()
        if r is None:
            raise typer.Exit(2)
        ok(f"直连同步完成 project_id={r.get('project_id')} total={r.get('pull', {}).get('total', 0)}")
        return

    ipc = AgentdIpcClient()
    if not ipc.available():
        warn("sop-agentd 未运行，尝试直连 Manager…")
        r = _direct_sync_cycle()
        if r is not None:
            ok(f"直连同步完成 project_id={r.get('project_id')} total={r.get('pull', {}).get('total', 0)}")
            return
        warn("启动 agentd：sop agentd start")
        raise typer.Exit(1)

    out = ipc.send("sync.trigger", data={"rules": rules, "specs": specs, "knowledge": knowledge})
    if out.get("ok"):
        summary = (out.get("result") or {}).get("summary") or out.get("summary", "-")
        ok(f"sync 已触发：{summary}")
        return

    err_msg = str(out.get("error", "-"))
    if "X-Project-Id" in err_msg or "绑定同步分区" in err_msg or "project_id" in err_msg.lower():
        warn("agentd 鉴权/项目作用域未就绪，尝试直连 Manager（已读取最新 login token）…")
        r = _direct_sync_cycle()
        if r is not None:
            ok(f"直连同步完成 project_id={r.get('project_id')} total={r.get('pull', {}).get('total', 0)}")
            warn("建议重建 agentd 以使用 IPC 同步：sop agentd stop && sop agentd start")
            return

    err(f"sync 失败：{err_msg}")
    warn("若刚 sop login：sop agentd stop && sop agentd start，或 sop sync --direct")
    raise typer.Exit(2)
