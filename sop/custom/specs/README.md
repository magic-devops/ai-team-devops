# 项目特定规范

本目录存放项目特定的开发规范，优先级高于 sop 通用规范。

## 当前规范

（项目运行过程中填充）

## 添加新规范

```bash
# 创建新规范文件
cat > custom/specs/api-naming.md << 'SPEC'
# API 命名约定

本项目 API 路径统一使用复数名词：
- /api/v1/users（而非 /user）
- /api/v1/orders（而非 /order）
SPEC
```
