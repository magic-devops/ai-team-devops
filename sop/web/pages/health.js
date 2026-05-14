// System health monitor page
window.i18nExtend && window.i18nExtend({
  zh: {
    page_health: '健康监控',
    health_title: '系统健康监控',
    health_refresh: '刷新',
    health_loading: '加载中...',
    health_fail: '健康检查失败',
    health_updated: '更新: {t}',
    health_metrics: 'Prometheus 指标端点: ',
    health_scope: '作用域',
    health_scope_request: '请求级（含 X-Project-Id）',
    health_scope_process: '进程级',
    health_scoped_project: '解析项目 ID',
    health_scoped_tenant: '解析租户 ID',
    health_project_path: '项目根路径',
    health_overall: '整体状态',
    health_ok: '正常',
    health_bad: '异常',
    health_uptime: '运行时长',
    health_deploy_mode: '部署模式',
    health_mode_saas: 'SaaS 多租户',
    health_mode_single: '单项目',
    health_check_sql: 'SQL 数据库',
    health_check_vector: '向量数据库',
    health_check_system: '系统资源',
    health_status_ok: '✓ 正常',
    health_status_bad: '✗ 异常',
  },
  en: {
    page_health: 'Health',
    health_title: 'System health',
    health_refresh: 'Refresh',
    health_loading: 'Loading...',
    health_fail: 'Health check failed',
    health_updated: 'Updated: {t}',
    health_metrics: 'Prometheus metrics: ',
    health_scope: 'Scope',
    health_scope_request: 'Request (incl. X-Project-Id)',
    health_scope_process: 'Process',
    health_scoped_project: 'Resolved project ID',
    health_scoped_tenant: 'Resolved tenant ID',
    health_project_path: 'Project root',
    health_overall: 'Overall',
    health_ok: 'OK',
    health_bad: 'Degraded',
    health_uptime: 'Uptime',
    health_deploy_mode: 'Deployment',
    health_mode_saas: 'SaaS multi-tenant',
    health_mode_single: 'Single project',
    health_check_sql: 'SQL database',
    health_check_vector: 'Vector database',
    health_check_system: 'System resources',
    health_status_ok: '✓ OK',
    health_status_bad: '✗ Error',
  },
});
const HealthPage = () => {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState(null);

  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);

  const load = () => {
    setLoading(true);
    apiFetch(`/health/detail`, { headers: authHeaders() })
      .then(r => r.json()).then(d => { setData(d); setLastRefresh(new Date().toLocaleTimeString()); })
      .catch(() => {}).finally(() => setLoading(false));
  };

  React.useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    const onProj = () => load();
    window.addEventListener('devdash-project-change', onProj);
    return () => {
      clearInterval(iv);
      window.removeEventListener('devdash-project-change', onProj);
    };
  }, []);

  if (loading && !data) return React.createElement('div', { style: { padding: 32, color: 'var(--text3)' } }, t('health_loading'));
  if (!data) return React.createElement('div', { style: { padding: 32, color: '#f87171' } }, t('health_fail'));

  const paths = data.paths || {};
  const scopeLabel = paths.scope === 'request' ? t('health_scope_request') : t('health_scope_process');
  const checks = data.checks || {};
  const statusColor = (ok) => ok ? '#22c55e' : '#ef4444';

  const scopeCards = [
    { label: t('health_scope'), value: scopeLabel },
    ...(paths.scopedProjectId ? [{ label: t('health_scoped_project'), value: paths.scopedProjectId }] : []),
    ...(paths.scopedTenantId ? [{ label: t('health_scoped_tenant'), value: paths.scopedTenantId }] : []),
    { label: t('health_project_path'), value: paths.projectPath || '—' },
  ];

  const checkTitle = (key) => ({ sql_db: t('health_check_sql'), vector_db: t('health_check_vector'), system: t('health_check_system') }[key] || key);

  return React.createElement('div', { style: { padding: '24px 32px' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
      React.createElement('h2', { style: { color: 'var(--text)', fontSize: 20 } }, t('health_title')),
      React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
        lastRefresh && React.createElement('span', { style: { fontSize: 12, color: 'var(--text3)' } }, t('health_updated', { t: lastRefresh })),
        React.createElement('button', { onClick: load, style: { padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, t('health_refresh'))
      )
    ),
    React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' } },
      [
        { label: t('health_overall'), value: data.ok ? t('health_ok') : t('health_bad'), color: statusColor(data.ok) },
        { label: t('health_uptime'), value: `${Math.floor((data.uptime_seconds || 0) / 3600)}h ${Math.floor(((data.uptime_seconds || 0) % 3600) / 60)}m` },
        { label: t('health_deploy_mode'), value: data.admin_mode === 'saas' ? t('health_mode_saas') : t('health_mode_single') },
      ].map(item => React.createElement('div', { key: item.label, style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 20px', minWidth: 140 } },
        React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, item.label),
        React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: item.color || 'var(--text)' } }, item.value)
      ))
    ),
    React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' } },
      scopeCards.map(item => React.createElement('div', { key: item.label, style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 20px', minWidth: 160, maxWidth: 420 } },
        React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, item.label),
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all', fontFamily: item.value && String(item.value).length > 40 ? 'monospace' : 'inherit' } }, item.value)
      ))
    ),
    React.createElement('div', { style: { display: 'grid', gap: 10 } },
      Object.entries(checks).map(([key, val]) => React.createElement('div', { key, style: { background: 'var(--bg2)', border: `1px solid ${val.ok === false ? 'rgba(239,68,68,.3)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 20px' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 14 } }, checkTitle(key)),
          val.ok !== undefined && React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: statusColor(val.ok) } }, val.ok ? t('health_status_ok') : t('health_status_bad'))
        ),
        React.createElement('div', { style: { display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' } },
          Object.entries(val).filter(([k]) => k !== 'ok').map(([k, v]) =>
            React.createElement('div', { key: k, style: { fontSize: 12 } },
              React.createElement('span', { style: { color: 'var(--text3)' } }, k + ': '),
              React.createElement('span', { style: { color: 'var(--text)', fontFamily: 'monospace' } },
                typeof v === 'number' && k.includes('percent') ? `${v.toFixed(1)}%` : String(v)
              )
            )
          )
        )
      ))
    ),
    React.createElement('div', { style: { marginTop: 16, fontSize: 12, color: 'var(--text3)' } },
      t('health_metrics'),
      React.createElement('a', { href: `${API}/metrics`, target: '_blank', style: { color: 'var(--link-inline)' } }, `${API}/metrics`)
    )
  );
};
