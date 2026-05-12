#!/usr/bin/env bash
# start-manager.sh - 一键启动 ai-team-devops Web 管理后台
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$SCRIPT_DIR/../web"
PORT="${PORT:-8765}"
PROJECT_PATH="${PROJECT_PATH:-$(pwd)}"

echo "🚀 启动 AI Dev Dashboard..."
echo "   项目路径: $PROJECT_PATH"
echo "   端口: $PORT"

# 检查 Python
if ! command -v python3 &>/dev/null; then
  echo "❌ 需要 Python 3.8+"
  exit 1
fi

# 安装依赖（首次）
if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "📦 安装依赖..."
  pip install fastapi uvicorn lancedb pyarrow pandas --break-system-packages -q
fi

# 打开浏览器（后台）
if command -v open &>/dev/null; then
  sleep 1.5 && open "http://localhost:$PORT" &
elif command -v xdg-open &>/dev/null; then
  sleep 1.5 && xdg-open "http://localhost:$PORT" &
fi

echo "✅ Dashboard: http://localhost:$PORT"
echo "   按 Ctrl+C 停止"
echo ""

cd "$DASHBOARD_DIR"
PROJECT_PATH="$PROJECT_PATH" python3 -m uvicorn api:app --host 0.0.0.0 --port "$PORT" --reload
