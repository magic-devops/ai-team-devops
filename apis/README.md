# apis/ — Schema-First 单一事实源

> 修改协议 = 改这里 → 触发生成 → 代码与文档自动追随。

## 三份契约

| 文件 | 用途 | 工具 |
|------|------|------|
| [`openapi/openapi.yaml`](openapi/openapi.yaml) | REST `/api/v1/*` | OpenAPI 3.1 + Spectral lint |
| [`proto/sop/agent/v1/agent.proto`](proto/sop/agent/v1/agent.proto) | sop-agentd ↔ Manager gRPC | buf |
| [`asyncapi/asyncapi.yaml`](asyncapi/asyncapi.yaml) | 事件 / Webhook / WS | AsyncAPI 3 |

## 生成产物（M2 完成后由 CI 自动 build）

| 输出 | 路径 | 工具 |
|------|------|------|
| Python Pydantic models | `apps/manager/sop_manager/api/_generated/` | `datamodel-code-generator` |
| Python SDK | `packages/sop-sdk-python/sop_sdk/_generated/` | 同上 |
| TypeScript types + SDK | `apps/manager-web/src/api/_generated/` (M12) | `openapi-typescript` + `openapi-fetch` |
| Go SDK | `apps/agent-runtime/internal/api/_generated/` | `oapi-codegen` + `buf` |
| Markdown 文档 | `docs/api/v1/` | `redocly build-docs` |

## 本地生成

```bash
# 安装工具
pipx install datamodel-code-generator
pipx install spectral-cli
brew install bufbuild/buf/buf
npm i -g @redocly/cli openapi-typescript

# 生成 Pydantic
datamodel-codegen \
  --input apis/openapi/openapi.yaml \
  --input-file-type openapi \
  --output apps/manager/sop_manager/api/_generated/models.py \
  --output-model-type pydantic_v2.BaseModel

# 校验
spectral lint apis/openapi/openapi.yaml
buf lint apis/proto

# 生成 Go
buf generate apis/proto
```

> CI 工作流模板见 `.github/workflows/api-gen.yml`（M7 产出）

## 改契约的标准流程

1. 改 yaml / proto
2. `make api-gen` 重新生成
3. 跑测试（断言契约与实现一致）
4. 写 ADR 进 `memory/decisions/`
5. CHANGELOG 加条目
6. 如是 break change：双发期开始

## 交付待办和概览进度

`GET /api/v1/delivery/inbox` 使用 scope/category/limit/cursor 的服务端分页，counts 表达完整所选本人/团队范围、total 表达当前分类，返回固定 query_generation 与 UTC 日期绑定游标。人工完成未验证任务为 acceptance_kind=manual；原生执行待审为 execution。`GET /api/v1/delivery/progress/summary` 仅返回项目当前 metrics 与观测日期覆盖。两入口缺少 schema 2 派生索引时明确 409，GET 不写入或全量回退。详细示例见 [交付待办指南](../docs/DELIVERY_ATTENTION_GUIDE.md)。
