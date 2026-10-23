# 发布前核对验收与代码

本阶段仅完成源码实现、行为定义与源码审查。当前没有运行应用、测试、构建、数据库升级或浏览器验证；这些验证继续等待用户恢复窗口。

1. 在“质量检查”或“版本候选”选择完整需求或独立任务。先解决有效验收和高优问题的阻断。
2. 在范围旁点击“准备源码核对包”。逐任务选择“涉及代码变更”，填写完整基准 SHA、已验收代码 SHA 与说明；不涉及代码时明确选择并填写具体理由。不会默认将任何任务归为非代码。
3. 点击“核对当前验收并生成”，下载固定包。该步骤核对当前完整范围与有效验收，不执行 Git，也不代表候选已批准。
4. 在可信 CI 的完整、干净 checkout 运行现有 `scripts/delivery-ci-attest.py`，新增必填 `--source-packet <下载的UTF-8文件>`。其他明确参数（项目、租户、仓库、工作流、策略代数、范围摘要、构建/测试参数、私钥文件、制品、JUnit 和输出路径）继续必填。网页不保管私钥或执行这些命令。
5. 将生产器 `--out` 输出的完整文件导入工作台。这是 `{envelope, source_packet, requirement_ids, task_ids}`，其中 envelope 保持原始 DSSE JSON 字符串，不能预解析后重组。导入文件最多 1.5 MiB；其中核对包最多 1 MiB、签名信封最多 128 KiB 字符，实际签名载荷最多 64 KiB。
6. 编制候选，在固定快照中逐项检查源码范围、非代码理由、验收证明、最终 CI 提交、制品、发布说明和回退方案，再执行现有候选批准。批准同时确认源码关联；批准和实际部署仍是不同事实。

CI 检查要求：基准是验收提交祖先，验收提交是构建 HEAD 祖先，且变更范围的所有路径在最终 HEAD 仍保留验收提交的内容和模式。删除/重命名同样检查。净变更为空、受影响路径被后续修改或回退、浅克隆、不支持的链接/子模块变更、超出 10000 条检查路径或元数据上限会拒绝。无关文件的后续提交可以保留；相关路径变化后需要重新核对明确关联。包在构建期间变化也会拒绝。

检查不拉取缺失对象，拒绝 partial clone 和未初始化的子模块；元数据读取有超时与输出上限，源码范围核对总计最多 120 秒，共用范围复用同一次精确检查。所有 Git 检查禁用 replace/graft。普通文本换行转换继续支持，任意 clean/smudge/filter、working-tree-encoding 或 ident 变换明确拒绝，避免“Git 显示干净”掩盖构建字节变化。源文件与制品按块计算摘要；这不代表依赖环境已完全隔离或测试覆盖充分。

CLI 可读取同样的逐任务提案文件：

```text
sop delivery release-source-packet --file associations.json --out source-packet.json
```

提案包含 `requirement_ids`、`task_ids`、`scope_basis`、`policy_generation`、`mappings`。每个 mapping 包含 task_id、kind（change 或 no_code_change）、comment；change 必须另填 base_commit 和 accepted_commit，非代码项禁止携带提交。`--out` 写 UTF-8 原始包，拒绝覆盖现有文件；不指定时 stdout 直接输出原始 JSON 包。SDK 使用 `delivery_release_source_packet(body)` 获得带当前版本元数据的响应及 packet。

CI 导入继续使用 `release.ci.import`，payload 直接取生产器完整输出，外层保留原 expected_version 和 idempotency_key。未知结果重放原命令，不创建新键；版本冲突后明确核对当前状态。旧 CI 证明可查看，缺少源码核对时不能支撑新的候选批准。

恢复验证后优先检查：真实 Git 的修改/回退/删除/重命名/模式变更与替换引用，完整任务闭包，非代码理由的候选批准，过期验收/策略，原件回执恢复，读取失败及切换身份后的晚到响应，窄屏与键盘操作。
