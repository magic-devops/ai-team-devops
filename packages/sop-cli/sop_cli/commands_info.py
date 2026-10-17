"""sop CLI 命令树（供 `sop commands` 与补全文档生成）。"""
from __future__ import annotations

from typing import TypedDict

from rich import box
from rich.panel import Panel
from rich.table import Table


class CmdEntry(TypedDict, total=False):
    help: str
    subs: dict[str, str]


# 顶层与子命令说明（与 __main__.py add_typer 保持同步）
COMMAND_TREE: dict[str, CmdEntry] = {
    "delivery": {"help": "项目交付与执行验收", "subs": {"workspace": "业务快照", "inbox": "个人/团队交付待办（--scope mine|team，--json）", "progress": "真实进度历史与基线比较（--from/--to/--scope/--baseline/--json）", "observation": "历史任务观测（ID，--scope，--json）", "baseline": "不可变计划与当前范围变化（ID，--json）", "targets": "执行目标", "preview": "任务计划预览（--file JSON，显式 generator）", "command": "版本与幂等命令（--file JSON）"}},
    "help": {"help": "帮助总览/命令摘要", "subs": {"--examples": "附带示例", "--group": "按场景过滤示例"}},
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
    "data": {
        "help": "数据智能平台蓝图",
        "subs": {
            "blueprint": "查询数据智能蓝图",
            "tasks": "将能力缺口任务化",
            "assets": "数据资产目录",
            "metrics": "指标中心目录",
            "nlq": "自然语言指标问数",
            "tags": "标签服务目录",
            "quality": "数据质量规则/评估",
            "governance-tasks": "数据治理任务化",
            "services": "数据服务目录",
            "publish-service": "发布/暂停数据服务",
            "alerts": "数据质量告警",
            "alert-tasks": "质量告警任务化",
            "dev-templates": "数据开发模板目录",
            "dev-tasks": "数据开发模板任务化",
            "dev-schedule": "数据开发智能调度计划",
            "dev-ops": "数据开发运营汇总",
            "dev-runbook": "数据开发自动化 Runbook",
            "dev-schedules": "数据开发调度历史",
            "dev-schedule-action": "数据开发调度治理动作",
            "dev-feed": "数据开发 Agent Feed",
            "dev-packet-action": "数据开发 Packet 执行动作",
            "dev-evidence": "数据开发质量证据",
            "dev-evidence-tasks": "数据开发质量证据任务化",
            "dev-evidence-notify": "数据开发质量证据通知",
        },
    },
    "dev-flow": {
        "help": "研发全流程",
        "subs": {"ops-plan": "研发流程治理计划", "ops-tasks": "治理任务化", "lifecycle": "需求、TDD、Agent、Graph Loop、质量和记忆闭环"},
    },
    "system": {
        "help": "系统全域 readiness",
        "subs": {"readiness": "后端、前端、CLI、SDK、权限、页面、scope、脚本与部署包检查"},
    },
    "graph-loop": {
        "help": "Graph Loop 控制面",
        "subs": {"summary": "图与运行摘要", "runs": "运行台账", "plan": "生成计划", "run": "创建运行", "action": "运行状态切换"},
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
            "notify-connectors": "通信连接器矩阵",
            "notify-channels": "通知渠道",
            "notify-callback": "连接器回调模板",
            "notify-verify": "连接器签名生成/校验",
            "notify-test": "测试通知",
            "sync-pull": "拉取同步",
            "worker-health": "Worker 健康",
        },
    },
    "pages": {
        "help": "页面菜单、模块 Manifest 与能力码",
        "subs": {
            "list": "页面/菜单注册表",
            "manifest": "模块 Manifest",
            "capabilities": "页面能力码与 AI surfaces",
            "health": "菜单健康分",
            "productize": "页面产品化矩阵",
            "isolation": "三码隔离审计",
            "isolation-scan": "源码隔离扫描",
            "isolation-scan-compare": "源码隔离智能基线对比",
            "isolation-scan-compare-tasks": "源码隔离对比任务化",
            "isolation-scan-run": "保存源码隔离扫描快照",
            "isolation-scan-runs": "源码隔离扫描快照历史",
            "isolation-scan-tasks": "源码隔离任务化",
            "isolation-tasks": "三码隔离任务化",
            "readiness": "模块完整度矩阵",
            "readiness-tasks": "模块完整度任务化",
            "governance-tasks": "模块治理任务运营",
            "governance-tasks-update": "模块治理任务批量处置",
            "menu-prefs": "当前用户菜单偏好",
        },
    },
    "platforms": {
        "help": "AI 平台接入",
        "subs": {"list": "列表", "init": "按 registry 初始化", "doctor": "自检", "install-shims": "安装 shim"},
    },
    "skills": {"help": "技能运行目录", "subs": {"runtime": "技能安装、版本、输入输出、权限与执行适配"}},
    "plugins": {"help": "插件治理", "subs": {"governance": "插件/MCP 可见性、工具白名单、审批、审计与失败恢复"}},
    "status": {"help": "本地 + Manager 状态概览", "subs": {"--json": "机器可读状态快照", "--out": "写入 JSON 文件"}},
    "agentd": {
        "help": "sop-agentd 守护进程",
        "subs": {"start": "启动", "stop": "停止", "status": "状态", "logs": "日志", "install": "launchd/systemd"},
    },
    "requirement": {
        "help": "需求（Manager + 本地离线队列）",
        "subs": {
            "list": "列表",
            "create": "创建",
            "parse-doc": "文档解析预览（显式 --generator，重试复用 --request-id）",
            "review": "规则/AI 评审预览；--apply-acceptance 明确采用",
            "prototype": "原型设计预览（wireframe/user_journey/ia）",
            "prototype-apply": "采用已编辑 JSON 设计文件，追加交付产物",
            "assistance-history": "生成来源、失败与采用历史",
            "ops-plan": "治理操作包",
            "ops-tasks": "治理任务化",
            "update": "更新",
            "delete": "删除",
        },
    },
    "workflow": {
        "help": "工作流运行与人工审查",
        "subs": {
            "start": "启动工作流（固定 --id，重试复用）",
            "detail": "阶段、审查结果和事件详情",
            "review": "代码审查结论（明确 --comment、--request-id）",
            "instances": "实例列表与状态筛选",
            "events": "按 --workflow-id 查询事件",
            "ops-plan": "运行治理计划",
            "ops-tasks": "治理任务预览；--apply 确认创建",
        },
    },
    "issue": {
        "help": "问题/缺陷（Manager + 本地离线队列）",
        "subs": {"list": "列表", "create": "创建", "update": "更新", "resolve": "解决", "delete": "删除"},
    },
    "task": {
        "help": "任务（Manager）",
        "subs": {
            "list": "列表",
            "show": "读取当前授权项目的任务详情",
            "schedule": "DAG 调度计划",
            "feed": "AI/CLI 任务包",
            "report": "Agent 回写",
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

QUICK_START_GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
    (
        "接入与登录",
        [
            ("sop init my-app --manager http://localhost:8765", "初始化项目"),
            (
                "sop register my-app --manager http://localhost:8765 --username admin",
                "注册到 Manager",
            ),
            ("sop login -u admin", "账号登录；配对登录用 sop login --pair"),
        ],
    ),
    (
        "健康与上下文",
        [
            ("sop agentd start && sop doctor", "启动守护进程并自检"),
            ("sop status --json", "给 CLI/IDE/Agent 的机器可读健康快照"),
            ("sop context manifest --write", "生成机器可读接入清单"),
            ("sop context env --out .sop-runtime/sop.env", "导出 SOP_* 环境变量模板"),
            ("sop context prepare --flush", "刷新上下文、远端配置并冲刷 outbox"),
            ("sop platforms init all", "生成各 CLI/IDE/Agent 接入配置"),
            ("sop pages capabilities --json", "让 Agent 读取菜单、能力码与 AI surfaces"),
        ],
    ),
    (
        "同步",
        [
            ("sop sync", "经 agentd 同步；失败可用 sop sync --direct"),
            ("sop sync doctor", "本地同步自检"),
            ("sop sync repair --dry-run", "预览队列修复"),
            ("sop sync compact", "压缩离线队列，减少重复上送"),
            ("sop sync flush", "不依赖 agentd，直连冲刷离线队列"),
            ("sop sync pull --direct --materialize", "直连拉取并物化远端实体"),
            ("sop sync watch --once", "扫描规则/规约/模板变更并写入队列"),
        ],
    ),
    (
        "交付工作台",
        [
            ("sop requirement parse-doc --file prd.md --generator ai --request-id intake-preview-001 --json", "模型解析预览；重试复用请求标识，编辑选择后再导入"),
            ("sop requirement parse-doc --file prd.md --generator rules --request-id intake-rules-001 --json", "明确选择本地规则，不调用模型"),
            ("sop requirement review REQ-EXAMPLE --generator ai --request-id review-preview-001 --json", "AI 评审预览；确认建议后才使用 --apply-acceptance"),
            ("sop requirement prototype REQ-EXAMPLE --mode wireframe --generator ai --request-id prototype-preview-001 --json", "原型预览；保留生成 ID、基准和版本，编辑采用 JSON 文件"),
            ("sop requirement prototype-apply REQ-EXAMPLE --file prototype-adoption.json --json", "确认已编辑设计文件，追加交付产物"),
            ("sop requirement assistance-history REQ-EXAMPLE --json", "查看建议的来源、失败和采用记录"),
            ("sop workflow start code_review --id review-example-001 --args '{}' --json", "启动固定 ID 的审查；传入真实 diff 后审查，缺少 diff 不会自动通过"),
            ("sop workflow detail review-example-001 --json", "先核对真实阶段、自动审查结果和权限"),
            ('sop workflow review review-example-001 --decision request_changes --comment "缺少测试证据，请补齐后重新审查" --request-id review-decision-001 --json', "明确提交人工意见；重试保持相同 ID、结论和意见"),
            ('sop requirement create "统一项目注册流程" --priority P1', "创建需求"),
            ('sop issue create "登录回调异常" --severity P1', "创建问题"),
            ('sop sprint create "MVP 闭环" --points 20', "创建迭代"),
            ("sop task list --status pending", "查看待处理任务"),
            ("sop task schedule --json", "生成 AI/CLI 可消费 DAG 调度计划"),
            ("sop task feed --json", "Agent 自动拉取下一批任务包"),
            ("sop work next --local", "查看下一批建议处理项"),
            ("sop work export --local", "导出工作台快照"),
        ],
    ),
    (
        "知识、记忆与规则",
        [
            ('sop memory add "项目采用本地优先、远端增强" --local', "写入本地记忆"),
            ('sop memory search "本地优先" --local', "检索本地记忆"),
            ("sop memory flush", "冲刷记忆 outbox"),
            (
                'sop kb add "项目接入规范" "CLI/Agent 读取 .sop-runtime/sop.env 接入。" --local',
                "写入知识库",
            ),
            ("sop kb flush", "冲刷知识库 outbox"),
            (
                'sop rule propose "所有 CLI/Agent 先读取 .sop-runtime/sop.env" --local',
                "提交规则提案",
            ),
            ("sop rule list --local --proposals", "查看本地规则提案"),
        ],
    ),
    (
        "AI、事件与用量",
        [
            ('sop copilot ask "下一步该做什么？" --remember', "带记忆提问"),
            ("sop copilot sessions", "查看会话"),
            ("sop event emit sop.agent.run.completed --data run_id=demo", "上报事件"),
            ("sop event subscribe --json", "订阅 Manager 实时事件"),
            ("sop usage summary --json", "查看用量汇总"),
            ("sop usage check llm_tokens 1000", "配额预检查"),
            ("sop data blueprint --json", "查看数据智能平台蓝图与能力缺口"),
            ("sop data assets --json", "查看数据资产目录与质量得分"),
            ('sop data nlq "当前阻塞任务有多少？" --json', "执行自然语言指标问数"),
            ("sop data services --json", "查看数据服务目录与发布健康"),
            ("sop data dev-templates --json", "查看数据开发模板"),
            ("sop data alerts --json", "查看数据质量与服务健康告警"),
            ("sop data quality --json", "执行数据质量评估"),
            ("sop data tasks --json", "预览数据平台增强任务"),
            ("sop db-config drivers --json", "查看数据源驱动模板"),
            ("sop db-config list --json", "查看远端数据源配置"),
        ],
    ),
    (
        "补全",
        [
            ("sop completion install bash", "持久安装；也支持 zsh / fish"),
            ('eval "$(sop completion show bash)"', "当前会话临时启用"),
        ],
    ),
]

QUICK_START_GROUP_NAMES = [name for name, _rows in QUICK_START_GROUPS]

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
  sop requirement parse-doc --file prd.md --generator ai --request-id intake-preview-001 --json
  sop requirement review REQ-EXAMPLE --generator rules --request-id review-preview-001 --json
  sop requirement prototype REQ-EXAMPLE --generator ai --mode wireframe --request-id prototype-preview-001 --json
  sop requirement prototype-apply REQ-EXAMPLE --file prototype-adoption.json --json  # 先编辑并核对采用文件
  sop requirement assistance-history REQ-EXAMPLE --json
  sop workflow start code_review --id review-example-001 --args '{}' --json
  sop workflow detail review-example-001 --json
  sop workflow review review-example-001 --decision request_changes --comment "缺少测试证据，请补齐后重新审查" --request-id review-decision-001 --json
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

SHORT_HELP_EPILOG = """
常用: sop help | sop commands --examples | sop doctor | sop status --json
提示: 子命令帮助用 sop <command> --help，例如 sop sync --help
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


def command_tree_table() -> Table:
    table = Table(
        title="sop 子命令",
        box=box.SIMPLE_HEAVY,
        show_lines=False,
        expand=True,
        padding=(0, 1),
    )
    table.add_column("命令", style="bold cyan", no_wrap=True, width=12)
    table.add_column("说明", ratio=3)
    table.add_column("常用子命令 / 选项", style="dim", ratio=4)
    for name, meta in COMMAND_TREE.items():
        subs = meta.get("subs") or {}
        table.add_row(name, meta.get("help", ""), ", ".join(subs.keys()))
    return table


def quick_start_panels(group: str | None = None) -> list[Panel]:
    panels: list[Panel] = []
    for title, rows in QUICK_START_GROUPS:
        if group and group not in title and group != title:
            continue
        table = Table(
            box=box.SIMPLE,
            show_header=True,
            expand=True,
            padding=(0, 1),
        )
        table.add_column("命令", style="cyan", overflow="fold", ratio=5)
        table.add_column("用途", overflow="fold", ratio=3)
        for command, purpose in rows:
            table.add_row(command, purpose)
        panels.append(Panel(table, title=title, border_style="green"))
    return panels


def command_detail_panel(name: str) -> Panel:
    meta = COMMAND_TREE[name]
    subs = meta.get("subs") or {}
    table = Table(box=box.SIMPLE, show_header=False, expand=True, padding=(0, 1))
    table.add_column("字段", style="bold cyan", no_wrap=True, width=12)
    table.add_column("内容", overflow="fold")
    table.add_row("命令", f"sop {name}")
    table.add_row("说明", meta.get("help", ""))
    if subs:
        table.add_row("子命令/选项", ", ".join(subs.keys()))
    table.add_row("帮助", f"sop {name} --help")
    return Panel(table, title=f"sop {name}", border_style="cyan")
