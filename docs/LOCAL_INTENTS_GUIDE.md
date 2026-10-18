# 本地操作、文件快照与原回执

需求、任务、问题、迭代的写命令现在统一先保存到项目 SQLite，再尝试送达。`--local` 仅保存同一原件。网络失败不生成另一条业务记录，也不修改只读缓存。设计见 [本地写入意图](LOCAL_INTENTS_DESIGN.md)。

## 提交与恢复

先执行 `sop delivery context` 核对项目和实际版本。创建时选定业务 `--record-id`；每个操作选定独立 `--key` 与 RFC3339 `--time`，重发时三者及全部正文、版本保持一致。下面的版本 7 是示例，不能直接用于其他项目或后续操作。

```powershell
sop task create '核对登录流程' --record-id T-login-check --expected-version 7 --key task-create-001 --time 2026-10-18T06:00:00Z --local
sop sync flush --limit 20
sop event show task-create-001 --local
```

17 个实体写入口均适用：

| 对象 | 操作 |
| --- | --- |
| 需求 | create、update、delete |
| 任务 | create、update、pull、done、fail、delete |
| 问题 | create、update、resolve、delete |
| 迭代 | create、update、complete、delete |

create 要求目标不存在，update 要求目标存在。更新只提交明确提供的字段；省略负责人保持原值，`--owner-id ''` 明确清空。已有任务修改负责人或验收标准还需 `--task-basis`，取自实际任务详情。已有需求修改标题、正文或验收标准还需原 `--requirement-basis`、`--change-preview-basis`，对应已审阅的变更预览。需求状态继续经阶段评审推进。

结果中的 `delivery_state` 表示队列状态，`processing.state` 表示原业务处理结果。`acked` 只表示持久送达；`processed` 也不代表功能已测试或人工验收。`done` 的 notes/confidence 是审计说明。返回 `ok=false` 或非零退出时，原意图仍保留；先查原回执，不能更换键绕过旧版本、权限或验收门禁。

浏览器“智能中枢 → 同步 → 高级资产同步”使用准备依据、审阅原件、送达与处理三步。先核对原版本与原文件摘要，或明确确认原文件不存在，再审阅目标和完整正文。每次新操作使用独立标识；未知结果保留会话内原稿并锁定，只重放同一原件，阻止离开或切换页面标签。发送使用审阅时绑定的会话，项目切换后不会把旧正文发送到新项目。回执显示 Manager 实际保存目标，接受 Windows 大小写规范化等合法差异；功能测试和人工验收继续分别完成。

Manager 地址和首次认证的租户、项目、用户绑定不可更换。重看已 ACK 操作时会验证当前身份；`--local` 无法重新验证身份，不显示旧回执为当前成功。相同用户的凭据轮换仍可恢复原件。结果未知的同一次提交只重发原件；明确拒绝后，如决定采用新的版本或预览，应另建经过审阅的新操作。

## 文件发现、审阅与入队

```powershell
sop sync watch --once --modules specs --include specs:login.md --out-dir .sop-runtime/sync/plans
```

watch 只发现和输出原 UTF-8/CRLF 快照，不创建发送队列。单次清单最多 50 条、1 MiB，单文件最多 60 KiB；超过限制明确报错，用重复的 `--include module:path` 选定范围。连续监听仅比较当前进程内前后两次扫描，删除显示为明确的 delete 条目；退出后不恢复旧 watch_state。

文件格式与 Manager 一致：md、json、yaml、yml、toml。其他格式不进入默认资产发现；明确文件提交也会在入队前拒绝，不保存注定无法执行的文件操作。

清单记录项目、采集时间、规范路径、动作、正文和 SHA256。输出目录必须在项目内，且不能与任何监听根重叠，防止把快照再次识别为资产。路径规则如下：

| 模块 | 本地根 | 清单路径示例 |
| --- | --- | --- |
| rules | `.ai-memory/rules` | `RULES.md` |
| specs | `sop/custom/specs` | `login.md` |
| templates | `sop/custom`，仅扫描 templates 子目录 | `templates/review.md` |

审阅清单后，选择一个条目并提交原项目版本和原远端摘要：

```powershell
sop sync enqueue-plan .sop-runtime/sync/plans/asset-plan-<ID>.json --entry specs:login.md --expected-version 8 --key spec-login-001 --time 2026-10-18T06:05:00Z --expected-sha256 absent
sop sync flush --limit 20
```

`absent` 必须表示实际观察到原远端目标不存在；已存在目标必须填写原 64 位小写 SHA256，未知不能填 absent。清单会整体校验，再固定所选条目；源文件之后修改或删除，不改变已审阅正文。重发复用同一清单、条目、版本、摘要、键和时间。每次只选一个原操作，多个文件分别审阅和提交。

`sync push-file`、`enqueue-file` 和 `rule flush` 同样要求 `--expected-sha256`。Manager 先校验原版本和原目标摘要；冲突保留原件，不能覆盖另一份目标。拉取资产采用原子替换项目内目录项，避免改变硬链接的其他文件；不宣称跨文件事务或任意外部写入者下的原子性。

## 规则提案

```powershell
sop rule propose '所有交付操作保留原回执' --json
sop rule apply rule-local-<ID>
sop rule list --local --proposals --json
sop rule flush --expected-version 9 --key rules-reviewed-001 --time 2026-10-18T06:10:00Z --expected-sha256 <原远端SHA256> --local
```

提案保存为独立 JSON 文档；未完成写入的临时文件不会发布为正式提案。按稳定 ID 应用，正文包含原提案标记；正文已写但状态落盘失败时，重试只恢复原状态，不重复规则。并行应用使用项目锁避免覆盖另一提案。应用仅改变本地文件，远端提交由明确 flush 完成。

## 缓存、范围与旧文件

`work ... --local` 只读取当前项目 Manager 拉取缓存，输出数据来源、采集时间及覆盖范围。未送意图和旧 local overlay 不算已处理实体；本地缓存无法证明完整项目统计或有效验收。远端概览失败明确报错，不自动回退缓存冒充成功。

`sync doctor`、`sop doctor`、`status` 和接入清单读取同一个配置队列。旧 JSONL、overlay、tombstone、规则旧提案及 watch_state 只读盘点，不自动转换、压缩、修复或发送；`sync compact/repair` 已移除。原文件保留，依赖缓存 `.pnpm-store` 继续忽略且不应提交 Git。

此阶段覆盖交付实体和规则/规约资产生产端。memory/kb/usage 等其他领域仍按各自契约工作；通用/reflection 处理、问题反向事件来源链、显式大详情有界读取、实机视觉与生产集成仍在完整平台待办中。阶段验证与提交不代表整个平台完成。
