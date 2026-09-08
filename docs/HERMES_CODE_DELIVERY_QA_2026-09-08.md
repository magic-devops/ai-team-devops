# Hermes v1 隔离代码交付验收

版本：1.0.0。环境：macOS、独立 Core、Go agentd、React Web；Flutter 使用组件验证。
本阶段是 Multica 对齐中的 Git 检出隔离与代码审查，不代表全量功能对齐或五平台发布。

## 实际操作

在 `http://127.0.0.1:5198/#/workspace` 连接 `127.0.0.1:8794`，创建测试工作空间与任务。
仓库 `/private/tmp/hermes-code-demo-20260908` 的提交内容为 `base`，主目录保留 `user draft`。

1. 界面填写验收条件和 `workspace-file-write` 命令，选择独立 Git 工作树。
2. 回读完整 HEAD 与未提交变更警告；预览明确固定提交，应用后生成 planned run。
3. 从任务定位运行并启动，真实 Go 执行器修改独立目录，退出码为 0。
4. 回到任务，筛选 `note`，展开 diff，确认 `-base/+reviewed`，而不是主目录草稿。
5. 390x844 视口下检查差异、结论输入和提交；完成预览及验收，再恢复默认视口。
6. 回读任务 accepted/v3、运行 completed/v8；Git worktree list 显示 detached、locked。
7. 从运行导出审计包，SDK 回读后重新计算代码摘要及整包摘要，均相等。
8. 实际执行新增 CLI repository/changes 命令，返回有效 JSON、正确 scope 和同一代码快照。
9. Shell 回读主目录 `note.txt` 仍为 `user draft`，没有自动暂存、提交、合并或删除。

| 证据 | 标识 |
| --- | --- |
| Workspace | `f244605c1b9944aa88e4b52ed4857953` |
| Task | `59121ec681e345bb9d19c826f9da4fff` |
| Run | `bca33008cdc24ccbbbbb53de3de9b61f` |
| Base commit | `01defdbfb51ae2b4d71acd5445fd1038cc085a58` |
| Artifact | `d29a69e40cb94bc4a10d7ff4ec38c32d` |
| 审查 trace | `7785afd140c54acaaf85e79c40b69443` |
| 代码 SHA-256 | `b79a529e984e87bfa8305e3549ed0add73e3abae8409a88b2f46038414a1378b` |
| 审计 SHA-256 | `3a18b1c4a6674b6fe3aa4c55f57248f703fee6e0305b173929db839054c3ac8e` |
| 事件 | 8 条运行事件、4 条任务事件 |

测试凭据不进入本文。临时目录不是正式分发制品。

## 验证边界

新增 Git 集成测试使用真实 Git 和 Go 执行器，覆盖隔离修改、审批恢复、幂等预览、
跨 scope 拒绝、失败差异保留、未跟踪文件/截断拒绝验收、丢失工作树拒绝重建。
Web 检查包含中英日文 key、HTTP 契约、typecheck 和 build；Flutter 覆盖移动/桌面尺寸组件交互。

完整 readiness 原始结果：`/private/tmp/hermes-code-readiness-final.json`。
30 项中 29 项通过，唯一失败是原生 macOS 构建环境。Core 48、Web 141、Flutter 42、
SDK/CLI 28 个测试通过；Go 测试、Manager 权限/页面测试、生成器、脚本、typecheck、
Web build 和 Flutter analyze 通过。新增 Python 仓库服务及 Git 回归测试 Ruff 检查通过。
macOS 原生构建仍被缺少完整 Xcode 的 `xcodebuild` 阻断；Windows/Linux/iOS/Android
真实安装和签名未在本机验收，不把组件测试或 Web 成功计作五平台完成。

只读独立复核未发现本阶段阻断项。当前 diff 表示最终工作树相对基线的内容，
porcelain 状态保留索引差异；后续如增加自动 commit/merge，必须额外审查 staged patch，
不能从当前工作树快照推断索引中的代码已经验收。
