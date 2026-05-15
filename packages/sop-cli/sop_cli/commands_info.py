"""sop CLI 命令树（供 `sop commands` 与补全文档生成）。"""
from __future__ import annotations

from typing import TypedDict


class CmdEntry(TypedDict, total=False):
    help: str
    subs: dict[str, str]


# 顶层与子命令说明（与 __main__.py add_typer 保持同步）
COMMAND_TREE: dict[str, CmdEntry] = {
    "init": {"help": "初始化项目（memory / .ai-memory / agent.toml）"},
    "login": {
        "help": "Bearer 登录或 OAuth 配对",
        "subs": {"--pair": "配对流程（浏览器 code）", "--username": "密码登录"},
    },
    "context": {"help": "三码上下文", "subs": {"show": "可读摘要", "json": "JSON 输出"}},
    "memory": {
        "help": "v4 记忆",
        "subs": {"health": "健康", "recent": "最近", "search": "搜索", "add": "写入"},
    },
    "kb": {
        "help": "知识库",
        "subs": {"search": "检索", "rag": "RAG", "add": "添加", "index": "索引", "job": "任务"},
    },
    "copilot": {
        "help": "AI Copilot",
        "subs": {"ask": "提问", "classify": "分类", "summarize": "摘要", "suggest": "建议"},
    },
    "ops": {
        "help": "运维辅助",
        "subs": {
            "notify-channels": "通知渠道",
            "notify-test": "测试通知",
            "sync-pull": "拉取同步",
            "worker-health": "Worker 健康",
        },
    },
    "platforms": {
        "help": "AI 平台 shim",
        "subs": {"list": "列表", "doctor": "自检", "install-shims": "安装 shim"},
    },
    "status": {"help": "本地 + Manager 状态概览"},
    "agentd": {
        "help": "sop-agentd 守护进程",
        "subs": {"start": "启动", "stop": "停止", "status": "状态", "logs": "日志", "install": "launchd/systemd"},
    },
    "task": {
        "help": "任务（Manager）",
        "subs": {"list": "列表", "pull": "认领", "done": "完成", "fail": "阻塞", "issue": "上报 issue"},
    },
    "rule": {"help": "规则", "subs": {"list": "列表", "propose": "提议"}},
    "sync": {
        "help": "双向同步",
        "subs": {"pull": "拉取", "push": "推送", "status": "本地游标/队列"},
    },
    "doctor": {"help": "端到端自检"},
    "llm": {"help": "LLM Gateway", "subs": {"chat": "对话", "embed": "嵌入", "search": "检索"}},
    "commands": {"help": "列出全部子命令（本命令）"},
    "completion": {
        "help": "Shell 补全",
        "subs": {"install": "安装", "show": "打印脚本", "doctor": "检查是否生效"},
    },
}

QUICK_START = """
[b]常用流程[/b]
  sop init my-app --manager http://localhost:8765
  sop login -u admin              # 或 sop login --pair
  sop agentd start && sop doctor
  sop sync                        # 经 agentd；失败可 sop sync --direct
  sop task list --status pending

[b]补全[/b]
  sop completion install bash     # 或 zsh / fish
  eval "$(sop completion show bash)"
"""


def format_command_tree(*, as_json: bool = False) -> str | dict:
    if as_json:
        return {"commands": COMMAND_TREE}
    lines: list[str] = []
    for name, meta in COMMAND_TREE.items():
        subs = meta.get("subs") or {}
        sub_s = f"  ({', '.join(subs)})" if subs else ""
        lines.append(f"  {name:<12} {meta.get('help', '')}{sub_s}")
    return "\n".join(lines)
