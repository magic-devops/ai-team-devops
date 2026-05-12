# Token 成本控制规范

## 成本模型

```
总成本 = Σ (input_tokens × input_price + output_tokens × output_price)

Claude Opus 4.7:  $15/M input,  $75/M output
Claude Sonnet 4.6: $3/M input,  $15/M output
Claude Haiku 4.5:  $0.8/M input, $4/M output
```

## 模型选择策略

| 任务类型 | 推荐模型 | 理由 |
|---------|---------|------|
| 需求分析、架构设计 | Opus 4.7 | 需要深度推理 |
| 代码实现（复杂） | Opus 4.7 | 准确性优先 |
| 代码实现（简单） | Sonnet 4.6 | 性价比最优 |
| 代码审查 | Sonnet 4.6 | 对照清单，不需要最强推理 |
| 测试编写 | Sonnet 4.6 | 模式化任务 |
| 文档生成 | Haiku 4.5 | 简单生成任务 |
| 进度汇报 | Haiku 4.5 | 格式化输出 |
| 搜索/定位代码 | Haiku 4.5 | 简单检索 |

```python
def select_model(task: Task) -> str:
    if task.type == "architecture" or task.complexity == "high":
        return "claude-opus-4-7"
    if task.type in ("code", "review", "test"):
        return "claude-sonnet-4-6"
    return "claude-haiku-4-5-20251001"
```

## Prompt Caching（必须启用）

Claude API 支持 prompt caching，对重复的系统提示缓存 5 分钟，节省 90% 输入成本。

```python
import anthropic

client = anthropic.Anthropic()

def call_with_cache(system_prompt: str, user_message: str, model: str) -> str:
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},  # 启用缓存
            }
        ],
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text
```

**缓存策略**：
- 系统提示（角色定义 + 规则）：必须缓存
- 项目规范文档（CLAUDE.md）：必须缓存
- 当前任务上下文：不缓存（每次不同）

## Token 预算追踪

```python
class TokenBudget:
    def __init__(self, daily_limit: int = 1_000_000):
        self.daily_limit = daily_limit
        self.used_today = self._load_today_usage()
    
    def check(self, estimated_tokens: int) -> bool:
        return self.used_today + estimated_tokens <= self.daily_limit
    
    def record(self, input_tokens: int, output_tokens: int, model: str):
        cost = self._calculate_cost(input_tokens, output_tokens, model)
        self.used_today += input_tokens + output_tokens
        self._persist(input_tokens, output_tokens, cost, model)
    
    def _calculate_cost(self, inp: int, out: int, model: str) -> float:
        prices = {
            "claude-opus-4-7":          (15, 75),
            "claude-sonnet-4-6":        (3, 15),
            "claude-haiku-4-5-20251001": (0.8, 4),
        }
        ip, op = prices.get(model, (15, 75))
        return (inp * ip + out * op) / 1_000_000
```

## 成本优化技巧

### 1. 批处理相似任务
```python
# 差：每个文件单独调用
for file in files:
    review_file(file)  # N 次 API 调用

# 好：批量审查
review_files_batch(files)  # 1 次 API 调用，共享系统提示缓存
```

### 2. 子智能体结果摘要
```python
# 子智能体探索后只返回摘要，不返回原始内容
def explore_codebase(query: str) -> str:
    # 子智能体读取大量文件
    raw_results = agent_explore(query)
    # 只返回摘要（100 tokens vs 5000 tokens）
    return summarize(raw_results, max_tokens=200)
```

### 3. 上下文复用
```python
# 同一 Sprint 内的任务共享系统提示缓存
# 系统提示包含：角色定义 + 项目规范 + 当前 Sprint 上下文
# 每次调用只更新任务部分
```

### 4. 早停策略
```python
# 如果前 3 个测试用例都失败，停止生成剩余测试
# 先修复根本问题，再继续
```

## 成本报告

每日生成成本报告：
```
日期: 2026-05-12
总 Token: 450,000 (input: 380,000, output: 70,000)
估算成本: $8.50
缓存命中率: 65% (节省 $12.30)

按模型分布:
  Opus 4.7:   120,000 tokens ($6.00) - 架构设计、复杂实现
  Sonnet 4.6: 280,000 tokens ($2.10) - 代码审查、测试
  Haiku 4.5:   50,000 tokens ($0.40) - 文档、进度汇报

按任务类型:
  代码实现: 45%
  代码审查: 25%
  测试编写: 20%
  其他:     10%
```
