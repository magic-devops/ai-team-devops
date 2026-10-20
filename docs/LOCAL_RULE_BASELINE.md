# 项目本地规则基线

阶段：`T-local-rule-baseline`。本阶段修复当前工作区的规则路径与缺失配置，不调整运行时架构、hook绑定、平台安装或业务流程。

## 路径契约

根 `.ai-memory` 应为指向 `.sop-runtime/ai-memory` 的仓库内相对目录符号链接。Manager的 `resolved_ai_memory_root()` 使用项目runtime目录；CLI规则和hook使用根 `.ai-memory`，两者因此读取同一份本地数据。该约定与现有Manager迁移和CLI初始化相符。

不能直接将根链接替换为实体目录：当前 `path_config._migrate_ai_memory()` 会搬运并删除该目录。已有 `.sop-runtime/ai-memory` 中的导出、同步及系统页数据保持原位置。本阶段只解除旧链接自身，不访问其旧外部目标。

## 可追踪来源与本地副本

| 本地文件 | 可追踪来源 | 语义 |
|---|---|---|
| `.ai-memory/rules/RULES.md` | `docs/PROJECT_RULES.md` | 缺失时恢复的项目规则初始集；已有规则必须保留并审阅，不能覆盖 |
| `.ai-memory/ai_capabilities.json` | `ai-sop-ops/AI_CAPABILITY_REGISTRY.json` | 锁定Ops版本提供的能力与适配声明；不是运行状态或连接凭证 |
| `.ai-memory/hook_policy.json` | 可选人工配置，参考Ops模板 | 本阶段不创建或覆盖，保持现有内置策略 |

本地运行数据继续受 `.gitignore` 保护，规则初始来源和根相对链接由Git追踪。新检出仍需显式初始化自己的runtime目录；仓库中的符号链接不会使忽略的运行数据自动存在。恢复必须先核实链接与目标都在本仓库内，再仅创建确实缺失的副本，不运行整套初始化器去覆盖现有配置。

## 核验与限制

恢复前保存旧链接文本、Git对象、目标目录全部文件的摘要及链接清单。恢复后核实根链接目标、解析后的规则/注册路径、规则副本与已审来源逐字节一致、注册JSON结构，以及所有原有文件的摘要和相对路径均未变化；不遍历任何外部链接。

Windows创建目录符号链接时使用原生路径分隔符，Git中的目标仍为 `.sop-runtime/ai-memory`。本次先发现仅可解析但文件打开报Invalid argument的正斜杠reparse目标，修正后再从根别名实际读取两个文件；不能只凭链接元数据或 `resolve()` 判定可用。首次普通权限创建失败停在修改原链接之前，之后获准使用所需系统权限完成，失败与修正记录均保留。

证据保存在 `.sop-runtime/delivery-evidence/local-rule-baseline/`。文件核验只证明当前本地路径和配置来源，不证明平台已经工作：

- 当前 `sop_ai_hook.py` 读取可选policy并写审计，未执行消费能力注册表；Manager的相关probe仅检查注册表是否存在。
- 当前Claude配置只有旧的Stop时间戳动作，没有接入统一launcher；这项绑定仍需单独实现和验证。
- CLI的 `rule_store` 接受解析后仍在项目内的规则路径，但 `asset_plans.safe_project_path` 逐段拒绝符号链接/reparse。故本阶段修复普通规则读取，不代表规则资产同步、watch或资产计划已经可用；后续需统一正式物理路径契约并实际验证，保持现有路径保护强度。
- 本阶段不运行hook、初始化器、应用、测试、SDK、模型或服务；共享测试窗口和原稳定性回归仍独立待办。
- 不把本地恢复提升为完整控制平面、当前全部界面或生产环境验收通过。
