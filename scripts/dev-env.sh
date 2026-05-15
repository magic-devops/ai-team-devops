#!/usr/bin/env bash
# dev-env.sh — 平台仓本地开发一键准备（CLI + agentd + 可选 Manager 依赖）
#
# 用法:
#   bash scripts/dev-env.sh                    # venv + CLI + agentd 构建 + doctor
#   bash scripts/dev-env.sh --start-agentd     # 额外启动 sop-agentd
#   bash scripts/dev-env.sh --skip-manager     # 不安装 Manager Python 依赖
#   bash scripts/dev-env.sh --venv .venv
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENV="${SOP_DEV_VENV:-.venv}"
START_AGENTD=0
SKIP_MANAGER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --venv) VENV="${2:?}"; shift 2 ;;
    --start-agentd) START_AGENTD=1; shift ;;
    --skip-manager) SKIP_MANAGER=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

ARGS=(--venv "$VENV" --agentd --verify --doctor)
if [[ "$START_AGENTD" -eq 1 ]]; then
  ARGS+=(--start-agentd)
fi

bash "$ROOT/scripts/build-sop.sh" "${ARGS[@]}"

if [[ "$SKIP_MANAGER" -eq 0 ]] && [[ -f "$ROOT/apps/manager/pyproject.toml" ]]; then
  printf '\n\033[1;36m[dev-env]\033[0m 安装 Manager 依赖\n'
  if [[ -d "$VENV" ]]; then
    # shellcheck disable=SC1091
    source "$VENV/bin/activate"
  fi
  if command -v uv &>/dev/null; then
    uv pip install -e "apps/manager[postgres,redis,otel,llm,embeddings,vector-lance]" \
      || pip install -r apps/manager/requirements.txt
  else
    pip install -e "apps/manager[postgres,redis,otel,llm,embeddings,vector-lance]" \
      || pip install -r apps/manager/requirements.txt
  fi
  printf '  ✅ Manager 依赖完成\n'
fi

echo
echo "── 下一步 ──"
echo "  source $VENV/bin/activate"
echo "  bash ai-sop-ops/start-manager.sh          # 启动 Manager（8765）"
echo "  sop agentd start                          # 若未 --start-agentd"
echo "  sop login --pair                          # 配对 project_id（启用 sync）"
echo "  sop doctor"
echo "  详见 docs/TOOLS_AND_SCRIPTS.md"
