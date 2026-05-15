# 平台仓顶层 Makefile（常用开发入口）
.PHONY: help build-sop install-sop wheel-sop build-agentd build-all verify-sop \
        doctor start-agentd stop-agentd dev-env bootstrap-dev

help:
	@echo "Targets:"
	@echo "  make build-sop       # 可编辑安装 sop CLI（bash scripts/build-sop.sh --verify）"
	@echo "  make install-sop     # 同 build-sop"
	@echo "  make wheel-sop       # 构建 wheel 到 dist/"
	@echo "  make build-agentd    # 构建 Go 守护进程 sop-agentd"
	@echo "  make build-all       # sop CLI + sop-agentd + verify"
	@echo "  make dev-env         # 全量本地开发环境（venv + CLI + agentd + doctor）"
	@echo "  make bootstrap-dev   # ai-sop-ops/bootstrap-dev.sh（含 Manager 依赖）"
	@echo "  make doctor          # sop doctor 端到端自检"
	@echo "  make start-agentd    # 启动 sop-agentd"
	@echo "  make stop-agentd     # 停止 sop-agentd"
	@echo "  make verify-sop      # 检查 sop 是否在 PATH"
	@echo ""
	@echo "文档: docs/TOOLS_AND_SCRIPTS.md"

build-sop install-sop:
	bash scripts/build-sop.sh --verify

wheel-sop:
	bash scripts/build-sop.sh --wheel

build-agentd:
	$(MAKE) -C apps/agent-runtime build

build-all:
	bash scripts/build-sop.sh --agentd --verify

dev-env:
	bash scripts/dev-env.sh --venv .venv

bootstrap-dev:
	bash ai-sop-ops/bootstrap-dev.sh

doctor:
	@command -v sop >/dev/null && sop doctor || \
	  (PYTHONPATH=packages/sop-cli:packages/sop-sdk-python python3 -m sop_cli doctor)

start-agentd:
	@command -v sop >/dev/null && sop agentd start || \
	  (PYTHONPATH=packages/sop-cli:packages/sop-sdk-python python3 -m sop_cli agentd start)

stop-agentd:
	@command -v sop >/dev/null && sop agentd stop || \
	  (PYTHONPATH=packages/sop-cli:packages/sop-sdk-python python3 -m sop_cli agentd stop)

verify-sop:
	@command -v sop >/dev/null && sop --version || (echo "sop 未在 PATH；运行: make build-sop" && exit 1)
