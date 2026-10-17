# 交付协作阶段实施计划

任务ID `T-delivery-collaboration`；设计见 `docs/DELIVERY_COLLABORATION_DESIGN.md`，基线4de57a0。

1. 完成三份只读代码审查，区分已实现排期/容量与真实缺口；明确四界面、授权和未知历史边界。
2. 后端提供安全有界活动、精确详情、需求已观测内容历史和固定变更影响预览；同一事务保存、CAS及幂等复核，实际SQL红绿测试。
3. UI替换旧活动及需求修改流程，加入版本/影响详情，补加载失败/权限/返回/草稿与冲突恢复，保持主题及三语。
4. 独立统一Sprint统计有效验收口径并覆盖真实SQL/API。
5. SDK/CLI及OpenAPI同步；真实服务验证分页、变更预览/提交、历史和GET零写，明确未验证边界。
6. 一次独立增量审查，修复和原问题复验；相关回归、类型、构建，更新实际状态、文档和证据。
7. 检查全部差异和凭据；清理本任务临时文件前留存散列和重要证据；全部阶段变更commit，不推送。

后端所有权 collaboration_domain_audit；UI所有权 collaboration_ui_audit；Sprint所有权 collaboration_planning_audit；root负责集成合同、SDK/CLI、OpenAPI、实际验证与收尾。文件所有权明确后并行，不覆盖他人未完成改动。
