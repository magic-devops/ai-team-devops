# 平台仓顶层 Makefile（常用开发入口）
.PHONY: help build-sop install-sop wheel-sop build-agentd build-all verify-sop full-readiness \
        doctor integration-check install-completion start-agentd stop-agentd dev-env bootstrap-dev \
        deploy-up deploy-down stack-start stack-stop stack-health health-check

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
	@echo "  make integration-check  # Manager + sync + agentd 冒烟"
	@echo "  make install-completion # 安装 sop bash Tab 补全"
	@echo "  make start-agentd    # 启动 sop-agentd"
	@echo "  make stop-agentd     # 停止 sop-agentd"
	@echo "  make verify-sop      # 检查 sop 是否在 PATH"
	@echo "  make full-readiness  # 全域 readiness：backend/frontend/CLI/SDK/权限/scope/脚本"
	@echo "  make deploy-up       # Docker 单机 up（scripts/deploy.sh）"
	@echo "  make deploy-down     # Docker 单机 down"
	@echo "  make stack-start     # 本地 Manager 后台 + wait-health"
	@echo "  make stack-stop      # 停止本地栈"
	@echo "  make stack-health    # stack doctor + health-check"
	@echo "  make health-check    # ai-sop-ops/health-check.sh"
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

integration-check:
	PROJECT_PATH="$(CURDIR)" bash scripts/sop-integration-check.sh

install-completion:
	@command -v sop >/dev/null && sop completion install bash || \
	  (PYTHONPATH=packages/sop-cli:packages/sop-sdk-python python3 -m sop_cli completion install bash)

start-agentd:
	@command -v sop >/dev/null && sop agentd start || \
	  (PYTHONPATH=packages/sop-cli:packages/sop-sdk-python python3 -m sop_cli agentd start)

stop-agentd:
	@command -v sop >/dev/null && sop agentd stop || \
	  (PYTHONPATH=packages/sop-cli:packages/sop-sdk-python python3 -m sop_cli agentd stop)

verify-sop:
	@command -v sop >/dev/null && sop --version || (echo "sop 未在 PATH；运行: make build-sop" && exit 1)

full-readiness:
	@command -v sop >/dev/null && sop system readiness --full --json || \
	  (PYTHONPATH=packages/sop-cli:packages/sop-sdk-python python3 -m sop_cli system readiness --full --json)

deploy-up:
	PROJECT_PATH="$(CURDIR)" bash scripts/deploy.sh up single

deploy-down:
	bash scripts/deploy.sh down single

stack-start:
	bash scripts/stack.sh start

stack-stop:
	bash scripts/stack.sh stop

stack-health:
	bash scripts/stack.sh doctor

health-check:
	PORT=$${PORT:-8765} PROJECT_PATH="$(CURDIR)" bash ai-sop-ops/health-check.sh
