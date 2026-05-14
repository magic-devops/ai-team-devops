# 安全与合规

## 威胁模型 STRIDE

| 类别 | 威胁 | 缓解 |
|------|------|------|
| **S**poofing 假冒 | 伪造身份调 API | JWT 签名 + Refresh + 短时效；mTLS 可选 |
| **T**ampering 篡改 | 改请求/审计日志 | 请求 HMAC + 时间戳 + nonce；审计哈希链 |
| **R**epudiation 抵赖 | 否认操作 | 全量审计入 WORM 存储 + 用户证书 |
| **I**nformation disclosure 泄露 | DB 拖库 / 日志 PII | 列加密（密钥/反思）+ 日志 PII 脱敏 |
| **D**enial of service 拒绝服务 | 频率攻击 / 资源耗尽 | slowapi 多维度限流 + 配额 + 熔断 |
| **E**levation of privilege 越权 | 跨租户/项目 | 行级 RLS + Casbin ABAC + 中间件强制 |

## 认证（三种方式）

### 1. JWT（人类 / Web UI）

- 算法：HS256（默认）/ RS256（企业 SSO 场景）
- 短时：access 1h，refresh 7d，旋转后旧 token 5 min 内仍可用
- 载荷：`sub / tid / role / username / exp / iat / jti`
- jti 在 Redis 黑名单 24h（登出/吊销立即生效）

### 2. API Key + HMAC + Timestamp + Nonce（自动化）

- 头：
  - `X-Api-Key: sop_xxxxxxxx`
  - `X-Sop-Timestamp: <unix秒>`（±5 分钟漂移）
  - `X-Sop-Nonce: <16 字节 base64url>`
  - `X-Sop-Signature: sha256=<hex>`
- 签名串：
  ```
  METHOD + "\n" + PATH + "\n" + X-Sop-Timestamp + "\n" + X-Sop-Nonce + "\n" + SHA256(body)
  ```
- 服务端：nonce LRU 300s 防重放；时钟漂移检查
- Key 长度 ≥ 32 字节随机 + 前缀 `sop_`（便于识别 / 在源码扫描出来）

### 3. mTLS（企业可选）

- Manager 配置受信 CA
- 证书 subject `CN=<project_id>,O=<tenant_id>`
- 可用于 sop-agentd ↔ Manager / 跨数据中心同步

## 授权（RBAC + ABAC）

| 层 | 实现 |
|----|------|
| Tenant 隔离 | DB 行级 `tenant_id` 列 + Postgres RLS 策略；中间件强制注入 |
| Project 成员 | `ProjectMember.role`（已有，七级） |
| 策略 | Casbin（M10 接入）：`p, project_admin, /api/v1/tasks/*, write` |
| 项目作用域 | 中间件解析 `X-Project-Id` 后注入；超级 admin 跨租户需显式 |
| 操作分级 | 低风险默认允许；中风险 approval；高风险必须人工 |

## 密钥管理

| 项目 | 存储 | 轮换 |
|------|------|------|
| `SECRET_KEY` (JWT) | env / Vault | 90 天，双 key 重叠 24h |
| Manager DB 密码 | Docker secret / KMS | 按需 |
| `ANTHROPIC_API_KEY` 等 LLM | Vault / KMS | 90 天 |
| API Key | 用户面板生成；hash 入库 | 用户自助；过期前 14d 通知 |
| 客户端 ApiKey（项目侧） | OS keyring（macOS Keychain / Linux Secret Service / Windows CredMan） | 同上 |
| Webhook secret | 创建时一次显示，hash 入库 | 用户手动轮换 |
| 列加密 KEK | AWS KMS / GCP KMS / 本地 SOPS（dev） | 年度 |

## 列加密（PII / 敏感）

需加密字段（Postgres 推荐 pgcrypto / 应用侧 AES-GCM）：
- `users.email`（PII，搜索用 hash 索引）
- `api_keys.key_hash`（已 hash，不需再加密）
- `webhook_configs.secret`
- `reflections.content`（可能含敏感推理）
- `vibe_uploads.*`（受密码保护的会话）

## 审计

- 所有写操作记 `audit_logs`
- 每条带 `prev_hash` 形成哈希链（M10）：
  ```
  hash_n = SHA256(canonical_json(row_n) || prev_hash)
  ```
- 周期性 anchor：每天最后一条 hash 写入只追加文件 / S3 Object Lock / 区块链锚定（企业版）
- 查询接口仅 super_admin / 审计员 / tenant_admin（受限）

## 数据生命周期

| 数据 | 保留 | 删除策略 |
|------|------|---------|
| 审计日志 | 365 天默认 | 归档到对象存储后清理 DB |
| Vibe 会话 | 90 天 | 软删 → 30 天硬删 |
| Webhook 投递日志 | 30 天 | 硬删 |
| 用户 PII | 用户主动删除立即处理（GDPR） | 哈希化脱敏 |
| 反思 / 规则 | 长期 | 置信度衰减自然废弃 |

## 网络安全

- TLS 1.3 强制（生产）
- HSTS + CSP + X-Content-Type-Options + Referrer-Policy
- CORS：白名单（不再 `*`）
- SSRF 防护：webhook URL 校验 + 拒绝私网 / 169.254.169.254 / loopback / link-local
- 速率限制：
  - 全局 IP：1000 req/min
  - 已登录用户：500 req/min
  - API Key：按 plan 配额
  - 登录端点：5 次/15min（防爆破）

## 依赖与供应链

- `pip-audit` + Dependabot 周扫描
- 锁定文件：`requirements.lock`（pip-tools）+ `go.sum`
- 镜像签名：cosign（生产镜像）
- SBOM 生成：CycloneDX

## 合规起点

| 标准 | 准备 |
|------|------|
| **SOC 2** | 审计 + 加密 + 访问控制 + 备份 + 事件响应（流程） |
| **GDPR** | DPIA 模板 + 删除接口 + 数据驻留（M12） |
| **ISO 27001** | 政策文档 + 风险评估（流程性） |
| **等保 2.0**（国内）| 三级所需技术控制项已覆盖 ~80%（剩 HA / 容灾） |

> 详尽控制项映射见 [`SECURITY_CONTROLS.md`](../security/CONTROLS.md)（M10 产出）
