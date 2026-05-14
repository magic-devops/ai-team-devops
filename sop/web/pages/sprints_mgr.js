window.i18nExtend && window.i18nExtend({
  zh: { page_sprints_mgr: 'Sprint 管理', sprint_new: '+ 新建 Sprint', sprint_active: '进行中', sprint_completed: '已完成', sprint_goal: '目标', sprint_points: '计划点数', sprint_ends: '截止日期', sprint_progress: '进度', sprint_retro: '回顾', sprint_close: '关闭 Sprint', sprint_no_active: '当前无活跃 Sprint', sprint_tasks: '任务', sprint_issues: '问题', sprint_blocked: '阻塞', sprint_velocity: '速度', sprint_conf: '平均置信度' },
  en: { page_sprints_mgr: 'Sprint Mgmt', sprint_new: '+ New Sprint', sprint_active: 'Active', sprint_completed: 'Completed', sprint_goal: 'Goal', sprint_points: 'Points', sprint_ends: 'Ends', sprint_progress: 'Progress', sprint_retro: 'Retrospective', sprint_close: 'Close Sprint', sprint_no_active: 'No active sprint', sprint_tasks: 'Tasks', sprint_issues: 'Issues', sprint_blocked: 'Blocked', sprint_velocity: 'Velocity', sprint_conf: 'Avg Confidence' },
});

const SprintManager = () => {
  const tr = k => (typeof window.t === 'function' ? window.t(k) : k);
  const [sprints, setSprints] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [progress, setProgress] = React.useState(null);
  const [modal, setModal] = React.useState(false);
  const [form, setForm] = React.useState({ goal: '', planned_points: 0, ends_at: '' });
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const load = () => {
    apiFetch(`/sprints?size=30`, { headers: authHeaders() })
      .then(r => r.json()).then(d => setSprints(d.items || [])).catch(() => {});
  };

  const loadProgress = id => {
    apiFetch(`/sprints/${id}/progress`, { headers: authHeaders() })
      .then(r => r.json()).then(setProgress).catch(() => {});
  };

  React.useEffect(() => { load(); }, []);
  React.useEffect(() => { if (selected) loadProgress(selected); }, [selected]);

  const api = async (url, method, body) => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch(url, { method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || '操作失败');
      setMsg({ ok: true, text: '操作成功' }); load(); setModal(false); setForm({ goal: '', planned_points: 0, ends_at: '' });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  };

  const active = sprints.find(s => s.status === 'active');
  const STATUS_COLOR = { active: '#22c55e', completed: '#64748b', planning: '#f59e0b' };

  return React.createElement('div', { style: { padding: '24px 32px', display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' } },
    // 左侧列表
    React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
        React.createElement('h2', { style: { color: 'var(--text)', fontSize: 18, margin: 0 } }, tr('page_sprints_mgr')),
        React.createElement('button', { onClick: () => setModal(true), style: btnStyle('accent') }, tr('sprint_new'))
      ),
      msg && React.createElement('div', { style: { padding: '7px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12, background: msg.ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)', color: msg.ok ? '#4ade80' : '#f87171' } }, msg.text),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        sprints.map(s => React.createElement('div', {
          key: s.id,
          onClick: () => setSelected(s.id),
          style: { padding: '10px 14px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${selected === s.id ? 'var(--accent)' : 'var(--border)'}`, background: selected === s.id ? 'var(--list-select-bg)' : 'var(--bg2)' }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('span', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 13 } }, s.id),
            React.createElement('span', { style: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: (STATUS_COLOR[s.status] || '#64748b') + '22', color: STATUS_COLOR[s.status] || '#64748b' } }, tr('sprint_' + s.status) || s.status)
          ),
          React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.goal || '—')
        ))
      )
    ),

    // 右侧详情
    React.createElement('div', null,
      !selected
        ? React.createElement('div', { style: { color: 'var(--text3)', padding: 32, textAlign: 'center' } }, '← 选择一个 Sprint 查看详情')
        : progress
          ? React.createElement('div', null,
              // Sprint 头部
              React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 14 } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontWeight: 700, color: 'var(--text)', fontSize: 16 } }, progress.sprint?.id),
                    React.createElement('div', { style: { fontSize: 13, color: 'var(--text2)', marginTop: 4 } }, progress.sprint?.goal),
                    progress.sprint?.ends_at && React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginTop: 2 } }, `${tr('sprint_ends')}: ${progress.sprint.ends_at.slice(0, 10)}`)
                  ),
                  progress.sprint?.status === 'active' && React.createElement('button', {
                    onClick: () => api(`${API}/sprints/${selected}`, 'PATCH', { status: 'completed' }),
                    style: { ...btnStyle('muted'), fontSize: 12 }
                  }, tr('sprint_close'))
                ),
                // 进度条
                React.createElement('div', { style: { marginTop: 12 } },
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 4 } },
                    React.createElement('span', null, `${tr('sprint_progress')}: ${progress.completion_rate}%`),
                    React.createElement('span', null, `${progress.completed}/${progress.total_tasks} ${tr('sprint_tasks')}`)
                  ),
                  React.createElement('div', { style: { height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' } },
                    React.createElement('div', { style: { height: '100%', width: `${progress.completion_rate}%`, background: '#22c55e', borderRadius: 3, transition: 'width .3s' } })
                  )
                )
              ),
              // 统计卡片
              React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 } },
                [
                  ['completed', progress.completed, '#22c55e'],
                  ['in_progress', progress.in_progress, '#3b82f6'],
                  ['pending', progress.pending, '#64748b'],
                  ['blocked', (progress.blocked || []).length, '#ef4444'],
                ].map(([k, v, c]) => React.createElement('div', { key: k, style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' } },
                  React.createElement('div', { style: { fontSize: 22, fontWeight: 700, color: c } }, v),
                  React.createElement('div', { style: { fontSize: 11, color: 'var(--text3)', marginTop: 2 } }, tr('sprint_' + k) || k)
                ))
              ),
              // 阻塞任务
              (progress.blocked || []).length > 0 && React.createElement('div', { style: { background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 14 } },
                React.createElement('div', { style: { fontWeight: 600, color: '#f87171', fontSize: 13, marginBottom: 8 } }, `${tr('sprint_blocked')} (${progress.blocked.length})`),
                progress.blocked.map(t => React.createElement('div', { key: t.id, style: { fontSize: 12, color: 'var(--text2)', padding: '3px 0' } }, `${t.id}: ${t.title}`))
              ),
              // 开放问题
              (progress.open_issues || []).length > 0 && React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 14 } },
                React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 13, marginBottom: 8 } }, `${tr('sprint_issues')} (${progress.open_issues.length})`),
                progress.open_issues.map(i => React.createElement('div', { key: i.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', padding: '3px 0' } },
                  React.createElement('span', null, i.title),
                  React.createElement('span', { style: { color: i.severity === 'P0' ? '#ef4444' : i.severity === 'P1' ? '#f59e0b' : 'var(--text3)' } }, i.severity)
                ))
              ),
              // 回顾
              React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' } },
                React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 13, marginBottom: 8 } }, tr('sprint_retro')),
                React.createElement('textarea', {
                  style: { width: '100%', minHeight: 80, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' },
                  defaultValue: progress.sprint?.retrospective || '',
                  onBlur: e => api(`${API}/sprints/${selected}`, 'PATCH', { retrospective: e.target.value })
                })
              )
            )
          : React.createElement('div', { style: { color: 'var(--text3)', padding: 20 } }, '加载中...')
    ),

    // 新建 Sprint 模态框
    modal && React.createElement('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, onClick: e => { if (e.target === e.currentTarget) setModal(false); } },
      React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 420 } },
        React.createElement('h3', { style: { color: 'var(--text)', marginBottom: 18, fontSize: 16 } }, tr('sprint_new')),
        React.createElement('div', { style: { display: 'grid', gap: 12 } },
          [['sprint_goal', 'goal', 'text'], ['sprint_ends', 'ends_at', 'date']].map(([lk, key, type]) =>
            React.createElement('div', { key },
              React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, tr(lk)),
              React.createElement('input', { type, value: form[key] || '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })), style: { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' } })
            )
          ),
          React.createElement('div', null,
            React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, tr('sprint_points')),
            React.createElement('input', { type: 'number', min: 0, value: form.planned_points, onChange: e => setForm(f => ({ ...f, planned_points: +e.target.value })), style: { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' } })
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 } },
          React.createElement('button', { onClick: () => setModal(false), style: btnStyle('muted') }, '取消'),
          React.createElement('button', { disabled: saving || !form.goal, onClick: () => api(`${API}/sprints`, 'POST', form), style: btnStyle('accent') }, saving ? '创建中...' : '创建')
        )
      )
    )
  );
};

function btnStyle(v) {
  const s = { padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13 };
  if (v === 'accent') return { ...s, background: 'var(--accent)', color: '#fff' };
  return { ...s, background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)' };
}
