#!/usr/bin/env bash
# pre-tool-call.sh - 工具调用前检查
# Claude Code 在每次工具调用前执行此脚本
# 环境变量: TOOL_NAME, TOOL_INPUT

TOOL="${TOOL_NAME:-}"
INPUT="${TOOL_INPUT:-}"

# 阻止危险操作
case "$TOOL" in
  Bash)
    # 检查危险命令
    if echo "$INPUT" | grep -qE "rm -rf /|DROP TABLE|DELETE FROM .* WHERE 1|git push --force"; then
      echo "⚠️  检测到高风险操作，需要人工确认" >&2
      exit 1
    fi
    # 检查硬编码密钥
    if echo "$INPUT" | grep -qiE "password\s*=\s*['\"][^'\"]{4,}|api_key\s*=\s*['\"][^'\"]{8,}"; then
      echo "⚠️  检测到可能的硬编码密钥" >&2
      exit 1
    fi
    ;;
esac

exit 0
