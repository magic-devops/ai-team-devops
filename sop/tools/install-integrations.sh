#!/usr/bin/env bash
# install-integrations.sh — 一键安装 AI Dev SOP 集成依赖（Python 版本锁定 + 安装校验）
#
# 用法:
#   bash sop/tools/install-integrations.sh
#   SOP_PYTHON=/usr/bin/python3.11 bash sop/tools/install-integrations.sh
#   INSTALL_INTEGRATIONS_RECREATE=1 bash sop/tools/install-integrations.sh   # 删除已有 venv 重建
#   INSTALL_INTEGRATIONS_SYSTEM=1 bash sop/tools/install-integrations.sh       # 不建 venv，装到当前 python 环境（不推荐）
#   WRITE_INTEGRATIONS_LOCK=1 bash sop/tools/install-integrations.sh           # 安装后写出 pip freeze 锁文件
#   INSTALL_MCP_NPM_PREFETCH=1 bash sop/tools/install-integrations.sh          # 预拉取 MCP npm 包（需 npm）
#   INSTALL_INTEGRATIONS_VENV=/path/.venv bash sop/tools/install-integrations.sh  # 自定义 venv 目录
#   INSTALL_INTEGRATIONS_QUIET=1 bash sop/tools/install-integrations.sh          # 静默 pip（适合 CI）
#   INSTALL_INTEGRATIONS_VERBOSE=1 bash sop/tools/install-integrations.sh        # pip 详细日志
#   INSTALL_INTEGRATIONS_LOG_TIME=1 bash sop/tools/install-integrations.sh       # 行首时间戳
#
# 相关文档: 仓库根 docs/USER_MANUAL.md、ARCHITECTURE.md、sop/web/README.md
#
set -euo pipefail

STEP_I=0
step() {
  STEP_I=$((STEP_I + 1))
  printf '\n━━━ 步骤 %d │ %s ━━━\n' "$STEP_I" "$*" >&2
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REQ_FILE="${INSTALL_INTEGRATIONS_REQUIREMENTS:-$SCRIPT_DIR/integrations-requirements.txt}"
VENV_DIR="${INSTALL_INTEGRATIONS_VENV:-$REPO_ROOT/.venv-integrations}"
LOCK_FILE="$SCRIPT_DIR/integrations-requirements.lock"
MCP_SMOKE_DIR="$SCRIPT_DIR/.mcp-npm-smoke"
# npm 上可核对的 MCP 包版本（与 .claude/settings.json 中 npx 建议保持一致时可手改此处常量）
MCP_SERVER_FILESYSTEM_PKG="${MCP_SERVER_FILESYSTEM_PKG:-@modelcontextprotocol/server-filesystem@2026.1.14}"

usage() {
  sed -n '1,22p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

for _arg in "$@"; do
  case "$_arg" in
    -h|--help) usage ;;
  esac
done

log() {
  if [[ -n "${INSTALL_INTEGRATIONS_LOG_TIME:-}" ]]; then
    printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
  else
    printf '%s\n' "$*"
  fi
}
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

# pip：默认进度条 + 下载日志；QUIET 时仅 -q；VERBOSE 在非 QUIET 时追加 -v（兼容 Bash 3.2，无 mapfile）
run_pip_install() {
  local py="$1"; shift
  if [[ -n "${INSTALL_INTEGRATIONS_QUIET:-}" ]]; then
    "$py" -m pip install -q --disable-pip-version-check "$@"
  else
    local b=(--disable-pip-version-check --progress-bar on)
    [[ -n "${INSTALL_INTEGRATIONS_VERBOSE:-}" ]] && b+=(-v)
    "$py" -m pip install "${b[@]}" "$@"
  fi
}

if [[ ! -f "$REQ_FILE" ]]; then
  die "未找到依赖清单: $REQ_FILE"
fi

# 选择 Python：优先 SOP_PYTHON，其次常见稳定版本，最后 python3
pick_python() {
  local candidates=()
  if [[ -n "${SOP_PYTHON:-}" ]]; then
    candidates+=("$SOP_PYTHON")
  fi
  for name in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$name" &>/dev/null; then
      candidates+=("$(command -v "$name")")
    fi
  done
  local seen="" bin=""
  for bin in "${candidates[@]}"; do
    [[ -z "$bin" || ! -x "$bin" ]] && continue
    case " $seen " in *" $bin "*) continue ;; esac
    seen+=" $bin"
    if "$bin" -c 'import sys; raise SystemExit(0 if (sys.version_info[:2] >= (3, 10)) else 1)' 2>/dev/null; then
      printf '%s' "$bin"
      return 0
    fi
  done
  return 1
}

resolve_python() {
  step "解析 Python 解释器"
  PYTHON_BIN="$(pick_python)" || die "未找到可用的 Python（需要 >= 3.10）。可设置 SOP_PYTHON=/绝对路径/python3.11"
  log "   已选用: ${PYTHON_BIN}"
  py_major="$("$PYTHON_BIN" -c 'import sys; print(sys.version_info[0])')"
  py_minor="$("$PYTHON_BIN" -c 'import sys; print(sys.version_info[1])')"
  log "   版本: ${py_major}.${py_minor}"
  if (( py_major > 3 || (py_major == 3 && py_minor >= 14) )); then
    log "⚠️  当前 Python ${py_major}.${py_minor}：部分依赖可能缺少预编译轮子（pyarrow/torch 等），强烈推荐 3.10–3.13，或通过 SOP_PYTHON 指定。"
  fi
}

install_into_venv() {
  step "准备虚拟环境"
  if [[ -n "${INSTALL_INTEGRATIONS_RECREATE:-}" && -d "$VENV_DIR" ]]; then
    log "🗑  已设置 INSTALL_INTEGRATIONS_RECREATE，移除旧虚拟环境: $VENV_DIR"
    rm -rf "$VENV_DIR"
  fi
  if [[ ! -d "$VENV_DIR" ]]; then
    log "📁 创建虚拟环境: ${VENV_DIR} （解释器: ${PYTHON_BIN}）"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    log "   ✓ venv 已创建"
  else
    log "📁 使用已有虚拟环境: ${VENV_DIR}"
  fi
  local py="$VENV_DIR/bin/python"

  step "升级基础打包工具 (pip / setuptools / wheel)"
  log "   执行: ${py} -m pip install … -U pip setuptools wheel"
  run_pip_install "$py" -U pip setuptools wheel
  log "   ✓ 基础工具已就绪"

  step "安装依赖清单（体积较大时请耐心等待：torch 等）"
  log "   清单文件: $REQ_FILE"
  run_pip_install "$py" -r "$REQ_FILE"
  log "   ✓ requirements 安装命令已结束"

  step "校验依赖完整性 (pip check)"
  if ! "$py" -m pip check; then
    die "pip check 未通过，请检查上方冲突说明。"
  fi
  log "   ✓ pip check 通过"
  VERIFY_PYTHON="$py"
}

install_system_python() {
  step "系统 Python 模式安装"
  log "⚠️  INSTALL_INTEGRATIONS_SYSTEM=1：将依赖安装到当前 Python 环境（可能影响系统/用户 site-packages）。"
  local py="$PYTHON_BIN"
  local extra=()
  if "$py" -c 'import sys; print(sys.prefix != getattr(sys, "base_prefix", sys.prefix))' 2>/dev/null | grep -q True; then
    log "   检测到已在虚拟环境中，无需 --break-system-packages"
  elif [[ -f /etc/debian_version ]]; then
    extra+=(--break-system-packages)
    log "   （检测到 Debian/Ubuntu 系，为 pip 追加 --break-system-packages）"
  fi
  log "📦 安装依赖: $REQ_FILE"
  run_pip_install "$py" "${extra[@]}" -r "$REQ_FILE"
  log "   ✓ requirements 安装命令已结束"
  step "校验依赖完整性 (pip check)"
  if ! "$py" -m pip check; then
    die "pip check 未通过。"
  fi
  log "   ✓ pip check 通过"
  VERIFY_PYTHON="$py"
}

verify_imports() {
  step "导入自检（核心包，逐模块）"
  "$VERIFY_PYTHON" - <<'PY'
import importlib
import sys

mods = [
    "lancedb",
    "pyarrow",
    "sentence_transformers",
    "fastapi",
    "uvicorn",
    "pandas",
]
failed = []
for i, m in enumerate(mods, 1):
    sys.stdout.write(f"   [{i}/{len(mods)}] import {m} ... ")
    sys.stdout.flush()
    try:
        importlib.import_module(m)
        ver = ""
        try:
            mod = sys.modules[m]
            v = getattr(mod, "__version__", None)
            if v:
                ver = f" (version {v})"
        except Exception:
            pass
        print(f"OK{ver}")
    except Exception as e:
        print(f"FAIL\n      {e}")
        failed.append((m, str(e)))
if failed:
    print("\n导入失败汇总:")
    for m, err in failed:
        print(f"  - {m}: {err}")
    raise SystemExit(1)
print("   ✓ 全部模块导入成功")
PY
}

maybe_write_lock() {
  if [[ -z "${WRITE_INTEGRATIONS_LOCK:-}" ]]; then
    return 0
  fi
  step "写入依赖锁文件 (pip freeze)"
  log "📝 输出: $LOCK_FILE"
  "$VERIFY_PYTHON" -m pip freeze > "$LOCK_FILE"
  local lines
  lines="$(wc -l < "$LOCK_FILE" | tr -d ' ')"
  log "   ✓ 已写入 ${lines} 行（供 CI/审计复现）"
}

maybe_prefetch_mcp_npm() {
  if [[ -z "${INSTALL_MCP_NPM_PREFETCH:-}" ]]; then
    return 0
  fi
  step "MCP npm 包预拉取（可选）"
  command -v npm &>/dev/null || { log "⚠️  未找到 npm，跳过 MCP npm 预拉取"; return 0; }
  log "📦 包: $MCP_SERVER_FILESYSTEM_PKG"
  mkdir -p "$MCP_SMOKE_DIR"
  (
    cd "$MCP_SMOKE_DIR"
    [[ -f package.json ]] || npm init -y >/dev/null
    npm install --no-save --no-audit --no-fund "$MCP_SERVER_FILESYSTEM_PKG"
  )
  log "✅ MCP 包已缓存在 $MCP_SMOKE_DIR/node_modules（仅供校验网络/版本；运行时仍常用 npx -y）"
}

index_custom() {
  if [[ -n "${SKIP_INTEGRATIONS_INDEX:-}" ]]; then
    step "知识库索引"
    log "⏭  已设置 SKIP_INTEGRATIONS_INDEX，跳过。"
    return 0
  fi
  if [[ ! -d "$REPO_ROOT/sop/custom" ]]; then
    step "知识库索引"
    log "ℹ️  无 sop/custom/ 目录，跳过。"
    return 0
  fi
  step "索引 sop/custom → LanceDB"
  log "   使用解释器: $VERIFY_PYTHON"
  if (cd "$REPO_ROOT" && PROJECT_PATH="$REPO_ROOT" "$VERIFY_PYTHON" sop/knowledge/lancedb_ops.py index-custom); then
    log "✅ custom/ 已写入知识库"
  else
    log "⚠️  知识库索引失败（可稍后手动执行: cd 仓库根 && $VERIFY_PYTHON sop/knowledge/lancedb_ops.py index-custom）"
  fi
}

# ── main ──────────────────────────────────────────────────────────
log "📦 AI Dev SOP 集成依赖安装"
log "   仓库根: $REPO_ROOT"
log "   依赖清单: $REQ_FILE"
if [[ -n "${INSTALL_INTEGRATIONS_QUIET:-}" ]]; then
  log "   模式: 静默 pip（INSTALL_INTEGRATIONS_QUIET=1）"
else
  log "   模式: 显示 pip 进度条与下载日志（设 INSTALL_INTEGRATIONS_QUIET=1 可关闭）"
fi
[[ -n "${INSTALL_INTEGRATIONS_VERBOSE:-}" ]] && log "   模式: pip 详细 -v（INSTALL_INTEGRATIONS_VERBOSE=1）"
[[ -n "${INSTALL_INTEGRATIONS_LOG_TIME:-}" ]] && log "   模式: 行首时间戳（INSTALL_INTEGRATIONS_LOG_TIME=1）"

resolve_python

if [[ -n "${INSTALL_INTEGRATIONS_SYSTEM:-}" ]]; then
  install_system_python
else
  install_into_venv
fi

verify_imports
maybe_write_lock
maybe_prefetch_mcp_npm

step "Node / npx 环境"
if command -v npx &>/dev/null; then
  log "✅ npx 可用；MCP 运行时示例（版本与 npm 发布一致时可固定 tag）:"
  log "   npx -y $MCP_SERVER_FILESYSTEM_PKG <args…>"
else
  log "⚠️  未找到 npx，Node MCP 将不可用。"
fi

index_custom

log ""
log "✅ 安装与校验完成。"
if [[ -z "${INSTALL_INTEGRATIONS_SYSTEM:-}" ]]; then
  log ""
  log "激活虚拟环境后使用本仓库 Python 工具:"
  log "  source \"$VENV_DIR/bin/activate\""
  log "  python sop/knowledge/lancedb_ops.py context '<任务描述>'"
  log "  python sop/integrations/agents/coder_backend.py --port 8001"
  log "  python sop/integrations/mcp/lancedb_server.py"
else
  log "使用已安装解释器: $VERIFY_PYTHON"
fi
