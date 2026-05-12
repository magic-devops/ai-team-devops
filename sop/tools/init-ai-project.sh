#!/usr/bin/env bash
# init-ai-project.sh
# 快速初始化 AI 辅助开发项目
# 用法：bash init-ai-project.sh <project-name>

set -euo pipefail

PROJECT_NAME="${1:-my-project}"
SOP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "初始化 AI 开发项目: $PROJECT_NAME"

# 1. 创建记忆目录
mkdir -p .ai-memory/{lancedb,snapshots,rules/{coding,testing,security,workflow}}
mkdir -p memory/{decisions,incidents,sprints}

# 2. 初始化当前状态
cat > memory/current_state.json << EOF
{
  "project_id": "$PROJECT_NAME",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "phase": "INIT",
  "sprint": null,
  "tasks": {
    "completed": [],
    "in_progress": [],
    "blocked": [],
    "pending": []
  },
  "metrics": {
    "completion_rate": 0,
    "velocity": 0,
    "blockers_count": 0
  }
}
EOF

# 3. 创建规则索引
cat > .ai-memory/rules/RULES.md << 'EOF'
# 项目规则库

AI 智能体每次启动时读取此文件，加载适用规则。

## 活跃规则

（项目运行过程中自动填充）

## 规则统计

- 总规则数: 0
- 活跃规则: 0
- 废弃规则: 0
EOF

# 4. 创建 .gitignore 条目
if [ -f .gitignore ]; then
    if ! grep -q ".ai-memory/lancedb" .gitignore; then
        echo "" >> .gitignore
        echo "# AI 记忆系统" >> .gitignore
        echo ".ai-memory/lancedb/" >> .gitignore
    fi
else
    cat > .gitignore << 'EOF'
# AI 记忆系统
.ai-memory/lancedb/
EOF
fi

# 5. 创建 Claude Code 配置
mkdir -p .claude
cat > .claude/settings.json << 'EOF'
{
  "permissions": {
    "allow": [
      "Bash(git status)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(npm run *)",
      "Bash(python *)",
      "Bash(pytest *)"
    ]
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ -f memory/current_state.json ] && python3 -c \"import json,sys; d=json.load(open('memory/current_state.json')); d['updated_at']=__import__('datetime').datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'); json.dump(d,open('memory/current_state.json','w'),indent=2)\" 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
EOF

# 6. 创建 CLAUDE.md（如果不存在）
if [ ! -f CLAUDE.md ]; then
    cat > CLAUDE.md << EOF
# $PROJECT_NAME

## AI 开发规约

本项目使用 sop 规约体系。

### 启动检查清单

1. 读取 \`memory/current_state.json\` 了解当前状态
2. 读取 \`.ai-memory/rules/RULES.md\` 加载项目规则
3. 确认当前阶段和待处理任务

### 核心原则

- 最小化：只写解决问题所需的最少代码
- 状态外化：进度持久化到 memory/ 目录
- 可追溯：commit 格式 \`type(scope): desc [T-id]\`
- 安全优先：用户输入必须验证，禁止硬编码密钥

### 技术栈

（在此填写项目技术栈）

### 构建命令

\`\`\`bash
# 构建
# npm run build

# 测试
# npm test

# 代码检查
# npm run lint
\`\`\`
EOF
fi

# 7. 初始化 Python 记忆库（如果有 Python）
if command -v python3 &>/dev/null; then
    python3 - << 'PYEOF'
import sys
try:
    import lancedb
    import pyarrow as pa
    from datetime import datetime, timezone

    db = lancedb.connect(".ai-memory/lancedb")

    schemas = {
        "tasks": pa.schema([
            pa.field("id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("description", pa.string()),
            pa.field("status", pa.string()),
            pa.field("priority", pa.string()),
            pa.field("estimate", pa.string()),
            pa.field("depends_on", pa.list_(pa.string())),
            pa.field("created_at", pa.timestamp("us")),
            pa.field("updated_at", pa.timestamp("us")),
        ]),
        "incidents": pa.schema([
            pa.field("id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("description", pa.string()),
            pa.field("severity", pa.string()),
            pa.field("status", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
        ]),
        "decisions": pa.schema([
            pa.field("id", pa.string()),
            pa.field("title", pa.string()),
            pa.field("context", pa.string()),
            pa.field("chosen", pa.string()),
            pa.field("rationale", pa.string()),
            pa.field("created_at", pa.timestamp("us")),
        ]),
    }

    for name, schema in schemas.items():
        if name not in db.table_names():
            db.create_table(name, schema=schema)

    print("LanceDB 初始化完成")
except ImportError:
    print("提示：安装 lancedb 以启用向量记忆: pip install lancedb pyarrow")
PYEOF
fi

echo ""
echo "项目初始化完成！"
echo ""

# 8. 生成多工具配置
RULES_CONTENT="# AI 开发规约
包名: com.magic.${PROJECT_NAME}
时间字段: MySQL 用 gmt_created/gmt_modified，API 响应用 createdAt/updatedAt
失败时 <reflect> 分析换思路，最多重试3次，第3次失败上报
完成后说明置信度，< 0.70 时主动说明不确定点
禁止硬编码密钥
规范文档在 sop/ 目录，按需加载对应规范文件"

# opencode.json
cat > opencode.json << OEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-7",
  "providers": {
    "anthropic": { "apiKey": "\${ANTHROPIC_API_KEY}" }
  },
  "system": "读取 CLAUDE.md 了解项目规约。包名 com.magic.${PROJECT_NAME}。失败时 <reflect> 分析，最多重试3次。",
  "rules": [
    "memory/current_state.json 存在时，启动前先读取了解当前状态",
    "commit 格式: type(scope): desc [T-id]",
    "禁止硬编码密钥",
    "完成任务后输出置信度 0-1"
  ],
  "context": [
    { "type": "file", "path": "CLAUDE.md" },
    { "type": "file", "path": "memory/current_state.json", "optional": true }
  ]
}
OEOF

# .cursorrules / .windsurfrules / .trae/rules.md
echo "$RULES_CONTENT" > .cursorrules
echo "$RULES_CONTENT" > .windsurfrules
mkdir -p .trae && echo "$RULES_CONTENT" > .trae/rules.md
mkdir -p .qoder && echo "$RULES_CONTENT" > .qoder/context.md

# custom/ 目录
mkdir -p sop/custom/{specs,examples,design,interaction,daily}

echo "目录结构："
echo "  memory/current_state.json  - 项目状态"
echo "  .ai-memory/lancedb/        - 向量记忆库"
echo "  .ai-memory/rules/          - 规则库"
echo "  CLAUDE.md                  - Claude Code 规约"
echo "  opencode.json              - opencode 配置"
echo "  .cursorrules               - Cursor 规则"
echo "  .windsurfrules             - Windsurf 规则"
echo "  .trae/rules.md             - Trae 规则"
echo "  sop/custom/         - 自定义模块"
echo ""
echo "下一步："
echo "  1. 编辑 CLAUDE.md，填写项目技术栈和构建命令"
echo "  2. 启动 Dashboard: bash sop/tools/start-manager.sh"
echo "  3. 健康检查: bash sop/tools/health-check.sh"
