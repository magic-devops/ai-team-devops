function SystemManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const [tab, setTab] = React.useState('scripts');
  const tabs = [
    ['scripts', tr('sys_tab_scripts')],
    ['config', tr('sys_tab_config')],
    ['memory', tr('sys_tab_memory')],
    ['ops', tr('sys_tab_ops')],
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${tab === id ? 'btn-primary' : ''}`}
            style={tab !== id ? { background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg2)' } : {}}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'scripts' && <ScriptManager />}
      {tab === 'config' && <ConfigManager />}
      {tab === 'memory' && <MemoryManager />}
      {tab === 'ops' && <OpsPanel />}
    </div>
  );
}

function ScriptManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/system/scripts`);
  const [selected, setSelected] = React.useState(null);
  const [content, setContent] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [output, setOutput] = React.useState(null);

  const open = (f) => {
    setSelected(f);
    setEditing(false);
    setOutput(null);
    fetch(`${API}/system/scripts/${f.name}/content`)
      .then((r) => r.json())
      .then((d) => setContent(d.content || ''))
      .catch(() => showToast(tr('sys_script_read_fail'), 'err'));
  };
  const save = () => {
    fetch(`${API}/system/scripts/${selected.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        setEditing(false);
        showToast(tr('sys_script_save_ok'), 'ok');
      })
      .catch(() => showToast(tr('sys_script_save_fail'), 'err'));
  };
  const run = () => {
    if (!confirm(tr('sys_script_run_confirm', { name: selected.name }))) return;
    setRunning(true);
    setOutput(null);
    fetch(`${API}/system/scripts/${selected.name}/run`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        setOutput(d);
        setRunning(false);
        if (d && d.returncode !== 0) showToast(tr('sys_script_rc_nonzero'), 'err');
      })
      .catch(() => {
        setRunning(false);
        showToast(tr('sys_script_run_req_fail'), 'err');
      });
  };

  if (loading)
    return (
      <div>
        <PageSkeleton cards={2} />
      </div>
    );
  if (error) return <LoadError message={error} onRetry={reload} />;

  return (
    <div className="grid-2">
      <div className="card scroll-slim" style={{ maxHeight: 560, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            {tr('sys_script_list')}
          </div>
          <RefreshBtn onClick={reload} />
        </div>
        {(data || []).map((f) => (
          <div
            key={f.name}
            className={'list-item' + (selected && selected.name === f.name ? ' vibe-list-selected' : '')}
            style={{ cursor: 'pointer', padding: '6px 8px', borderRadius: 4 }}
            onClick={() => open(f)}
          >
            <div style={{ flex: 1 }}>
              <div className="title" style={{ fontSize: 12 }}>
                {f.name}
              </div>
              <div className="meta">
                {(f.size / 1024).toFixed(1)}KB{f.executable ? tr('sys_executable') : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {selected && (
          <div className="card" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{selected.name}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {selected.name.endsWith('.sh') && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={running}>
                    {running ? tr('sys_run_running') : tr('sys_run_btn')}
                  </button>
                )}
                {!editing && (
                  <button type="button" className="btn btn-sm btn-muted" onClick={() => setEditing(true)}>
                    {tr('gen_edit')}
                  </button>
                )}
                {editing && (
                  <>
                    <button type="button" className="btn btn-sm btn-cancel" onClick={() => setEditing(false)}>
                      {tr('gen_cancel')}
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={save}>
                      {tr('gen_save')}
                    </button>
                  </>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 300,
                  background: 'var(--surface-input)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  resize: 'vertical',
                }}
              />
            ) : (
              <pre style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>{content}</pre>
            )}
          </div>
        )}
        {output && (
          <div className="card">
            <div className="section-title" style={{ color: output.returncode === 0 ? 'var(--toast-ok)' : 'var(--toast-err)' }}>
              {output.returncode === 0 ? tr('sys_out_ok') : tr('sys_out_fail')} (exit {output.returncode})
            </div>
            {output.stdout && (
              <pre style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 150, overflowY: 'auto' }}>{output.stdout}</pre>
            )}
            {output.stderr && <pre style={{ fontSize: 11, color: 'var(--toast-err)', whiteSpace: 'pre-wrap' }}>{output.stderr}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/system/config`);
  if (loading) return <PageSkeleton cards={2} />;
  if (error) return <LoadError message={error} onRetry={reload} />;
  return (
    <div className="grid-2">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            {tr('sys_config_codex')}
          </div>
          <RefreshBtn onClick={reload} />
        </div>
        <pre className="scroll-slim" style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
          {(data && data.codex_config) || ''}
        </pre>
        <div className="section-title" style={{ marginTop: 10 }}>
          {tr('sys_codex_hooks')}
        </div>
        <pre className="scroll-slim" style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
          {JSON.stringify((data && data.codex_hooks) || {}, null, 2)}
        </pre>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            {tr('sys_config_claude')}
          </div>
        </div>
        <pre className="scroll-slim" style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' }}>
          {JSON.stringify((data && data.claude_settings) || {}, null, 2)}
        </pre>
      </div>
      <div className="card">
        <div className="section-title">{tr('sys_config_opencode')}</div>
        <pre className="scroll-slim" style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' }}>
          {JSON.stringify((data && data.opencode) || {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function MemoryManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/system/memory`);
  const [tableStats, setTableStats] = React.useState({});

  const loadStats = (tbl) => {
    fetch(`${API}/system/memory/lancedb/${tbl}/stats`)
      .then((r) => r.json())
      .then((d) => setTableStats((p) => ({ ...p, [tbl]: d })))
      .catch(() => showToast(tr('sys_stats_load_fail'), 'err'));
  };

  if (loading) return <PageSkeleton cards={2} />;
  if (error) return <LoadError message={error} onRetry={reload} />;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <RefreshBtn onClick={reload} />
      </div>
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="section-title">{tr('sys_mem_rules', { n: ((data && data.rules) || []).length })}</div>
          {((data && data.rules) || []).map((f) => (
            <div key={f} className="list-item">
              <div className="title" style={{ fontSize: 12 }}>
                {f}
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="section-title">{tr('sys_mem_snapshots', { n: ((data && data.snapshots) || []).length })}</div>
          {((data && data.snapshots) || []).map((f) => (
            <div key={f} className="list-item">
              <div className="title" style={{ fontSize: 12, flex: 1 }}>
                {f}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                style={{ padding: '2px 6px' }}
                onClick={() =>
                  fetch(`${API}/system/memory/snapshots/${f}`, { method: 'DELETE' })
                    .then((r) => {
                      if (!r.ok) throw new Error();
                    })
                    .then(() => {
                      reload();
                      showToast(tr('sys_snapshot_del_ok'), 'ok');
                    })
                    .catch(() => showToast(tr('vibe_toast_del_fail'), 'err'))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="section-title">{tr('sys_lancedb_tables')}</div>
        {((data && data.lancedb_tables) || []).map((tbl) => (
          <div key={tbl} className="list-item">
            <div style={{ flex: 1 }}>
              <div className="title" style={{ fontSize: 12 }}>
                {tbl}
              </div>
              {tableStats[tbl] && (
                <div className="meta">
                  {tr('sys_lancedb_meta', {
                    rows: tableStats[tbl].rows,
                    cols: (tableStats[tbl].columns && tableStats[tbl].columns.length) || 0,
                  })}
                </div>
              )}
            </div>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => loadStats(tbl)}>
              {tr('sys_view_stats')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpsPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data: health, loading: hLoad, error: hErr, reload: hReload } = useFetch(`${API}/health`);
  const { data: rel, loading: rLoad, reload: rRel } = useFetch(`${API}/system/release`);
  const { data: backups, loading: bLoad, error: bErr, reload: bRel } = useFetch(`${API}/system/backups`);
  const [proc, setProc] = React.useState(null);
  const [hints, setHints] = React.useState(null);
  const [relForm, setRelForm] = React.useState({ displayVersion: '', notes: '' });
  const [relSaving, setRelSaving] = React.useState(false);
  const [bkProfile, setBkProfile] = React.useState('admin_state');
  const [bkBusy, setBkBusy] = React.useState(false);

  React.useEffect(() => {
    if (rel && rel.displayVersion != null) {
      setRelForm({ displayVersion: rel.displayVersion || '', notes: rel.notes || '' });
    }
  }, [rel]);

  React.useEffect(() => {
    fetch(`${API}/system/ops/process`)
      .then((r) => r.json())
      .then(setProc)
      .catch(() => {});
    Promise.all([fetch(`${API}/system/ops/restart-hint`).then((r) => r.json()), fetch(`${API}/system/ops/upgrade-hint`).then((r) => r.json())])
      .then(([restart, upgrade]) => setHints({ restart, upgrade }))
      .catch(() => {});
  }, []);

  const saveRelease = () => {
    setRelSaving(true);
    fetch(`${API}/system/release`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_version: relForm.displayVersion.trim(), notes: relForm.notes }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(() => {
        setRelSaving(false);
        showToast(tr('sys_release_save_ok'), 'ok');
        rRel();
        hReload();
      })
      .catch(() => {
        setRelSaving(false);
        showToast(tr('sys_script_save_fail'), 'err');
      });
  };

  const createBackup = () => {
    if (!confirm(tr('sys_backup_create_confirm', { profile: bkProfile }))) return;
    setBkBusy(true);
    fetch(`${API}/system/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: bkProfile }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setBkBusy(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : tr('sys_backup_create_fail'), 'err');
          return;
        }
        showToast(tr('sys_backup_created', { file: d.file || '' }), 'ok');
        bRel();
      })
      .catch(() => {
        setBkBusy(false);
        showToast(tr('gen_req_fail'), 'err');
      });
  };

  const delBackup = (name) => {
    if (!confirm(tr('sys_backup_del_confirm', { name }))) return;
    fetch(`${API}/system/backups/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast(tr('auth_toast_deleted'), 'ok');
        bRel();
      })
      .catch(() => showToast(tr('vibe_toast_del_fail'), 'err'));
  };

  const downloadBackup = (name) => {
    window.open(`${API}/system/backups/download?name=${encodeURIComponent(name)}`, '_blank');
  };

  if (hLoad || rLoad) return <PageSkeleton cards={2} />;
  if (hErr) return <LoadError message={hErr} onRetry={hReload} />;

  return (
    <div>
      <div className="grid-2">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>
              {tr('sys_ops_health')}
            </div>
            <RefreshBtn
              onClick={() => {
                hReload();
                rRel();
              }}
            />
          </div>
          <pre style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{JSON.stringify(health || {}, null, 2)}</pre>
          {proc && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text2)' }}>
              <div>
                {tr('sys_pid')} {proc.pid}
              </div>
              <div style={{ wordBreak: 'break-all' }}>{proc.executable}</div>
              <div style={{ wordBreak: 'break-all' }}>{proc.projectPath}</div>
            </div>
          )}
        </div>
        <div className="card">
          <div className="section-title" style={{ marginBottom: 8 }}>
            {tr('sys_ops_release_title')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>{tr('sys_ops_release_hint')}</div>
          <div className="form-group">
            <label>displayVersion</label>
            <input
              value={relForm.displayVersion}
              onChange={(e) => setRelForm((p) => ({ ...p, displayVersion: e.target.value }))}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
          <div className="form-group">
            <label>notes</label>
            <textarea value={relForm.notes} onChange={(e) => setRelForm((p) => ({ ...p, notes: e.target.value }))} style={{ minHeight: 64, fontSize: 12 }} />
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={relSaving} onClick={saveRelease}>
            {relSaving ? tr('gen_saving') : tr('sys_release_save_btn')}
          </button>
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            {tr('sys_backup_title')}
          </div>
          <RefreshBtn onClick={bRel} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.55 }}>
          {tr('sys_backup_p1')}
          <strong>{tr('sys_backup_p1b')}</strong>
          {tr('sys_backup_p2')}
          <code>init-ai-project.sh reinit</code>
          {tr('sys_backup_p3')}
          <code>.ai-reinit-backups/</code>
          {tr('sys_backup_p4')}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          <select value={bkProfile} onChange={(e) => setBkProfile(e.target.value)} style={{ fontSize: 12 }}>
            <option value="admin_state">{tr('sys_backup_opt_admin')}</option>
            <option value="sop_web">{tr('sys_backup_opt_sop')}</option>
          </select>
          <button type="button" className="btn btn-sm btn-primary" disabled={bkBusy} onClick={createBackup}>
            {bkBusy ? tr('sys_backup_packaging') : tr('sys_backup_create_btn')}
          </button>
        </div>
        {bErr ? <LoadError message={bErr} onRetry={bRel} /> : null}
        {bLoad ? <div className="meta">{tr('gen_loading')}</div> : null}
        {!bLoad && !bErr && (
          <div>
            {((backups && backups.items) || []).length === 0 ? (
              <div className="empty">{tr('sys_backup_empty')}</div>
            ) : (
              ((backups && backups.items) || []).map((it) => (
                <div key={it.name} className="list-item">
                  <div style={{ flex: 1 }}>
                    <div className="title" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {it.name}
                    </div>
                    <div className="meta">
                      {(it.size / 1024).toFixed(1)} KB · {it.updatedAt}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-muted" onClick={() => downloadBackup(it.name)}>
                    {tr('gen_download')}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => delBackup(it.name)}>
                    {tr('gen_delete')}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>
          {tr('sys_upgrade_title')}
        </div>
        {hints && hints.upgrade && (
          <div style={{ marginBottom: 12 }}>
            <div className="meta" style={{ color: 'var(--text2)', marginBottom: 6 }}>
              {hints.upgrade.notes}
            </div>
            <ol style={{ fontSize: 12, color: 'var(--text)', paddingLeft: 18 }}>
              {(hints.upgrade.steps || []).map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        )}
        {hints && hints.restart && (
          <div style={{ fontSize: 12, color: '#fdba74' }}>
            <strong>{tr('sys_restart_word')}</strong>: {hints.restart.hint} ({tr('sys_pid')} {hints.restart.pid})
          </div>
        )}
      </div>
    </div>
  );
}
