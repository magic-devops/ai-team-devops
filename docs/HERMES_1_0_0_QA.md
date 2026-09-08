# Hermes 1.0.0 交付验收

日期：2026-09-08。产品名称 Hermes v1，产品版本 `1.0.0`。
工作空间入口 `#/workspace`，API 前缀 `/api/hermes/v1`。

## 本轮范围

- Core、Manager、Worker、CLI、SDK、Go 执行器、Flutter 和 Web 产品版本归一。
- 任务、需求、会话、资产的业务表单、结构化详情、权限反馈和上下文隔离。
- 审批重复提交、状态幂等、资源筛选与领域校验的正确性。
- 安装脚本、生成契约、页面注册和交互规约同步。

这不是全平台发布完成声明。设备配对、远程执行所有权、外部 Agent 适配、
完整 IDE/终端体验和各平台签名安装仍按能力矩阵单独验收。

## 已观察的真实操作

| 验收项 | 证据 |
| --- | --- |
| Core 版本 | 本地 `/api/hermes/v1/health` 返回 `ok=true, version=1.0.0` |
| 无旧协议别名 | 同一 Core 的 `/api/v2/health` 返回 404 |
| CLI 版本 | `sop --version` 输出 `sop 1.0.0`，退出码 0 |
| CLI 离线失败 | 不可达回环端点返回 `ok=false` JSON，退出码 1，不产生写入 |
| Web 创建工作空间 | 创建“交付验收工作空间”，ID `5aead3b25c354959b1edcdb25287aff0` |
| Web 创建及编辑任务 | 任务 `c025c04df3514f6789df25e7b6d4fb43` 从版本 1 更新至版本 2，状态 completed，CLI 回读一致 |
| Web 清空可选字段 | 同一任务版本 3，描述通过表单提交为空字符串，SDK 回读一致 |
| Web 创建需求 | `1bed9cc5a3964ec5b6d5058b0aed1465`，带验收描述，SDK 回读一致 |
| Web 知识资产 | `d0fd9c3685204cbaa11605442132a960`，类型 knowledge，正文保存交付复盘，SDK 回读一致 |
| 真实双审批运行 | `d6cba6f325a7453c8abdc18a765e157e`：Red 预期退出码 1，通过两次独立审批后 Green 写入文件，最终 completed / 资源版本 18 |
| 交付文件 | `/private/tmp/hermes-v1-qa/hermes-v1-verified.txt`，内容 `Hermes 1.0.0 verified`，SHA256 `69d3cf04d34f8078ae3f1b1b3d78b4cfbf88eb67a138ad1bd131304299541bc3` |
| 无副作用回放 | 页面返回 `dry_run=true, would_execute=false`，原运行保持 completed / 版本 18 |
| 审计导出 | 页面生成 artifact `323cf8a7e37d4697b5dc66d3e3a31455`，含运行快照、事件、actor、trace_id；包内容 SHA256 `16cdb4cc9f9d2ee8cc1e987bc449d2259ebc192f9ba83050ea37b3e976da8ec2` |
| Go 版本 | `go run ./cmd/sop-agentd version` 输出 `1.0.0` |
| 包元数据 | 本地 editable 安装的 Core、Manager、Worker、CLI、SDK 均为 `1.0.0` |

验收数据位于独立的本地临时工作区，凭据仅保存在该工作区的受限 token 文件，
没有写入本文档。此前迭代的 QA 记录不作为本轮新接口执行证据。

## 自动化与打包证据

- 全量门禁：22 项通过，1 项失败，`release_ready=false`。唯一失败项
  `flutter.build.macos`，本机缺少完整 Xcode / xcodebuild；CocoaPods 也未安装。
- Core 26 个测试通过，包含真实 Go 执行器；Manager 3 个测试通过；
  CLI/SDK 18 个测试通过；生成契约 1 个测试通过；Go 测试通过。
- Web 23 个文件、134 个测试通过，TypeScript 和 Vite build 通过。
  最后文案与输出清理后再次运行测试和构建通过。存在大于 500 kB 的构建分块警告。
  此处测试包括源码契约检查，不等同于 134 个浏览器端到端用例。
- Flutter analyze 无问题，11 个测试通过，覆盖桌面/移动尺寸、权限禁用、
  上下文变更和可选字段清空；不等同于原生安装测试。
- 审批恢复独立复核：并发重复决定仅有一次状态写入；过期恢复作业在事务内
  被拒绝，不能抢占下一审批节点的执行所有权；有效作业仍完成一次交付。
- `bash scripts/hermes-package.sh --core-only` 成功，冻结 Python Core 和 Go
  执行器实际启动并完成执行 smoke。产物为未签名的 macOS arm64 运行时包，
  不是含 Flutter 的安装器：`dist/hermes-1.0.0-macos-arm64-core-only.tar.gz`。
  SHA256：`e5e05579c55983c70ab6e6a50f2da5406eb6273fc4d3be4eec29f18438ea3935`。

## 发布边界

- 本机没有完整 Xcode，无法证明 macOS 原生客户端构建与安装成功。
- Windows、Linux、iOS、Android 真机验收，以及签名、公证和商店分发尚未完成。
- Web 浏览器操作和 Flutter 组件测试不能替代五平台安装验收。
- 不把静态通过、开发包生成或任务状态 completed 当成生产交付证明。
