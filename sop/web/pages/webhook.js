// Webhook 配置管理页面
window.i18nExtend && window.i18nExtend({
  zh: { page_webhook: 'Webhook', webhook_new: '+ 新建', webhook_empty: '暂无 Webhook，点击右上角新建', webhook_test: '测试', webhook_enable: '启用', webhook_disable: '停用', webhook_delete: '删除', webhook_events: '订阅事件', webhook_secret: '签名密钥 (可选)' },
  en: { page_webhook: 'Webhook', webhook_new: '+ New', webhook_empty: 'No webhooks yet', webhook_test: 'Test', webhook_enable: 'Enable', webhook_disable: 'Disable', webhook_delete: 'Delete', webhook_events: 'Events', webhook_secret: 'Secret (optional)' },
});
const WebhookPage = () => {
  const [hooks, setHooks] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [modal, setModal] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', url: '', secret: '', events: [] });
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const load = () => {
    apiFetch(`/webhooks`, { headers: authHeaders() }).then(r => r.json()).then(setHooks).catch(() => {});
    apiFetch(`/webhooks/events`, { headers: authHeaders() }).then(r => r.json()).then(d => setEvents(d.events || [])).catch(() => {});
  };
  React.useEffect(() => { load(); }, []);

  const api = async (url, method, body) => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch(url, { method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || '操作失败');
      setMsg({ ok: true, text: '操作成功' }); load(); setModal(false); setForm({ name: '', url: '', secret: '', events: [] });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  };

  const test = async (id) => {
    const r = await apiFetch(`/webhooks/${id}/test`, { method: 'POST', headers: authHeaders() });
    const d = await r.json();
    setMsg({ ok: d.ok, text: d.ok ? `测试成功 (${d.status_code})` : `测试失败: ${d.error}` });
  };

  const toggleEvent = (e) => setForm(f => ({
    ...f, events: f.events.includes(e) ? f.events.filter(x => x !== e) : [...f.events, e]
  }));

  return React.createElement('div', { style: { padding: '24px 32px' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
      React.createElement('h2', { style: { color: 'var(--text)', fontSize: 20 } }, 'Webhook 配置'),
      React.createElement('button', { onClick: () => setModal(true), style: { padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13 } }, '+ 新建')
    ),
    msg && React.createElement('div', { style: { padding: '8px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, background: msg.ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)', color: msg.ok ? '#4ade80' : '#f87171' } }, msg.text),
    hooks.length === 0 ? React.createElement('div', { style: { color: 'var(--text3)', padding: 32, textAlign: 'center' } }, '暂无 Webhook，点击右上角新建') :
    React.createElement('div', { style: { display: 'grid', gap: 10 } },
      hooks.map(h => React.createElement('div', { key: h.id, style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 14 } }, h.name),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', fontFamily: 'monospace', marginTop: 2 } }, h.url),
            React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 } },
              (h.events || []).map(e => React.createElement('span', { key: e, style: { fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--btn-accent-soft-bg)', color: 'var(--btn-accent-soft-fg)' } }, e))
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            React.createElement('span', { style: { fontSize: 11, padding: '2px 7px', borderRadius: 4, background: h.active ? 'rgba(34,197,94,.15)' : 'rgba(100,116,139,.15)', color: h.active ? '#4ade80' : '#64748b' } }, h.active ? '启用' : '停用'),
            h.fail_count > 0 && React.createElement('span', { style: { fontSize: 11, color: '#f87171' } }, `失败 ${h.fail_count}`),
            React.createElement('button', { onClick: () => test(h.id), style: { padding: '4px 10px', borderRadius: 5, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, '测试'),
            React.createElement('button', { onClick: () => api(`${API}/webhooks/${h.id}`, 'PATCH', { active: !h.active }), style: { padding: '4px 10px', borderRadius: 5, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, h.active ? '停用' : '启用'),
            React.createElement('button', { onClick: () => { if (confirm(`删除 ${h.name}？`)) api(`${API}/webhooks/${h.id}`, 'DELETE'); }, style: { padding: '4px 10px', borderRadius: 5, border: 'none', background: 'rgba(239,68,68,.12)', color: '#f87171', cursor: 'pointer', fontSize: 12 } }, '删除')
          )
        )
      ))
    ),
    modal && React.createElement('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, onClick: e => { if (e.target === e.currentTarget) setModal(false); } },
      React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 480, maxWidth: '94vw' } },
        React.createElement('h3', { style: { color: 'var(--text)', marginBottom: 18, fontSize: 16 } }, '新建 Webhook'),
        React.createElement('div', { style: { display: 'grid', gap: 10 } },
          [['名称', 'name', 'text'], ['URL', 'url', 'url'], ['签名密钥 (可选)', 'secret', 'text']].map(([label, key, type]) =>
            React.createElement('div', { key },
              React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, label),
              React.createElement('input', { type, value: form[key] || '', onChange: e => setForm(f => ({ ...f, [key]: e.target.value })), style: { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' } })
            )
          ),
          React.createElement('div', null,
            React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 6 } }, '订阅事件'),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              events.map(e => React.createElement('label', { key: e, style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: form.events.includes(e) ? 'var(--accent)' : 'var(--text2)' } },
                React.createElement('input', { type: 'checkbox', checked: form.events.includes(e), onChange: () => toggleEvent(e) }), e
              ))
            )
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 } },
          React.createElement('button', { onClick: () => setModal(false), style: { padding: '7px 16px', borderRadius: 6, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 13 } }, '取消'),
          React.createElement('button', { disabled: saving || !form.name || !form.url, onClick: () => api(`${API}/webhooks`, 'POST', form), style: { padding: '7px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13 } }, saving ? '保存中...' : '创建')
        )
      )
    )
  );
};
