#!/usr/bin/env bash
# start-dashboard.sh — 与 start-manager.sh 一致，启动完整 Web 后台（main:app）
# 曾用 api:app 单体入口；现统一为 main.py 以包含 dev-flow、vibe、design-docs 等全部路由。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/../web"
PORT="${PORT:-8765}"
PROJECT_PATH="${PROJECT_PATH:-$(pwd)}"

echo "🚀 启动 Web 管理后台（main:app）..."
echo "   项目路径: $PROJECT_PATH"
echo "   地址: http://localhost:$PORT"
echo "   手册: 仓库根 docs/USER_MANUAL.md"

command -v python3 &>/dev/null || { echo "❌ 需要 Python 3.10+"; exit 1; }

python3 -c "import fastapi,lancedb" 2>/dev/null || {
  echo "📦 请先执行: bash sop/tools/install-integrations.sh"
  exit 1
}

if [ ! -d "$PROJECT_PATH/.ai-memory/lancedb" ]; then
  echo "🗄️  初始化 LanceDB 目录..."
  mkdir -p "$PROJECT_PATH/.ai-memory/lancedb"
fi

if command -v open &>/dev/null; then
  sleep 1.5 && open "http://localhost:$PORT" &
elif command -v xdg-open &>/dev/null; then
  sleep 1.5 && xdg-open "http://localhost:$PORT" &
fi

cd "$WEB_DIR"
PROJECT_PATH="$PROJECT_PATH" python3 -m uvicorn main:app --host 0.0.0.0 --port "$PORT" --reload
