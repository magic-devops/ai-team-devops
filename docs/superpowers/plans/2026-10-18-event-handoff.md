# 可靠事件交接实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成外部工具事件从唯一持久队列到真实业务回写、可追溯接收和人工恢复的完整纵向流程。

**Architecture:** Go/Python共享SQLite outbox；Manager同库收件回执与业务阶段事务；文件资产保存固定操作计划并恢复。现事件页提供有界事实读取，不把收到、处理及验收合并。

**Tech Stack:** 现Go1.26.9/modernc SQLite、Python sqlite3/FastAPI/SQLAlchemy/Pydantic、React/AntD，不增加服务。

**Spec:** docs/DURABLE_EVENT_HANDOFF_DESIGN.md；HTTP快照为apis/openapi/openapi.yaml，共享规范为apis/sqlite/event_outbox_v1.sql；阶段API_CONTRACT及验证回执在.sop-runtime/delivery-evidence/event-handoff。

## Global Constraints

- 真实认证身份绑定，不以source/payload/JWT客户端解析代替授权；原ID/字节/摘要和原业务expected_version不能更换。
- 不保留IDEMP内存权威、DELETE后JSONL死信、pusher+event双投递或直接任意列写入。
- stored、processed、业务验收三者独立；权限撤回、归档、版本冲突和无处理器如实展示。
- scratch与所有测试临时数据位于.cache/event-handoff，证据位于.sop-runtime/delivery-evidence/event-handoff。

## Review Focus

- Manager已提交而响应丢失后，重启/换worker/轮换key/切换User或Project不能复制业务效果。
- 同一SQLite多sender、人工重排和迟到ACK必须以revision CAS保护新状态。
- 单条非法/拒绝结果、坏ACK和取消不得删除/吞掉原事件；有限JSON/负载/游标都严格验证。
- 文件已写但SQL状态失败仍需原operation恢复；目标外部变化不得覆盖、重规划或猜最新版本。
- 新编辑器、页面ABA和SSR均保持原业务退出/草稿/未知结果保护，不能用测试mock遮住旧真实回归。

### Task 1: 规范与原始故障

- [x] 查当前源与原证据，冻结真实问题和设计；准备已校验隔离Go工具链/模块。
- [x] 原Go最后副本丢失与heartbeat假ACK用真实SQLite/httptest跑RED；保留之前Manager四RED。
- [x] 冻结HTTP DTO、共享SQLite规范与IPC操作、身份绑定和控制指纹向量。

### Task 2: 本地唯一队列与发送

- [x] Go/Python共享schema与严格冻结/绑定/入队/回执CAS，先RED再实现。
- [x] 原子pending/dead_letter/acked、显式原件查看/重排、统计分页和原操作回执。
- [x] 泛型/heartbeat统一ingest；取消/坏ACK/ACK落库失败可恢复，移除双队列发送。
- [x] 显式legacy迁移/隔离，保持原字节/ID，不建立双运行时或自动猜新版本。

### Task 3: Manager真实接收与处理

- [x] SQL不可变Inbox、Processing/Attempt、认证scope绑定/锁后复核、逐ID durable ACK与有界GET。
- [x] 抽stage_delivery_command并验证原入口；Task/Issue/structured-sync原CAS/原业务规则与processed同TX。
- [x] 文件plan先持久并初次执行，crash/SQL失败恢复同operation，冲突不覆盖。
- [x] 精确人工恢复、原key结果、当前原producer能力与提交后safe WS hint/逐帧鉴权。

### Task 4: SDK/CLI及紧凑事件页

- [x] SDK逐ID ACK校验、共享SQLite离线CLI/重排、原event文件重试及严格OpenAPI。
- [x] 原事件入口有界列表/精确详情/三语状态、可信来源/结果、当前Task导航与安全返回。
- [x] 当前capability控制人工恢复，未知原key/409保稿/ABA/SSR/旧退出行为测试。

### Task 5: 实际验证与阶段提交

- [x] 真实HTTP/原daemon/SDK/CLI及ACK断线后Manager进程重启，双向SQLite与崩溃/故障注入。
- [x] 权限/scope/跨producer/分页/纯读/规模，以及完整受影响回归、类型与构建。
- [x] 独立增量审查、完整目标待办/说明/证据及task scratch盘点；精确保留/清理结果以阶段cleanup-receipt.json为准。
- [x] 准备全部已验证更改本地commit、不push；实际提交以阶段commit-receipt.json为准，完整目标仍按实际状态推进。

## 验证结果

Manager1532、Web678、SDK/CLI426、Go75主项+38子例/6包通过（3原Windows链接跳过）；类型、Vite、vet、SDK wheel和OpenAPI通过。真实HTTP/原Windows执行器任务与问题处理、共享SQLite、离线及双端重启有完整证据。390px三语实机视觉和生产/长期验证未完成，后续完整目标待办见docs/DELIVERY_WORKBENCH.md。
