#!/usr/bin/env bash
# start-manager.sh — 启动项目管理后台（FastAPI + uvicorn）
#
# 用法:
#   bash sop/tools/start-manager.sh
#   bash sop/tools/start-manager.sh --port 9000
#   bash sop/tools/start-manager.sh --no-reload
#   bash sop/tools/start-manager.sh --help
#
# 环境变量:
#   PORT              监听端口，默认 8765
#   PROJECT_PATH      被管理仓库根路径，默认当前工作目录
#   MANAGER_VENV      Python venv 目录，默认 <仓库根>/.venv-integrations
#   SOP_PYTHON        显式指定 python 可执行文件（优先于 venv / PATH）
#   START_MANAGER_NO_RELOAD=1  关闭 --reload（生产或避免 StatReload 子进程问题）
#   START_MANAGER_SKIP_BROWSER=1  不自动打开浏览器
#
set -euo pipefail

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      sed -n '1,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --no-reload) export START_MANAGER_NO_RELOAD=1; shift ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    --port)
      if [[ -z "${2:-}" ]]; then printf '❌ --port 需要端口号\n' >&2; exit 1; fi
      PORT="$2"
      shift 2
      ;;
    *)
      printf '⚠️  未知参数: %s（忽略）。支持: --help --port N --no-reload\n' "$1" >&2
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEB_DIR="$REPO_ROOT/sop/web"
PORT="${PORT:-8765}"
PROJECT_PATH="${PROJECT_PATH:-$(pwd)}"
VENV_DIR="${MANAGER_VENV:-$REPO_ROOT/.venv-integrations}"
UVICORN_EXTRA=()

log() { printf '%s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

pick_python() {
  if [[ -n "${SOP_PYTHON:-}" ]]; then
    printf '%s' "$SOP_PYTHON"
    return 0
  fi
  if [[ -x "$VENV_DIR/bin/python" ]]; then
    printf '%s' "$VENV_DIR/bin/python"
    return 0
  fi
  if command -v python3 &>/dev/null; then
    command -v python3
    return 0
  fi
  return 1
}

PY="$(pick_python)" || die "未找到 Python。请先: bash sop/tools/install-integrations.sh 或设置 SOP_PYTHON"

if [[ ! -d "$WEB_DIR" ]]; then
  die "未找到 Web 目录: $WEB_DIR"
fi

log "🚀 启动项目管理后台"
log "   本仓库(SOP)根: $REPO_ROOT"
log "   被管理项目路径 PROJECT_PATH: $PROJECT_PATH"
log "   监听: http://127.0.0.1:${PORT} （局域网: http://0.0.0.0:${PORT}）"
log "   Python: $PY"
if [[ "$PY" == "${VENV_DIR}/bin/python" ]]; then
  log "   （使用集成虚拟环境: ${VENV_DIR}）"
fi

log ""
log "🔎 预检依赖与入口模块…"
if ! "$PY" -c "import fastapi, uvicorn" 2>/dev/null; then
  die "缺少 fastapi/uvicorn。请执行: bash sop/tools/install-integrations.sh"
fi
cd "$WEB_DIR"
if ! PROJECT_PATH="$PROJECT_PATH" "$PY" -c "import main" 2>/dev/null; then
  log "   尝试输出具体错误:"
  PROJECT_PATH="$PROJECT_PATH" "$PY" -c "import main" || true
  die "main 模块加载失败（见上方 Traceback）。常见原因: routers 导入错误、缺依赖。"
fi

if [[ ! -d "$PROJECT_PATH/.ai-memory/lancedb" ]]; then
  log "🗄️  创建 LanceDB 数据目录（空库，首次访问时再写入）…"
  mkdir -p "$PROJECT_PATH/.ai-memory/lancedb"
fi

if [[ -z "${START_MANAGER_SKIP_BROWSER:-}" ]]; then
  if command -v open &>/dev/null; then
    ( sleep 1.5 && open "http://127.0.0.1:${PORT}" ) &
  elif command -v xdg-open &>/dev/null; then
    ( sleep 1.5 && xdg-open "http://127.0.0.1:${PORT}" ) &
  fi
fi

if [[ -z "${START_MANAGER_NO_RELOAD:-}" ]]; then
  UVICORN_EXTRA+=(--reload)
else
  log "ℹ️  已禁用热重载（START_MANAGER_NO_RELOAD=1）"
fi

log ""
log "✅ 启动 uvicorn（Ctrl+C 停止）"
log "   手册: 仓库根 docs/USER_MANUAL.md · sop/web/README.md"
log ""

export PROJECT_PATH
exec "$PY" -m uvicorn main:app --host 0.0.0.0 --port "$PORT" "${UVICORN_EXTRA[@]}"
