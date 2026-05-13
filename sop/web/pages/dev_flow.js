/**
 * 研发全流程枢纽：可视化阶段 + 一键跳转 + 低 Token 提示短句（精简要义，引用路径而非贴全文）
 */
function devFlowNavigate(tabId) {
  window.dispatchEvent(new CustomEvent('app-set-tab', { detail: { tab: tabId } }));
}

const DEV_FLOW_STAGES = [
  { id: 'req', label: '需求', sub: '澄清 · 优先级 · 范围', tab: 'requirements', icon: '📋' },
  { id: 'split', label: '拆解', sub: '需求→子项/估点', tab: 'requirements', icon: '✂️' },
  { id: 'design', label: '方案', sub: '架构 · 接口 · 回滚', tab: 'design-docs', icon: '📐' },
  { id: 'iterate', label: '迭代', sub: 'Sprint · 燃尽', tab: 'iteration', icon: '🔄' },
  { id: 'task', label: '执行', sub: '分配 · 状态', tab: 'plan', icon: '⚙️' },
  { id: 'dev', label: '开发', sub: 'Vibe · CLI · 规范', tab: 'vibe', icon: '💻' },
  { id: 'multi', label: '多 Agent', sub: '专家组 · 编排', tab: 'agents', icon: '🤖' },
  { id: 'env', label: '镜像/环境', sub: 'Docker · 检查', tab: 'docker', icon: '🐳' },
  { id: 'debug', label: '调试', sub: '问题 · 根因', tab: 'issues', icon: '🔧' },
  { id: 'orch', label: '发布/编排', sub: '工作流 · MCP', tab: 'orchestration', icon: '🚀' },
];

/** 复制到剪贴板：短提示，减少模型上下文；引用仓库内路径由人/工具按需加载 */
const DEV_FLOW_PROMPTS = [
  {
    title: '需求澄清（低 Token）',
    text:
      '针对需求 [ID/标题]：仅输出①范围/非范围 ②验收标准（可测）③风险与假设④待确认问题（≤5条）。不要写实现代码；引用 specs/ 时只写相对路径。',
  },
  {
    title: '需求拆解 → 任务',
    text:
      '将需求拆为 ≤10 条任务：每条含标题、依赖、估点(1-5)、负责人角色；用表格输出。不展开技术细节；接口/表结构放到「技术方案」阶段。',
  },
  {
    title: '功能/接口设计摘要',
    text:
      '输出≤300字摘要 + 「变更清单」：影响模块、对外接口、数据表、兼容策略。详设写入技术方案文档（.ai-memory/tech_design），此处不贴长文。',
  },
  {
    title: '开发计划（迭代内）',
    text:
      '基于当前 Sprint 任务：给出本周交付顺序（拓扑排序）、阻塞项、每日可验证里程碑。不要重复需求全文，只引用任务 ID。',
  },
  {
    title: '编码实现（规范驱动）',
    text:
      '实现任务 [TASK-ID]：严格遵守 specs/backend 或 specs/frontend 中相关文件；改动面尽量小；先列文件清单再给补丁思路。禁止无关重构。',
  },
  {
    title: '调试 / 排障',
    text:
      '根据错误日志/堆栈：①最小复现步骤 ②根因假设（≤3条）③验证实验 ④最小修复 diff。不要猜测未给出的代码路径。',
  },
  {
    title: '多 Agent 分工',
    text:
      '拆分为 Planner / Coder / Reviewer 可并行子任务：每段输入≤150字 + 明确产出物格式。由编排页触发，避免单轮超长 system prompt。',
  },
  {
    title: '镜像 / 运行 / 发布检查',
    text:
      '输出发布前检查表：配置项、DB 迁移、回滚步骤、监控与告警各 1 行；Docker/compose 仅确认镜像名与端口，不粘贴整个 yaml。',
  },
];

function DevFlowHub() {
  const { data, loading, error, reload } = useFetch(`${API}/dev-flow/summary`);
  const [openPrompt, setOpenPrompt] = React.useState(0);

  const copy = (t) => {
    navigator.clipboard.writeText(t).then(() => showToast('已复制', 'ok')).catch(() => showToast('复制失败', 'err'));
  };

  const hints = React.useMemo(() => {
    const h = [];
    if (!data) return h;
    if (!(data.requirements && data.requirements.total)) h.push({ type: 'warn', text: '尚无需求入库：从「需求管理」录入或导入。' });
    else if (data.requirements && data.requirements.p0 > 0) h.push({ type: 'info', text: `存在 P0 需求 ${data.requirements.p0} 条，建议优先闭环验收标准。` });
    if (data.tasks && data.tasks.total_all && data.tasks.linked_to_requirement / data.tasks.total_all < 0.25) {
      h.push({ type: 'warn', text: '任务与需求关联度偏低：拆解时在任务上绑定 requirement_id，便于追溯。' });
    }
    if (!(data.design_docs && data.design_docs.count)) h.push({ type: 'info', text: '技术方案文档数为 0：关键变更前先落「技术方案」再开发，降低返工。' });
    if (data.issues && data.issues.critical_open > 0) h.push({ type: 'err', text: `有 ${data.issues.critical_open} 个高优未关闭问题，建议先处理再扩功能。` });
    if (!(data.repo_hints && data.repo_hints.dockerfile) && !(data.repo_hints && data.repo_hints.compose)) h.push({ type: 'info', text: '未发现 Dockerfile/compose：环境管理可从模板初始化。' });
    if (((data.agents && data.agents.definitions) || 0) >= 1 && ((data.agents && data.agents.groups) || 0) === 0) {
      h.push({ type: 'info', text: '已定义 Agent 但未建专家组：可在 Agent 管理创建 group 供 Vibe 与编排复用。' });
    }
    return h;
  }, [data]);

  if (loading) {
    return (
      <div>
        <div className="section-title">研发全流程</div>
        <PageSkeleton cards={3} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">研发全流程</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  const R = data.requirements || {};
  const T = data.tasks || {};
  const I = data.issues || {};
  const S = data.sprint;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">研发全流程 · 智能交付枢纽</div>
        <RefreshBtn onClick={reload} />
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
        单接口聚合项目状态，减少多轮问答消耗；阶段卡片直达对应模块。提示短句强调<strong style={{ color: '#94a3b8' }}>引用路径、限制长度、分阶段输入</strong>以控制 Token。
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>需求</h3>
          <div className="stat-val">{R.total != null ? R.total : 0}</div>
          <div className="stat-sub">P0 {R.p0 != null ? R.p0 : 0}</div>
        </div>
        <div className="card">
          <h3>任务(Sprint)</h3>
          <div className="stat-val">{T.sprint_scope != null ? T.sprint_scope : 0}</div>
          <div className="stat-sub">完成 {T.done_sprint != null ? T.done_sprint : 0} · 已关联需求 {T.linked_to_requirement != null ? T.linked_to_requirement : 0}/{T.total_all != null ? T.total_all : 0}</div>
        </div>
        <div className="card">
          <h3>问题(未关闭)</h3>
          <div className="stat-val">{I.open != null ? I.open : 0}</div>
          <div className="stat-sub">高优 {I.critical_open != null ? I.critical_open : 0}</div>
        </div>
        <div className="card">
          <h3>方案 / Agent</h3>
          <div className="stat-val">{data.design_docs && data.design_docs.count != null ? data.design_docs.count : 0}</div>
          <div className="stat-sub">
            Agent {data.agents && data.agents.definitions != null ? data.agents.definitions : 0} · 组 {data.agents && data.agents.groups != null ? data.agents.groups : 0}
          </div>
        </div>
      </div>

      {S && (
        <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
          <span style={{ color: '#94a3b8' }}>当前 Sprint</span>{' '}
          <strong style={{ color: '#e2e8f0' }}>{S.id || '-'}</strong> · {S.goal || '（无描述）'}
        </div>
      )}

      {hints.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
            质量与节奏建议
          </div>
          {hints.map((x, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                marginBottom: 6,
                padding: '8px 10px',
                borderRadius: 8,
                background: x.type === 'err' ? 'rgba(127,29,29,0.35)' : x.type === 'warn' ? 'rgba(120,53,15,0.35)' : 'rgba(30,58,95,0.5)',
                color: '#e2e8f0',
              }}
            >
              {x.text}
            </div>
          ))}
        </div>
      )}

      <div className="section-title" style={{ marginBottom: 10 }}>
        阶段导航（一键进入）
      </div>
      <div className="scroll-slim" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 10, marginBottom: 20 }}>
        {DEV_FLOW_STAGES.map((st) => (
          <button
            key={st.id}
            type="button"
            className="card"
            onClick={() => devFlowNavigate(st.tab)}
            style={{
              minWidth: 132,
              flexShrink: 0,
              cursor: 'pointer',
              textAlign: 'left',
              border: '1px solid #334155',
              background: '#1e293b',
            }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>{st.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{st.label}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{st.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title" style={{ fontSize: 14 }}>
            低 Token 提示模板（点击展开 / 复制）
          </div>
          {DEV_FLOW_PROMPTS.map((p, i) => (
            <div key={i} style={{ borderBottom: '1px solid #334155', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <button type="button" className="btn btn-sm" style={{ background: 'transparent', color: '#93c5fd', textAlign: 'left', flex: 1 }} onClick={() => setOpenPrompt(openPrompt === i ? -1 : i)}>
                  {openPrompt === i ? '▼' : '▶'} {p.title}
                </button>
                <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => copy(p.text)}>
                  复制
                </button>
              </div>
              {openPrompt === i && (
                <pre style={{ marginTop: 8, fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.55, maxHeight: 160, overflow: 'auto' }}>{p.text}</pre>
              )}
            </div>
          ))}
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 10 }}>
            用法：复制到 Vibe Coding / 外部 Agent；把 [ID] 替换为真实键值。长规范用「规范文档」「技术方案」页打开，勿粘贴全文。
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ fontSize: 14 }}>
            仓库与工程线索
          </div>
          <ul style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.9, paddingLeft: 18 }}>
            <li>
              项目路径：<code style={{ color: '#e2e8f0' }}>{data.project_path}</code>
            </li>
            <li>specs/ 目录：{data.repo_hints && data.repo_hints.specs_dir ? '✅ 已存在' : '— 未检测到'}</li>
            <li>Dockerfile：{data.repo_hints && data.repo_hints.dockerfile ? '✅' : '—'}</li>
            <li>Compose：{data.repo_hints && data.repo_hints.compose ? '✅' : '—'}</li>
          </ul>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => devFlowNavigate('knowledge-mgr')}>
              知识库
            </button>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => devFlowNavigate('specs')}>
              规范文档
            </button>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => devFlowNavigate('cli')}>
              CLI 工具
            </button>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => devFlowNavigate('models')}>
              模型配置
            </button>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => devFlowNavigate('mcp')}>
              MCP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
