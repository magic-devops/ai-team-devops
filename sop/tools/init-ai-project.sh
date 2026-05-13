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
  backup_dir=".ai-reinit-backups"
  tarball="${backup_dir}/reinit-${ts}.tar.gz"
  mkdir -p "${backup_dir}"

  local paths
  paths=()
  [ -d memory ] && paths+=(memory)
  [ -d .ai-memory ] && paths+=(.ai-memory)
  [ -f .claude/settings.json ] && paths+=(.claude/settings.json)
  [ -f opencode.json ] && paths+=(opencode.json)
  [ -f .cursorrules ] && paths+=(.cursorrules)
  [ -f .windsurfrules ] && paths+=(.windsurfrules)
  [ -f .trae/rules.md ] && paths+=(.trae/rules.md)
  [ -f .qoder/context.md ] && paths+=(.qoder/context.md)
  [ -f CLAUDE.md ] && paths+=(CLAUDE.md)

  n="${#paths[@]}"
  if [ "${n}" -eq 0 ]; then
    step "备份: 无可备份路径（可能是全新目录），跳过打包"
    return 0
  fi

  tar czf "${tarball}" "${paths[@]}"
  step "备份已写入: ${tarball}（共 ${n} 项）"
}

clean_for_reinit() {
  step "清理: 删除 memory/ 与 .ai-memory/ …"
  rm -rf memory .ai-memory

  step "清理: 覆盖工具配置（.claude、opencode、各 IDE 规则）…"
  rm -f opencode.json .cursorrules .windsurfrules
  rm -f .trae/rules.md .qoder/context.md
  rm -f .claude/settings.json

  if [ "${KEEP_CLAUDE_MD}" -eq 0 ]; then
    rm -f CLAUDE.md
    step "已移除 CLAUDE.md（将按模板重建）"
  else
    step "保留现有 CLAUDE.md（--keep-claude-md）"
  fi
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
  mkdir -p .ai-memory/rules
  cat > .ai-memory/rules/RULES.md << 'EOF'
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

patch_gitignore() {
  if [ -f .gitignore ]; then
    if ! grep -q ".ai-memory/lancedb" .gitignore; then
      echo "" >> .gitignore
      echo "# AI 记忆系统" >> .gitignore
      echo ".ai-memory/lancedb/" >> .gitignore
    fi
    if ! grep -q ".ai-reinit-backups" .gitignore; then
      echo "" >> .gitignore
      echo "# init-ai-project.sh reinit 备份" >> .gitignore
      echo ".ai-reinit-backups/" >> .gitignore
    fi
  else
    cat > .gitignore << 'EOF'
# AI 记忆系统
.ai-memory/lancedb/
# init-ai-project.sh reinit 备份
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
  python3 - << 'PYEOF'
import sys
try:
    import lancedb
    import pyarrow as pa
    from datetime import datetime, timezone

    db = lancedb.connect(".ai-memory/lancedb")

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

run_init() {
  step "1/8 创建目录 .ai-memory、memory 子结构…"
  mkdir -p .ai-memory/{lancedb,snapshots,rules/{coding,testing,security,workflow}}
  mkdir -p memory/{decisions,incidents,sprints}

  step "2/8 写入 memory/current_state.json…"
  write_current_state

  step "3/8 写入 .ai-memory/rules/RULES.md…"
  write_rules_md

  step "4/8 合并 .gitignore…"
  patch_gitignore

  step "5/8 写入 .claude/settings.json…"
  write_claude_settings

  step "6/8 写入 CLAUDE.md（若允许）…"
  write_claude_md

  step "7/8 可选 LanceDB 初始化…"
  init_lancedb_optional

  step "8/8 写入 opencode / IDE 规则与 sop/custom…"
  write_tool_configs
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
log "  memory/current_state.json  - 项目状态"
log "  .ai-memory/lancedb/        - 向量记忆库"
log "  .ai-memory/rules/          - 规则库"
log "  CLAUDE.md                  - Claude Code 规约"
log "  opencode.json              - opencode 配置"
log "  .cursorrules               - Cursor 规则"
log "  .windsurfrules             - Windsurf 规则"
log "  .trae/rules.md             - Trae 规则"
log "  sop/custom/                - 自定义模块（reinit 不删除其中已有文件）"
log ""
log "reinit 备份目录: .ai-reinit-backups/（若未使用 --no-backup）"
log ""
log "下一步:"
log "  1. 编辑 CLAUDE.md，填写项目技术栈和构建命令"
log "  2. 启动 Dashboard: bash sop/tools/start-manager.sh"
log "  3. 健康检查: bash sop/tools/health-check.sh"
log "──────────────────────────────────────────────────────────────"
