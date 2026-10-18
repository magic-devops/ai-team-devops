# 项目接入与上下文准备

`sop init` 负责项目基础资料、执行器配置和平台接入；`sop register` 在现有初始化上注册 Manager。实际基础初始化仍依赖 `ai-sop-ops/init-ai-project.sh`，缺失时明确报错，不创建虚假成功记录。初次未绑定项目时先完成注册或选定实际项目。

绑定后运行：

```powershell
sop context prepare --no-db-config --no-pages --no-platforms
```

该操作生成无密钥项目 manifest、`sop.work.snapshot.v2` 只读缓存观察、环境入口和 Agent 索引。默认完整 prepare 还尝试刷新数据源、页面能力和平台入口；`--pull`、`--flush` 是明确的附加操作，失败分别保留在 prepared 结果，不以部分完成冒充全部接入成功。

初始化的上下文生成和 prepare 使用同一配置对象传给 manifest、工作快照、能力缓存及索引。工作快照通过 `work.write_cache_snapshot(config, path)` 生成，与 `sop work export --local` 共用读取/校验；不保留旧私有快照接口。

缓存必须属于当前项目；旧 local overlay、tombstone 和未处理意图不作为真实实体。缓存为空时标为缺失，完整项目总数和当前验收为未知。快照写入先生成完整临时文件再替换，不发布半个 JSON。读取异常时保留原快照并明确失败。

原版本写入、文件快照审阅及回执恢复见 [本地操作指南](../LOCAL_INTENTS_GUIDE.md)。完整源代码与实际验证记录见 `memory/current_state.json` 的当前阶段链接。
