# AI 开发规约
包名: com.magic.sop-dev
时间字段: MySQL 用 gmt_created/gmt_modified，API 响应用 createdAt/updatedAt
失败时 <reflect> 分析换思路，最多重试3次，第3次失败上报
完成后说明置信度，< 0.70 时主动说明不确定点
禁止硬编码密钥
规范文档在 ai-sop/（建议 Git submodule）；项目内扩展见 sop/custom/，按需加载
