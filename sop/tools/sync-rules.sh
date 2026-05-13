#!/usr/bin/env bash
# sync-rules.sh - 同步 sop 规范到各工具配置
# 用法：bash sync-rules.sh [project-path]
set -euo pipefail

PROJECT="${1:-$(pwd)}"
SOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🔄 同步规范到: $PROJECT"

# 同步 AGENTS.md（Codex）
if [ ! -f "$PROJECT/AGENTS.md" ]; then
cat > "$PROJECT/AGENTS.md" << 'AGENTS'
# AI 开发规约（Codex）

## 启动检查

1. 读取 `memory/current_state.json` 了解当前状态
2. 读取 `.ai-memory/rules/RULES.md` 加载项目规则
3. 按需加载 `sop/` 下对应规范

## 核心规则

- 只写解决问题所需的最少代码
- 失败时分析根因并换思路，最多重试 3 次
- commit 格式: `type(scope): desc [T-id]`
- 禁止硬编码密钥，所有敏感配置从环境变量读取
- Codex hooks 只做校验、审计和状态同步；高风险命令必须人工确认
AGENTS
fi

# 同步 .cursorrules
cat > "$PROJECT/.cursorrules" << 'CURSOR'
# AI 开发规约（Cursor）
# 完整规范: sop/

## 项目约定
- 包名: com.magic.{app}，默认 superpower
- 时间字段: MySQL 用 gmt_created/gmt_modified，API 响应用 createdAt/updatedAt
- API 基础路径: /api/v1/

## 核心规则
1. 只写解决问题所需的最少代码
2. 失败时 <reflect> 分析换思路，最多重试3次
3. 完成后说明置信度，< 0.70 时主动说明不确定点
4. 禁止硬编码密钥

## 启动检查
读取 memory/current_state.json 了解当前状态。

## 规范（按需加载）
- Java: sop/specs/backend/JAVA_SPEC.md
- DB: sop/specs/database/DATABASE_SPEC.md
- 安全: sop/specs/security/SECURITY_SPEC.md
CURSOR

# 同步 .trae/rules.md
mkdir -p "$PROJECT/.trae"
cp "$PROJECT/.cursorrules" "$PROJECT/.trae/rules.md"

# 同步 .windsurfrules
cp "$PROJECT/.cursorrules" "$PROJECT/.windsurfrules"

echo "✅ 已同步: AGENTS.md（若缺失）/ .cursorrules / .trae/rules.md / .windsurfrules"
