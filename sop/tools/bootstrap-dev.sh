#!/usr/bin/env bash
# bootstrap-dev.sh — 一键拉起 v2 新版开发环境
#
#   * 安装 sop-sdk + sop-cli（packages/）
#   * 装 Manager 依赖（apps/manager 或退回 sop/web/requirements.txt）
#   * 若可用，构建 sop-agentd Go 二进制
#   * 执行 sop doctor（如果安装了 CLI）
#
# 用法:
#   bash sop/tools/bootstrap-dev.sh         # 全量
#   bash sop/tools/bootstrap-dev.sh --skip-agentd
#   SOP_BOOTSTRAP_VENV=.venv bash sop/tools/bootstrap-dev.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
SKIP_AGENTD=0
SKIP_DOCTOR=0
for a in "$@"; do
  case "$a" in
    --skip-agentd) SKIP_AGENTD=1 ;;
    --skip-doctor) SKIP_DOCTOR=1 ;;
  esac
done

step() { printf '\n\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }

# venv（可选）
if [[ -n "${SOP_BOOTSTRAP_VENV:-}" ]]; then
  if [[ ! -d "${SOP_BOOTSTRAP_VENV}" ]]; then
    step "创建虚拟环境 ${SOP_BOOTSTRAP_VENV}"
    python3 -m venv "${SOP_BOOTSTRAP_VENV}"
  fi
  # shellcheck disable=SC1091
  source "${SOP_BOOTSTRAP_VENV}/bin/activate"
  ok "venv 已激活：$(python -c 'import sys;print(sys.prefix)')"
fi

step "安装 SDK 与 CLI（可编辑模式）"
pip install -e "packages/sop-sdk-python[keyring]" -e "packages/sop-cli[all]"
ok "sop-sdk + sop-cli"

step "安装 Manager 依赖（不带前端构建工具）"
if [[ -f "apps/manager/pyproject.toml" ]]; then
  pip install -e "apps/manager[postgres,redis,otel,llm,embeddings,vector-lance]" || {
    warn "apps/manager extras 安装失败，退回 sop/web/requirements.txt"
    pip install -r sop/web/requirements.txt
  }
else
  pip install -r sop/web/requirements.txt
fi
ok "Manager 依赖完成"

if [[ "${SKIP_AGENTD}" -eq 0 ]]; then
  if command -v go &>/dev/null; then
    step "构建 sop-agentd Go 二进制"
    (cd apps/agent-runtime && make build) || warn "go build 失败（可稍后再做：cd apps/agent-runtime && make build）"
  else
    warn "未检测到 Go；跳过 sop-agentd 构建（参见 apps/agent-runtime/README.md）"
  fi
fi

if [[ "${SKIP_DOCTOR}" -eq 0 ]] && command -v sop &>/dev/null; then
  step "运行 sop doctor"
  sop doctor || true
fi

echo
echo "✨ 全部就绪。常用命令："
echo "  sop init <project>              # 初始化项目（也可直接 bash sop/tools/init-ai-project.sh）"
echo "  sop agentd start                # 启动守护进程"
echo "  sop-manager start --reload      # 启动 Manager"
echo "  bash sop/tools/start-manager.sh # 兼容旧入口"
echo "  bash sop/tools/health-check.sh  # 健康检查"
