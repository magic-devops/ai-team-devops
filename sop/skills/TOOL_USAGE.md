# 工具使用规范

## 工具选择原则

优先使用专用工具，而非通用 Bash 命令：

| 操作 | 优先使用 | 避免使用 |
|------|---------|---------|
| 读取文件 | Read 工具 | `cat`, `head`, `tail` |
| 编辑文件 | Edit 工具 | `sed`, `awk` |
| 创建文件 | Write 工具 | `echo >`, `cat <<EOF` |
| 搜索内容 | Bash grep | — |
| 查找文件 | Bash find | — |
| 运行命令 | Bash | — |

## 文件读取规范

### 精确读取（节省 token）
```python
# 好：只读需要的部分
Read(file="src/auth/jwt.ts", offset=45, limit=30)

# 差：读整个文件
Read(file="src/auth/jwt.ts")  # 如果文件很大
```

### 读取前先定位
```bash
# 先 grep 找到行号
grep -n "function generateToken" src/auth/jwt.ts
# → 47: function generateToken(payload: Payload): string {

# 再精确读取
Read(file="src/auth/jwt.ts", offset=47, limit=20)
```

## 文件编辑规范

### 使用 Edit（增量更新）
```python
# 好：只发送变更部分
Edit(
    file="src/auth/jwt.ts",
    old_string="const SECRET = 'hardcoded'",
    new_string="const SECRET = process.env.JWT_SECRET"
)

# 差：重写整个文件（除非是全量重写）
Write(file="src/auth/jwt.ts", content="...整个文件内容...")
```

### Edit 的 old_string 必须唯一
```python
# 如果 old_string 在文件中出现多次，提供更多上下文
Edit(
    file="src/utils.ts",
    old_string="""function validate(input: string) {
  return input.length > 0
}""",
    new_string="""function validate(input: string) {
  return input.trim().length > 0
}"""
)
```

## Bash 命令规范

### 命令注入防护
```bash
# 好：引号保护用户输入
grep -r "$USER_INPUT" ./src/

# 差：直接拼接（可能注入）
grep -r $USER_INPUT ./src/
```

### 并行执行独立命令
```python
# 好：并行执行（在同一消息中）
Bash("npm run build")
Bash("npm run lint")

# 差：串行执行独立命令
Bash("npm run build && npm run lint")  # 如果两者独立
```

### 超时设置
```python
# 长时间运行的命令设置超时
Bash("npm run test:e2e", timeout=300000)  # 5分钟
```

## 搜索规范

### 代码搜索
```bash
# 搜索函数定义
grep -n "function generateToken\|const generateToken\|generateToken =" src/

# 搜索文件
find . -name "*.test.ts" -not -path "*/node_modules/*"

# 搜索特定模式
grep -rn "TODO\|FIXME\|HACK" src/ --include="*.ts"
```

### 搜索结果处理
- 搜索结果只用于定位，不作为代码内容使用
- 定位后用 Read 工具读取完整内容
- 搜索结果超过 20 行时，缩小搜索范围

## LanceDB 工具使用

```python
# 初始化（项目开始时一次）
db = init_project_memory(project_id)

# 写入（任务完成时）
add_task(db, project_id, req_id, title, description, assigned_to)

# 检索（开始新任务前）
similar = search_similar(db, "tasks", task_description, limit=3)

# 更新状态（状态变化时）
update_task_status(db, task_id, "done")
```

## 工具调用并行化

```python
# 好：独立操作并行执行
parallel:
  Read("src/auth/login.ts")
  Read("src/auth/login.test.ts")
  Bash("grep -n 'UserService' src/auth/login.ts")

# 差：独立操作串行执行
Read("src/auth/login.ts")
# 等待...
Read("src/auth/login.test.ts")
# 等待...
```

**规则**：没有依赖关系的工具调用必须并行执行。
