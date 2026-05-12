# custom/ 自定义模块

人工输入的项目特定规范、样例、设计风格，AI 自我进化的知识库。

## 目录结构

```
custom/
├── specs/          # 项目特定开发规范（补充 sop/specs/）
├── examples/       # 代码样例、最佳实践参考
├── design/         # 设计模板、UI 组件库、品牌规范
├── interaction/    # 交互规范、动效、用户体验指南
└── daily/          # 日常输入、临时参考、会议记录
```

## specs/ - 项目特定规范

补充或覆盖 sop 通用规范，优先级高于通用规范。

```
specs/
├── README.md                    # 本项目特定规范索引
├── api-naming.md                # 本项目 API 命名约定
├── error-codes.md               # 错误码规范
└── business-rules.md            # 业务规则（如折扣计算、积分规则）
```

**格式**：Markdown，AI 可直接读取。

## examples/ - 代码样例

经过验证的代码片段，AI 可参考复用。

```
examples/
├── README.md
├── java/
│   ├── controller-template.java  # Controller 标准模板
│   ├── service-impl-pattern.java # Service 实现模式
│   └── exception-handler.java    # 异常处理示例
├── frontend/
│   ├── form-validation.tsx       # 表单验证模式
│   ├── api-client.ts             # API 调用封装
│   └── state-management.ts       # 状态管理模式
└── sql/
    ├── complex-query.sql         # 复杂查询示例
    └── migration-template.sql    # 迁移脚本模板
```

**格式**：源代码文件，带注释说明使用场景。

## design/ - 设计规范

UI/UX 设计资产和规范。

```
design/
├── README.md
├── brand/
│   ├── colors.md                 # 品牌色规范
│   ├── typography.md             # 字体规范
│   └── logo.png                  # Logo 文件
├── components/
│   ├── button-variants.html      # 按钮样式变体
│   ├── form-controls.html        # 表单控件
│   └── modal-template.html       # 弹窗模板
└── layouts/
    ├── dashboard-layout.png      # 仪表盘布局截图
    └── mobile-layout.png         # 移动端布局
```

**格式**：Markdown（规范）+ HTML（组件）+ PNG/SVG（视觉稿）。

## interaction/ - 交互规范

用户交互、动效、反馈机制。

```
interaction/
├── README.md
├── loading-states.md             # 加载状态规范
├── error-feedback.md             # 错误反馈规范
├── animation-timing.md           # 动效时序
└── gesture-controls.md           # 手势操作（移动端）
```

**格式**：Markdown + 可选视频/GIF 演示。

## daily/ - 日常输入

临时参考、会议记录、用户反馈。

```
daily/
├── 2026-05-12-meeting-notes.md  # 会议记录
├── user-feedback-summary.md     # 用户反馈汇总
└── temp-reference.html          # 临时参考页面
```

**格式**：任意（Markdown/HTML/图片/PDF），AI 按需读取。

## 使用方式

### AI 自动加载

AI 在以下场景自动读取 custom/ 内容：
- 实现新功能时，先检查 `custom/examples/` 是否有类似代码
- 设计 UI 时，读取 `custom/design/` 了解品牌规范
- 遇到业务规则时，查阅 `custom/specs/business-rules.md`

### 人工维护

```bash
# 添加新的代码样例
cp src/controller/UserController.java custom/examples/java/

# 添加设计规范
echo "主色: #3b82f6" > custom/design/brand/colors.md

# 记录会议决策
echo "决定使用 Redis 作为缓存" > custom/daily/$(date +%F)-meeting.md
```

### 优先级

```
custom/specs/ > sop/specs/ > 默认行为
```

项目特定规范覆盖通用规范。
