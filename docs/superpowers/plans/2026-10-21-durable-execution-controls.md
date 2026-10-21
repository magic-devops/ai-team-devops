# 耐久控制、启动投递与恢复实施

基点`87b7ab4`。上一阶段66个文件真实提交，属于目标进展；当前继续完整四类控制与本地/远端启动，不将目标缩减为单个取消修补。

1. 固定Manager/Core/UI真实边界、全部动作故障矩阵与源快照，按`DURABLE_EXECUTION_CONTROLS_DESIGN.md`收敛协议。
2. Core抽取同连接mutate/控制，原子approval决定/结果；以私有终态收据串行apply/close，新增受控启动票据，local/remote同事务领取。
3. Manager同受理事务存C/ACK、固定原件、claim/fence、取消barrier、后台效果/投递和当前版本窄投影；挂载共同授权回调，保留独立工作区。
4. 增加canonical typed详情/分页、close命令、SDK/CLI读取；不公开完整原件或依赖派生就绪。
5. 严格受理ACK与原请求恢复、后台C状态、明确取消/结束、独立三语及实际消费者故障定义一同落地。
6. 独立源码审查、精确保护既有Reflection WIP、更新进度和待验限制；阶段性全部相关源码commit。实际运行/类型/视觉与生产验收等待资源窗口后执行。
