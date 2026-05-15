"""sop CLI 命令树（供 `sop commands` 与补全文档生成）。"""
from __future__ import annotations

from typing import TypedDict


class CmdEntry(TypedDict, total=False):
    help: str
    subs: dict[str, str]


# 顶层与子命令说明（与 __main__.py add_typer 保持同步）
COMMAND_TREE: dict[str, CmdEntry] = {
    "init": {"help": "初始化项目（memory / .ai-memory / agent.toml）"},
    "register": {
        "help": "一键注册工程到 Manager",
        "subs": {"--code": "使用配对码", "--username": "登录后自动生成配对码", "--no-init": "跳过初始化"},
    },
    "login": {
        "help": "Bearer 登录或 OAuth 配对",
        "subs": {"--pair": "配对流程（浏览器 code）", "--username": "密码登录"},
    },
    "context": {
        "help": "三码上下文",
        "subs": {
            "show": "可读摘要",
            "json": "JSON 输出",
            "services": "远端能力探测",
            "manifest": "项目接入清单",
            "env": "CLI/Agent 环境变量",
            "prepare": "准备 Agent 上下文包",
        },
    },
    "memory": {
        "help": "v4 记忆",
        "subs": {
            "health": "健康",
            "recent": "最近",
            "search": "搜索",
            "add": "写入",
            "forget": "遗忘",
            "summarize": "摘要",
            "attach-run": "关联运行",
            "flush": "冲刷本地记忆 outbox",
        },
    },
    "kb": {
        "help": "知识库",
        "subs": {"search": "检索", "rag": "RAG", "add": "添加", "flush": "冲刷本地 kb outbox", "index": "索引", "job": "任务"},
    },
    "copilot": {
        "help": "AI Copilot",
        "subs": {"ask": "提问", "sessions": "会话列表", "show": "查看会话", "classify": "分类", "summarize": "摘要", "suggest": "建议"},
    },
    "db-config": {
        "help": "远端数据库配置",
        "subs": {"drivers": "驱动/能力模板", "list": "列表", "add": "新增/更新", "test": "测试连接", "delete": "删除", "export": "导出无密钥配置"},
    },
    "ops": {
        "help": "运维辅助",
        "subs": {
            "health": "健康检查",
            "stack": "本地栈",
            "deploy": "Docker 部署",
            "snapshot": "记忆快照",
            "notify-channels": "通知渠道",
            "notify-test": "测试通知",
            "sync-pull": "拉取同步",
            "worker-health": "Worker 健康",
        },
    },
    "platforms": {
        "help": "AI 平台接入",
        "subs": {"list": "列表", "init": "按 registry 初始化", "doctor": "自检", "install-shims": "安装 shim"},
    },
    "status": {"help": "本地 + Manager 状态概览", "subs": {"--json": "机器可读状态快照", "--out": "写入 JSON 文件"}},
    "agentd": {
        "help": "sop-agentd 守护进程",
        "subs": {"start": "启动", "stop": "停止", "status": "状态", "logs": "日志", "install": "launchd/systemd"},
    },
    "requirement": {
        "help": "需求（Manager + 本地离线队列）",
        "subs": {"list": "列表", "create": "创建", "update": "更新", "delete": "删除"},
    },
    "issue": {
        "help": "问题/缺陷（Manager + 本地离线队列）",
        "subs": {"list": "列表", "create": "创建", "update": "更新", "resolve": "解决", "delete": "删除"},
    },
    "task": {
        "help": "任务（Manager）",
        "subs": {
            "list": "列表",
            "create": "创建",
            "update": "更新",
            "pull": "认领",
            "done": "完成",
            "fail": "阻塞",
            "delete": "删除",
            "issue": "上报 issue",
        },
    },
    "sprint": {
        "help": "迭代（Manager + 本地离线队列）",
        "subs": {
            "list": "列表",
            "create": "创建",
            "update": "更新",
            "complete": "完成",
            "progress": "进度",
            "delete": "删除",
        },
    },
    "work": {
        "help": "工作台聚合视图",
        "subs": {"summary": "总览", "list": "列表", "next": "下一批建议处理项", "export": "导出机器可读快照"},
    },
    "event": {
        "help": "CloudEvent 事件上报与查询",
        "subs": {
            "emit": "上报事件",
            "flush": "冲刷本地事件 outbox",
            "list": "查询事件流水",
            "subscribe": "订阅 WSS 实时事件",
        },
    },
    "usage": {
        "help": "用量计量与配额",
        "subs": {
            "record": "记录用量",
            "flush": "冲刷本地 usage outbox",
            "summary": "用量汇总",
            "quota": "查看/设置配额",
            "check": "配额预检查",
        },
    },
    "rule": {"help": "规则", "subs": {"list": "列表", "propose": "提议", "apply": "应用本地提案", "flush": "推送 RULES.md"}},
    "sync": {
        "help": "双向同步",
        "subs": {
            "pull": "拉取/物化",
            "push": "推送",
            "enqueue": "离线入队",
            "push-file": "推送文件",
            "enqueue-file": "文件离线入队",
            "watch": "监听规则/规约/模板文件并入队",
            "flush": "冲刷本地队列",
            "compact": "压缩本地队列",
            "doctor": "本地同步自检",
            "repair": "修复本地队列",
            "status": "本地游标/队列",
        },
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
  sop register my-app --manager http://localhost:8765 --username admin
  sop login -u admin              # 或 sop login --pair
  sop agentd start && sop doctor
  sop status --json              # 给 CLI/IDE/Agent 的机器可读健康快照
  sop sync                        # 经 agentd；失败可 sop sync --direct
  sop sync doctor                 # 本地同步自检
  sop sync repair --dry-run       # 预览队列修复
  sop sync compact                # 压缩离线队列，减少重复上送
  sop sync flush                  # 不依赖 agentd，直连冲刷离线队列
  sop sync pull --direct --materialize
  sop sync watch --once           # 扫描规则/规约/模板变更并写入队列
  sop context manifest --write    # 给各 CLI/Agent 生成机器可读接入清单
  sop context env --out .sop-runtime/sop.env
  sop context prepare --flush     # 刷新上下文、远端 DB 配置并冲刷 sync/memory/kb/event/usage outbox
  sop platforms init all          # 生成各 CLI/IDE/Agent 接入配置
  sop requirement create "统一项目注册流程" --priority P1
  sop issue create "登录回调异常" --severity P1
  sop sprint create "MVP 闭环" --points 20
  sop work next --local
  sop work export --local          # 给 CLI/IDE/Agent 导出工作台快照
  sop memory add "项目采用本地优先、远端增强" --local
  sop memory search "本地优先" --local
  sop memory flush
  sop kb add "项目接入规范" "CLI/Agent 读取 .sop-runtime/sop.env 接入。" --local
  sop kb flush
  sop rule propose "所有 CLI/Agent 先读取 .sop-runtime/sop.env" --local
  sop rule list --local --proposals
  sop copilot ask "下一步该做什么？" --remember
  sop copilot sessions
  sop event emit sop.agent.run.completed --data run_id=demo
  sop event subscribe --json       # 订阅 Manager 实时事件
  sop usage summary --json
  sop usage check llm_tokens 1000
  sop db-config drivers --json     # 查看支持的 SQL/向量/多模数据源模板
  sop db-config list --json        # 查看 OceanBase/PG/MySQL 等远端数据源配置
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
