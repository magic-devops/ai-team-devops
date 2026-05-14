# 部署形态

## 三档部署模式

| 模式 | 适用 | 组件 | 资源 |
|------|------|------|------|
| **single** | 个人 / 小团队 / 本地试用 | Manager + SQLite + LanceDB（嵌入式） | 1 vCPU / 512 MiB |
| **saas** | 团队 / SaaS 多租户 | Manager + Postgres + Qdrant + Redis + (Centrifugo) | 2 vCPU / 2 GiB |
| **enterprise** | 大企业 / 私有化 / 多区域 | + Temporal + OTel + IdP + Vault + HA | 集群级 |

## 1. single（5 分钟上手）

```bash
pip install "ai-team-devops[manager,cli]"
sop-manager start --port 8765
# 或
docker compose -f apps/manager/docker-compose.single.yml up -d
```

数据落在 `${PROJECT_PATH}/.sop-runtime/`。

## 2. saas（生产推荐）

```bash
cp apps/manager/.env.example apps/manager/.env
# 编辑 .env：SECRET_KEY / DB_TYPE=postgres / VECTOR_DB_TYPE=qdrant / REDIS_URL ...

docker compose -f apps/manager/docker-compose.saas.yml \
  --profile realtime --profile observability up -d
```

服务清单：
- `sop-manager` — FastAPI 后端 + 静态前端
- `sop-postgres` — Postgres 16（含 pgvector 扩展）
- `sop-qdrant` — 向量库
- `sop-redis` — 缓存 / Streams 事件总线
- `sop-centrifugo`（profile=realtime） — WebSocket 推送
- `sop-otel`（profile=observability） — 可观测采集器

### 反向代理

推荐 Caddy / Nginx，强制 HTTPS：

```caddy
manager.example.com {
  encode gzip zstd
  reverse_proxy /api/* sop-manager:8765
  reverse_proxy /ws/* sop-centrifugo:8000
  reverse_proxy * sop-manager:8765
  header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
}
```

其中 **`/api/*`** 覆盖 Manager 的 **`/api/v1/*`** 等业务路径；**`/metrics`** 等根路径由同块中最后的 `reverse_proxy *` 一并转发到 Manager（与 `main.py` 挂载顺序一致即可）。

### 备份

```bash
# 数据库
docker exec sop-postgres pg_dump -U sop -Fc sop > backup-$(date +%F).pgdump
# 向量库
docker run --rm -v sop_qdrant_data:/data -v $PWD:/b alpine \
  tar czf /b/qdrant-$(date +%F).tar.gz -C /data .
# 工作区
tar czf workspace-$(date +%F).tar.gz workspace/
```

## 3. enterprise（Kubernetes）

```
charts/sop-manager/             ← Helm chart（M12 产出）
├── templates/
│   ├── deployment.yaml         ← 2+ 副本，HPA，PodDisruptionBudget
│   ├── service.yaml
│   ├── ingress.yaml            ← cert-manager 自动 TLS
│   ├── postgres-cluster.yaml   ← CloudNativePG operator
│   ├── qdrant.yaml             ← StatefulSet
│   ├── redis.yaml              ← Bitnami Redis Sentinel
│   ├── temporal.yaml           ← 子 chart
│   ├── otel.yaml
│   └── secrets-externalsecret.yaml ← 走 Vault / KMS
└── values.{prod,stage,dev}.yaml
```

要点：
- 副本：Manager ≥ 2，无状态；Temporal worker 独立 deployment
- 持久化：Postgres 用 Operator 做主备 + WAL 归档到 S3
- 网络：Ingress + cert-manager + WAF（cloudflare / AWS WAF）
- 密钥：Vault Agent Injector / ExternalSecrets Operator
- 监控：Prometheus + Grafana + Loki + Tempo（或托管 Grafana Cloud）

## 4. 项目侧 sop-agentd 部署

### macOS（launchd）

```xml
<!-- ~/Library/LaunchAgents/dev.sop.agentd.plist -->
<plist><dict>
  <key>Label</key><string>dev.sop.agentd</string>
  <key>ProgramArguments</key>
    <array><string>/usr/local/bin/sop-agentd</string></array>
  <key>WorkingDirectory</key><string>${PROJECT_PATH}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${PROJECT_PATH}/.sop-runtime/logs/agentd.log</string>
  <key>StandardErrorPath</key><string>${PROJECT_PATH}/.sop-runtime/logs/agentd.err</string>
</dict></plist>

# 由 sop CLI 自动写入：sop agentd install
launchctl load ~/Library/LaunchAgents/dev.sop.agentd.plist
```

### Linux（systemd user）

```ini
# ~/.config/systemd/user/sop-agentd.service
[Unit]
Description=sop agentd
After=network-online.target

[Service]
ExecStart=/usr/local/bin/sop-agentd
WorkingDirectory=%h/code/my-project
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

### Windows（NSSM / Service）

由 `sop agentd install` 走 NSSM 注册为 Windows Service。

## 5. CI / CD

- 每次 push 触发：lint + 单测 + 类型检查 + 依赖审计
- main 分支：构建 + 推 Docker registry + 自动部署 staging
- 标签 `v*`：发布到 PyPI + GitHub Releases + 镜像签名

详见 [`docs/playbooks/CICD.md`](../playbooks/CICD.md)。

## 6. 升级与回滚

- 后端：Manager 蓝绿 / 滚动；DB schema 用 Alembic（每次 PR 必有迁移文件）
- 协议：v1 内增量；break 必须 v2 双发
- 客户端：sop-agentd 自查 Manager `/api/v1/health` 中的 `min_agentd_version`，过低自动提示升级

## 7. 灾难恢复 RPO/RTO

| 模式 | RPO | RTO |
|------|-----|-----|
| single | 24h（用户主动备份） | 数小时 |
| saas | 1h（WAL 归档） | 30 min |
| enterprise | 5 min（多 AZ） | 15 min |
