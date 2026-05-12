# Prompt 工程规范

> 版本: v1.0 | 更新: 2026-05-12
> 适用于 AI 智能体构建 Prompt 和调用 LLM API。

## 1. Prompt 结构规范

```
系统提示（System）= 角色 + 规则 + 约束
用户消息（User）  = 任务 + 上下文 + 输出要求
```

### 系统提示模板
```
你是 {角色}，负责 {职责}。

## 规则
- {规则1}
- {规则2}

## 约束
- {约束1}
- {约束2}
```

### 任务消息模板
```
## 任务
{任务描述，1-3 句话}

## 上下文
{必要的背景信息}

## 输出要求
- 格式：{JSON/Markdown/代码}
- 长度：{限制}
- 包含：{必须包含的内容}
```

## 2. Prompt Caching（必须启用）

```python
import anthropic

client = anthropic.Anthropic()

def call_with_cache(system: str, user: str, model: str = "claude-sonnet-4-6") -> str:
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=[{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"},  # 缓存系统提示
        }],
        messages=[{"role": "user", "content": user}],
    )
    return response.content[0].text
```

**缓存策略**：
- 系统提示（角色 + 规则）：必须缓存（节省 90% 输入成本）
- 项目规范文档：必须缓存
- 任务上下文：不缓存（每次不同）

## 3. 模型选择策略

```python
def select_model(task_type: str, complexity: str) -> str:
    if task_type in ("architecture", "complex_reasoning") or complexity == "high":
        return "claude-opus-4-7"
    if task_type in ("code", "review", "test", "debug"):
        return "claude-sonnet-4-6"
    # 文档生成、格式化、简单检索
    return "claude-haiku-4-5-20251001"
```

## 4. 结构化输出

```python
# ✅ 要求 JSON 输出时，明确 Schema
system = """
输出必须是合法的 JSON，格式如下：
{
  "tasks": [
    {
      "id": "T001",
      "title": "string",
      "estimate": "S|M|L",
      "depends_on": ["T000"]
    }
  ]
}
不要输出任何 JSON 以外的内容。
"""

# ✅ 解析时处理异常
import json
try:
    result = json.loads(response)
except json.JSONDecodeError:
    # 提取 JSON 块
    import re
    match = re.search(r'\{.*\}', response, re.DOTALL)
    result = json.loads(match.group()) if match else {}
```

## 5. 上下文长度控制

```python
# ✅ 估算 token 数（粗略：1 token ≈ 4 字符）
def estimate_tokens(text: str) -> int:
    return len(text) // 4

# ✅ 超出预算时截断
def truncate_to_budget(content: str, budget_tokens: int) -> str:
    max_chars = budget_tokens * 4
    if len(content) <= max_chars:
        return content
    return content[:max_chars] + "\n...[内容已截断]"
```

## 6. 错误重试策略

```python
import time
from anthropic import RateLimitError, APIError

def call_with_retry(prompt: str, max_retries: int = 3) -> str:
    for attempt in range(max_retries):
        try:
            return call_api(prompt)
        except RateLimitError:
            wait = 2 ** attempt  # 指数退避
            time.sleep(wait)
        except APIError as e:
            if e.status_code >= 500:  # 服务端错误才重试
                time.sleep(1)
            else:
                raise  # 客户端错误不重试
    raise Exception(f"重试 {max_retries} 次后仍失败")
```

## 7. 禁止事项

- 禁止在 Prompt 中包含真实密钥/密码
- 禁止将用户 PII 发送给外部 API（除非有明确授权）
- 禁止无限重试（最多 3 次）
- 禁止忽略 API 错误（必须处理）
