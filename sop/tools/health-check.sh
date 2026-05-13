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
[ -f "memory/current_state.json" ] && pass "current_state.json 存在" || warn "current_state.json 缺失，运行 init-ai-project.sh"
[ -f ".ai-memory/rules/RULES.md" ] && pass "规则库存在" || warn "规则库缺失"
[ -f ".ai-memory/ai_capabilities.json" ] && pass "AI 能力注册表存在" || warn "AI 能力注册表缺失"
[ -d ".ai-memory/lancedb" ] && pass "LanceDB 目录存在" || warn "LanceDB 未初始化"

echo ""
echo "【工具配置】"
[ -f "CLAUDE.md" ] && pass "CLAUDE.md 存在" || warn "CLAUDE.md 缺失（Claude Code 无法读取项目规约）"
[ -f "AGENTS.md" ] && pass "AGENTS.md 存在" || warn "AGENTS.md 缺失（Codex CLI 无法读取项目规约）"
[ -f ".codex/config.toml" ] && pass ".codex/config.toml 存在" || warn ".codex/config.toml 缺失（Codex CLI 项目配置）"
[ -f ".codex/hooks.json" ] && pass ".codex/hooks.json 存在" || warn ".codex/hooks.json 缺失（Codex hooks 未启用）"
[ -f "sop/tools/sop_ai_hook.py" ] && pass "统一 AI hook 引擎存在" || warn "sop/tools/sop_ai_hook.py 缺失"
[ -f "opencode.json" ] && pass "opencode.json 存在" || warn "opencode.json 缺失"
[ -f ".cursorrules" ] && pass ".cursorrules 存在" || warn ".cursorrules 缺失（Cursor 用户）"

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
echo "────────────────────────────────"
echo "  ✅ $OK  ⚠️  $WARN  ❌ $FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
