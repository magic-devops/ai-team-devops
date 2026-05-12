# /standup - 每日站会报告

生成今日开发进度报告。

## 执行步骤

1. 读取 `memory/current_state.json`
2. 运行 `git log --since="24 hours ago" --oneline`
3. 查询 LanceDB 中今日完成的任务和新增问题
4. 生成站会报告

## 输出格式

```
## 📅 {日期} 站会报告

### ✅ 昨日完成
- ...

### 🚧 今日计划
- ...

### ⚠️ 阻塞/风险
- ...

### 📊 迭代进度
Sprint X: XX% (X/X 任务)
```
