// Webhook configuration page
window.i18nExtend && window.i18nExtend({
  zh: {
    page_webhook: 'Webhook',
    webhook_page_title: 'Webhook 配置',
    webhook_new: '+ 新建',
    webhook_modal_new: '新建 Webhook',
    webhook_empty: '暂无 Webhook，点击右上角新建',
    webhook_test: '测试',
    webhook_enable: '启用',
    webhook_disable: '停用',
    webhook_delete: '删除',
    webhook_events: '订阅事件',
    webhook_events_hint: '按业务域分组；悬停事件名可看说明。可与外部 Agent / CI / ChatOps 对接。',
    webhook_secret: '签名密钥 (可选)',
    webhook_label_name: '名称',
    webhook_cancel: '取消',
    webhook_saving: '保存中...',
    webhook_create: '创建',
    webhook_op_fail: '操作失败',
    webhook_op_ok: '操作成功',
    webhook_test_ok: '测试成功 ({code})',
    webhook_test_fail: '测试失败: {err}',
    webhook_confirm_del: '删除 {name}？',
    webhook_fail_count: '失败 {n}',
    webhook_select_all: '全选',
    webhook_clear_all: '清除',
    webhook_sel_group: '全选本组',
    webhook_clr_group: '清除本组',
    webhook_cat_task: '任务',
    webhook_cat_requirement: '需求',
    webhook_cat_issue: '问题',
    webhook_cat_sprint: 'Sprint',
    webhook_cat_project: '项目',
    webhook_cat_other: '其他',
  },
  en: {
    page_webhook: 'Webhook',
    webhook_page_title: 'Webhook settings',
    webhook_new: '+ New',
    webhook_modal_new: 'New Webhook',
    webhook_empty: 'No webhooks yet — use New above',
    webhook_test: 'Test',
    webhook_enable: 'Enable',
    webhook_disable: 'Disable',
    webhook_delete: 'Delete',
    webhook_events: 'Subscription events',
    webhook_events_hint: 'Grouped by domain; hover an event for a short description. Use for agents, CI, or ChatOps.',
    webhook_secret: 'Signing secret (optional)',
    webhook_label_name: 'Name',
    webhook_cancel: 'Cancel',
    webhook_saving: 'Saving...',
    webhook_create: 'Create',
    webhook_op_fail: 'Operation failed',
    webhook_op_ok: 'Done',
    webhook_test_ok: 'Test OK ({code})',
    webhook_test_fail: 'Test failed: {err}',
    webhook_confirm_del: 'Delete {name}?',
    webhook_fail_count: 'Failed {n}',
    webhook_select_all: 'Select all',
    webhook_clear_all: 'Clear',
    webhook_sel_group: 'Select group',
    webhook_clr_group: 'Clear group',
    webhook_cat_task: 'Tasks',
    webhook_cat_requirement: 'Requirements',
    webhook_cat_issue: 'Issues',
    webhook_cat_sprint: 'Sprints',
    webhook_cat_project: 'Projects',
    webhook_cat_other: 'Other',
  },
});

const _WEBHOOK_GROUP_ORDER = ['task', 'requirement', 'issue', 'sprint', 'project', 'other'];

const WebhookPage = () => {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const API = typeof window.API === 'string' ? window.API : '/api/v1';
  const [hooks, setHooks] = React.useState([]);
  const [eventIds, setEventIds] = React.useState([]);
  const [catalog, setCatalog] = React.useState([]);
  const [modal, setModal] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', url: '', secret: '', events: [] });
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const _langEn = () => {
    try {
      return String(document.documentElement.lang || '').toLowerCase().startsWith('en');
    } catch (e) {
      return false;
    }
  };

  const evLabel = (ev) => (_langEn() ? (ev.label_en || ev.id) : (ev.label_zh || ev.id));
  const evHint = (ev) => (_langEn() ? (ev.hint_en || '') : (ev.hint_zh || ''));

  const groups = React.useMemo(() => {
    const m = {};
    const list = catalog.length ? catalog : (eventIds || []).map((id) => ({
      id, category: 'other', label_zh: id, label_en: id, hint_zh: '', hint_en: '',
    }));
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      const c = ev.category || 'other';
      if (!m[c]) m[c] = [];
      m[c].push(ev);
    }
    return m;
  }, [catalog, eventIds]);

  const orderedGroupKeys = React.useMemo(() => {
    const keys = Object.keys(groups);
    keys.sort((a, b) => {
      const ia = _WEBHOOK_GROUP_ORDER.indexOf(a);
      const ib = _WEBHOOK_GROUP_ORDER.indexOf(b);
      const va = ia === -1 ? 99 : ia;
      const vb = ib === -1 ? 99 : ib;
      if (va !== vb) return va - vb;
      return a.localeCompare(b);
    });
    return keys;
  }, [groups]);

  const load = () => {
    apiFetch(`${API}/webhooks`, { headers: authHeaders() }).then((r) => r.json()).then(setHooks).catch(() => {});
    apiFetch(`${API}/webhooks/events`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const ids = d.events || [];
        setEventIds(ids);
        if (d.catalog && d.catalog.length) {
          setCatalog(d.catalog);
        } else {
          setCatalog(ids.map((id) => ({
            id, category: 'other', label_zh: id, label_en: id, hint_zh: '', hint_en: '',
          })));
        }
      })
      .catch(() => {});
  };
  React.useEffect(() => { load(); }, []);

  const api = async (url, method, body) => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch(url, { method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || t('webhook_op_fail'));
      setMsg({ ok: true, text: t('webhook_op_ok') }); load(); setModal(false); setForm({ name: '', url: '', secret: '', events: [] });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  };

  const test = async (id) => {
    const r = await apiFetch(`${API}/webhooks/${id}/test`, { method: 'POST', headers: authHeaders() });
    const d = await r.json();
    setMsg({ ok: d.ok, text: d.ok ? t('webhook_test_ok', { code: d.status_code }) : t('webhook_test_fail', { err: d.error || '' }) });
  };

  const toggleEvent = (e) => setForm((f) => ({
    ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e],
  }));

  const selectAllEvents = () => setForm((f) => ({ ...f, events: [...eventIds] }));
  const clearAllEvents = () => setForm((f) => ({ ...f, events: [] }));
  const selectGroup = (c) => {
    const ids = (groups[c] || []).map((x) => x.id);
    setForm((f) => ({ ...f, events: [...new Set([...f.events, ...ids])] }));
  };
  const clearGroup = (c) => {
    const rm = new Set((groups[c] || []).map((x) => x.id));
    setForm((f) => ({ ...f, events: f.events.filter((e) => !rm.has(e)) }));
  };

  const catTitle = (c) => t(`webhook_cat_${c}`, null) || c;

  return React.createElement('div', { style: { padding: '24px 32px' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
      React.createElement('h2', { style: { color: 'var(--text)', fontSize: 20 } }, t('webhook_page_title')),
      React.createElement('button', { onClick: () => setModal(true), style: { padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13 } }, t('webhook_new'))
    ),
    msg && React.createElement('div', { style: { padding: '8px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, background: msg.ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)', color: msg.ok ? '#4ade80' : '#f87171' } }, msg.text),
    hooks.length === 0 ? React.createElement('div', { style: { color: 'var(--text3)', padding: 32, textAlign: 'center' } }, t('webhook_empty')) :
    React.createElement('div', { style: { display: 'grid', gap: 10 } },
      hooks.map((h) => React.createElement('div', { key: h.id, style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 14 } }, h.name),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', fontFamily: 'monospace', marginTop: 2 } }, h.url),
            React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 } },
              (h.events || []).map((e) => React.createElement('span', { key: e, style: { fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'var(--btn-accent-soft-bg)', color: 'var(--btn-accent-soft-fg)' } }, e))
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            React.createElement('span', { style: { fontSize: 11, padding: '2px 7px', borderRadius: 4, background: h.active ? 'rgba(34,197,94,.15)' : 'rgba(100,116,139,.15)', color: h.active ? '#4ade80' : '#64748b' } }, h.active ? t('webhook_enable') : t('webhook_disable')),
            h.fail_count > 0 && React.createElement('span', { style: { fontSize: 11, color: '#f87171' } }, t('webhook_fail_count', { n: h.fail_count })),
            React.createElement('button', { onClick: () => test(h.id), style: { padding: '4px 10px', borderRadius: 5, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, t('webhook_test')),
            React.createElement('button', { onClick: () => api(`${API}/webhooks/${h.id}`, 'PATCH', { active: !h.active }), style: { padding: '4px 10px', borderRadius: 5, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, h.active ? t('webhook_disable') : t('webhook_enable')),
            React.createElement('button', { onClick: () => { if (confirm(t('webhook_confirm_del', { name: h.name }))) api(`${API}/webhooks/${h.id}`, 'DELETE'); }, style: { padding: '4px 10px', borderRadius: 5, border: 'none', background: 'rgba(239,68,68,.12)', color: '#f87171', cursor: 'pointer', fontSize: 12 } }, t('webhook_delete'))
          )
        )
      ))
    ),
    modal && React.createElement('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }, onClick: (e) => { if (e.target === e.currentTarget) setModal(false); } },
      React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' } },
        React.createElement('h3', { style: { color: 'var(--text)', marginBottom: 14, fontSize: 16 } }, t('webhook_modal_new')),
        React.createElement('div', { style: { display: 'grid', gap: 10 } },
          [[t('webhook_label_name'), 'name', 'text'], ['URL', 'url', 'url'], [t('webhook_secret'), 'secret', 'text']].map(([label, key, type]) =>
            React.createElement('div', { key: String(key) },
              React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, label),
              React.createElement('input', { type, value: form[key] || '', onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })), style: { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' } })
            )
          ),
          React.createElement('div', null,
            React.createElement('label', { style: { display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, t('webhook_events')),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--text3)', marginBottom: 8, lineHeight: 1.45 } }, t('webhook_events_hint')),
            React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
              React.createElement('button', { type: 'button', onClick: selectAllEvents, style: { padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, t('webhook_select_all')),
              React.createElement('button', { type: 'button', onClick: clearAllEvents, style: { padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, t('webhook_clear_all'))
            ),
            orderedGroupKeys.map((gk) => React.createElement('div', { key: gk, style: { marginBottom: 12 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 } },
                React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--text2)' } }, catTitle(gk)),
                React.createElement('div', { style: { display: 'flex', gap: 6 } },
                  React.createElement('button', { type: 'button', onClick: () => selectGroup(gk), style: { padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 11 } }, t('webhook_sel_group')),
                  React.createElement('button', { type: 'button', onClick: () => clearGroup(gk), style: { padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 11 } }, t('webhook_clr_group'))
                )
              ),
              React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' } },
                (groups[gk] || []).map((ev) => React.createElement('label', {
                  key: ev.id,
                  title: evHint(ev) || ev.id,
                  style: {
                    display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, cursor: 'pointer',
                    color: form.events.includes(ev.id) ? 'var(--accent)' : 'var(--text2)', lineHeight: 1.35,
                  },
                },
                React.createElement('input', { type: 'checkbox', checked: form.events.includes(ev.id), onChange: () => toggleEvent(ev.id), style: { marginTop: 2 } }),
                React.createElement('span', null, evLabel(ev))
                ))
              )
            ))
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 } },
          React.createElement('button', { onClick: () => setModal(false), style: { padding: '7px 16px', borderRadius: 6, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 13 } }, t('webhook_cancel')),
          React.createElement('button', { disabled: saving || !form.name || !form.url, onClick: () => api(`${API}/webhooks`, 'POST', form), style: { padding: '7px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13 } }, saving ? t('webhook_saving') : t('webhook_create'))
        )
      )
    )
  );
};
