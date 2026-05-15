#!/usr/bin/env bash
# deploy.sh — Docker 部署 Manager（single / saas compose）
#
# 用法:
#   bash scripts/deploy.sh print [single|saas]     # 打印命令（默认）
#   bash scripts/deploy.sh up [single|saas]        # docker compose up -d --build
#   bash scripts/deploy.sh down [single|saas]      # docker compose down
#   bash scripts/deploy.sh logs [single|saas]      # docker compose logs -f
#   bash scripts/deploy.sh ps [single|saas]        # docker compose ps
#
# 环境变量:
#   PROJECT_PATH   挂载到容器的 /workspace，默认仓库根
#   PORT           宿主机映射端口，默认 8765
#   SECRET_KEY     生产务必修改
#   COMPOSE_PROJECT_NAME  可选，默认 sop-manager
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ACTION="${1:-print}"
MODE="${2:-single}"
PROJECT_PATH="${PROJECT_PATH:-$ROOT}"
PORT="${PORT:-8765}"
SECRET_KEY="${SECRET_KEY:-dev-only-change-me}"
export PROJECT_PATH PORT SECRET_KEY

compose_file() {
  case "$MODE" in
    single) echo "apps/manager/docker-compose.single.yml" ;;
    saas)   echo "apps/manager/docker-compose.saas.yml" ;;
    *) echo "unknown" >&2; return 1 ;;
  esac
}

die() { printf '❌ %s\n' "$*" >&2; exit 1; }

CF="$(compose_file)" || die "用法: $0 {print|up|down|logs|ps} [single|saas]"
[[ -f "$CF" ]] || die "未找到 compose 文件: $CF"

if ! command -v docker &>/dev/null; then
  die "未安装 docker"
fi

DC=(docker compose -f "$CF")
if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
  export COMPOSE_PROJECT_NAME
fi

case "$ACTION" in
  print)
    printf '模式: %s\n文件: %s\n' "$MODE" "$CF"
    printf 'PROJECT_PATH=%s PORT=%s\n' "$PROJECT_PATH" "$PORT"
    printf '\n建议命令:\n'
    printf '  SECRET_KEY=<强随机> PROJECT_PATH=%s PORT=%s \\\n' "$PROJECT_PATH" "$PORT"
    printf '    docker compose -f %s up -d --build\n' "$CF"
    ;;
  up)
    printf '🚀 启动 %s …\n' "$CF"
    "${DC[@]}" up -d --build
    printf '✅ 已启动 → http://127.0.0.1:%s/api/v1/health\n' "$PORT"
    printf '   等待就绪: bash ai-sop-ops/sop-ctl.sh wait-health --port %s\n' "$PORT"
    ;;
  down)
    printf '🛑 停止 %s …\n' "$CF"
    "${DC[@]}" down
    printf '✅ 已停止\n'
    ;;
  logs)
    "${DC[@]}" logs -f --tail=200
    ;;
  ps)
    "${DC[@]}" ps
    ;;
  *)
    die "未知动作: $ACTION（print|up|down|logs|ps）"
    ;;
esac
