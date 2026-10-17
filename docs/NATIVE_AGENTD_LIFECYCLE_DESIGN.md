# 原生执行器连接与生命周期

阶段 `T-native-ipc`，基线 `590ca69`。本阶段修复已核实的 Windows SDK/CLI 与项目执行器互通、真实状态及安全停止；完整研发协作目标继续 active。新增一个统一的纯 Go SQLite 驱动，退役依赖 C 编译器的驱动与禁用持久化的替身实现；没有新增厂商接入、用户服务安装或机器环境配置。

## 证据与问题

- SDK 默认 Windows pipe 固定为 `\\.\pipe\sop-agentd`；Go 则将项目 socket locator 转小写后计算项目管道名，默认无法互通。
- SDK 接受 SOP_AGENTD_PIPE/SOP_AGENTD_SOCK，旧 Go 配置未读取对应覆盖，配置后仍可能连接不同地址。
- Windows 同步 pipe.read 没有执行 SDK 的 timeout 参数，服务端不响应时可无限等待。
- CLI 本地 binary 回退缺少 Windows .exe，状态硬编码 cwd socket，启动和状态未统一 PROJECT_PATH；IPC 不可用仍返回成功。
- 原 `590ca69` 的真实隔离 stop 探针：PID 文件指向本任务创建的无关 sleep 子进程，CLI exit=0，子进程被终止且退出码15。这证明停止不能仅信任数字 PID。
- 同一基线真实 status 探针中，无关 sleep 子进程仍存活。不能根据 Python 文档的 Windows 概述，推断 signal=0 一定会终止进程；原先该推断已被实测否定，报告与修复依据明确区分。

原始探针只操作任务创建的子进程和 `.cache/native-ipc/` 内 PID 文件，不接触用户进程。异常与清理回执保存在 `.sop-runtime/delivery-evidence/native-ipc/`。

## 可移植持久化

原构建在 `CGO_ENABLED=0` 时能执行部分工具子命令，但真实 daemon 初始化会因 outbox 不支持而退出。因此，工具调用成功不能证明原生 daemon 可运行。本阶段采用单一 `modernc.org/sqlite v1.60.1` 后端，保留 SQLite 数据格式和事件幂等语义，不保留有无 CGO 两套后端或不可用队列替身。模块要求 Go 1.26，toolchain 固定该维护分支的 1.26.9；使用官方便携工具链和项目内模块缓存，不安装全局编译器。

每次连接设置 WAL、FULL 同步和 5 秒 busy timeout，限制一个连接，事务使用 immediate 锁。确认追加、重开、幂等、确认删除、并发重试、取消不写入、WAL 快照与异常进程退出恢复。锁竞争时取消可能等到 SQLite busy timeout 才返回，不能声称即时取消。跨 SQLite 删除和 JSONL DLQ 追加的旧交接仍有丢失边界，另列高优先级后续任务；本阶段不将其描述为原子交接。

版本与能力依据见 [modernc SQLite](https://pkg.go.dev/modernc.org/sqlite)、[该版本 go.mod](https://gitlab.com/cznic/sqlite/-/raw/v1.60.1/go.mod)、[Go 官方下载清单](https://go.dev/dl/?mode=json)。下载、校验、离线构建及实际进程结果另存本阶段证据。

## 项目与地址

SDK 显式 transport 优先；未指定时使用当前操作系统的原生 IPC。项目选择为 SDK 显式 project_path、PROJECT_PATH、CWD。CLI start/status/stop/logs 使用同一所选项目，启动的 cwd/env 与该项目一致。

逻辑 socket locator 按显式 socket_path、非空 SOP_AGENTD_SOCK、所选项目默认 `.sop-runtime/agentd.sock` 选择；相对 locator 以所选项目为基准，清理 . 和 .. 后成为绝对路径。Go 同步相同环境覆盖。Unix 直接连接该 locator；Windows 使用统一分隔符、同机器 Windows invariant lowercase API，再计算 SHA1 前8字节十六进制命名空间。该摘要只作地址标识，不作认证或证据签名。

非空 SOP_AGENTD_PIPE 在 Windows 双端覆盖派生地址，只接受本机 `\\.\pipe\...`，拒绝控制字符和远程 UNC。不回退到旧固定管道，也不偷偷将 Windows 改用 Unix transport。共同向量与实际进程验证斜杠、相对路径、Unicode、不同 CWD 及两个项目隔离；不维护两套 Unicode 大小写表。

## 有界 IPC

Windows 分支抽为小模块，连接、写、分片读取共享一个 monotonic deadline。优先复用本项目支持范围 CPython >=3.10 的 stdlib Windows 原生 overlapped I/O；超时取消并收回 I/O，关闭事件与 handle，不留后台线程继续请求。available 使用非消费的有界探测，不用打开再关闭来占用一次服务端连接。

真实短命 named-pipe fixture 验证无响应、不读取、忙端点、缺失端点、分片与正常响应；旧实现的阻塞 RED 在带外进程硬期限下运行。错误返回结构化结果，不能将超时或无响应当健康成功。

## 真实生命周期

health 返回实际 pid、project_path、instance_id 及已有运行状态。instance_id 复用该次启动生成的 ULID，不新建第二实例库。PID 文件仅辅助诊断，不作为运行或停止的事实来源。

CLI start 发现健康的同项目实例时不重复启动；新建进程需在有界期限内确认健康响应属于本次 Popen 的 pid 和所选项目。Windows 后台启动使用隐藏窗口。失败仅使用本次 Popen 持有的句柄清理新建子进程，不向来源不明 PID 发信号、不删除外来 PID 文件。

发现可执行文件时即固定绝对路径，避免启动时切换所选项目后相对 PATH 换义。启动/停止每轮健康读取后再次检查等待期限，迟到响应不算期限内成功。`--timeout` 是状态确认预算；单次 SDK I/O 与失败后的自有进程清理另有独立上限，不描述成整个命令的墙钟硬上限。

新增 `daemon.stop` 请求携带 health 原样返回的 instance_id/project_path。服务端只接受当前匹配实例/项目，写出成功 ACK 后取消 Run 子 context，经已有队列关闭和退出流程完成。错实例、旧实例或错项目拒绝；ACK 与已停止分别表达，CLI 有界等待原实例不可用，不能只凭 ACK 声称停止成功。不得提供数字 PID 强杀回退。

监听失败、重复启动不得覆盖或删除正在运行实例的 PID；成功绑定后才登记，清理时核对仍属于自己。CLI status 提供 JSON 实际 transport/endpoint/health 与机器可判定退出状态，PID 存在而 IPC 不健康不得伪装成功。

主循环退出会关闭并等待已接收连接，随后再关闭队列；不留半帧 handler 在退出后继续等待原三秒期限。真实进程联调还证明旧 HTTP 退避忽略取消会让端点已经离开而进程仍存活：改为可取消 timer、最后一次失败直接返回、指数先封顶。CLI 的 `stopped` 仅确认原 IPC 实例离开，操作系统进程退出另由测试保留的原 Popen 句柄验证，二者证据分别记录。

## 验证与交付

先 RED 再修复；分别验证平台/覆盖选择、跨语言地址、真实 Windows 阻塞期限、实例控制与 CLI payload。构建当前 Go binary，实际启动隔离项目 A/B；默认 SDK 和 CLI 都能发现，跨项目停止被拒绝，过期/无关 PID 不影响 sentinel，重复启动不破坏现有实例，正常停止后确认任务所持进程句柄退出。

Pages 两条任务命令已正式使用 --owner-id，旧 --assigned-to 断言为漏迁移测试；校正契约并补真实帮助、参数到 SDK 载荷、默认未分配预览及旧参数拒绝验证，不恢复姓名写入。全 SDK/CLI 和受影响 Go 套件运行后如实记录结果。

文档原理参考 [Python os.kill](https://docs.python.org/3/library/os.html#os.kill)、[Microsoft named-pipe client](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-client)、[CancelIoEx](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-cancelioex)；实际行为结论以本机隔离复现为准。

源码/测试/构建临时目录仅 `.cache/native-ipc/`，最终证据 `.sop-runtime/delivery-evidence/native-ipc/`。清理前清点并保存源码、binary、日志与重要证据散列；仅清理该精确任务目录，不遍历链接目标。阶段验证后全部 commit，不推送。对象讨论、结论采纳、来源摘要、专属详情有界化、390px 实际视觉与生产验证仍待继续。
