#!/usr/bin/env bash
# stack.sh — 本地开发栈：Manager（后台）+ 可选 agentd + 健康检查
#
# 用法:
#   bash scripts/stack.sh start          # start-bg Manager + 提示 agentd
#   bash scripts/stack.sh start --agentd # 并尝试 sop agentd start
#   bash scripts/stack.sh stop           # stop-bg + agentd stop
#   bash scripts/stack.sh status         # status + health 摘要
#   bash scripts/stack.sh doctor         # sop doctor 或 health-check
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CMD="${1:-status}"
WITH_AGENTD=0
PORT="${PORT:-8765}"
PP="${PROJECT_PATH:-$ROOT}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --agentd) WITH_AGENTD=1; shift ;;
    --port) PORT="${2:?}"; shift 2 ;;
    --project-path) PP="${2:?}"; shift 2 ;;
    start|stop|status|doctor) CMD="$1"; shift ;;
    *) printf '未知参数: %s\n' "$1" >&2; exit 1 ;;
  esac
done

CTL=(bash "$ROOT/ai-sop-ops/sop-ctl.sh" --project-path "$PP" --port "$PORT")

_run_sop() {
  if command -v sop &>/dev/null; then
    sop "$@"
  elif [[ -f "$ROOT/.venv/bin/sop" ]]; then
    "$ROOT/.venv/bin/sop" "$@"
  else
    PYTHONPATH="$ROOT/packages/sop-cli:$ROOT/packages/sop-sdk-python" \
      python3 -m sop_cli "$@"
  fi
}

case "$CMD" in
  start)
    printf '🚀 启动 Manager（后台）…\n'
    "${CTL[@]}" start-bg
    if [[ "$WITH_AGENTD" -eq 1 ]]; then
      printf '🚀 启动 sop-agentd…\n'
      _run_sop agentd start || printf '⚠️  agentd 启动失败（先 make build-agentd）\n'
    else
      printf 'ℹ️  可选: bash scripts/stack.sh start --agentd\n'
    fi
    "${CTL[@]}" wait-health --timeout 90 || true
    ;;
  stop)
    "${CTL[@]}" stop-bg --force 2>/dev/null || "${CTL[@]}" stop --force 2>/dev/null || true
    _run_sop agentd stop 2>/dev/null || true
    printf '✅ 已尝试停止 Manager 与 agentd\n'
    ;;
  status)
    "${CTL[@]}" status
    ;;
  doctor)
    if command -v sop &>/dev/null || [[ -f "$ROOT/.venv/bin/sop" ]]; then
      _run_sop doctor || true
    fi
    PORT="$PORT" PROJECT_PATH="$PP" bash "$ROOT/ai-sop-ops/health-check.sh" || true
    ;;
  *)
    printf '用法: %s {start|stop|status|doctor}\n' "$0" >&2
    exit 1
    ;;
esac
