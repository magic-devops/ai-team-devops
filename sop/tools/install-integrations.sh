#!/usr/bin/env bash
# install-integrations.sh - 一键安装所有集成依赖
set -euo pipefail

echo "📦 安装 AI Dev SOP 集成依赖..."

# Python 依赖
pip install lancedb pyarrow sentence-transformers \
    fastapi uvicorn pandas \
    --break-system-packages -q

# Node.js MCP servers（可选）
if command -v npx &>/dev/null; then
  echo "✅ npx 可用，MCP servers 将按需安装"
else
  echo "⚠️  未找到 npx，跳过 Node.js MCP servers"
fi

# 初始化 LanceDB 并索引 custom/ 目录
if [ -d "sop/custom" ]; then
  python3 sop/knowledge/lancedb_ops.py index-custom 2>/dev/null && \
    echo "✅ custom/ 目录已索引到知识库" || \
    echo "⚠️  知识库索引跳过（LanceDB 未就绪）"
fi

echo ""
echo "✅ 安装完成！"
echo ""
echo "可用命令："
echo "  python sop/knowledge/lancedb_ops.py context '<任务描述>'"
echo "  python sop/integrations/agents/coder_backend.py --port 8001"
echo "  python sop/integrations/mcp/lancedb_server.py  # MCP stdio server"
