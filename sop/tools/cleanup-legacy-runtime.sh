#!/usr/bin/env bash
# cleanup-legacy-runtime.sh — 在已迁移到 .sop-runtime 后，清理遗留的空目录与重复 SQLite/日志（可选）
#
# 用法:
#   PROJECT_PATH=/path/to/project bash sop/tools/cleanup-legacy-runtime.sh        # 仅打印将删除项（dry-run）
#   PROJECT_PATH=/path/to/project bash sop/tools/cleanup-legacy-runtime.sh --apply
#
# 仅删除「安全」项：
#   - sop/web/sop.db* 当 PROJECT_PATH/.sop-runtime/db/sop.db 已存在
#   - 空的 sop/web/logs、PROJECT_PATH/logs（若 .sop-runtime/logs 已存在且非空）
#   - 空的 PROJECT_PATH/.ai-reinit-backups
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEB_DIR="$REPO_ROOT/sop/web"
PP="${PROJECT_PATH:-$REPO_ROOT}"
RT="$PP/.sop-runtime"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

say() { printf '%s\n' "$*"; }

if [[ ! -d "$RT" ]]; then
  say "ℹ️  未找到运行时目录 $RT，跳过（请先启动一次管理后台以完成迁移）。"
  exit 0
fi

remove_file() {
  local f="$1"
  if [[ -f "$f" ]]; then
    say "  - 文件: $f"
    [[ "$APPLY" -eq 1 ]] && rm -f "$f"
  fi
}

remove_dir_if_empty() {
  local d="$1"
  if [[ -d "$d" ]] && [[ -z "$(find "$d" -mindepth 1 -maxdepth 1 2>/dev/null | head -1)" ]]; then
    say "  - 空目录: $d"
    [[ "$APPLY" -eq 1 ]] && rmdir "$d" 2>/dev/null || true
  fi
}

say "🔎 PROJECT_PATH=$PP"
say "   运行时目录: $RT"
if [[ "$APPLY" -eq 0 ]]; then
  say "（dry-run，追加 --apply 执行删除）"
else
  say "（--apply 将执行删除）"
fi

if [[ -f "$RT/db/sop.db" ]]; then
  say "【SQLite 遗留于 Web 目录】"
  remove_file "$WEB_DIR/sop.db"
  remove_file "$WEB_DIR/sop.db-wal"
  remove_file "$WEB_DIR/sop.db-shm"
fi

if [[ -d "$RT/logs" ]]; then
  say "【可能冗余的空日志目录】"
  remove_dir_if_empty "$WEB_DIR/logs"
  remove_dir_if_empty "$PP/logs"
fi

say "【历史 reinit 备份目录（若已空）】"
remove_dir_if_empty "$PP/.ai-reinit-backups"

say "✅ 完成。"
