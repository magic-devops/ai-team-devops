#!/usr/bin/env bash
# post-tool-call.sh - 工具调用后记录
# 记录关键操作到日志，用于审计和自进化

TOOL="${TOOL_NAME:-}"
LOG_FILE=".ai-memory/tool-audit.log"
mkdir -p .ai-memory

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) TOOL=$TOOL" >> "$LOG_FILE"

# 文件变更后自动更新状态时间戳
if [[ "$TOOL" == "Edit" || "$TOOL" == "Write" ]]; then
  if [ -f "memory/current_state.json" ] && command -v python3 &>/dev/null; then
    python3 -c "
import json, datetime
try:
    with open('memory/current_state.json') as f: d = json.load(f)
    d['updated_at'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    with open('memory/current_state.json', 'w') as f: json.dump(d, f, indent=2)
except: pass
" 2>/dev/null
  fi
fi

exit 0
