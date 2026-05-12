# 知识库（Knowledge Base）

> 基于 LanceDB 的语义知识库，支持文档索引、语义搜索、规则检索。

## 核心文件

- `lancedb_ops.py` — LanceDB 操作库（语义搜索、知识索引、规则管理）

## 快速使用

```python
from sop.knowledge.lancedb_ops import LanceOps

ops = LanceOps()

# 为当前任务获取相关上下文
ctx = ops.get_context_for_task("实现用户注册功能")
# 返回：相似历史任务 + 相关规则 + 知识库文档

# 语义搜索
results = ops.search("tasks", "JWT token 认证", limit=5)

# 索引 custom/ 目录
ops.index_custom_dir()

# 添加规则
ops.add_rule("密码必须使用 BCrypt 加密", "security", "INC-003", confidence=0.90)
```

## CLI 使用

```bash
cd sop/knowledge

# 搜索任务
python lancedb_ops.py search tasks "用户认证"

# 索引自定义文档
python lancedb_ops.py index-custom

# 获取任务上下文
python lancedb_ops.py context "实现支付功能"
```

## LanceDB 表结构

| 表名 | 用途 |
|------|------|
| `knowledge` | 文档知识库（custom/ + 规范文档） |
| `rules` | 规则库（从错误中提取） |
| `tasks` | 任务历史（避免重复工作） |
| `incidents` | 问题历史（快速定位解决方案） |
| `requirements` | 需求库（语义相似需求检测） |
| `agent_reflections` | Agent 反思记录 |

## 与 AI 工具集成

在 CLAUDE.md 中添加：
```markdown
## 知识库查询
任务开始前，运行：python sop/knowledge/lancedb_ops.py context "<任务描述>"
获取相似历史任务和相关规则，避免重复踩坑。
```
