# Hermes v1 自动化验收记录

日期：2026-09-08。版本：1.0.0。范围：外部 Agent、Squads、间隔调度、
端侧配对与命令执行。本文不是 Multica 全量对齐或五平台发布通过声明。

## 真实执行

验收使用独立 Core 数据目录、独立工作空间和测试仓库。密钥不进入本文、
Git 或审计导出；下列运行 ID 可在对应验收工作空间内追溯。

| 场景 | 实际结果 | 证据 |
| --- | --- | --- |
| Codex 提供方失败 | 本机默认模型不被当前 CLI 支持，运行真实失败，没有伪造成功 | `35f1fa2fc9c845b1b51e6ec2956c0713`，exit 1 |
| Codex 明确模型配置 | gpt-5.5 真实调用、Go 进程执行、提供方成功事件与 exit 0 | `c596b6d0d4584247b8501ff249954b02`，`HERMES_AGENT_OK` |
| Squad Leader 委派 | Leader 返回结构化成员选择，所选成员实际执行；任务等待人工审查 | `3cd2fe066afe4842aa9e8125145d2a4a`，`HERMES_SQUAD_OK` |
| 浏览器远程派发 | 创建任务、选择已配对设备、预览、应用、启动；打包 Worker 领取并执行 | `fc0471b8544c4427b65dd85f0d83769b`，`HERMES_REMOTE_OK`，exit 0 |
| 设备撤销 | 浏览器撤销后，同一打包 Worker 再次领取失败 | HTTP 403 `/api/hermes/v1/remote/claim`，进程 exit 1 |
| 浏览器周期调度 | 预览不创建资源；修改间隔使预览失效；重新预览后应用，后台自动执行 | `9728a7285dcb703b3d6e8cfcada06a39`，trigger=`scheduled`，`HERMES_SCHEDULE_OK` |
| 调度暂停 | 使用最新版本暂停，状态为 paused、enabled=false | `browser-schedule-20260908`，version 4；验收后保持暂停 |
| 审计导出 | 浏览器导出远程运行审计包 | artifact `16d611de646644fd81da5a4e27e45941` |

远程审计包 SHA-256：
`e4a5d4a3931d6a4179a7c381e8a7510551d781ee54477a7af7a33e13ce0f7f27`。

Codex 成功运行记录原始 usage：input 30952、cached input 2432、output 26、
reasoning 15。没有据此估造价格或跨提供方成本。

远程 Worker 使用随包的 `hermes-core remote-worker` 与 Go `sop-agentd`，
执行机器不依赖外部 Python 命令。该测试是在同一 macOS 上通过 HTTP 协议运行的
独立进程，不代表已完成公网、多主机或移动真机验证。

## 自动验证

聚合入口：

```sh
FLUTTER_BIN=/path/to/flutter .venv/bin/python scripts/hermes-readiness.py --full --json
HERMES_TEST_AGENTD=/path/to/sop-agentd .venv/bin/python -m pytest packages/hermes-core/tests -q
bash scripts/hermes-package.sh --core-only
```

- Core 91 项通过，零跳过；覆盖真实 Go 进程、跨 scope 拒绝、旧租约、
  旧配对凭据、远程失败后重试、幂等回执与调度工作空间版本变化。
- SDK/CLI 43 项通过，包括真实 Core 路由、JSON 结构与顶层命令注册。
- Web 全量 178 项通过；typecheck、生产构建通过。
- Flutter analyze 通过，57 项测试通过；包含 390x844 与 1440x900 布局。
  最后一项 SDK 回归在聚合 gate 后补跑，确认 actions() 保留权限数组而非字符串化。
- 聚合 gate 47 项通过，1 项失败：`flutter.build.macos` 缺少 `xcodebuild`。
  `ok=false`、`release_ready=false` 保持真实状态。
- macOS arm64 Core-only 包构建通过，481 项清单验证通过，包内健康检查、
  诊断与真实命令执行通过。产物是未签名运行包，不是 Flutter GUI 安装器。

## 人工验收发现与修复

- 调度预览曾关闭表单、误报保存并保留 loading；现在预览内联展示，修改后失效，
  预览与应用复用幂等键，不能直接应用未预览的计划。
- 远程 Agent/Squad/命令派发同样要求当前计划的预览，不能复用修改前预览。
- 设备邀请按公开契约读取过期时间；密钥仅在页面内存中遮罩显示，关闭即清除。
- 自动调度更新资源版本后，旧页面操作被后端拒绝，不自动重试写入。
  客户端刷新版本、保留冲突提示后由用户重新操作。
- 历史证据与 CLI 按需展开；运行完成不自动接受任务交付。
- 调度历史表直接打开指定运行，人工回读 stdout 成功。浅色、深色和系统主题
  采用相同共享令牌；390x844 首屏可见调度记录，表格横向滚动而非把标题挤成竖排。
- Flutter 设备创建只提交公开契约允许的 title/name/platform；不再展示或提交
  未支持的 endpoint/notes。widget 回归对实际提交字段实施严格白名单。
- `/actions` 使用完整 permissions 数组；通用 create/update 改为具体资源动作，
  不再把 Agent 配置权限误报为 write。运行内核的 HTTP 回读和静态目录一致性均通过。
- Core 立即重启的 TIME_WAIT 冲突已修复：POSIX 使用地址复用，Windows 使用
  独占绑定；真实 HTTP 连接后停止并重启、另一活跃 Core 的端口冲突均有回归。

## 尚未通过的边界

完整差异矩阵见 [Multica 对齐说明](HERMES_MULTICA_ALIGNMENT.md)。
Cron/时区、Webhook、多触发器、远程 Agent/worktree、完整 runtime 目录、
多提供方 Chat、技能安装、渠道集成与团队管理仍不能标记为完成。
Claude/OpenCode 本轮是协议回归，未提供真实认证调用证据。
Windows/Linux/iOS/Android 真机、Flutter macOS GUI、签名公证及商店发布尚未验收。

本阶段只提交相关实现与规约；本地配置、运行记忆、锁文件以及其他并行任务的改动保留。
