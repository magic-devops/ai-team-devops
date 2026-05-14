#!/usr/bin/env bash
# init-ai-project.sh
# 快速初始化 / 重新初始化 AI 辅助开发项目（当前工作目录为项目根）
#
# 用法:
#   bash sop/tools/init-ai-project.sh [init] <project-name>
#   bash sop/tools/init-ai-project.sh reinit [project-name] [选项]
#
# 命令:
#   init (默认)  创建 memory/、.ai-memory/、多工具规则与配置
#   reinit       备份（默认）后清空记忆与相关配置，再执行完整 init
#
# 选项（reinit 或 init 均可放在参数任意顺序，init 时仅 --help / 项目名有意义）:
#   -y, --yes            reinit 时跳过交互确认
#   --no-backup          reinit 时不生成备份包（不推荐）
#   --keep-claude-md     reinit 时不覆盖已有 CLAUDE.md
#   -h, --help           显示帮助

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="init"
PROJECT_NAME=""
REINIT_YES=0
REINIT_NO_BACKUP=0
KEEP_CLAUDE_MD=0

usage() {
  cat >&2 << 'EOF'
init-ai-project.sh — 初始化 / 重新初始化 AI 辅助开发项目（在项目根目录执行）

用法:
  bash sop/tools/init-ai-project.sh [init] <project-name>
  bash sop/tools/init-ai-project.sh reinit [project-name] [选项]

命令:
  init (默认)  创建 memory/、.ai-memory/、多工具规则与配置
  reinit       默认先打 tar 备份，再删除记忆与相关配置，然后完整 init

选项:
  -y, --yes            reinit 时跳过交互确认（CI / 非 TTY 必填）
  --no-backup          reinit 时不生成备份包（不推荐）
  --keep-claude-md     reinit 后保留已有 CLAUDE.md（不删除、不覆盖）
  -h, --help           显示本帮助

说明:
  reinit 会删除 memory/、.ai-memory/ 及工具配置文件后重建；sop/custom/ 下已有文件不删除。
  未写项目名且存在 memory/current_state.json 时，reinit 会尝试读取其中的 project_id。
EOF
}

log() {
  printf '%s\n' "$*" >&2
}

step() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >&2
}

die() {
  log "错误: $*"
  exit 1
}

resolve_project_name() {
  if [ -n "${PROJECT_NAME}" ]; then
    return 0
  fi
  if [ "${ACTION}" = "reinit" ] && [ -f memory/current_state.json ]; then
    if command -v python3 >/dev/null 2>&1; then
      local pid
      pid="$(python3 -c "import json; print(json.load(open('memory/current_state.json')).get('project_id') or '')" 2>/dev/null || true)"
      if [ -n "${pid}" ]; then
        PROJECT_NAME="${pid}"
        step "未指定项目名，从 memory/current_state.json 读取 project_id: ${PROJECT_NAME}"
        return 0
      fi
    fi
  fi
  PROJECT_NAME="my-project"
  step "未指定项目名，使用默认: ${PROJECT_NAME}"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      reinit)
        ACTION="reinit"
        shift
        ;;
      init)
        ACTION="init"
        shift
        ;;
      -y | --yes)
        REINIT_YES=1
        shift
        ;;
      --no-backup)
        REINIT_NO_BACKUP=1
        shift
        ;;
      --keep-claude-md)
        KEEP_CLAUDE_MD=1
        shift
        ;;
      -*)
        die "未知选项: $1（见 --help）"
        ;;
      *)
        if [ -n "${PROJECT_NAME}" ]; then
          die "多余参数: $1"
        fi
        PROJECT_NAME="$1"
        shift
        ;;
    esac
  done
}

backup_before_reinit() {
  local ts backup_dir tarball n
  ts="$(date '+%Y%m%d-%H%M%S')"
  local rt="${SOP_RUNTIME_DIR:-${PWD}/.sop-runtime}"
  backup_dir="${rt}/reinit-backups"
  tarball="${backup_dir}/reinit-${ts}.tar.gz"
  mkdir -p "${backup_dir}"

  local paths
  paths=()
  [ -d memory ] && paths+=(memory)
  [ -d .ai-memory ] && paths+=(.ai-memory)
  [ -d "${rt}/ai-memory" ] && paths+=("${rt}/ai-memory")
  [ -f .claude/settings.json ] && paths+=(.claude/settings.json)
  [ -f .codex/config.toml ] && paths+=(.codex/config.toml)
  [ -f .codex/hooks.json ] && paths+=(.codex/hooks.json)
  [ -f .codex/hooks/sop_hook.py ] && paths+=(.codex/hooks/sop_hook.py)
  [ -f opencode.json ] && paths+=(opencode.json)
  [ -f .cursorrules ] && paths+=(.cursorrules)
  [ -f .windsurfrules ] && paths+=(.windsurfrules)
  [ -f .trae/rules.md ] && paths+=(.trae/rules.md)
  [ -f .qoder/context.md ] && paths+=(.qoder/context.md)
  [ -f CLAUDE.md ] && paths+=(CLAUDE.md)
  [ -f AGENTS.md ] && paths+=(AGENTS.md)

  n="${#paths[@]}"
  if [ "${n}" -eq 0 ]; then
    step "备份: 无可备份路径（可能是全新目录），跳过打包"
    return 0
  fi

  tar czf "${tarball}" "${paths[@]}"
  step "备份已写入: ${tarball}（共 ${n} 项）"
}

clean_for_reinit() {
  local rt="${SOP_RUNTIME_DIR:-${PWD}/.sop-runtime}"
  step "清理: 删除 memory/、.ai-memory/ 与运行时目录 .sop-runtime/ …"
  rm -rf memory .ai-memory "${rt}" .ai-reinit-backups

  step "清理: 覆盖工具配置（.claude、opencode、各 IDE 规则）…"
  rm -f opencode.json .cursorrules .windsurfrules
  rm -f .trae/rules.md .qoder/context.md
  rm -f .claude/settings.json
  rm -f .codex/config.toml .codex/hooks.json .codex/hooks/sop_hook.py

  if [ "${KEEP_CLAUDE_MD}" -eq 0 ]; then
    rm -f CLAUDE.md
    step "已移除 CLAUDE.md（将按模板重建）"
  else
    step "保留现有 CLAUDE.md（--keep-claude-md）"
  fi
}

write_agents_md() {
  if [ -f AGENTS.md ]; then
    step "跳过 AGENTS.md（已存在，init/reinit 不覆盖）"
    return 0
  fi
  cat > AGENTS.md << EOF
# ${PROJECT_NAME}

## AI 开发规约

本项目使用 sop 规约体系，Codex CLI / Codex IDE / Codex App 启动时优先读取本文件。

### 启动检查清单

1. 读取 \`memory/current_state.json\` 了解当前状态
2. 读取 \`.ai-memory/rules/RULES.md\` 加载项目规则
3. 确认当前阶段和待处理任务

### 核心原则

- 最小化：只写解决问题所需的最少代码
- 状态外化：进度持久化到 memory/ 目录
- 可追溯：commit 格式 \`type(scope): desc [T-id]\`
- 安全优先：用户输入必须验证，禁止硬编码密钥
- Hook 可审计：Codex hooks 只做校验、审计和状态同步；涉及外部网络或写入高风险路径必须人工确认

### 技术栈

（在此填写项目技术栈）

### 构建命令

\`\`\`bash
# 构建
# npm run build

# 测试
# npm test

# 代码检查
# npm run lint
\`\`\`
EOF
}

write_codex_config() {
  mkdir -p .codex/hooks
  cat > .codex/config.toml << 'EOF'
model = "gpt-5.5"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[features]
hooks = true
codex_hooks = true

[sandbox_workspace_write]
network_access = false
EOF

  cat > .codex/hooks.json << 'EOF'
{
  "description": "sop project hooks for Codex CLI: startup context, guarded tool use, audit log, and state persistence.",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" SessionStart",
            "timeout": 10,
            "statusMessage": "Loading sop context"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" UserPromptSubmit",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|apply_patch|Edit|Write|run_terminal_cmd|Patch|Shell|shell",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" PreToolUse",
            "timeout": 10,
            "statusMessage": "Checking sop guardrails"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "Bash|apply_patch|Edit|Write|run_terminal_cmd|Patch|Shell|shell",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" PermissionRequest",
            "timeout": 10,
            "statusMessage": "Checking approval policy"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|apply_patch|Edit|Write|run_terminal_cmd|Patch|Shell|shell",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" PostToolUse",
            "timeout": 10,
            "statusMessage": "Recording tool activity"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" Stop",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
EOF

  cat > .codex/hooks/sop_hook.py << 'EOF'
#!/usr/bin/env python3
"""Codex adapter shim for the central sop AI hook engine."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

event = sys.argv[1] if len(sys.argv) > 1 else ""
engine = Path(__file__).resolve().parents[2] / "sop" / "tools" / "sop_ai_hook.py"
sys.argv = [str(engine), "codex", event]
runpy.run_path(str(engine), run_name="__main__")
EOF
}

confirm_reinit() {
  if [ "${REINIT_YES}" -eq 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    die "reinit 在非交互终端需加 -y/--yes"
  fi
  log ""
  log "即将执行 reinit：会备份（除非 --no-backup）并删除 memory/、.ai-memory/ 及"
  log "  .claude/settings.json、opencode.json、.cursorrules 等，然后重新初始化。"
  log "项目名: ${PROJECT_NAME}"
  printf '确认继续？[y/N] ' >&2
  local ans
  read -r ans || true
  case "$(echo "${ans}" | tr '[:upper:]' '[:lower:]')" in
    y | yes) return 0 ;;
    *) die "已取消" ;;
  esac
}

write_current_state() {
  mkdir -p memory
  cat > memory/current_state.json << EOF
{
  "project_id": "${PROJECT_NAME}",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "phase": "INIT",
  "sprint": null,
  "tasks": {
    "completed": [],
    "in_progress": [],
    "blocked": [],
    "pending": []
  },
  "metrics": {
    "completion_rate": 0,
    "velocity": 0,
    "blockers_count": 0
  }
}
EOF
}

write_rules_md() {
  mkdir -p "${SOP_AI_MEM_ROOT}/rules"
  cat > "${SOP_AI_MEM_ROOT}/rules/RULES.md" << 'EOF'
# 项目规则库

AI 智能体每次启动时读取此文件，加载适用规则。

## 活跃规则

（项目运行过程中自动填充）

## 规则统计

- 总规则数: 0
- 活跃规则: 0
- 废弃规则: 0
EOF
}

write_ai_capability_registry() {
  mkdir -p "${SOP_AI_MEM_ROOT}"
  if [ -f "${SCRIPT_DIR}/AI_CAPABILITY_REGISTRY.json" ]; then
    cp "${SCRIPT_DIR}/AI_CAPABILITY_REGISTRY.json" "${SOP_AI_MEM_ROOT}/ai_capabilities.json"
  else
    cat > "${SOP_AI_MEM_ROOT}/ai_capabilities.json" << 'EOF'
{
  "version": "1.0",
  "control_plane": "sop",
  "capabilities": [],
  "adapters": {}
}
EOF
  fi
}

patch_gitignore() {
  if [ -f .gitignore ]; then
    if ! grep -q ".sop-runtime/" .gitignore; then
      echo "" >> .gitignore
      echo "# 管理后台 / 工具链运行时数据（SQLite、LanceDB、编排状态等）" >> .gitignore
      echo ".sop-runtime/" >> .gitignore
    fi
    if ! grep -q ".ai-memory/lancedb" .gitignore; then
      echo "" >> .gitignore
      echo "# AI 记忆系统（若未使用符号链接可忽略）" >> .gitignore
      echo ".ai-memory/lancedb/" >> .gitignore
    fi
    if ! grep -q ".ai-reinit-backups" .gitignore; then
      echo "" >> .gitignore
      echo "# 历史 reinit 备份目录（已迁移至 .sop-runtime/reinit-backups）" >> .gitignore
      echo ".ai-reinit-backups/" >> .gitignore
    fi
  else
    cat > .gitignore << 'EOF'
# 运行时统一目录
.sop-runtime/
# AI 记忆系统
.ai-memory/lancedb/
# 历史 reinit 备份
.ai-reinit-backups/
EOF
  fi
}

write_claude_settings() {
  mkdir -p .claude
  cat > .claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(npm run *)",
      "Bash(python *)",
      "Bash(pytest *)"
    ]
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ -f memory/current_state.json ] && python3 -c \"import json,sys; d=json.load(open('memory/current_state.json')); d['updated_at']=__import__('datetime').datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'); json.dump(d,open('memory/current_state.json','w'),indent=2)\" 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
EOF
}

write_claude_md() {
  if [ -f CLAUDE.md ] && [ "${ACTION}" != "reinit" ]; then
    step "跳过 CLAUDE.md（已存在，init 不覆盖）"
    return 0
  fi
  if [ -f CLAUDE.md ] && [ "${KEEP_CLAUDE_MD}" -eq 1 ]; then
    step "跳过 CLAUDE.md（--keep-claude-md）"
    return 0
  fi
  cat > CLAUDE.md << EOF
# ${PROJECT_NAME}

## AI 开发规约

本项目使用 sop 规约体系。

### 启动检查清单

1. 读取 \`memory/current_state.json\` 了解当前状态
2. 读取 \`.ai-memory/rules/RULES.md\` 加载项目规则
3. 确认当前阶段和待处理任务

### 核心原则

- 最小化：只写解决问题所需的最少代码
- 状态外化：进度持久化到 memory/ 目录
- 可追溯：commit 格式 \`type(scope): desc [T-id]\`
- 安全优先：用户输入必须验证，禁止硬编码密钥

### 技术栈

（在此填写项目技术栈）

### 构建命令

\`\`\`bash
# 构建
# npm run build

# 测试
# npm test

# 代码检查
# npm run lint
\`\`\`
EOF
}

init_lancedb_optional() {
  if ! command -v python3 >/dev/null 2>&1; then
    step "跳过 LanceDB（未找到 python3）"
    return 0
  fi
  export _LANCE_INIT_DIR="${SOP_AI_MEM_ROOT}/lancedb"
  python3 - << 'PYEOF'
import os
import sys
try:
    import lancedb
    import pyarrow as pa
    from datetime import datetime, timezone

    db = lancedb.connect(os.environ["_LANCE_INIT_DIR"])

    schemas = {
        "tasks": pa.schema([
            pa.field("id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("description", pa.string()),
            pa.field("status", pa.string()),
            pa.field("priority", pa.string()),
            pa.field("estimate", pa.string()),
            pa.field("depends_on", pa.list_(pa.string())),
            pa.field("created_at", pa.timestamp("us")),
            pa.field("updated_at", pa.timestamp("us")),
        ]),
        "incidents": pa.schema([
            pa.field("id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("description", pa.string()),
            pa.field("severity", pa.string()),
            pa.field("status", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
        ]),
        "decisions": pa.schema([
            pa.field("id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("context", pa.string()),
            pa.field("chosen", pa.string()),
            pa.field("rationale", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
        ]),
    }

    for name, schema in schemas.items():
        if name not in db.table_names():
            db.create_table(name, schema=schema)

    print("LanceDB 初始化完成")
except ImportError:
    print("提示：安装 lancedb 以启用向量记忆: pip install lancedb pyarrow")
PYEOF
}

write_tool_configs() {
  local RULES_CONTENT
  RULES_CONTENT="# AI 开发规约
包名: com.magic.${PROJECT_NAME}
时间字段: MySQL 用 gmt_created/gmt_modified，API 响应用 createdAt/updatedAt
失败时 <reflect> 分析换思路，最多重试3次，第3次失败上报
完成后说明置信度，< 0.70 时主动说明不确定点
禁止硬编码密钥
规范文档在 sop/ 目录，按需加载对应规范文件"

  cat > opencode.json << OEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-7",
  "providers": {
    "anthropic": { "apiKey": "\${ANTHROPIC_API_KEY}" }
  },
  "system": "读取 CLAUDE.md 了解项目规约。包名 com.magic.${PROJECT_NAME}。失败时 <reflect> 分析，最多重试3次。",
  "rules": [
    "memory/current_state.json 存在时，启动前先读取了解当前状态",
    "commit 格式: type(scope): desc [T-id]",
    "禁止硬编码密钥",
    "完成任务后输出置信度 0-1"
  ],
  "context": [
    { "type": "file", "path": "CLAUDE.md" },
    { "type": "file", "path": "memory/current_state.json", "optional": true }
  ]
}
OEOF

  echo "${RULES_CONTENT}" > .cursorrules
  echo "${RULES_CONTENT}" > .windsurfrules
  mkdir -p .trae && echo "${RULES_CONTENT}" > .trae/rules.md
  mkdir -p .qoder && echo "${RULES_CONTENT}" > .qoder/context.md
  mkdir -p sop/custom/{specs,examples,design,interaction,daily}
}

write_agent_toml() {
  # sop-agentd 守护进程配置（与 packages/sop-sdk-python/sop_sdk/config.py 字段一致）
  local target="${SOP_RUNTIME_DIR}/agent.toml"
  if [[ -f "${target}" ]]; then
    log "  保留已存在的 agent.toml（如需重置请手动删除：${target}）"
    return 0
  fi
  cat > "${target}" << ATOML
# @module: sop-agentd configuration
# @purpose: 项目侧 sop-agentd 与 Manager 通信配置
# @ai_safe_edit: 修改字段后重启 agentd；旧字段缺失给默认值

[manager]
url = "${MANAGER_URL:-http://localhost:8765}"
project_id = ""    # 由 \`sop login --pair\` 自动填充
tenant_id  = "${TENANT_ID:-t-default}"

[auth]
method = "apikey"
api_key_ref = "keyring://sop/manager"
verify_ssl = true

[transport]
ws = true
grpc = false
mcp_servers = ["lancedb", "knowledge", "tasks", "files"]
a2a_port = 7741

[reliability]
outbox_path = ".sop-runtime/outbox.sqlite"
batch_size = 50
max_retries = 6
dlq_path = ".sop-runtime/dlq/"
timeout_seconds = 30

[security]
nonce_window_seconds = 300
sign_body = true
ATOML
}

write_mcp_configs() {
  # 让 Claude Code / Codex 通过本地 sop-agentd 走 MCP（M9 完成时 agentd 内置全部 server）
  mkdir -p .claude .codex
  if [[ ! -f .claude/mcp.json ]]; then
    cat > .claude/mcp.json << 'MEOF'
{
  "mcpServers": {
    "sop.tasks": {
      "command": "python3",
      "args": ["sop/integrations/mcp/tasks_server.py"],
      "env": { "PROJECT_PATH": "." }
    },
    "sop.lancedb": {
      "command": "python3",
      "args": ["sop/integrations/mcp/lancedb_server.py"],
      "env": { "PROJECT_PATH": "." }
    },
    "sop.llm": {
      "command": "python3",
      "args": ["sop/integrations/mcp/llm_server.py"],
      "env": { "PROJECT_PATH": "." }
    }
  }
}
MEOF
  fi
  if [[ ! -f .codex/mcp.json ]]; then
    cat > .codex/mcp.json << 'MEOF'
{
  "mcpServers": {
    "sop.tasks":   { "command": "python3", "args": ["sop/integrations/mcp/tasks_server.py"] },
    "sop.lancedb": { "command": "python3", "args": ["sop/integrations/mcp/lancedb_server.py"] },
    "sop.llm":     { "command": "python3", "args": ["sop/integrations/mcp/llm_server.py"] }
  }
}
MEOF
  fi
}

run_init() {
  export SOP_RUNTIME_DIR="${SOP_RUNTIME_DIR:-${PWD}/.sop-runtime}"
  export SOP_AI_MEM_ROOT="${SOP_RUNTIME_DIR}/ai-memory"
  mkdir -p "${SOP_RUNTIME_DIR}/db" "${SOP_RUNTIME_DIR}/logs" "${SOP_AI_MEM_ROOT}"

  step "1/10 创建目录 ${SOP_AI_MEM_ROOT}、memory 子结构…"
  mkdir -p "${SOP_AI_MEM_ROOT}/"{lancedb,snapshots,rules/{coding,testing,security,workflow}}
  mkdir -p memory/{decisions,incidents,sprints}

  step "2/10 写入 memory/current_state.json…"
  write_current_state

  step "3/10 写入规则库 RULES.md…"
  write_rules_md

  step "4/10 写入统一 AI 能力注册表…"
  write_ai_capability_registry

  step "5/10 合并 .gitignore…"
  patch_gitignore

  step "6/10 写入 .claude/settings.json…"
  write_claude_settings

  step "7/10 写入 CLAUDE.md / AGENTS.md（若允许）…"
  write_claude_md
  write_agents_md

  step "8/10 写入 Codex CLI 配置与 hooks…"
  write_codex_config

  step "9/10 可选 LanceDB 初始化…"
  init_lancedb_optional

  step "10/12 写入 opencode / IDE 规则与 sop/custom…"
  write_tool_configs

  step "11/12 写入 sop-agentd 配置（.sop-runtime/agent.toml）…"
  write_agent_toml

  step "12/12 写入 .claude/.codex MCP 配置…"
  write_mcp_configs

  if [[ ! -e .ai-memory ]]; then
    rel="$(python3 -c "import os.path; print(os.path.relpath('${SOP_AI_MEM_ROOT}', os.getcwd()))")"
    ln -sfn "${rel}" .ai-memory 2>/dev/null || log "（未创建 .ai-memory 符号链接，可设置 SOP_RUNTIME_NO_SYMLINK 或 Windows 下忽略）"
  fi
}

# ── main ──────────────────────────────────────────────────────────

parse_args "$@"
resolve_project_name

log ""
log "══════════════════════════════════════════════════════════════"
log "  AI 项目初始化  |  动作: ${ACTION}  |  项目: ${PROJECT_NAME}"
log "  脚本目录: ${SCRIPT_DIR}  |  工作目录: $(pwd)"
log "══════════════════════════════════════════════════════════════"
log ""

if [ "${ACTION}" = "reinit" ]; then
  confirm_reinit
  if [ "${REINIT_NO_BACKUP}" -eq 0 ]; then
    step "reinit: 打包备份…"
    backup_before_reinit
  else
    step "reinit: 已跳过备份（--no-backup）"
  fi
  clean_for_reinit
fi

run_init

log ""
log "──────────────────────────────────────────────────────────────"
log "完成。目录与文件说明:"
log "  .sop-runtime/              - 统一运行时目录（SQLite、日志、ai-memory 等）"
log "  .ai-memory/ → 符号链接   - 指向 .sop-runtime/ai-memory（Unix；供 CLI 与文档路径）"
log "  memory/current_state.json  - 项目状态"
log "  CLAUDE.md                  - Claude Code 规约"
log "  AGENTS.md                  - Codex CLI / App 规约"
log "  .codex/config.toml         - Codex CLI 配置"
log "  .codex/hooks.json          - Codex hook 声明（需在 Codex 中审查信任）"
log "  opencode.json              - opencode 配置"
log "  .cursorrules               - Cursor 规则"
log "  .windsurfrules             - Windsurf 规则"
log "  .trae/rules.md             - Trae 规则"
log "  sop/custom/                - 自定义模块（reinit 不删除其中已有文件）"
log ""
log "reinit 备份目录: \${SOP_RUNTIME_DIR:-.sop-runtime}/reinit-backups/（若未使用 --no-backup）"
log ""
log "下一步:"
log "  1. 编辑 CLAUDE.md，填写项目技术栈和构建命令"
log "  2. （推荐）使用统一 CLI:"
log "       pip install -e packages/sop-sdk-python -e packages/sop-cli"
log "       sop doctor                              # 端到端自检"
log "       sop login --pair --manager <URL>        # 与 Manager 配对，自动填 project_id + API Key"
log "       sop agentd install && sop agentd start  # 装上 sop-agentd 守护进程"
log "  3. 启动 Manager Dashboard: bash sop/tools/start-manager.sh"
log "  4. 健康检查（传统方式）:  bash sop/tools/health-check.sh"
log ""
log "新版架构入口:"
log "  apps/manager        - SaaS 后端打包入口（独立部署）"
log "  apps/agent-runtime  - sop-agentd 守护进程（Go 单二进制）"
log "  packages/sop-cli    - 统一 CLI \`sop\`"
log "  packages/sop-sdk-python - 项目侧 Python SDK"
log "  apis/                - Schema-First 契约源（OpenAPI/Proto/AsyncAPI）"
log "  docs/architecture/   - 全套架构文档（OVERVIEW/MODULES/PROTOCOLS/...）"
log "──────────────────────────────────────────────────────────────"
