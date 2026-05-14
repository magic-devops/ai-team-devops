# AI 开发规约（Qoder 上下文）
包名: com.magic.sop
时间字段: MySQL 用 gmt_created/gmt_modified，API 响应用 createdAt/updatedAt
失败时 <reflect> 分析换思路，最多重试3次，第3次失败上报
完成后说明置信度，< 0.70 时主动说明不确定点
禁止硬编码密钥
规范文档在 `ai-sop/` 目录（Git submodule `magic-devops/ai-sop`），按需加载对应规范文件；运维脚本在 `ai-sop-ops/`。
