#!/usr/bin/env bash
# start-manager.sh - 启动 ai-team-devops 项目管理后台
# 功能：需求/计划/迭代/问题/知识库/规范 全生命周期管理
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/../web"
PORT="${PORT:-8765}"
PROJECT_PATH="${PROJECT_PATH:-$(pwd)}"

echo "🚀 启动 ai-team-devops 项目管理后台..."
echo "   项目路径: $PROJECT_PATH"
echo "   地址: http://localhost:$PORT"

command -v python3 &>/dev/null || { echo "❌ 需要 Python 3.8+"; exit 1; }

# 安装依赖（首次）
python3 -c "import fastapi,lancedb" 2>/dev/null || {
  echo "📦 安装依赖..."
  pip install fastapi uvicorn lancedb pyarrow pandas sentence-transformers --break-system-packages -q
}

# 初始化 LanceDB（如果未初始化）
if [ ! -d "$PROJECT_PATH/.ai-memory/lancedb" ]; then
  echo "🗄️  初始化 LanceDB..."
  mkdir -p "$PROJECT_PATH/.ai-memory/lancedb"
fi

# 打开浏览器
if command -v open &>/dev/null; then
  sleep 1.5 && open "http://localhost:$PORT" &
elif command -v xdg-open &>/dev/null; then
  sleep 1.5 && xdg-open "http://localhost:$PORT" &
fi

echo ""
echo "✅ 管理后台已启动: http://localhost:$PORT"
echo "   功能: 需求管理 · 执行计划 · 迭代进度 · 问题处理 · 知识库 · 规范管理"
echo "   按 Ctrl+C 停止"
echo ""

cd "$WEB_DIR"
PROJECT_PATH="$PROJECT_PATH" python3 -m uvicorn main:app --host 0.0.0.0 --port "$PORT" --reload
