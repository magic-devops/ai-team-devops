# T-native-ipc 实施计划

基线590ca69。设计见 `docs/NATIVE_AGENTD_LIFECYCLE_DESIGN.md`，完整目标保持 active。

1. 核对当前源码并用任务自有子进程/pipe复现：地址分歧、超时、PID停止、旧Pages断言；保留推断被证伪的status signal0结果。
2. SDK/Go owner：双端地址规范、Windows有界原生I/O、真实pipe fixture、health与实例绑定stop、监听/PID生命周期，先RED后实现。
3. CLI owner：所选项目一致、Windows binary/后台窗口、真实健康JSON/退出码、有界ready/stop、仅清理自己启动失败的Popen；先RED后实现。
4. outbox owner：退役 CGO 驱动和禁用队列替身，采用单一纯 Go SQLite 与 Go1.26维护工具链；root下载并校验官方便携工具链/模块到项目缓存。先记录真实daemon启动失败，再验证SQLite幂等、重启、取消、并发重试和异常退出。
5. root：Pages契约真实行为测试、跨语言与双项目实际进程联调、全客户端/受影响Go回归及文档；独立复核修复必要发现。
6. 保存重要证据与散列、更新记忆及未完成清单，清理精确任务目录，全部本地commit，不推送。可重取的第三方编译器/模块缓存只保存来源和校验回执，不复制进最终证据。

只读并行任务继续完成对象讨论/结论采纳和来源衔接的四flow设计，不在本阶段混入未验证生产改动。
