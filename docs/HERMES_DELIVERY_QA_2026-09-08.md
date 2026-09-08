# Hermes v1 任务交付阶段验收

版本：1.0.0。环境：macOS，本地隔离 Core + Go agentd + Vite 工作台。
本记录只覆盖任务交付阶段，不代表 Multica 全量功能或五平台发布验收。

## 实际界面操作

在 `http://127.0.0.1:5198/#/workspace` 连接独立 Core `127.0.0.1:8793`，
数据目录为 `/private/tmp/hermes-delivery-qa-20260908`，未改动现有业务工作空间。

1. 创建“交付闭环验收”工作空间及“真实执行与人工验收”任务，填写验收条件。
2. 预览 `echo` 命令节点，界面呈现任务来源、验收条件、根目录和版本；确认派发。
3. 点击“查看执行与证据”定位关联运行，启动 Go agentd；回读 completed、exit=0、
   stdout=`Hermes delivery verified`，节点执行耗时为 22ms（不是整体性能基准）。
4. 返回任务，确认状态仍为进行中且交付为待审查；填写依据，预览并提交验收。
5. 回读任务 completed/v3、交付 accepted，运行 completed/v6；任务编辑与运行启动禁用。
6. 点击“导出 JSON”，回读持久化 artifact；重新计算运行证据和审计包 SHA-256 均匹配。
7. 在 390x844 与默认 1280x720 视口检查任务详情；节点表在窄屏内部横向滚动，正文和操作可达。
8. 输入无效测试 Token，界面展示未授权和 trace，清空旧工作空间与任务，禁用创建和诊断；
   恢复连接后重新选择工作空间，任务与审查证据保持不变。

证据标识：

| 对象 | 标识 |
| --- | --- |
| Workspace | `0504f5e4878c4562a2a66596338ff40b` |
| Task | `373c78721de7481ab76259d90465ede5` |
| Run | `da7f781c9d5341c8b222d98b504617cf` |
| Artifact | `9141017fbc1f4d14b49a3c191f2c73f6` |
| 审查 trace | `23fbde70982c416fab75ca29824e5358` |
| 审计事件 | 6 条运行事件、4 条任务事件 |
| 审计 SHA-256 | `47c819db6f5403d77e1b1e5f4f081434a7007454f8c02184051ebd2f59788472` |

测试 Token 不写入此文档。临时目录中的证据依赖本机保留，不作为发布制品。

## 自动验证

`scripts/hermes-readiness.py --full`：28 项中 27 项通过，1 项环境阻断。

- Core：42 tests passed，含真实 Go 执行器、任务派发、审查、重复提交、scope、版本冲突。
- SDK/CLI contracts：20 tests passed；Core 集成测试还覆盖新 task v1 命令实际 HTTP 往返。
- Web：140 tests passed，TypeScript 检查和 Vite build 通过。
- Flutter：37 tests passed，analyze 无问题；包含 390/1200 宽度派发预览与应用、只读禁用、
  任务验收条件编辑提交。它们是组件测试，不是真机执行。
- Go build/test、Manager 权限页面、生成器、分发契约、脚本语法和命令 help 检查通过。
- 新增 Python 领域服务与测试 Ruff 检查通过；git diff --check 通过。

原始聚合结果：`/private/tmp/hermes-delivery-readiness-final.json`。
唯一失败项 `flutter.build.macos`：`xcrun` 无法找到 `xcodebuild`，本机缺少完整 Xcode。
readiness 正确保持 `ok=false`、`release_ready=false`，不把缺失原生构建当成通过。

## 剩余边界

- Windows/Linux/iOS/Android 真实安装、macOS 签名公证、商店发布均未在本轮完成。
- Flutter 原生任务闭环尚无真机证据；当前计划编辑为 JSON，不是可视化编排器。
- 本次实际运行是受控命令，不是外部编码 Agent 的自动实现任务。
- 全量 Multica 对齐缺口见 [功能矩阵](HERMES_MULTICA_ALIGNMENT.md)。
