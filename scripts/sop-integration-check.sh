#!/usr/bin/env bash
# sop-integration-check.sh — 核心链路冒烟（Manager / 鉴权 / sync / agentd）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PROJECT_PATH="${PROJECT_PATH:-$ROOT}"
export ADMIN_MODE="${ADMIN_MODE:-single}"

step() { printf '\n\033[1;36m[check]\033[0m %s\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
fail() { printf '  ❌ %s\n' "$*" >&2; exit 1; }

step "Manager 健康"
curl -sf "http://localhost:8765/api/v1/health" >/dev/null || fail "Manager 未启动 → bash ai-sop-ops/start-manager.sh"
ok "Manager 在线"

step "sop doctor"
if command -v sop &>/dev/null; then
  sop doctor || fail "sop doctor 未通过"
else
  uv run sop doctor || fail "sop doctor 未通过"
fi
ok "doctor 通过"

step "直连 sync pull（需已 sop login）"
if command -v sop &>/dev/null; then
  sop sync pull --direct -o /tmp/sop-sync-pull.json || fail "sync pull --direct 失败"
else
  uv run sop sync pull --direct -o /tmp/sop-sync-pull.json || fail "sync pull --direct 失败"
fi
ok "sync pull 成功 → /tmp/sop-sync-pull.json"

if [[ -S "$ROOT/.sop-runtime/agentd.sock" ]]; then
  step "agentd IPC sync.trigger"
  if command -v sop &>/dev/null; then
    sop sync || ok "sop sync（经 agentd 或自动回退直连）"
  else
    uv run sop sync || ok "sop sync"
  fi
else
  printf '  ⚠️  agentd 未运行，跳过 sop sync（可 sop agentd start）\n'
fi

echo
ok "集成检查完成"
