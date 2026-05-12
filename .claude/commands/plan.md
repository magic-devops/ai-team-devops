# /plan - 需求规划

将用户需求拆解为可执行任务树。

## 执行步骤

1. 读取 `memory/current_state.json` 了解当前状态
2. 使用 `<think>` 分析需求，识别依赖关系
3. 按 MoSCoW 优先级分类（Must/Should/Could/Won't）
4. 输出 YAML 格式任务树，含估算和完成标准
5. 写入 `memory/current_state.json`

## 输出格式

```yaml
plan_id: PLAN-{timestamp}
goal: "..."
tasks:
  - id: T001
    title: "..."
    priority: P0|P1|P2
    estimate: S|M|L   # S<2h M<1d L>1d
    depends_on: []
    done_when: "..."
```
