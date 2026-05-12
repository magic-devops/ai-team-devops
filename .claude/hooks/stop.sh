#!/usr/bin/env bash
# stop.sh - 会话结束时执行
# 自动保存状态快照

if [ -f "memory/current_state.json" ] && command -v python3 &>/dev/null; then
  DATE=$(date +%Y-%m-%d)
  mkdir -p memory/snapshots
  cp memory/current_state.json "memory/snapshots/${DATE}-state.json" 2>/dev/null || true
fi

# 提示用户运行 /evolve 提取规则
echo "💡 提示：运行 /evolve 从本次会话提取规则，持续进化 AI 能力"

exit 0
