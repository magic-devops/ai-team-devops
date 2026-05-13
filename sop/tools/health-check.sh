#!/usr/bin/env bash
# health-check.sh - 项目健康检查
set -euo pipefail

OK=0; WARN=0; FAIL=0
pass() { echo "  ✅ $1"; OK=$((OK + 1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "🔍 AI 项目健康检查"
echo ""

echo "【记忆系统】"
PP="${PROJECT_PATH:-.}"
RT="${PP%/}/.sop-runtime"
[ -f "${PP}/memory/current_state.json" ] && pass "current_state.json 存在" || warn "current_state.json 缺失，运行 init-ai-project.sh"
if [ -f "${PP}/.ai-memory/rules/RULES.md" ] || [ -f "${RT}/ai-memory/rules/RULES.md" ]; then
  pass "规则库存在"
else
  warn "规则库缺失"
fi
if [ -f "${PP}/.ai-memory/ai_capabilities.json" ] || [ -f "${RT}/ai-memory/ai_capabilities.json" ]; then
  pass "AI 能力注册表存在"
else
  warn "AI 能力注册表缺失"
fi
if [ -d "${PP}/.ai-memory/lancedb" ] || [ -d "${RT}/ai-memory/lancedb" ]; then
  pass "LanceDB 目录存在"
else
  warn "LanceDB 未初始化"
fi

echo ""
echo "【数据库】"
WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../web" && pwd)"
if [ -f "$WEB_DIR/.env" ]; then
  DB_TYPE=$(grep "^DB_TYPE=" "$WEB_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d ' ')
  pass ".env 存在 (DB_TYPE=${DB_TYPE:-sqlite})"
elif [ -f "$WEB_DIR/.env.example" ]; then
  warn ".env 不存在，请复制 .env.example: cp sop/web/.env.example sop/web/.env"
fi
DB_FILE="${RT}/db/sop.db"
[ -f "$DB_FILE" ] || DB_FILE="$WEB_DIR/sop.db"
[ -f "$DB_FILE" ] && pass "SQLite 数据库存在 ($(du -sh "$DB_FILE" 2>/dev/null | cut -f1))" || warn "SQLite 未初始化（首次启动 main 时在 .sop-runtime/db 自动创建）"

echo ""
echo "【管理后台依赖】"
PY="${SOP_PYTHON:-python3}"
if "$PY" -c "import fastapi, uvicorn, sqlalchemy, jwt" 2>/dev/null; then
  pass "核心依赖已安装 (fastapi/uvicorn/sqlalchemy/pyjwt)"
else
  fail "核心依赖缺失，请执行: bash sop/tools/install-integrations.sh"
fi
"$PY" -c "import lancedb" 2>/dev/null && pass "lancedb 已安装" || warn "lancedb 未安装（向量库功能不可用）"
"$PY" -c "import anthropic" 2>/dev/null && pass "anthropic SDK 已安装" || warn "anthropic 未安装（AI 功能不可用）"
"$PY" -c "import psutil" 2>/dev/null && pass "psutil 已安装（健康监控）" || warn "psutil 未安装（健康监控指标不可用）"

echo ""
echo "【工具配置】"
[ -f "CLAUDE.md" ] && pass "CLAUDE.md 存在" || warn "CLAUDE.md 缺失（Claude Code 无法读取项目规约）"
[ -f "AGENTS.md" ] && pass "AGENTS.md 存在" || warn "AGENTS.md 缺失（Codex CLI 无法读取项目规约）"
[ -f ".codex/config.toml" ] && pass ".codex/config.toml 存在" || warn ".codex/config.toml 缺失"
[ -f ".codex/hooks.json" ] && pass ".codex/hooks.json 存在" || warn ".codex/hooks.json 缺失"
[ -f "sop/tools/sop_ai_hook.py" ] && pass "统一 AI hook 引擎存在" || warn "sop/tools/sop_ai_hook.py 缺失"
[ -f "opencode.json" ] && pass "opencode.json 存在" || warn "opencode.json 缺失"
[ -f ".cursorrules" ] && pass ".cursorrules 存在" || warn ".cursorrules 缺失（Cursor 用户）"

echo ""
echo "【日志目录】"
PP="${PROJECT_PATH:-.}"
RT="${PP%/}/.sop-runtime"
LOG_DIR="${LOG_DIR:-${RT}/logs}"
[ -d "$LOG_DIR" ] && pass "日志目录存在: $LOG_DIR" || warn "日志目录不存在（启动时自动创建）"

echo ""
echo "【自定义模块】"
[ -d "sop/custom/specs" ] && pass "custom/specs 存在" || warn "custom/specs 缺失"
[ -d "sop/custom/examples" ] && pass "custom/examples 存在" || warn "custom/examples 缺失"

echo ""
echo "【Git】"
if git rev-parse --git-dir &>/dev/null; then
  pass "Git 仓库已初始化"
  DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  [ "$DIRTY" -eq 0 ] && pass "工作区干净" || warn "$DIRTY 个未提交变更"
else
  warn "未初始化 Git 仓库"
fi

echo ""
echo "【管理后台连通性】"
PORT="${PORT:-8765}"
if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  pass "管理后台运行中 (http://127.0.0.1:${PORT})"
else
  warn "管理后台未运行（可执行: bash sop/tools/start-manager.sh）"
fi

echo ""
echo "────────────────────────────────"
echo "  ✅ $OK  ⚠️  $WARN  ❌ $FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0

