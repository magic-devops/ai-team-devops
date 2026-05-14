// 审计日志页面
window.i18nExtend && window.i18nExtend({
  zh: { page_audit: '审计日志', audit_total: '共 {n} 条', audit_all: '全部', audit_loading: '加载中...', audit_prev: '上一页', audit_next: '下一页', audit_page: '第 {n} 页' },
  en: { page_audit: 'Audit Log', audit_total: '{n} records', audit_all: 'All', audit_loading: 'Loading...', audit_prev: 'Prev', audit_next: 'Next', audit_page: 'Page {n}' },
});
const AuditPage = () => {
  const [items, setItems] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [filter, setFilter] = React.useState({ action: '', resource_type: '', user_id: '' });
  const [loading, setLoading] = React.useState(false);

  const load = (p = 1) => {
    setLoading(true);
    const q = new URLSearchParams({ page: p, size: 50 });
    if (filter.action) q.set('action', filter.action);
    if (filter.resource_type) q.set('resource_type', filter.resource_type);
    if (filter.user_id) q.set('user_id', filter.user_id);
    apiFetch(`/audit?${q}`, { headers: authHeaders() })
      .then(r => r.json()).then(d => { setItems(d.items || []); setTotal(d.total || 0); setPage(p); })
      .catch(() => {}).finally(() => setLoading(false));
  };

  React.useEffect(() => { load(1); }, [filter]);

  const ACTION_COLOR = { create: '#22c55e', update: '#3b82f6', delete: '#ef4444', login: '#a855f7' };

  return React.createElement('div', { style: { padding: '24px 32px' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
      React.createElement('h2', { style: { color: 'var(--text)', fontSize: 20 } }, '审计日志'),
      React.createElement('span', { style: { fontSize: 13, color: 'var(--text3)' } }, `共 ${total} 条`)
    ),
    // 过滤栏
    React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' } },
      ['create', 'update', 'delete', 'login', ''].map(a =>
        React.createElement('button', {
          key: a || 'all', onClick: () => setFilter(f => ({ ...f, action: a })),
          style: {
            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
            background: filter.action === a ? (ACTION_COLOR[a] || 'var(--accent)') : 'var(--btn-muted-bg)',
            color: filter.action === a ? '#fff' : 'var(--text2)'
          }
        }, a || '全部')
      ),
      React.createElement('input', {
        placeholder: '用户ID过滤', value: filter.user_id,
        onChange: e => setFilter(f => ({ ...f, user_id: e.target.value })),
        style: { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 12, width: 140 }
      })
    ),
    loading ? React.createElement('div', { style: { color: 'var(--text3)', padding: 20 } }, '加载中...') :
    React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            ['时间', '用户', '操作', '资源', '路径', '状态'].map(h =>
              React.createElement('th', { key: h, style: { padding: '8px 12px', color: 'var(--text3)', textAlign: 'left', borderBottom: '1px solid var(--border)', fontWeight: 500 } }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          items.map(a => React.createElement('tr', { key: a.id, style: { borderBottom: '1px solid var(--border-subtle)' } },
            React.createElement('td', { style: { padding: '7px 12px', color: 'var(--text3)', whiteSpace: 'nowrap' } }, a.created_at?.slice(0, 19).replace('T', ' ')),
            React.createElement('td', { style: { padding: '7px 12px', color: 'var(--text)' } }, a.username || a.user_id || '—'),
            React.createElement('td', { style: { padding: '7px 12px' } },
              React.createElement('span', { style: { fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: (ACTION_COLOR[a.action] || '#64748b') + '22', color: ACTION_COLOR[a.action] || '#64748b' } }, a.action)
            ),
            React.createElement('td', { style: { padding: '7px 12px', color: 'var(--text2)' } }, a.resource_type ? `${a.resource_type}${a.resource_id ? ':' + a.resource_id.slice(0, 8) : ''}` : '—'),
            React.createElement('td', { style: { padding: '7px 12px', color: 'var(--text3)', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.path),
            React.createElement('td', { style: { padding: '7px 12px' } },
              React.createElement('span', { style: { color: a.status_code >= 400 ? '#ef4444' : '#22c55e', fontWeight: 600 } }, a.status_code)
            )
          ))
        )
      )
    ),
    total > 50 && React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 } },
      page > 1 && React.createElement('button', { onClick: () => load(page - 1), style: btnStyle() }, '上一页'),
      React.createElement('span', { style: { fontSize: 13, color: 'var(--text3)', alignSelf: 'center' } }, `第 ${page} 页`),
      items.length === 50 && React.createElement('button', { onClick: () => load(page + 1), style: btnStyle() }, '下一页')
    )
  );
};
function btnStyle() { return { padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', fontSize: 13 }; }
