# 长期演进与兼容承诺

## 版本节奏

- 主版本（**v2** → **v3**）：≥ 18 个月一次；带破坏性变更
- 次版本（v2.0 → v2.x）：每月；新增字段/接口，不破坏
- 补丁（v2.x.y）：随时；仅 bug fix

## 兼容承诺

| 接口 | 兼容窗口 |
|------|---------|
| REST `/api/v1/*` | ≥ 12 个月，删除前 6 个月起 `Deprecation` header + 文档高亮 |
| Webhook event | ≥ 12 个月；新版本上线后 24h 双发 |
| WebSocket / CloudEvents | minor 内向后兼容；消费者按 `schema_version` 适配 |
| MCP tool | 新增可选字段不算 break；改语义 → 新 tool 名 |
| CLI 命令 | ≥ 12 个月；移除前 6 个月起打 warning |
| 配置 / env | ≥ 12 个月；改名期间双键同时识别 |
| 数据库 schema | Alembic 单向迁移；不删表，仅 deprecate |

## 里程碑路线（v2.0 → v3.0）

### v2.0（当前主线，2026 H1）
- M1 ✅ 目录骨架
- M2 Schema-First openapi.yaml
- M3 sop CLI / SDK
- M4 sop-agentd Go MVP

### v2.1（2026 Q3）
- M5 LLM Gateway + RAG 流水线
- M6 DDD 模块切薄
- M7 OpenTelemetry + 审计哈希链

### v2.2（2026 Q4）
- M8 Temporal 工作流
- M9 协议完备（WS/MCP/A2A/gRPC）
- M10 安全硬化（HMAC+ts+nonce / 列加密 / 密钥轮换）

### v2.3（2027 Q1）
- M11 插件系统 + AI Copilot + 市场
- 新前端 Vite/TS/shadcn 起步（与旧前端并行）

### v3.0（2027 H2）
- M12 完成：企业功能 SSO/SAML/ABAC/HA/多区域
- 旧 Babel 前端下线
- gRPC 默认开启
- 移除 v1 deprecated 接口

## 弃用流程（5 步）

1. **决策**：ADR 写入 `memory/decisions/`
2. **公告**：CHANGELOG 标记 + 文档加 ⚠️
3. **警告**：API 返回 `Deprecation` / `Sunset` header；CLI 打 warning
4. **替代品**：必须先有新版本就位
5. **移除**：≥ 12 个月窗口后

## 数据迁移策略

- **Alembic 单向**：所有 schema 变更通过迁移文件
- **影子双写**（破坏性变更）：
  ```
  阶段 1：双写（旧 + 新）
  阶段 2：双读（验证一致性）
  阶段 3：切换读到新
  阶段 4：停写旧；保留旧表 30 天
  阶段 5：删除旧表
  ```
- **数据导出**：永远提供 `/api/v1/export/{domain}` 让用户拿走自己的数据

## 技术债策略

每月一次 "Tech Debt Day"：
- 跑 `ruff` / `vulture` / `radon` 找复杂热点
- 升级关键依赖（pin → 测试 → 解 pin）
- 移除 deprecated 代码（注释超过 12 月的）
- 文档与代码差异修复

## AI 反向贡献

允许 AI 提案改动：
- AI 在 `propose_changes/` 写差异方案
- 人工审核 → merge
- 凡是 AI 提出的改动，commit message 自动加 `[ai-proposed]`，便于回溯
