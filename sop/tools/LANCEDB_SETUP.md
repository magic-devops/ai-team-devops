# LanceDB 配置与初始化指南

## 快速开始

### Python 项目

```bash
# 安装依赖
pip install lancedb sentence-transformers pyarrow

# 初始化项目记忆
python -c "
from ai_dev_sop.memory import init_project_memory
db = init_project_memory('my-project')
print('记忆系统初始化完成')
"
```

### Node.js 项目

```bash
# 安装依赖
npm install @lancedb/lancedb @xenova/transformers

# 初始化
node -e "
const { initProjectMemory } = require('./sop/memory');
initProjectMemory('my-project').then(() => console.log('初始化完成'));
"
```

## 目录结构

```
{project_root}/
├── .ai-memory/
│   ├── lancedb/              # LanceDB 数据（加入 .gitignore）
│   │   ├── requirements.lance
│   │   ├── tasks.lance
│   │   ├── code_changes.lance
│   │   ├── incidents.lance
│   │   └── decisions.lance
│   └── snapshots/            # JSON 快照（可选择提交）
│       └── 20260512_100000.json
└── memory/
    ├── current_state.json    # 当前状态（提交到 git）
    ├── decisions/            # 决策记录（提交到 git）
    └── incidents/            # 问题记录（提交到 git）
```

## .gitignore 配置

```gitignore
# AI 记忆系统
.ai-memory/lancedb/

# 保留快照（可选）
# .ai-memory/snapshots/
```

## 嵌入模型选择

| 模型 | 维度 | 大小 | 适用场景 |
|------|------|------|---------|
| all-MiniLM-L6-v2 | 384 | 80MB | 默认推荐，速度快 |
| all-mpnet-base-v2 | 768 | 420MB | 更高精度 |
| paraphrase-multilingual-MiniLM-L12-v2 | 384 | 120MB | 多语言（含中文） |

中文项目推荐使用 `paraphrase-multilingual-MiniLM-L12-v2`。

## 备份策略

```python
import schedule

def backup_memory(project_id: str):
    """每天自动备份"""
    snapshot_path = create_snapshot(project_id)
    print(f"备份完成: {snapshot_path}")

# 每天 23:00 备份
schedule.every().day.at("23:00").do(backup_memory, project_id="my-project")
```

## 故障恢复

### LanceDB 损坏时
```python
# 从最近的快照恢复
latest_snapshot = get_latest_snapshot()
restore_from_snapshot(latest_snapshot)
```

### 降级模式（LanceDB 不可用时）
当 LanceDB 不可用时，降级到纯文件系统模式：
- 任务状态存储在 `memory/current_state.json`
- 决策记录存储在 `memory/decisions/` 目录
- 失去向量搜索能力，但基本功能正常

```python
def get_memory_backend():
    try:
        return LanceDBBackend()
    except Exception:
        logger.warning("LanceDB 不可用，降级到文件系统模式")
        return FileSystemBackend()
```
