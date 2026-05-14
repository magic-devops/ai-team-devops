window.i18nExtend && window.i18nExtend({
  zh:{page_logs_viewer:'日志查看',logs_file:'日志文件',logs_lines:'显示行数',logs_refresh:'刷新',logs_loading:'加载中...',logs_empty:'暂无日志',logs_auto:'自动刷新'},
  en:{page_logs_viewer:'Log Viewer',logs_file:'Log File',logs_lines:'Lines',logs_refresh:'Refresh',logs_loading:'Loading...',logs_empty:'No logs',logs_auto:'Auto refresh'},
});

const LogsViewer = () => {
  const tr = k => typeof window.t === 'function' ? window.t(k) : k;
  const [files, setFiles] = React.useState([]);
  const [selected, setSelected] = React.useState('sop.app');
  const [lines, setLines] = React.useState(200);
  const [content, setContent] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [auto, setAuto] = React.useState(false);
  const bottomRef = React.useRef(null);

  const loadFiles = () =>
    apiFetch(`/logs/list`, { headers: authHeaders() })
      .then(r => r.json()).then(d => setFiles(d.files || [])).catch(() => {});

  const loadLogs = () => {
    setLoading(true);
    apiFetch(`/logs?name=${encodeURIComponent(selected)}&lines=${lines}`, { headers: authHeaders() })
      .then(r => r.text()).then(t => { setContent(t); setLoading(false); })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { loadFiles(); }, []);
  React.useEffect(() => { loadLogs(); }, [selected, lines]);
  React.useEffect(() => {
    if (!auto) return;
    const t = setInterval(loadLogs, 5000);
    return () => clearInterval(t);
  }, [auto, selected, lines]);
  React.useEffect(() => { bottomRef.current?.scrollIntoView(); }, [content]);

  const logNames = [...new Set(['sop.app','sop.audit','sop.access', ...files.map(f => f.name.replace(/\.log.*$/, ''))])];

  return React.createElement('div', { style: { padding: '20px 28px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' } },
    React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' } },
      React.createElement('h2', { style: { color: 'var(--text)', fontSize: 18, margin: 0 } }, tr('page_logs_viewer')),
      React.createElement('select', {
        value: selected, onChange: e => setSelected(e.target.value),
        style: { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13 }
      }, logNames.map(n => React.createElement('option', { key: n, value: n }, n))),
      React.createElement('select', {
        value: lines, onChange: e => setLines(+e.target.value),
        style: { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13, width: 90 }
      }, [100,200,500,1000,2000].map(n => React.createElement('option', { key: n, value: n }, n + ' ' + tr('logs_lines')))),
      React.createElement('button', { onClick: loadLogs, style: { padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)', cursor: 'pointer', fontSize: 13 } }, tr('logs_refresh')),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' } },
        React.createElement('input', { type: 'checkbox', checked: auto, onChange: e => setAuto(e.target.checked) }),
        tr('logs_auto')
      ),
      loading && React.createElement('span', { style: { fontSize: 12, color: 'var(--text3)' } }, tr('logs_loading'))
    ),
    React.createElement('div', {
      style: { flex: 1, overflow: 'auto', background: 'var(--surface-code)', borderRadius: 8, border: '1px solid var(--border)', padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
    },
      content
        ? content.split('\n').map((line, i) => {
            const color = line.includes('ERROR') ? '#f87171' : line.includes('WARNING') ? '#fbbf24' : line.includes('INFO') ? 'var(--text)' : 'var(--text3)';
            return React.createElement('div', { key: i, style: { color } }, line);
          })
        : React.createElement('div', { style: { color: 'var(--text3)', padding: 20, textAlign: 'center' } }, tr('logs_empty')),
      React.createElement('div', { ref: bottomRef })
    )
  );
};
