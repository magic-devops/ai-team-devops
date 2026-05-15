#!/usr/bin/env bash
# build-sop.sh — 编译并安装 sop CLI（sop-sdk + sop-cli）
#
# 安装后终端应有 `sop` 命令（在 venv 内或当前 Python 的 bin 目录）。
#
# 用法:
#   bash scripts/build-sop.sh                 # 可编辑安装（开发推荐）
#   bash scripts/build-sop.sh --venv .venv    # 创建/使用 .venv 再安装
#   bash scripts/build-sop.sh --wheel         # 仅构建 wheel 到 dist/
#   bash scripts/build-sop.sh --agentd        # 同时构建 sop-agentd（需 Go）
#   bash scripts/build-sop.sh --start-agentd  # 安装后启动 sop-agentd（需已构建二进制）
#   bash scripts/build-sop.sh --doctor        # 安装后执行 sop doctor
#   bash scripts/build-sop.sh --all           # --agentd --verify --doctor（不自动 start-agentd）
#   bash scripts/build-sop.sh --verify        # 安装后执行 sop --version
#   bash scripts/build-sop.sh --uv            # 强制用 uv workspace sync
#   bash scripts/build-sop.sh --pip           # 强制用 pip install -e
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="editable"   # editable | wheel
USE_VENV=""
WITH_AGENTD=0
START_AGENTD=0
RUN_DOCTOR=0
VERIFY=0
INSTALLER=""      # auto | uv | pip

step() { printf '\n\033[1;36m[build-sop]\033[0m %s\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }
die()  { printf '  ❌ %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  echo
  echo "组合示例:"
  echo "  bash scripts/build-sop.sh --venv .venv --agentd --doctor"
  echo "  make build-all    # 等同 --agentd --verify"
  echo "  make dev-env      # 全量开发环境（见 scripts/dev-env.sh）"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --venv)
      USE_VENV="${2:?--venv 需要路径}"
      shift 2
      ;;
    --wheel) MODE="wheel"; shift ;;
    --agentd) WITH_AGENTD=1; shift ;;
    --start-agentd) START_AGENTD=1; shift ;;
    --doctor) RUN_DOCTOR=1; shift ;;
    --all) WITH_AGENTD=1; VERIFY=1; RUN_DOCTOR=1; shift ;;
    --verify) VERIFY=1; shift ;;
    --uv) INSTALLER="uv"; shift ;;
    --pip) INSTALLER="pip"; shift ;;
    *) die "未知参数: $1（--help 查看用法）" ;;
  esac
done

if [[ -n "$USE_VENV" ]]; then
  if [[ ! -d "$USE_VENV" ]]; then
    step "创建虚拟环境 $USE_VENV"
    python3 -m venv "$USE_VENV"
  fi
  # shellcheck disable=SC1091
  source "$USE_VENV/bin/activate"
  ok "已激活 venv: $(python -c 'import sys; print(sys.prefix)')"
fi

_have_uv() { command -v uv &>/dev/null && [[ -f "$ROOT/pyproject.toml" ]]; }

_run_sop() {
  if command -v sop &>/dev/null; then
    sop "$@"
  elif [[ -f "$ROOT/packages/sop-cli/sop_cli/__main__.py" ]]; then
    local _pp="$ROOT/packages/sop-cli:$ROOT/packages/sop-sdk-python"
    PYTHONPATH="$_pp${PYTHONPATH:+:$_pp}" python3 -m sop_cli "$@"
  else
    return 127
  fi
}

if [[ "$MODE" == "wheel" ]]; then
  step "构建 wheel（sop-sdk + sop-cli）"
  mkdir -p "$ROOT/dist"
  if [[ "$INSTALLER" != "pip" ]] && _have_uv; then
    uv build --package sop-sdk -o "$ROOT/dist"
    uv build --package sop-cli -o "$ROOT/dist"
  else
    python3 -m pip install -q build
    python3 -m build "$ROOT/packages/sop-sdk-python" -o "$ROOT/dist"
    python3 -m build "$ROOT/packages/sop-cli" -o "$ROOT/dist"
  fi
  ok "产物目录: $ROOT/dist/"
  ls -1 "$ROOT/dist"/*.whl 2>/dev/null || true
  echo
  echo "安装 wheel: pip install dist/sop_sdk-*.whl dist/sop_cli-*.whl"
  exit 0
fi

step "可编辑安装 sop-sdk + sop-cli"
if [[ "$INSTALLER" == "pip" ]]; then
  python3 -m pip install -e "packages/sop-sdk-python[keyring]" -e "packages/sop-cli[all]"
elif [[ "$INSTALLER" == "uv" ]] || { [[ -z "$INSTALLER" ]] && _have_uv; }; then
  uv sync --package sop-sdk --package sop-cli
  ok "uv sync 完成（workspace 成员已链接到当前环境）"
else
  python3 -m pip install -e "packages/sop-sdk-python[keyring]" -e "packages/sop-cli[all]"
fi
ok "sop-cli 已安装"

if [[ "$WITH_AGENTD" -eq 1 ]]; then
  if command -v go &>/dev/null; then
    step "构建 sop-agentd"
    (cd apps/agent-runtime && make build)
    ok "二进制: apps/agent-runtime/bin/sop-agentd"
  else
    warn "未安装 Go，跳过 sop-agentd（见 apps/agent-runtime/README.md）"
  fi
fi

if [[ "$VERIFY" -eq 1 ]] || [[ -z "$USE_VENV" ]]; then
  step "验证 sop 命令"
  if command -v sop &>/dev/null; then
    if ! sop --version 2>/dev/null; then
      sop --help >/dev/null
    fi
    ok "PATH 中的 sop: $(command -v sop)"
  elif _run_sop --help >/dev/null 2>&1; then
    ok "可通过 python -m sop_cli 运行（建议 source venv 或 make build-sop --venv .venv）"
  else
    warn "当前 shell 的 PATH 中尚无 sop"
    echo "  若使用了 --venv，请先: source ${USE_VENV:-.venv}/bin/activate"
    echo "  或: export PATH=\"\$(python3 -m site --user-base)/bin:\$PATH\""
  fi
fi

if [[ "$START_AGENTD" -eq 1 ]]; then
  step "启动 sop-agentd"
  if ! _run_sop agentd start 2>/dev/null; then
    warn "sop agentd start 失败（先 make build-agentd 或 bash scripts/build-sop.sh --agentd）"
  fi
fi

if [[ "$RUN_DOCTOR" -eq 1 ]]; then
  step "运行 sop doctor"
  _run_sop doctor || true
fi

echo
echo "── 获取 sop 命令的几种方式 ──"
echo "  1) 本脚本（开发）: bash scripts/build-sop.sh --venv .venv && source .venv/bin/activate"
echo "  2) uv workspace:   uv sync && source .venv/bin/activate"
echo "  3) Make:           make build-sop | make build-all | make dev-env"
echo "  4) 发布 wheel:     bash scripts/build-sop.sh --wheel && pip install dist/sop_*.whl"
echo "  5) 一键环境:       bash ai-sop-ops/bootstrap-dev.sh"
echo
echo "验证: sop --help && sop doctor"
echo "文档: docs/TOOLS_AND_SCRIPTS.md"
