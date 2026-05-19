"""
@module: sop_cli.commands.ops
@purpose: 运维：通知通道、同步拉取、Worker 探活、health/stack/deploy/snapshot 脚本统一入口
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import typer
from rich.table import Table

from .._util import console, err, get_client, get_config, ok, warn

app = typer.Typer(help="运维：health/stack/deploy/snapshot/notify/worker")


def _repo_root() -> Path:
    cfg_root = get_config().project_path.resolve()
    for p in (cfg_root, *cfg_root.parents):
        if (p / "ai-sop-ops").is_dir() and ((p / "scripts").is_dir() or (p / "apps").is_dir()):
            return p
    return cfg_root


def _script(*parts: str) -> Path:
    return _repo_root().joinpath(*parts)


def _run_script(args: list[str], *, project_path: Path | None = None, extra_env: dict[str, str] | None = None) -> None:
    root = _repo_root()
    env = {**os.environ}
    cfg = get_config()
    env.setdefault("PROJECT_PATH", str(project_path or cfg.project_path))
    if extra_env:
        env.update(extra_env)
    kv = " ".join(args)
    console.print(f"[muted]$ {kv}[/muted]")
    r = subprocess.run(args, cwd=str(root), env=env)
    if r.returncode != 0:
        err(f"命令退出码 {r.returncode}")
        raise typer.Exit(r.returncode)


def _csv(raw: str) -> list[str]:
    return [x.strip() for x in (raw or "").split(",") if x.strip()]


@app.command("org-policy")
def org_policy(json_out: bool = typer.Option(False, "--json", help="输出原始 JSON")) -> None:
    """查看组织角色权限策略。"""
    try:
        r = get_client(get_config()).organization_policy()
        if json_out:
            console.print_json(data=r)
            return
        tbl = Table(title="组织角色权限策略", show_header=True, header_style="bold")
        tbl.add_column("scope")
        tbl.add_column("role")
        tbl.add_column("capabilities")
        for row in (r.get("user_roles") or []) + (r.get("project_member_roles") or []):
            tbl.add_row(str(row.get("scope", "")), str(row.get("role", "")), ",".join(row.get("capabilities") or []))
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("org-policy-set")
def org_policy_set(
    role: str = typer.Option(..., "--role", help="角色，例如 developer/project_admin"),
    scope: str = typer.Option("tenant", "--scope", help="tenant|project"),
    capabilities: str = typer.Option(..., "--capabilities", help="能力码逗号分隔"),
    notes: str = typer.Option("", "--notes", help="策略说明"),
    json_out: bool = typer.Option(False, "--json", help="输出原始 JSON"),
) -> None:
    """更新单个角色的能力配置。"""
    try:
        current = get_client(get_config()).organization_policy()
        user_map = dict(current.get("user_capability_map") or {})
        project_map = dict(current.get("project_capability_map") or {})
        if scope == "project":
            project_map[role] = _csv(capabilities)
        else:
            user_map[role] = _csv(capabilities)
        r = get_client(get_config()).organization_policy_update({
            "user_capability_map": user_map,
            "project_capability_map": project_map,
            "notes": notes or current.get("notes", ""),
        })
        if json_out:
            console.print_json(data=r)
            return
        ok(f"updated {scope}:{role}")
    except Exception as e:
        warn(str(e))


@app.command("org-policy-reset")
def org_policy_reset(json_out: bool = typer.Option(False, "--json", help="输出原始 JSON")) -> None:
    """恢复组织角色权限默认策略。"""
    try:
        r = get_client(get_config()).organization_policy_reset()
        if json_out:
            console.print_json(data=r)
            return
        ok("organization policy reset")
    except Exception as e:
        warn(str(e))


@app.command("org-policy-check")
def org_policy_check(
    role: str = typer.Option(..., "--role", help="角色，例如 developer/project_admin"),
    capability: str = typer.Option(..., "--capability", help="能力码，例如 task.claim"),
    scope: str = typer.Option("tenant", "--scope", help="tenant|project"),
    json_out: bool = typer.Option(False, "--json", help="输出原始 JSON"),
) -> None:
    """试算指定角色是否拥有某个能力码。"""
    try:
        r = get_client(get_config()).organization_policy_check({
            "scope": scope,
            "role": role,
            "capability": capability,
        })
        if json_out:
            console.print_json(data=r)
            return
        decision = str(r.get("decision") or "deny")
        color = "green" if decision == "allow" else "red"
        console.print(f"[{color}]{decision.upper()}[/{color}] {scope}:{role} -> {capability}")
        if r.get("matched_capabilities"):
            console.print(",".join(r.get("matched_capabilities") or []))
    except Exception as e:
        warn(str(e))


@app.command("org-policy-history")
def org_policy_history(
    limit: int = typer.Option(20, "--limit", min=1, max=200, help="返回条数"),
    json_out: bool = typer.Option(False, "--json", help="输出原始 JSON"),
) -> None:
    """查看组织角色策略变更历史。"""
    try:
        r = get_client(get_config()).organization_policy_history(limit=limit)
        if json_out:
            console.print_json(data=r)
            return
        tbl = Table(title="组织角色策略变更历史", show_header=True, header_style="bold")
        tbl.add_column("time")
        tbl.add_column("action")
        tbl.add_column("user")
        tbl.add_column("tenant/project roles")
        tbl.add_column("notes")
        for item in r.get("items", []) if isinstance(r, dict) else []:
            tbl.add_row(
                str(item.get("created_at", "")),
                str(item.get("action", "")),
                str(item.get("updated_by", "")),
                f"{item.get('user_roles', 0)}/{item.get('project_roles', 0)}",
                str(item.get("notes", ""))[:80],
            )
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("org-access-review")
def org_access_review(json_out: bool = typer.Option(False, "--json", help="输出原始 JSON")) -> None:
    """查看组织权限体检结果。"""
    try:
        r = get_client(get_config()).organization_access_review()
        if json_out:
            console.print_json(data=r)
            return
        summary = r.get("summary") or {}
        console.print(f"[bold]权限体检[/bold] score={r.get('score')} grade={r.get('grade')} findings={summary.get('findings', 0)}")
        tbl = Table(title="组织权限风险", show_header=True, header_style="bold")
        tbl.add_column("severity")
        tbl.add_column("kind")
        tbl.add_column("title")
        tbl.add_column("project")
        tbl.add_column("owner")
        for item in r.get("findings", [])[:30]:
            tbl.add_row(
                str(item.get("severity", "")),
                str(item.get("kind", "")),
                str(item.get("title", "")),
                str(item.get("project_name") or item.get("project_id") or ""),
                str(item.get("owner") or ""),
            )
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("org-access-tasks")
def org_access_tasks(
    apply: bool = typer.Option(False, "--apply", help="实际创建任务；默认只预览"),
    limit: int = typer.Option(20, "--limit", min=1, max=100, help="最多处理风险数"),
    assigned_to: str = typer.Option("tenant_admin", "--assigned-to", help="任务负责人"),
    priority: str = typer.Option("P1", "--priority", help="medium 风险默认优先级 P0-P3"),
    json_out: bool = typer.Option(False, "--json", help="输出原始 JSON"),
) -> None:
    """将组织权限体检风险预览或生成治理任务。"""
    try:
        r = get_client(get_config()).organization_access_review_tasks({
            "dry_run": not apply,
            "limit": limit,
            "assigned_to": assigned_to,
            "priority": priority,
        })
        if json_out:
            console.print_json(data=r)
            return
        summary = r.get("summary") or {}
        ok(f"planned={summary.get('planned', 0)} created={summary.get('created', 0)} dry_run={r.get('dry_run')}")
    except Exception as e:
        warn(str(e))


@app.command("notify-channels")
def notify_channels() -> None:
    try:
        rows = get_client(get_config()).notify_list_channels()
        tbl = Table(title="通知通道", show_header=True, header_style="bold")
        tbl.add_column("name")
        tbl.add_column("type")
        tbl.add_column("enabled")
        for ch in rows or []:
            if isinstance(ch, dict):
                tbl.add_row(str(ch.get("name", "")), str(ch.get("type", "")), str(ch.get("enabled", "")))
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("notify-connectors")
def notify_connectors(json_out: bool = typer.Option(False, "--json", help="输出原始 JSON")) -> None:
    try:
        r = get_client(get_config()).notify_connectors()
        if json_out:
            console.print_json(data=r)
            return
        tbl = Table(title="通信连接器", show_header=True, header_style="bold")
        tbl.add_column("type")
        tbl.add_column("name")
        tbl.add_column("direction")
        tbl.add_column("configured")
        tbl.add_column("maturity")
        for item in r.get("items", []) if isinstance(r, dict) else []:
            tbl.add_row(
                str(item.get("type", "")),
                str(item.get("display_name") or item.get("name") or ""),
                ",".join(item.get("direction") or []),
                str(item.get("configured_channels", 0)),
                str(item.get("maturity", "")),
            )
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("notify-callback")
def notify_callback(connector_type: str = typer.Argument(..., help="连接器类型：dingtalk/wechat_work/webhook")) -> None:
    try:
        r = get_client(get_config()).notify_connector_callback_template(connector_type)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("notify-verify")
def notify_verify(
    connector_type: str = typer.Argument(..., help="连接器类型：dingtalk/wechat_work/webhook"),
    secret: str = typer.Option("", "--secret", help="签名密钥/token"),
    timestamp: str = typer.Option("", "--timestamp", help="时间戳，留空自动生成"),
    nonce: str = typer.Option("", "--nonce", help="企业微信 nonce"),
    signature: str = typer.Option("", "--signature", help="待校验签名"),
    body: str = typer.Option("", "--body", help="原始请求体"),
) -> None:
    try:
        r = get_client(get_config()).notify_connector_verify(
            connector_type,
            secret=secret,
            timestamp=timestamp,
            nonce=nonce,
            signature=signature,
            body=body,
        )
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("notify-test")
def notify_test(channel: str = typer.Argument(..., help="通道名称")) -> None:
    try:
        r = get_client(get_config()).notify_test_channel(channel)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("notify-messages")
def notify_messages(
    direction: str = typer.Option("", "--direction", help="inbound/outbound/internal"),
    limit: int = typer.Option(50, "--limit", help="返回数量"),
    json_out: bool = typer.Option(False, "--json", help="输出原始 JSON"),
) -> None:
    try:
        r = get_client(get_config()).notify_messages(limit=limit, direction=direction)
        if json_out:
            console.print_json(data=r)
            return
        tbl = Table(title="通知消息流水", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("direction")
        tbl.add_column("channel")
        tbl.add_column("title/text")
        for row in r.get("items", []) if isinstance(r, dict) else []:
            tbl.add_row(
                str(row.get("id", "")),
                str(row.get("direction", "")),
                str(row.get("channel", "")),
                str(row.get("title") or row.get("text") or row.get("content") or "")[:60],
            )
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("notify-send")
def notify_send(
    channel: str = typer.Argument(..., help="通道名称"),
    title: str = typer.Option("Hermes 通知", "--title", help="消息标题"),
    content: str = typer.Option("", "--content", help="消息内容"),
    level: str = typer.Option("info", "--level", help="info/warn/error/success"),
) -> None:
    try:
        r = get_client(get_config()).notify_send(channel, title, content or title, level)
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("notify-inbound")
def notify_inbound(
    text: str = typer.Argument(..., help="入站消息文本"),
    channel: str = typer.Option("manual", "--channel", help="来源通道"),
    sender: str = typer.Option("cli", "--sender", help="发送人"),
    event: str = typer.Option("message", "--event", help="事件类型"),
) -> None:
    try:
        r = get_client(get_config()).notify_inbound({"channel": channel, "sender": sender, "event": event, "text": text})
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("notify-action")
def notify_action(
    message_id: str = typer.Argument(..., help="入站消息 ID"),
    action: str = typer.Option("task", "--action", help="task 或 requirement"),
    apply: bool = typer.Option(False, "--apply", help="实际创建；默认仅预览"),
    priority: str = typer.Option("P1", "--priority", help="优先级"),
    assigned_to: str = typer.Option("Coder", "--assigned-to", help="任务处理人"),
    assigned_agent: str = typer.Option("PM", "--assigned-agent", help="需求负责人 Agent"),
    dev_tool: str = typer.Option("copilot", "--dev-tool", help="推荐开发工具"),
) -> None:
    try:
        r = get_client(get_config()).notify_inbound_action(
            message_id,
            {
                "action": action,
                "dry_run": not apply,
                "priority": priority,
                "assigned_to": assigned_to,
                "assigned_agent": assigned_agent,
                "dev_tool": dev_tool,
            },
        )
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("sync-pull")
def sync_pull(
    cursor: str = typer.Option("", "--cursor", help="ISO8601 游标"),
    modules: str = typer.Option("tasks,requirements,issues,sprints,rules,specs,templates", "--modules", "-m"),
    out: str = typer.Option("", "--out", "-o", help="写入 JSON 文件"),
) -> None:
    try:
        r = get_client(get_config()).sync_pull(cursor=cursor, modules=modules)
        if out:
            with open(out, "w", encoding="utf-8") as f:
                json.dump(r, f, ensure_ascii=False, indent=2)
            ok(f"已写入 {out}")
        else:
            console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("sync-modules")
def sync_modules(json_out: bool = typer.Option(False, "--json", help="输出原始 JSON")) -> None:
    try:
        r = get_client(get_config()).sync_modules()
        if json_out:
            console.print_json(data=r)
            return
        tbl = Table(title="同步模块", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("name")
        tbl.add_column("kind")
        tbl.add_column("description")
        for row in r.get("items", []) if isinstance(r, dict) else []:
            tbl.add_row(str(row.get("id", "")), str(row.get("name", "")), str(row.get("kind", "")), str(row.get("description", ""))[:60])
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("sync-summary")
def sync_summary() -> None:
    try:
        console.print_json(data=get_client(get_config()).sync_summary())
    except Exception as e:
        warn(str(e))


@app.command("worker-health")
def worker_health() -> None:
    try:
        r = get_client(get_config()).worker_health()
        console.print_json(data=r)
    except Exception as e:
        warn(str(e))


@app.command("worker-types")
def worker_types(json_out: bool = typer.Option(False, "--json", help="输出原始 JSON")) -> None:
    try:
        r = get_client(get_config()).worker_types()
        if json_out:
            console.print_json(data=r)
            return
        tbl = Table(title="Worker 任务类型", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("name")
        tbl.add_column("queue")
        tbl.add_column("description")
        for row in r.get("items", []) if isinstance(r, dict) else []:
            tbl.add_row(str(row.get("id", "")), str(row.get("name", "")), str(row.get("queue", "")), str(row.get("description", ""))[:60])
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("worker-jobs")
def worker_jobs(
    status: str = typer.Option("", "--status", help="状态筛选"),
    job_type: str = typer.Option("", "--type", help="任务类型筛选"),
    limit: int = typer.Option(50, "--limit", help="返回数量"),
    json_out: bool = typer.Option(False, "--json", help="输出原始 JSON"),
) -> None:
    try:
        r = get_client(get_config()).worker_jobs(limit=limit, status=status, job_type=job_type)
        if json_out:
            console.print_json(data=r)
            return
        tbl = Table(title="Worker 任务", show_header=True, header_style="bold")
        tbl.add_column("id")
        tbl.add_column("type")
        tbl.add_column("status")
        tbl.add_column("updated")
        for row in r.get("items", []) if isinstance(r, dict) else []:
            tbl.add_row(str(row.get("id", "")), str(row.get("type", "")), str(row.get("status", "")), str(row.get("updated_at", "")))
        console.print(tbl)
    except Exception as e:
        warn(str(e))


@app.command("worker-enqueue")
def worker_enqueue(
    job_type: str = typer.Argument(..., help="任务类型，例如 kb.index"),
    payload: str = typer.Option("{}", "--payload", help="JSON payload"),
) -> None:
    try:
        body = json.loads(payload or "{}")
        if not isinstance(body, dict):
            raise typer.BadParameter("--payload 必须是 JSON object")
        console.print_json(data=get_client(get_config()).worker_enqueue(job_type, body))
    except Exception as e:
        warn(str(e))


@app.command("worker-cancel")
def worker_cancel(job_id: str = typer.Argument(..., help="Worker job id")) -> None:
    try:
        console.print_json(data=get_client(get_config()).worker_cancel(job_id))
    except Exception as e:
        warn(str(e))


@app.command("worker-retry")
def worker_retry(job_id: str = typer.Argument(..., help="Worker job id")) -> None:
    try:
        console.print_json(data=get_client(get_config()).worker_retry(job_id))
    except Exception as e:
        warn(str(e))


@app.command("usage-alerts")
def usage_alerts(limit: int = typer.Option(5000, "--limit", help="统计记录数量")) -> None:
    try:
        console.print_json(data=get_client(get_config()).usage_alerts(limit=limit))
    except Exception as e:
        warn(str(e))


@app.command("usage-alert-tasks")
def usage_alert_tasks(
    ids: str = typer.Option("", "--ids", help="逗号分隔告警 ID；空则全部"),
    apply: bool = typer.Option(False, "--apply", help="实际创建治理任务；默认预览"),
    priority: str = typer.Option("P1", "--priority", help="任务优先级"),
    assigned_to: str = typer.Option("FinOps", "--assigned-to", help="负责人"),
    dev_tool: str = typer.Option("copilot", "--dev-tool", help="推荐工具"),
) -> None:
    try:
        body = {
            "ids": [x.strip() for x in ids.split(",") if x.strip()],
            "dry_run": not apply,
            "priority": priority,
            "assigned_to": assigned_to,
            "dev_tool": dev_tool,
        }
        console.print_json(data=get_client(get_config()).usage_alert_tasks(body))
    except Exception as e:
        warn(str(e))


@app.command("intelligence-hub")
def intelligence_hub() -> None:
    try:
        console.print_json(data=get_client(get_config()).intelligence_hub())
    except Exception as e:
        warn(str(e))


@app.command("health")
def health(
    strict: bool = typer.Option(False, "--strict", help="任一 FAIL 则返回非零"),
    port: int = typer.Option(8765, "--port", help="Manager 端口"),
) -> None:
    """运行 ai-sop-ops/health-check.sh。"""
    script = _script("ai-sop-ops", "health-check.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    _run_script(
        ["bash", str(script)],
        extra_env={"PORT": str(port), "HEALTH_CHECK_STRICT": "1" if strict else "0"},
    )


@app.command("stack")
def stack(
    action: str = typer.Argument("status", help="start|stop|status|doctor"),
    agentd: bool = typer.Option(False, "--agentd", help="stack start 时同时启动 agentd"),
    port: int = typer.Option(8765, "--port", help="Manager 端口"),
) -> None:
    """本地开发栈管理，封装 scripts/stack.sh。"""
    script = _script("scripts", "stack.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    args = ["bash", str(script), action, "--port", str(port), "--project-path", str(get_config().project_path)]
    if agentd:
        args.append("--agentd")
    _run_script(args)


@app.command("deploy")
def deploy(
    action: str = typer.Argument("print", help="print|up|down|logs|ps"),
    mode: str = typer.Option("single", "--mode", help="single|saas"),
    port: int = typer.Option(8765, "--port", help="宿主机端口"),
    project_path: str = typer.Option("", "--project-path", help="挂载到容器的工程目录"),
) -> None:
    """Docker 部署封装，支持 single/saas profile。"""
    script = _script("scripts", "deploy.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    pp = Path(project_path).expanduser().resolve() if project_path else get_config().project_path
    _run_script(
        ["bash", str(script), action, mode],
        project_path=pp,
        extra_env={"PORT": str(port), "PROJECT_PATH": str(pp)},
    )


@app.command("snapshot")
def snapshot(project_path: str = typer.Option("", "--project-path", help="要导出快照的工程目录")) -> None:
    """导出记忆/向量快照到 memory/snapshots。"""
    script = _script("ai-sop-ops", "snapshot.sh")
    if not script.is_file():
        err(f"缺少 {script}")
        raise typer.Exit(1)
    pp = Path(project_path).expanduser().resolve() if project_path else get_config().project_path
    _run_script(["bash", str(script)], project_path=pp)


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    console.print("[dim]子命令：health | stack | deploy | snapshot | notify-* | sync-pull/modules/summary | worker-health/types/jobs/enqueue/cancel/retry | usage-alerts/usage-alert-tasks | intelligence-hub[/dim]")
