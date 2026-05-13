// 系统健康监控页面
window.i18nExtend && window.i18nExtend({
  zh: { page_health: '健康监控', health_refresh: '刷新', health_loading: '加载中...', health_fail: '健康检查失败', health_updated: '更新: {t}', health_metrics: 'Prometheus 指标端点: ' },
  en: { page_health: 'Health Monitor', health_refresh: 'Refresh', health_loading: 'Loading...', health_fail: 'Health check failed', health_updated: 'Updated: {t}', health_metrics: 'Prometheus metrics: ' },
});
const HealthPage = () => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState(null);

  const load = () => {
    setLoading(true);
    fetch(`${API}/health/detail`, { headers: authHeaders() })
      .then(r => r.json()).then(d => { setData(d); setLastRefresh(new Date().toLocaleTimeString()); })
      .catch(() => {}).finally(() => setLoading(false));
  };

  React.useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  if (loading && !data) return React.createElement('div', { style: { padding: 32, color: 'var(--text3)' } }, '加载中...');
  if (!data) return React.createElement('div', { style: { padding: 32, color: '#f87171' } }, '健康检查失败');

  const checks = data.checks || {};
  const statusColor = (ok) => ok ? '#22c55e' : '#ef4444';

  return React.createElement('div', { style: { padding: '24px 32px' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 } },
      React.createElement('h2', { style: { color: 'var(--text)', fontSize: 20 } }, '系统健康监控'),
      React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
        lastRefresh && React.createElement('span', { style: { fontSize: 12, color: 'var(--text3)' } }, `更新: ${lastRefresh}`),
        React.createElement('button', { onClick: load, style: { padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 12 } }, '刷新')
      )
    ),
    // 总体状态
    React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' } },
      [
        { label: '整体状态', value: data.ok ? '正常' : '异常', color: statusColor(data.ok) },
        { label: '运行时长', value: `${Math.floor((data.uptime_seconds || 0) / 3600)}h ${Math.floor(((data.uptime_seconds || 0) % 3600) / 60)}m` },
        { label: '部署模式', value: data.admin_mode === 'saas' ? 'SaaS 多租户' : '单项目' },
      ].map(item => React.createElement('div', { key: item.label, style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 20px', minWidth: 140 } },
        React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginBottom: 4 } }, item.label),
        React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: item.color || 'var(--text)' } }, item.value)
      ))
    ),
    // 各项检查
    React.createElement('div', { style: { display: 'grid', gap: 10 } },
      Object.entries(checks).map(([key, val]) => React.createElement('div', { key, style: { background: 'var(--bg2)', border: `1px solid ${val.ok === false ? 'rgba(239,68,68,.3)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 20px' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 14 } }, { sql_db: 'SQL 数据库', vector_db: '向量数据库', system: '系统资源' }[key] || key),
          val.ok !== undefined && React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: statusColor(val.ok) } }, val.ok ? '✓ 正常' : '✗ 异常')
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
    // Prometheus 链接
    React.createElement('div', { style: { marginTop: 16, fontSize: 12, color: 'var(--text3)' } },
      'Prometheus 指标端点: ',
      React.createElement('a', { href: `${API}/metrics`, target: '_blank', style: { color: 'var(--link-inline)' } }, `${API}/metrics`)
    )
  );
};
