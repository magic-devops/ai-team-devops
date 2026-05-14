# 持续重构计划（AI-Friendly Split Plan）

> 任何 AI / 人 在修改本仓时应优先遵循"先看本文件→再决定动哪儿"。

## 1. 大文件治理目标

| 文件 | 当前行数 | 目标 | 拆分动作 |
|------|----------|------|----------|
| `sop/web/routers/docker_env.py` | 1660 | < 60 行 facade | 拆 6 个子模块入 `routers/env/` |
| `sop/web/routers/orchestration.py` | 820 | < 400 | 抽 `_workflow.py`、`_sprint.py` 子模块 |
| `sop/web/routers/vibe.py` | 605 | < 350 | 抽 `_vibe_codegen.py` |
| `sop/web/routers/system.py` | 594 | < 350 | 抽 `_health.py`、`_diag.py` |
| `sop/web/routers/requirements.py` | 575 | < 350 | 抽 `_parser.py` |

## 2. 通用拆分规则

1. **路由前缀不变**：URL 路径稳定，前端零改动
2. **保留 facade**：原文件保留 import 重导出，避免外部 import 路径碎裂
3. **新增功能不入旧文件**：新增 endpoint 一律放对应子包
4. **共享工具下沉**：`_run`、`_validate_*` 等 utility 抽到 `_exec.py`
5. **每完成一步：跑 `uvicorn main:app --reload` 验证路由表无回退**

## 3. 已落地的 AI 安全编辑约定

所有"必须 AI 修改"的文件顶部必须含以下注释块：

```
@module: <import 路径>
@purpose: 一行用途说明
@stable: 哪些 API 是稳定契约
@ai_safe_edit:
  - 允许的修改模式 1
  - 允许的修改模式 2
@deps_in: 上游依赖
```

文件最大行数 ≤ 500（路由/服务）/ ≤ 800（聚合根/编排）；超出请按上表拆分。

## 4. 新功能落点指引（给 AI）

| 想加什么功能 | 放哪儿 |
|--------------|--------|
| 新的 LLM 提供商 | `sop/web/routers/llm_gateway.py` 的 `_PROVIDERS` 字典 |
| 新的向量库 | `sop/web/routers/vector_store_iface.py` 新加 Class 实现 `VectorStore` |
| 新的工作流类型 | `sop/web/routers/workflow.py` 加 `@register("...")` 协程 |
| 新的市场源 | `SOP_MARKETPLACE_REGISTRIES` 环境变量追加 |
| 新的 SSO IdP | `SOP_SSO_PROVIDERS` 环境变量 + IdP 端配置 |
| 新的 env 路由 | `sop/web/routers/env/<topic>.py`（**不要塞 docker_env.py**） |
| 新的前端页面 | `apps/web-next/src/pages/<X>.tsx` + `App.tsx` NAV 数组 |
| 新的 CLI 子命令 | `packages/sop-cli/sop_cli/commands/<x>.py` + `__main__.py` 注册 |

## 5. 持续度量

- 每周跑：`wc -l sop/web/routers/*.py | sort -rn | head -10`
- 单文件 > 500 行触发 issue 自动建单（M11 反思蒸馏后台任务）
- CI 上跑 ruff + mypy + pyright + tsc，超阈值阻止合并
