// 数据库配置管理页面 — SQL + 向量数据库可视化配置
window.i18nExtend && window.i18nExtend({
  zh: { page_db_config: '数据库配置', db_sql_title: 'SQL 数据库（管理数据）', db_vector_title: '向量数据库（知识库）', db_test_conn: '测试连接', db_testing: '测试中...', db_table_stats: '向量表统计', db_env_hint: '修改请更新环境变量后重启服务' },
  en: { page_db_config: 'DB Config', db_sql_title: 'SQL Database', db_vector_title: 'Vector Database', db_test_conn: 'Test Connection', db_testing: 'Testing...', db_table_stats: 'Vector Table Stats', db_env_hint: 'Update env vars and restart to change' },
});
const DbConfigPage = () => {
  const t = window.__T__;
  const [cfg, setCfg] = React.useState(null);
  const [tables, setTables] = React.useState([]);
  const [testing, setTesting] = React.useState({});
  const [msg, setMsg] = React.useState(null);

  React.useEffect(() => {
    fetch('/api/db-config', { headers: authHeaders() })
      .then(r => r.json()).then(setCfg).catch(() => {});
    fetch('/api/db-config/vector/tables', { headers: authHeaders() })
      .then(r => r.json()).then(d => setTables(d.tables || [])).catch(() => {});
  }, []);

  const testConn = async (type, body) => {
    setTesting(p => ({ ...p, [type]: true }));
    setMsg(null);
    try {
      const r = await fetch(`/api/db-config/${type}/test`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      setMsg({ ok: d.ok, text: d.message || d.detail });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
    setTesting(p => ({ ...p, [type]: false }));
  };

  if (!cfg) return React.createElement('div', { style: { padding: 32, color: 'var(--text2)' } }, '加载中...');

  return React.createElement('div', { style: { padding: '24px 32px', maxWidth: 900 } },
    React.createElement('h2', { style: { color: 'var(--text)', marginBottom: 24, fontSize: 20 } }, '数据库配置'),

    msg && React.createElement('div', {
      style: {
        padding: '10px 16px', borderRadius: 8, marginBottom: 16,
        background: msg.ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)',
        color: msg.ok ? '#4ade80' : '#f87171', fontSize: 13
      }
    }, msg.text),

    // SQL 数据库
    React.createElement('div', { style: cardStyle() },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
        React.createElement('h3', { style: sectionTitle() }, 'SQL 数据库（管理数据）'),
        React.createElement('span', { style: badgeStyle(cfg.sql.type === 'mysql' ? 'blue' : 'gray') }, cfg.sql.type.toUpperCase())
      ),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
        infoRow('类型', cfg.sql.type),
        infoRow('连接', cfg.sql.url_masked),
        infoRow('模式', cfg.admin_mode === 'saas' ? '多租户 SaaS' : '单项目'),
      ),
      React.createElement('div', { style: { marginTop: 12, fontSize: 12, color: 'var(--text3)' } },
        '修改数据库连接请更新环境变量 DB_TYPE / DATABASE_URL 后重启服务'
      )
    ),

    // 向量数据库
    React.createElement('div', { style: { ...cardStyle(), marginTop: 16 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
        React.createElement('h3', { style: sectionTitle() }, '向量数据库（知识库）'),
        React.createElement('span', { style: badgeStyle(cfg.vector.type === 'milvus' ? 'purple' : 'green') }, cfg.vector.type.toUpperCase())
      ),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
        cfg.vector.type === 'milvus'
          ? infoRow('Milvus URI', cfg.vector.milvus_uri)
          : infoRow('LanceDB 路径', cfg.vector.lance_path),
      ),
      React.createElement('div', { style: { marginTop: 12, display: 'flex', gap: 8 } },
        React.createElement('button', {
          style: btnStyle('accent'),
          disabled: testing.vector,
          onClick: () => testConn('vector', {
            type: cfg.vector.type,
            uri: cfg.vector.milvus_uri,
            path: cfg.vector.lance_path
          })
        }, testing.vector ? '测试中...' : '测试连接'),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', alignSelf: 'center' } },
          '修改请更新环境变量 VECTOR_DB_TYPE / MILVUS_URI / LANCE_DB_PATH'
        )
      )
    ),

    // 向量表统计
    tables.length > 0 && React.createElement('div', { style: { ...cardStyle(), marginTop: 16 } },
      React.createElement('h3', { style: { ...sectionTitle(), marginBottom: 12 } }, '向量表统计'),
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            ['表名', '行数', '字段数'].map(h =>
              React.createElement('th', { key: h, style: thStyle() }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          tables.map(t =>
            React.createElement('tr', { key: t.table },
              React.createElement('td', { style: tdStyle() }, t.table),
              React.createElement('td', { style: tdStyle() }, t.rows),
              React.createElement('td', { style: tdStyle() }, (t.columns || []).length),
            )
          )
        )
      )
    )
  );
};

function cardStyle() {
  return { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '20px 24px' };
}
function sectionTitle() {
  return { color: 'var(--text)', fontSize: 15, fontWeight: 600, margin: 0 };
}
function infoRow(label, value) {
  return React.createElement('div', { key: label, style: { fontSize: 13 } },
    React.createElement('span', { style: { color: 'var(--text3)', marginRight: 6 } }, label + ':'),
    React.createElement('span', { style: { color: 'var(--text)', fontFamily: 'monospace', wordBreak: 'break-all' } }, value || '—')
  );
}
function badgeStyle(color) {
  const colors = { blue: '#3b82f6', gray: '#64748b', purple: '#a855f7', green: '#22c55e' };
  return {
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    background: (colors[color] || '#64748b') + '22', color: colors[color] || '#64748b',
    border: `1px solid ${(colors[color] || '#64748b')}44`
  };
}
function btnStyle(variant) {
  return {
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
    background: variant === 'accent' ? 'var(--accent)' : 'var(--btn-muted-bg)',
    color: variant === 'accent' ? '#fff' : 'var(--btn-muted-fg)'
  };
}
function thStyle() {
  return { textAlign: 'left', padding: '6px 12px', color: 'var(--text3)', fontSize: 12, borderBottom: '1px solid var(--border)' };
}
function tdStyle() {
  return { padding: '8px 12px', color: 'var(--text)', borderBottom: '1px solid var(--border-subtle)' };
}
