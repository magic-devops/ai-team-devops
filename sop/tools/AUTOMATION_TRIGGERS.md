# 自动化触发器规范

## 触发器体系

```
代码事件 ──► Git Hooks
CI 事件  ──► GitHub Actions / CI Webhooks
AI 事件  ──► Claude Code Hooks
AI 事件  ──► Codex Hooks
时间事件 ──► Cron Jobs
```

## Git Hooks

### pre-commit（提交前自动检查）

```bash
# .git/hooks/pre-commit
#!/bin/bash
set -e

# 1. 代码格式
npm run lint --silent || { echo "Lint 失败，请修复后重试"; exit 1; }

# 2. 类型检查
npm run typecheck --silent || { echo "类型错误，请修复后重试"; exit 1; }

# 3. 检查硬编码密钥
if grep -rn "password\s*=\s*['\"][^'\"]\+['\"]" src/ --include="*.ts" 2>/dev/null; then
    echo "警告：检测到可能的硬编码密码"
    exit 1
fi

echo "pre-commit 检查通过"
```

### commit-msg（提交信息格式验证）

```bash
# .git/hooks/commit-msg
#!/bin/bash
COMMIT_MSG=$(cat "$1")
PATTERN="^(feat|fix|refactor|test|chore|docs|revert)(\(.+\))?: .{1,72}( \[T-?[0-9]+\])?$"

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
    echo "提交信息格式错误！"
    echo "正确格式：type(scope): description [T-id]"
    echo "示例：feat(auth): 实现 JWT token 生成 [T002]"
    exit 1
fi
```

### post-commit（提交后自动更新状态）

```bash
# .git/hooks/post-commit
#!/bin/bash
COMMIT_MSG=$(git log -1 --pretty=%B)
TASK_ID=$(echo "$COMMIT_MSG" | grep -oE '\[T[0-9]+\]' | tr -d '[]')

if [ -n "$TASK_ID" ]; then
    python3 -c "
import sys
sys.path.insert(0, '.ai-memory')
from memory_ops import update_task_status, add_code_change
import subprocess

commit_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode().strip()
add_code_change('$TASK_ID', commit_hash, '$COMMIT_MSG')
print(f'已记录变更: $TASK_ID → {commit_hash[:8]}')
" 2>/dev/null || true
fi
```

## AI Hooks 设计原则

- 统一策略入口是 `sop/tools/sop_ai_hook.py`；各工具 hook 配置只负责把本地事件转成 sop 标准事件。
- Hook 脚本必须可审计，禁止 `curl|sh`、动态下载执行和隐藏网络调用。
- `PreToolUse` / `PermissionRequest` 只做轻量策略判断，重型检查放到 `PostToolUse` 或 CI。
- Hook 输出应尽量结构化，失败时给出明确阻断原因。
- Hook 首次安装或修改后，需要在对应 AI 工具中人工审查并信任。

## Codex Hooks（`.codex/hooks.json`）

Codex CLI 支持 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`Stop` 等生命周期事件，可用于 sop 启动上下文、危险操作拦截、权限请求二次判断、工具调用审计和状态持久化。

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" SessionStart",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|apply_patch|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" PreToolUse",
            "timeout": 10
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "Bash|apply_patch|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" PermissionRequest",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|apply_patch|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" PostToolUse",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/sop_hook.py\" Stop",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

默认脚本 `.codex/hooks/sop_hook.py`：
- 作为 Codex adapter shim 调用 `sop/tools/sop_ai_hook.py codex <event>`。
- 中央引擎在 `SessionStart` 输出 `additionalContext`，提醒加载 `memory/current_state.json`、`.ai-memory/rules/RULES.md`、工具入口文件。
- 中央引擎在 `PreToolUse` / `PermissionRequest` 拦截 `rm -rf /`、`git reset --hard`、`git clean -fdx`、`chmod -R 777`、`curl|sh`、`wget|bash` 等高风险命令。
- 中央引擎在 `PostToolUse` / `UserPromptSubmit` / `Stop` 追加 `.ai-memory/activity.log`。
- 中央引擎在 `Stop` 更新 `memory/current_state.json.updated_at`。

## Claude Code Hooks（`.claude/settings.json`）

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npm run lint --silent 2>&1 | tail -5"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[TOOL] Bash executed at '$(date -u +%H:%M:%S) >> .ai-memory/activity.log"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .ai-memory/scripts/check_budget.py 2>/dev/null || true"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .ai-memory/scripts/persist_state.py 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

## GitHub Actions 触发器

```yaml
# .github/workflows/ai-dev-triggers.yml
name: AI Dev Triggers

on:
  pull_request:
    types: [opened, synchronize]
  push:
    branches: [main]

jobs:
  # PR 开启时：自动创建审查任务
  on-pr-open:
    if: github.event_name == 'pull_request' && github.event.action == 'opened'
    runs-on: ubuntu-latest
    steps:
      - name: Extract Task IDs from PR
        run: |
          TASK_IDS=$(echo "${{ github.event.pull_request.body }}" | grep -oE 'T[0-9]+' | tr '\n' ',')
          echo "TASK_IDS=$TASK_IDS" >> $GITHUB_ENV

      - name: Trigger Review
        run: |
          curl -X POST "${{ secrets.ORCHESTRATOR_WEBHOOK }}" \
            -H "Content-Type: application/json" \
            -d '{"event":"pr_opened","pr_number":${{ github.event.pull_request.number }},"task_ids":"${{ env.TASK_IDS }}"}'

  # 合并到 main 后：更新任务状态
  on-merge:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Update Task Status
        run: |
          TASK_IDS=$(git log -1 --pretty=%B | grep -oE '\[T[0-9]+\]' | tr -d '[]')
          for TASK_ID in $TASK_IDS; do
            echo "标记任务完成: $TASK_ID"
          done
```

## 定时任务

```bash
# crontab -e

# 每天 23:00 创建记忆快照
0 23 * * * cd /path/to/project && python3 .ai-memory/scripts/snapshot.py

# 每小时检查阻塞任务（超过 4 小时未解除则通知）
0 * * * * cd /path/to/project && python3 .ai-memory/scripts/check_blockers.py

# 每个 Sprint 结束日（周五 18:00）生成 Sprint 报告
0 18 * * 5 cd /path/to/project && python3 .ai-memory/scripts/sprint_report.py
```

## 触发器脚本目录

```
.ai-memory/scripts/
├── persist_state.py      # 持久化当前状态（Stop hook 调用）
├── check_budget.py       # 检查 token 预算（PreToolUse 调用）
├── snapshot.py           # 创建记忆快照（定时调用）
├── check_blockers.py     # 检查长期阻塞任务（定时调用）
└── sprint_report.py      # 生成 Sprint 报告（定时调用）
```
