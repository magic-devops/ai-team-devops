# 需求辅助与工作流人工审查实现

设计：`docs/DELIVERY_ASSISTANCE_DESIGN.md`。本增量不替代完整主计划，不声明生产厂商及全链路已完成。

- [x] 后端：统一需求生成网关、SQL凭据、显式规则、采用版本及历史。
- [x] 工作流：实际人审信号、超时等待、作用域、审批角色、异步调用和等待恢复。
- [x] 前端：可编辑预览、来源和用量、显式确认、错误/冲突保留、工作流意见与权限。
- [x] 契约与客户端：OpenAPI、SDK、CLI反映新输入、固定请求和明确失败。
- [x] 独立审查及修复、回归/构建、桌面/窄屏/真实服务联调，保存证据。独立审查 3 个 Important 已修复；来源名称与本地时间显示问题经新增测试及真实渲染复验通过。

2026-10-17 验证：Manager 309 项、Web 223 项、SDK/CLI 35 项通过；最后等价类型修正后需求辅助 27 项、客户端 35 项再次通过。OpenAPI 新增 19 路径/20 操作，389 个本地引用与既有 17 个 delivery 动作校验通过。TypeScript、生产构建和新增 Python 模块检查通过；既有弃用、大包警告及旧文件 lint 债务保留。

真实隔离服务与浏览器已验证：规则两条草稿中只导入一条人工编辑内容；AI 评审来源和 30 tokens；冲突保留输入、查看最新基准并明确采用后持久化 4 条验收条件；原型预览不写业务、人工编辑采用后保存设计产物；超时仍等待人工，要求修改及意见记录真实审核人。390px 下表单和页面无横向溢出；失败请求重试不重复调用模型且保留旧预览。

证据位于 `.sop-runtime/assistance-http-proof.json`、`assistance-ui-fixture.json`、`assistance-manager-full.log`、`assistance-web-tests.log`、`assistance-final-check-manager.log`、`assistance-final-check-clients.log`、`assistance-workflow-openapi-proof.json`、`requirements-assistance-mobile.png`。模型使用本地 Ollama 协议桩，未调用收费模型，未验证生产账户推理。

完整目标继续 active；下一项为项目资源/详情整合和个人交付待办聚合。v2 治理、生产账户、连续历史/容量/甘特、可信 CI、真实部署回滚和智能运维仍按主计划推进。

最终显示修正后：Web 全量 224 项通过（33 文件，14.89 秒），TypeScript 与 Vite 生产构建通过（44.86 秒，既有大包提示）；新增 epoch 时间/三语来源渲染测试先失败后通过。日志 `assistance-date-red.log`、`assistance-date-green.log`、`assistance-web-final-tests.log`、`assistance-web-final-types.log`、`assistance-web-final-build.log`。实际 UI 与 HTTP 证据 `assistance-ui-proof.json`，视口覆盖已恢复，未修改正式业务数据。
