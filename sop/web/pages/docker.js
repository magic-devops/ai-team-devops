function dockerTr(k, v) {
  return typeof window.t === 'function' ? window.t(k, v) : k;
}

function DockerEnvManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const [tab, setTab] = React.useState('check');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ['check', dockerTr('docker_tab_check')],
          ['containers', dockerTr('docker_tab_containers')],
          ['images', dockerTr('docker_tab_images')],
          ['presets', dockerTr('docker_tab_presets')],
          ['run', dockerTr('docker_tab_run')],
          ['build', dockerTr('docker_tab_build')],
          ['compose', dockerTr('docker_tab_compose')],
          ['managed', dockerTr('docker_tab_managed')],
        ].map(([id, l]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${tab === id ? 'btn-primary' : ''}`}
            style={tab !== id ? { background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg2)' } : {}}
            onClick={() => setTab(id)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'check' && <EnvCheckPanel />}
      {tab === 'containers' && <ContainersPanel />}
      {tab === 'images' && <ImagesPanel />}
      {tab === 'presets' && <PresetsPanel />}
      {tab === 'run' && <DockerRunPanel />}
      {tab === 'build' && <BuildPanel />}
      {tab === 'compose' && <ComposePanel />}
      {tab === 'managed' && <ManagedDockerfilePanel />}
    </div>
  );
}

function EnvCheckPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const [full, setFull] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiMd, setAiMd] = React.useState('');
  const [remBusy, setRemBusy] = React.useState(null);
  const [pinJson, setPinJson] = React.useState('');
  const [allowBin, setAllowBin] = React.useState('');
  const [formCustom, setFormCustom] = React.useState({
    name: '',
    kind: 'command',
    argvText: '["which", "git"]',
    path: '',
    min_semver: '',
    timeout_sec: 15,
  });

  const run = () => {
    setLoading(true);
    fetch(`${API}/env/check/full`)
      .then((r) => r.json())
      .then((d) => {
        setFull(d);
        setLoading(false);
        if (d.pins) setPinJson(JSON.stringify(d.pins, null, 2));
      })
      .catch(() => {
        setLoading(false);
        showToast(dockerTr('docker_check_fail'), 'err');
      });
  };

  React.useEffect(() => {
    run();
  }, []);

  const runAiPlan = () => {
    setAiBusy(true);
    fetch(`${API}/env/ai-plan`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({snapshot: full || undefined, extra_context: ''}),
    })
      .then((r) => r.json().then((d) => ({ok: r.ok, d})))
      .then(({ok, d}) => {
        setAiBusy(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('docker_ai_fail'), 'err');
          return;
        }
        setAiMd(d.markdown || '');
        setAiOpen(true);
      })
      .catch(() => {
        setAiBusy(false);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const remediate = (action) => {
    if (!confirm(action === 'install_integrations' ? dockerTr('docker_confirm_install') : dockerTr('docker_confirm_health'))) return;
    setRemBusy(action);
    fetch(`${API}/env/remediate-run`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action}),
    })
      .then((r) => r.json().then((d) => ({httpOk: r.ok, d})))
      .then(({httpOk, d}) => {
        setRemBusy(null);
        if (!httpOk) {
          const msg = typeof d.detail === 'string' ? d.detail : (Array.isArray(d.detail) ? d.detail.map((x) => x.msg || '').join(';') : dockerTr('docker_http_err'));
          showToast(msg, 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || dockerTr('docker_cmd_nonzero')).slice(0, 240), 'err');
          run();
          return;
        }
        showToast(dockerTr('docker_cmd_ok'), 'ok');
        run();
      })
      .catch(() => {
        setRemBusy(null);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const savePins = () => {
    let j;
    try {
      j = JSON.parse(pinJson || '{}');
    } catch (e) {
      showToast(dockerTr('docker_pins_json_err'), 'err');
      return;
    }
    fetch(`${API}/env/version-pins`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        runtime: j.runtime,
        tools: j.tools,
        notes: j.notes,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast(dockerTr('docker_pins_saved'), 'ok');
        run();
      })
      .catch(() => showToast(dockerTr('sys_script_save_fail'), 'err'));
  };

  const addCustomCheck = () => {
    let argv = null;
    if (formCustom.kind !== 'file_exists') {
      try {
        argv = JSON.parse(formCustom.argvText || '[]');
      } catch (e) {
        showToast(dockerTr('docker_argv_json'), 'err');
        return;
      }
      if (!Array.isArray(argv)) {
        showToast(dockerTr('docker_argv_array'), 'err');
        return;
      }
    }
    const body = {
      name: formCustom.name.trim(),
      kind: formCustom.kind,
      timeout_sec: Number(formCustom.timeout_sec) || 15,
    };
    if (formCustom.kind === 'file_exists') body.path = formCustom.path.trim();
    else body.argv = argv;
    if (formCustom.kind === 'version_command') body.min_semver = formCustom.min_semver.trim() || undefined;
    fetch(`${API}/env/custom-checks`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => ({ok: r.ok, d})))
      .then(({ok, d}) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('docker_custom_add_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_custom_added'), 'ok');
        setFormCustom({name: '', kind: 'command', argvText: '["which", "git"]', path: '', min_semver: '', timeout_sec: 15});
        run();
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const delCustom = (id) => {
    if (!confirm(dockerTr('docker_custom_del_confirm', { id }))) return;
    fetch(`${API}/env/custom-checks/${encodeURIComponent(id)}`, {method: 'DELETE'})
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast(dockerTr('auth_toast_deleted'), 'ok');
        run();
      })
      .catch(() => showToast(dockerTr('vibe_toast_del_fail'), 'err'));
  };

  const appendAllow = () => {
    const b = allowBin.trim();
    if (!b) return;
    fetch(`${API}/env/exec-allowlist/append`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({binary: b}),
    })
      .then((r) => r.json().then((d) => ({ok: r.ok, d})))
      .then(({ok, d}) => {
        if (!ok) {
          showToast(d.detail || dockerTr('docker_allow_append_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_allow_append_ok'), 'ok');
        setAllowBin('');
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const [installState, setInstallState] = React.useState({});
  const [collapsedGroups, setCollapsedGroups] = React.useState({});
  const [installModal, setInstallModal] = React.useState(null); // {tool, logs, done, rc, ws}
  const installInputRef = React.useRef(null);
  const installLogsRef = React.useRef(null);

  const bi = (full && full.builtin) || {};
  const groups = full
    ? [
        [dockerTr('docker_grp_dev'), 'dev', ['claude', 'opencode', 'git', 'gh', 'make', 'jq', 'curl', 'rg']],
        [dockerTr('docker_grp_rt'), 'rt', ['python3', 'java', 'mvn', 'gradle', 'node', 'npm', 'pnpm', 'go', 'uv', 'bun', 'deno', 'kubectl']],
        [dockerTr('docker_grp_py'), 'py', Object.keys(bi).filter((k) => k.startsWith('py:'))],
        [dockerTr('docker_grp_docker'), 'docker', ['docker', 'docker-compose']],
      ]
    : [];

  const toggleGroup = (id) => setCollapsedGroups((p) => ({ ...p, [id]: !p[id] }));

  const aiInstall = (tool) => {
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsBase = API.replace(/^https?/, wsProto);
    const ws = new WebSocket(`${wsBase}/env/tool/install/ws?tool=${encodeURIComponent(tool)}`);
    setInstallModal({ tool, logs: [], done: false, rc: null, ws });
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      setInstallModal((prev) => {
        if (!prev) return prev;
        const logs = [...prev.logs];
        if (msg.type === 'cmd') logs.push({ type: 'info', text: dockerTr('docker_install_cmd') + ' ' + msg.cmd });
        else if (msg.type === 'stdout') logs.push({ type: 'out', text: msg.data });
        else if (msg.type === 'error') logs.push({ type: 'err', text: msg.message });
        else if (msg.type === 'exit') {
          logs.push({ type: msg.code === 0 ? 'ok' : 'err', text: `exit ${msg.code}` });
          if (msg.code === 0) { showToast(dockerTr('docker_install_ok', { tool }), 'ok'); run(); }
          return { ...prev, logs, done: true, rc: msg.code };
        }
        return { ...prev, logs };
      });
      setTimeout(() => { if (installLogsRef.current) installLogsRef.current.scrollTop = installLogsRef.current.scrollHeight; }, 30);
    };
    ws.onerror = () => setInstallModal((p) => p ? { ...p, logs: [...p.logs, { type: 'err', text: 'WebSocket error' }], done: true } : p);
    ws.onclose = () => setInstallModal((p) => p && !p.done ? { ...p, done: true } : p);
  };

  const sendInstallInput = (text) => {
    if (!text.trim() || !installModal || !installModal.ws || installModal.ws.readyState !== 1) return;
    installModal.ws.send(JSON.stringify({ stdin: text }));
    setInstallModal((p) => p ? { ...p, logs: [...p.logs, { type: 'in', text: '> ' + text }] } : p);
    setTimeout(() => { if (installLogsRef.current) installLogsRef.current.scrollTop = installLogsRef.current.scrollHeight; }, 30);
  };

  const closeInstallModal = () => {
    if (installModal && installModal.ws) try { installModal.ws.close(); } catch (_) {}
    setInstallModal(null);
  };

  return (
    <div>
      {installModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, width: '90%', maxWidth: 640, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{dockerTr('docker_ai_install')} · {installModal.tool}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {!installModal.done && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{dockerTr('docker_installing')}</span>}
                {installModal.done && <span style={{ fontSize: 11, color: installModal.rc === 0 ? '#86efac' : '#fca5a5' }}>exit {installModal.rc}</span>}
                <button type="button" className="btn btn-sm btn-muted" onClick={closeInstallModal}>×</button>
              </div>
            </div>
            <pre ref={installLogsRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#0f172a', color: '#e2e8f0', margin: 0, minHeight: 200 }}>
              {installModal.logs.map((l, i) => (
                <span key={i} style={{ color: l.type === 'err' ? '#fca5a5' : l.type === 'ok' ? '#86efac' : l.type === 'info' ? '#93c5fd' : l.type === 'in' ? '#fde68a' : '#e2e8f0' }}>{l.text}</span>
              ))}
              {!installModal.done && '▌'}
            </pre>
            {!installModal.done && (
              <div style={{ display: 'flex', gap: 6, padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
                <input
                  ref={installInputRef}
                  placeholder={dockerTr('docker_install_input_ph')}
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, background: 'var(--surface-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px' }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { sendInstallInput(e.target.value); e.target.value = ''; } }}
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={() => { sendInstallInput(installInputRef.current.value); installInputRef.current.value = ''; }}>
                  {dockerTr('vibe_run')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="section-title">{dockerTr('docker_check_title')}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{dockerTr('docker_check_sub')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
            {loading ? dockerTr('docker_checking') : dockerTr('docker_recheck')}
          </button>
          <button type="button" className="btn btn-sm btn-muted" style={{ background: '#4f46e5', color: '#fff' }} onClick={runAiPlan} disabled={aiBusy || loading}>
            {aiBusy ? dockerTr('docker_ai_busy') : dockerTr('docker_ai_plan')}
          </button>
          <button type="button" className="btn btn-sm btn-muted" disabled={!!remBusy} onClick={() => remediate('install_integrations')}>
            {remBusy === 'install_integrations' ? dockerTr('docker_rem_busy') : dockerTr('docker_rem_install')}
          </button>
          <button type="button" className="btn btn-sm btn-muted" disabled={!!remBusy} onClick={() => remediate('health_check')}>
            {remBusy === 'health_check' ? dockerTr('docker_rem_busy') : dockerTr('docker_rem_health')}
          </button>
        </div>
      </div>

      {full && (full.pin_warnings || []).length > 0 && (
        <div className="card" style={{ marginBottom: 10, borderColor: '#f59e0b' }}>
          <div className="section-title" style={{ color: '#fdba74' }}>
            {dockerTr('docker_pin_warn_title')}
          </div>
          {(full.pin_warnings || []).map((w, i) => (
            <div key={i} className="meta" style={{ color: '#fed7aa' }}>
              {w}
            </div>
          ))}
        </div>
      )}

      {full &&
        groups.map(([g, gid, keys]) => {
          const collapsed = collapsedGroups[gid];
          const visibleKeys = keys.filter((k) => bi[k]);
          const missingCount = visibleKeys.filter((k) => !bi[k]?.available).length;
          return (
            <div key={gid} className="card" style={{ marginBottom: 10 }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleGroup(gid)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{collapsed ? '▶' : '▼'}</span>
                  <div className="section-title" style={{ margin: 0 }}>{g}</div>
                  {missingCount > 0 && (
                    <span className="tag tag-p0" style={{ fontSize: 10 }}>{missingCount} {dockerTr('docker_missing_count')}</span>
                  )}
                </div>
              </div>
              {!collapsed && visibleKeys.map((k) => {
                const info = bi[k];
                return (
                  <div key={k} className="list-item">
                    <div style={{ flex: 1 }}>
                      <div className="title">{k.replace('py:', '')}</div>
                      <div className="meta">{info.version || '-'}</div>
                    </div>
                    <span className={`tag ${info.available ? 'tag-done' : 'tag-p0'}`}>
                      {info.available ? dockerTr('docker_avail') : dockerTr('docker_missing')}
                    </span>
                    {!info.available && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: '#4f46e5', color: '#fff', marginLeft: 4 }}
                        onClick={(e) => { e.stopPropagation(); aiInstall(k); }}
                      >
                        {dockerTr('docker_ai_install')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

      {full && (full.custom_catalog || []).length > 0 && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="section-title">{dockerTr('docker_custom_list')}</div>
          {(full.custom_catalog || []).map((c) => {
            const key = `custom:${c.id}`;
            const r = (full.custom || {})[key] || {};
            return (
              <div key={c.id} className="list-item">
                <div style={{flex: 1}}>
                  <div className="title">{c.name}</div>
                  <div className="meta">
                    {c.kind} · {c.id}
                  </div>
                  <div className="meta" style={{fontSize: 11}}>
                    {r.version || '-'}
                  </div>
                </div>
                <span className={`tag ${r.available ? 'tag-done' : 'tag-p0'}`}>{r.available ? '✅' : '❌'}</span>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => delCustom(c.id)}>
                  {dockerTr('gen_delete')}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{ marginBottom: 10 }}>
        <div className="section-title">{dockerTr('docker_custom_add_title')}</div>
        <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{dockerTr('docker_custom_add_hint')}</p>
        <div className="form-group">
          <label>{dockerTr('docker_label_name')}</label>
          <input value={formCustom.name} onChange={(e) => setFormCustom({ ...formCustom, name: e.target.value })} placeholder={dockerTr('docker_ph_nexus')} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-group">
            <label>{dockerTr('docker_label_kind')}</label>
            <select value={formCustom.kind} onChange={(e) => setFormCustom({ ...formCustom, kind: e.target.value })}>
              <option value="command">{dockerTr('docker_opt_command')}</option>
              <option value="file_exists">{dockerTr('docker_opt_file')}</option>
              <option value="version_command">{dockerTr('docker_opt_vercmd')}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{dockerTr('docker_label_timeout')}</label>
            <input type="number" value={formCustom.timeout_sec} onChange={(e) => setFormCustom({ ...formCustom, timeout_sec: e.target.value })} />
          </div>
        </div>
        {formCustom.kind === 'file_exists' ? (
          <div className="form-group">
            <label>{dockerTr('docker_label_path')}</label>
            <input value={formCustom.path} onChange={(e) => setFormCustom({ ...formCustom, path: e.target.value })} placeholder={dockerTr('docker_ph_path')} />
          </div>
        ) : (
          <div className="form-group">
            <label>{dockerTr('docker_label_argv')}</label>
            <textarea value={formCustom.argvText} onChange={(e) => setFormCustom({ ...formCustom, argvText: e.target.value })} style={{ minHeight: 56, fontFamily: 'monospace', fontSize: 12 }} />
          </div>
        )}
        {formCustom.kind === 'version_command' && (
          <div className="form-group">
            <label>{dockerTr('docker_label_minver')}</label>
            <input value={formCustom.min_semver} onChange={(e) => setFormCustom({ ...formCustom, min_semver: e.target.value })} placeholder={dockerTr('docker_ph_minver')} />
          </div>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={addCustomCheck}>
          {dockerTr('docker_btn_add')}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <div className="section-title">{dockerTr('docker_pins_title')}</div>
        <textarea value={pinJson} onChange={(e) => setPinJson(e.target.value)} style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 12, width: '100%' }} />
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={savePins}>
          {dockerTr('docker_pins_save')}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <div className="section-title">{dockerTr('docker_allow_title')}</div>
        <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{dockerTr('docker_allow_hint')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={allowBin} onChange={(e) => setAllowBin(e.target.value)} placeholder={dockerTr('docker_allow_ph')} style={{ flex: 1, minWidth: 120 }} />
          <button type="button" className="btn btn-sm btn-muted" onClick={appendAllow}>
            {dockerTr('docker_allow_append')}
          </button>
        </div>
      </div>

      {aiOpen && (
        <div className="modal-bg" onClick={() => setAiOpen(false)}>
          <div
            className="modal"
            style={{ width: Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 24 : 720), maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{dockerTr('docker_ai_modal_title')}</h3>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{dockerTr('docker_ai_modal_p')}</p>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, color: 'var(--text)', maxHeight: '60vh', overflow: 'auto' }}>{aiMd}</pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setAiOpen(false)}>
                {dockerTr('gen_close')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  navigator.clipboard
                    .writeText(aiMd)
                    .then(() => showToast(dockerTr('vibe_toast_copy_ok'), 'ok'))
                    .catch(() => showToast(dockerTr('vibe_toast_copy_fail'), 'err'));
                }}
              >
                {dockerTr('docker_copy_all')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function dockerApiToWsUrl(pathSuffix) {
  try {
    const b = String(typeof API !== 'undefined' ? API : '').replace(/\/$/, '');
    return b.replace(/^http/i, 'ws').replace(/^https/i, 'wss') + pathSuffix;
  } catch (e) {
    return '';
  }
}

function DockerInteractiveExec({ container, shell, onClose }) {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const outRef = React.useRef(null);
  const [buf, setBuf] = React.useState('');
  const [inp, setInp] = React.useState('');
  const [hint, setHint] = React.useState({ kind: 'connecting' });
  const wsRef = React.useRef(null);

  const hintText = (h) => {
    if (!h || h.kind === 'connecting') return dockerTr('docker_ws_connecting');
    if (h.kind === 'no_url') return dockerTr('docker_ws_no_url');
    if (h.kind === 'ready') return dockerTr('docker_ws_ready', { argv: JSON.stringify(h.argv != null ? h.argv : []) });
    if (h.kind === 'error') return dockerTr('docker_ws_err_msg', { msg: h.message || '' });
    if (h.kind === 'exit') return dockerTr('docker_ws_exit', { code: String(h.code) });
    if (h.kind === 'ws_err') return dockerTr('docker_ws_socket_err');
    return '';
  };

  React.useEffect(() => {
    const u = dockerApiToWsUrl('/env/docker/ws-exec/' + encodeURIComponent(container));
    if (!u || u.indexOf('ws') !== 0) {
      setHint({ kind: 'no_url' });
      return undefined;
    }
    setHint({ kind: 'connecting' });
    const ws = new WebSocket(u);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ argv: [shell] }));
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'ready') setHint({ kind: 'ready', argv: m.argv });
        else if (m.type === 'stdout') setBuf((p) => p + (m.data || ''));
        else if (m.type === 'error') setHint({ kind: 'error', message: m.message || '' });
        else if (m.type === 'exit') setHint({ kind: 'exit', code: m.code });
      } catch (e) {}
    };
    ws.onerror = () => setHint({ kind: 'ws_err' });
    ws.onclose = () => {
      wsRef.current = null;
    };
    return () => {
      try {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'close' }));
      } catch (e) {}
      try {
        ws.close();
      } catch (e) {}
    };
  }, [container, shell]);

  React.useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [buf]);

  const send = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const s = inp;
    setInp('');
    ws.send(JSON.stringify({ type: 'stdin', data: s + '\n' }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 220 }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{hintText(hint)}</div>
      <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.45 }}>{dockerTr('docker_ws_desc')}</div>
      <pre
        ref={outRef}
        style={{
          flex: 1,
          minHeight: 120,
          maxHeight: 280,
          overflow: 'auto',
          background: '#020617',
          color: '#e2e8f0',
          padding: 10,
          borderRadius: 8,
          fontSize: 12,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: '1px solid #1e293b',
        }}
      >
        {buf || dockerTr('docker_ws_wait_out')}
      </pre>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          value={inp}
          onChange={(e) => setInp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
          placeholder={dockerTr('docker_ws_ph_stdin')}
          style={{ flex: 1, minWidth: 200, fontFamily: 'monospace', fontSize: 12 }}
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={send}>
          {dockerTr('docker_ws_send')}
        </button>
        <button type="button" className="btn btn-sm btn-cancel" onClick={onClose}>
          {dockerTr('docker_ws_disconnect')}
        </button>
      </div>
    </div>
  );
}

function ContainersPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const [scope, setScope] = React.useState('running');
  const [logDock, setLogDock] = React.useState(null);
  const [logTail, setLogTail] = React.useState(200);
  const logTailRef = React.useRef(200);
  React.useEffect(() => {
    logTailRef.current = logTail;
  }, [logTail]);
  const [logBusy, setLogBusy] = React.useState(false);
  const [logAuto, setLogAuto] = React.useState(false);
  const [dockH, setDockH] = React.useState(() => {
    try {
      const v = Number(sessionStorage.getItem('dockerDockH'));
      return Number.isFinite(v) && v >= 160 && v <= 900 ? v : 360;
    } catch (e) {
      return 360;
    }
  });
  const [dockX, setDockX] = React.useState(() => {
    try {
      const v = Number(sessionStorage.getItem('dockerDockX'));
      return Number.isFinite(v) ? Math.min(480, Math.max(-480, v)) : 0;
    } catch (e) {
      return 0;
    }
  });
  const dragDock = React.useRef({ mode: null, startY: 0, startH: 0, startX: 0, startDX: 0 });

  React.useEffect(() => {
    try {
      sessionStorage.setItem('dockerDockH', String(dockH));
    } catch (e) {}
  }, [dockH]);
  React.useEffect(() => {
    try {
      sessionStorage.setItem('dockerDockX', String(dockX));
    } catch (e) {}
  }, [dockX]);

  const [execModal, setExecModal] = React.useState(null);
  const [execTab, setExecTab] = React.useState('once');
  const [execShell, setExecShell] = React.useState('sh');
  const [execArgv, setExecArgv] = React.useState('["uname", "-a"]');
  const [execTty, setExecTty] = React.useState(false);
  const [execBusy, setExecBusy] = React.useState(false);
  const [execOut, setExecOut] = React.useState(null);
  const url = scope === 'all' ? `${API}/env/docker/ps-all` : `${API}/env/docker/ps`;
  const { data, loading, error, reload } = useFetch(url);

  const refreshLogs = React.useCallback((name) => {
    if (!name) return;
    setLogBusy(true);
    const tail = logTailRef.current;
    fetch(`${API}/env/docker/logs/container/${encodeURIComponent(name)}?tail=${encodeURIComponent(String(tail))}`)
      .then((r) => r.json())
      .then((d) => {
        setLogBusy(false);
        const text = d.ok ? `${d.stdout || ''}${d.stderr || ''}` : JSON.stringify(d, null, 2);
        setLogDock((prev) => (prev && prev.name === name ? { name, text } : prev));
      })
      .catch(() => {
        setLogBusy(false);
        setLogDock((prev) => (prev && prev.name === name ? { name, text: dockerTr('gen_req_fail') } : prev));
      });
  }, []);

  const openLogs = (name) => {
    if (!name) return;
    setLogDock({ name, text: '' });
    refreshLogs(name);
  };

  const closeDock = () => {
    setLogDock(null);
    setLogAuto(false);
  };

  React.useEffect(() => {
    if (!logDock || !logAuto) return undefined;
    const id = setInterval(() => refreshLogs(logDock.name), 5000);
    return () => clearInterval(id);
  }, [logDock, logAuto, refreshLogs]);

  React.useEffect(() => {
    const onMove = (e) => {
      const d = dragDock.current;
      if (!d.mode) return;
      if (d.mode === 'resize') {
        const dy = d.startY - e.clientY;
        const nh = Math.min(Math.max(d.startH + dy, 160), Math.floor(window.innerHeight * 0.78));
        setDockH(nh);
      }
      if (d.mode === 'move') {
        const dx = e.clientX - d.startX;
        setDockX(Math.min(480, Math.max(-480, d.startDX + dx)));
      }
    };
    const onUp = () => {
      dragDock.current.mode = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    dragDock.current = { mode: 'resize', startY: e.clientY, startH: dockH, startX: 0, startDX: dockX };
    document.body.style.userSelect = 'none';
  };

  const startMoveDock = (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
    e.preventDefault();
    dragDock.current = { mode: 'move', startY: 0, startH: dockH, startX: e.clientX, startDX: dockX };
    document.body.style.userSelect = 'none';
  };

  const openExec = (name) => {
    setExecOut(null);
    setExecArgv('["uname", "-a"]');
    setExecTab('once');
    setExecShell('sh');
    setExecTty(false);
    setExecModal(name);
  };

  const runExec = () => {
    let argv;
    try {
      argv = JSON.parse(execArgv || '[]');
    } catch (e) {
      showToast(dockerTr('docker_argv_json'), 'err');
      return;
    }
    if (!Array.isArray(argv) || !argv.length) {
      showToast(dockerTr('docker_argv_nonempty'), 'err');
      return;
    }
    setExecBusy(true);
    setExecOut(null);
    fetch(`${API}/env/docker/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ container: execModal, argv, tty: !!execTty }),
    })
      .then((r) => r.json())
      .then((d) => {
        setExecBusy(false);
        setExecOut(d);
        if (!d.ok) showToast((d.stderr || d.stdout || dockerTr('docker_exec_cmd_fail')).slice(0, 160), 'err');
      })
      .catch(() => {
        setExecBusy(false);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const cname = (c) => String(c.Names || c.Name || c.ID || '')
    .split(',')[0]
    .replace(/^\//, '')
    .trim();

  const stop = (name) => {
    if (!name) return;
    fetch(`${API}/env/docker/stop/${encodeURIComponent(name)}`, { method: 'POST' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast(dockerTr('docker_cont_stopped'), 'ok');
      })
      .catch(() => showToast(dockerTr('docker_cont_stop_fail'), 'err'));
  };

  const startC = (name) => {
    if (!name) return;
    fetch(`${API}/env/docker/start/${encodeURIComponent(name)}`, { method: 'POST' })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('docker_cont_start_fail'), 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '').slice(0, 200), 'err');
        } else {
          showToast(dockerTr('docker_cont_started'), 'ok');
        }
        reload();
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const remove = (name) => {
    if (!name) return;
    if (!confirm(dockerTr('docker_confirm_rm_container', { name }))) return;
    fetch(`${API}/env/docker/remove/${encodeURIComponent(name)}`, { method: 'POST' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast(dockerTr('auth_toast_deleted'), 'ok');
      })
      .catch(() => showToast(dockerTr('vibe_toast_del_fail'), 'err'));
  };

  if (loading) {
    return (
      <div>
        <div className="section-title">{dockerTr('docker_cont_title')}</div>
        <PageSkeleton cards={1} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">{dockerTr('docker_cont_title')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  const rows = (data && data.containers) || [];

  return (
    <div style={{ paddingBottom: logDock ? dockH + 12 : 0, transition: 'padding-bottom 0.2s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ flex: '1 1 220px' }}>
          <div className="section-title">{dockerTr('docker_cont_title')}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.55 }}>
            {dockerTr('docker_cont_blurb')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
            <option value="running">{dockerTr('docker_filter_running')}</option>
            <option value="all">{dockerTr('docker_filter_all')}</option>
          </select>
          <RefreshBtn onClick={reload} />
        </div>
      </div>
      {(data && data.error) && (
        <div className="card" style={{ marginBottom: 10, borderColor: '#b45309' }}>
          <div className="meta" style={{ color: '#fdba74' }}>
            {data.error}
          </div>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            {dockerTr('docker_cont_none')}
          </div>
        ) : (
          rows.map((c) => {
            const name = cname(c);
            const st = String(c.Status || c.State || '');
            const running = /Up /i.test(st) || String(c.State || '').toLowerCase() === 'running';
            return (
              <div
                key={c.ID || name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1fr) auto',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: '1px solid #1e293b',
                  alignItems: 'start',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="title" style={{ fontSize: 14 }}>
                    {name || c.ID}
                  </div>
                  <div className="meta" style={{ marginTop: 4, wordBreak: 'break-word' }}>
                    {c.Image} · {st}
                  </div>
                  <div className="meta" style={{ marginTop: 2, fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                    {c.Ports || '-'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                  <button type="button" className="btn btn-sm" style={{ background: '#1e3a5f', color: '#93c5fd' }} onClick={() => openLogs(name)}>
                    {dockerTr('gen_logs')}
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => openExec(name)}>
                    {dockerTr('gen_exec')}
                  </button>
                  {running ? (
                    <button type="button" className="btn btn-sm btn-warn" onClick={() => stop(name)}>
                      {dockerTr('docker_cont_stop')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => startC(name)}>
                      {dockerTr('docker_cont_start')}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={() => remove(name)}>
                    {dockerTr('gen_delete')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {logDock && (
        <div
          style={{
            position: 'fixed',
            zIndex: 10050,
            left: '50%',
            bottom: 0,
            width: 'min(96vw, 1680px)',
            height: dockH,
            transform: `translateX(calc(-50% + ${dockX}px))`,
            display: 'flex',
            flexDirection: 'column',
            background: '#0b1222',
            border: '1px solid #334155',
            borderBottom: 'none',
            borderRadius: '12px 12px 0 0',
            boxShadow: '0 -12px 40px rgba(0,0,0,0.55)',
          }}
        >
          <div
            onMouseDown={startResize}
            title={dockerTr('docker_resize_h')}
            style={{
              height: 10,
              cursor: 'ns-resize',
              flexShrink: 0,
              borderRadius: '12px 12px 0 0',
              background: 'linear-gradient(180deg, #334155 0%, #1e293b 100%)',
            }}
          />
          <div
            onMouseDown={startMoveDock}
            style={{
              cursor: 'grab',
              flexShrink: 0,
              padding: '8px 12px',
              borderBottom: '1px solid #1e293b',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="section-title" style={{ margin: 0, fontSize: 13 }}>
                {dockerTr('docker_log_dock_title', { name: logDock.name })}
              </span>
              <span style={{ fontSize: 10, color: '#64748b' }}>{dockerTr('docker_drag_bar_hint')}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                tail
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={logTail}
                  onChange={(e) => setLogTail(Number(e.target.value) || 200)}
                  style={{ width: 72, fontSize: 12 }}
                />
              </label>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={logAuto} onChange={(e) => setLogAuto(e.target.checked)} />
                {dockerTr('docker_log_auto_5s')}
              </label>
              <button type="button" className="btn btn-sm btn-primary" disabled={logBusy} onClick={() => refreshLogs(logDock.name)}>
                {logBusy ? dockerTr('docker_log_loading_dots') : dockerTr('gen_refresh')}
              </button>
              <button type="button" className="btn btn-sm btn-cancel" onClick={closeDock}>
                {dockerTr('gen_collapse')}
              </button>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: '0 12px 12px', display: 'flex', flexDirection: 'column' }}>
            <pre
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                margin: 0,
                fontSize: 12,
                lineHeight: 1.45,
                color: '#e2e8f0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: '#020617',
                border: '1px solid #1e293b',
                borderRadius: 8,
                padding: 10,
              }}
            >
              {logBusy ? dockerTr('docker_log_stream_loading') : logDock.text || dockerTr('docker_log_empty_paren')}
            </pre>
          </div>
        </div>
      )}

      {execModal && (
        <div className="modal-overlay" onClick={() => !execBusy && setExecModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 340, maxWidth: 640, width: 'min(92vw, 620px)' }}>
            <div className="section-title">docker exec · {execModal}</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {[
                ['once', dockerTr('docker_exec_tab_once')],
                ['shell', dockerTr('docker_exec_tab_shell')],
              ].map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn btn-sm ${execTab === id ? 'btn-primary' : ''}`}
                  style={execTab !== id ? { background: '#334155', color: '#94a3b8' } : {}}
                  onClick={() => setExecTab(id)}
                >
                  {lab}
                </button>
              ))}
            </div>
            {execTab === 'once' ? (
              <>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
                  {dockerTr('docker_exec_once_blurb')}
                </div>
                <div className="form-group">
                  <label>{dockerTr('docker_label_argv_arr')}</label>
                  <textarea value={execArgv} onChange={(e) => setExecArgv(e.target.value)} style={{ minHeight: 72, fontFamily: 'monospace', fontSize: 12 }} />
                </div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <input type="checkbox" checked={execTty} onChange={(e) => setExecTty(e.target.checked)} />
                  {dockerTr('docker_exec_pseudo_tty')}
                </label>
                <div className="modal-actions">
                  <button type="button" className="btn btn-cancel" disabled={execBusy} onClick={() => setExecModal(null)}>
                    {dockerTr('gen_close')}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={execBusy} onClick={runExec}>
                    {execBusy ? dockerTr('docker_exec_busy') : dockerTr('docker_exec_btn')}
                  </button>
                </div>
                {execOut && (
                  <div style={{ marginTop: 10 }}>
                    <div className="meta" style={{ color: execOut.ok ? '#86efac' : '#fca5a5' }}>
                      {execOut.ok ? dockerTr('docker_exec_status_done') : dockerTr('docker_exec_status_fail')} {execOut.returncode != null ? `(exit ${execOut.returncode})` : ''}
                    </div>
                    <pre style={{ fontSize: 11, color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{execOut.stdout || ''}</pre>
                    {execOut.stderr ? <pre style={{ fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap' }}>{execOut.stderr}</pre> : null}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                  {dockerTr('docker_shell_ws_blurb')}
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>Shell</span>
                  <select value={execShell} onChange={(e) => setExecShell(e.target.value)} style={{ fontSize: 12 }}>
                    <option value="sh">sh</option>
                    <option value="bash">bash</option>
                  </select>
                </div>
                <DockerInteractiveExec container={execModal} shell={execShell} onClose={() => setExecModal(null)} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ImagesPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/env/docker/images`);
  const [pullImg, setPullImg] = React.useState('');
  const [pullBusy, setPullBusy] = React.useState(false);
  const [rmBusy, setRmBusy] = React.useState(null);

  const pull = () => {
    const image = pullImg.trim();
    if (!image) return;
    setPullBusy(true);
    fetch(`${API}/env/docker/images/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setPullBusy(false);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_pull_fail'), 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '').slice(0, 240), 'err');
        } else {
          showToast(dockerTr('gen_pull_ok'), 'ok');
        }
        reload();
      })
      .catch(() => {
        setPullBusy(false);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const rmi = (ref) => {
    if (!confirm(dockerTr('docker_confirm_rm_image', { ref }))) return;
    setRmBusy(ref);
    fetch(`${API}/env/docker/images/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref }),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setRmBusy(null);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('docker_img_rm_fail'), 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '').slice(0, 240), 'err');
        } else {
          showToast(dockerTr('docker_img_rm_ok'), 'ok');
        }
        reload();
      })
      .catch(() => {
        setRmBusy(null);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  if (loading) {
    return (
      <div>
        <div className="section-title">{dockerTr('docker_img_section')}</div>
        <PageSkeleton cards={1} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">{dockerTr('docker_img_section')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  const imgs = (data && data.images) || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="section-title">{dockerTr('docker_img_local')}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{dockerTr('docker_img_list_hint')}</div>
        </div>
        <RefreshBtn onClick={reload} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title">{dockerTr('docker_img_pull_card')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input value={pullImg} onChange={(e) => setPullImg(e.target.value)} placeholder={dockerTr('docker_img_pull_ph')} style={{ flex: 1, minWidth: 200, fontFamily: 'monospace', fontSize: 12 }} />
          <button type="button" className="btn btn-sm btn-primary" disabled={pullBusy} onClick={pull}>
            {pullBusy ? dockerTr('docker_img_pulling') : 'docker pull'}
          </button>
        </div>
      </div>
      {(data && data.error) && (
        <div className="card" style={{ marginBottom: 10, borderColor: '#b45309' }}>
          <div className="meta" style={{ color: '#fdba74' }}>
            {data.error}
          </div>
        </div>
      )}
      <div className="card">
        {imgs.length === 0 ? (
          <div className="empty">{dockerTr('docker_img_empty')}</div>
        ) : (
          imgs.map((im) => {
            const repo = im.Repository || im.repository || '';
            const tag = im.Tag || im.tag || '';
            const ref = repo && tag && tag !== '<none>' ? `${repo}:${tag}` : im.ID || im.Id || '';
            return (
              <div key={im.ID || im.Id || ref} className="list-item">
                <div style={{ flex: 1 }}>
                  <div className="title">{repo || dockerTr('docker_img_no_repo')}</div>
                  <div className="meta">
                    {tag} · {im.Size || im.size || '-'} · {im.ID || im.Id || '-'}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} disabled={!ref || rmBusy === ref} onClick={() => rmi(ref)}>
                  {rmBusy === ref ? '…' : dockerTr('gen_delete')}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PresetsPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/env/docker/presets/catalog`);
  const [starting, setStarting] = React.useState({});
  const [results, setResults] = React.useState({});
  const [modal, setModal] = React.useState(null);
  const [form, setForm] = React.useState({
    key: '',
    label: '',
    image: '',
    container_name: '',
    portsText: '8080:8080',
    envText: '',
    volumesText: '',
    restart: '',
  });

  const start = (key) => {
    setStarting((p) => ({ ...p, [key]: true }));
    fetch(`${API}/env/docker/presets/${encodeURIComponent(key)}/start`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        setStarting((p) => ({ ...p, [key]: false }));
        setResults((p) => ({ ...p, [key]: d }));
        if (d.ok) showToast(dockerTr('docker_preset_run_sent', { key }), 'ok');
        else showToast(dockerTr('docker_cont_start_fail'), 'err');
      })
      .catch(() => {
        setStarting((p) => ({ ...p, [key]: false }));
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const parseLines = (text) =>
    (text || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  const saveCustom = () => {
    const ports = parseLines(form.portsText).flatMap((line) => line.split(/[\s,]+/).filter(Boolean));
    const env = parseLines(form.envText);
    const volumes = parseLines(form.volumesText);
    const isEdit = modal === 'edit';
    const k = form.key.trim().toLowerCase();
    if (!isEdit && !k) {
      showToast(dockerTr('docker_fill_key'), 'err');
      return;
    }
    const body = {
      label: form.label.trim(),
      image: form.image.trim(),
      container_name: form.container_name.trim() || undefined,
      ports,
      env,
      volumes,
      restart: form.restart.trim() || undefined,
    };
    body.key = k;
    const url = isEdit ? `${API}/env/docker/custom-presets/${encodeURIComponent(form._id)}` : `${API}/env/docker/custom-presets`;
    fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_save_fail'), 'err');
          return;
        }
        showToast(isEdit ? dockerTr('docker_preset_updated') : dockerTr('docker_preset_added'), 'ok');
        setModal(null);
        setForm({ key: '', label: '', image: '', container_name: '', portsText: '', envText: '', volumesText: '', restart: '' });
        reload();
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const delCustom = (id) => {
    if (!confirm(dockerTr('docker_confirm_del_preset'))) return;
    fetch(`${API}/env/docker/custom-presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast(dockerTr('auth_toast_deleted'), 'ok');
        reload();
      })
      .catch(() => showToast(dockerTr('vibe_toast_del_fail'), 'err'));
  };

  const openEdit = (row) => {
    setModal('edit');
    setForm({
      _id: row.id,
      key: row.key,
      label: row.label || row.key,
      image: row.image,
      container_name: row.container_name || '',
      portsText: (row.ports || []).join('\n'),
      envText: (row.env || []).join('\n'),
      volumesText: (row.volumes || []).join('\n'),
      restart: row.restart || '',
    });
  };

  const ICONS = { mysql: '🐬', redis: '🔴', postgres: '🐘', mongo: '🍃', rabbitmq: '🐰', minio: '📦' };

  if (loading) {
    return (
      <div>
        <div className="section-title">{dockerTr('docker_preset_section')}</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">{dockerTr('docker_preset_section')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  const builtin = (data && data.builtin) || {};
  const custom = (data && data.custom) || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="section-title">{dockerTr('docker_preset_title')}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{dockerTr('docker_preset_intro')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => { setModal('add'); setForm({ key: '', label: '', image: '', container_name: '', portsText: '', envText: '', volumesText: '', restart: '' }); }}>
            {dockerTr('docker_preset_add')}
          </button>
          <RefreshBtn onClick={reload} />
        </div>
      </div>

      <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
        {dockerTr('docker_preset_builtin')}
      </div>
      <div className="grid-2">
        {Object.entries(builtin).map(([name, cfg]) => (
          <div key={name} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>
                {ICONS[name] || '📦'}{' '}
                <strong style={{ color: '#f1f5f9' }}>{name}</strong>
              </span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => start(name)} disabled={starting[name]}>
                {starting[name] ? dockerTr('docker_preset_starting') : dockerTr('docker_preset_go')}
              </button>
            </div>
            <div className="meta">{cfg.image}</div>
            <div className="meta">{dockerTr('docker_preset_ports', { ports: (cfg.ports && cfg.ports.join(', ')) || '' })}</div>
            {results[name] && (
              <div style={{ marginTop: 6, fontSize: 11, color: results[name].ok ? '#86efac' : '#fca5a5', background: '#0f172a', padding: '4px 8px', borderRadius: 4 }}>
                {results[name].ok ? dockerTr('docker_preset_ok_ran') : `❌ ${(results[name].stderr || results[name].stdout || '').slice(0, 120)}`}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="section-title" style={{ fontSize: 13, margin: '16px 0 8px' }}>
        {dockerTr('docker_preset_custom')}
      </div>
      <div className="card">
        {custom.length === 0 ? (
          <div className="empty" style={{ fontSize: 12 }}>
            {dockerTr('docker_preset_no_custom')}
          </div>
        ) : (
          custom.map((row) => (
            <div key={row.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="title">
                    {row.label || row.key} <span style={{ fontSize: 11, color: '#64748b' }}>({row.key})</span>
                  </div>
                  <div className="meta">
                    {dockerTr('docker_preset_row_meta', {
                      image: row.image,
                      cn: row.container_name || '-',
                      rs: row.restart || '-',
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <button type="button" className="btn btn-sm btn-primary" disabled={starting[row.key]} onClick={() => start(row.key)}>
                    {starting[row.key] ? '…' : dockerTr('docker_preset_go')}
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#e2e8f0' }} onClick={() => openEdit(row)}>
                    {dockerTr('gen_edit')}
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#451a1a', color: '#fca5a5' }} onClick={() => delCustom(row.id)}>
                    {dockerTr('gen_delete')}
                  </button>
                </div>
              </div>
              {results[row.key] && (
                <div style={{ fontSize: 11, color: results[row.key].ok ? '#86efac' : '#fca5a5' }}>
                  {results[row.key].ok ? '✅' : '❌'} {(results[row.key].stderr || results[row.key].stdout || '').slice(0, 160)}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {modal && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" style={{ width: 520, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>{modal === 'edit' ? dockerTr('docker_preset_modal_edit') : dockerTr('docker_preset_modal_add')}</h3>
            <p style={{ fontSize: 11, color: '#64748b' }}>{dockerTr('docker_preset_modal_hint')}</p>
            {modal !== 'edit' && (
              <div className="form-group">
                <label>{dockerTr('docker_label_key')}</label>
                <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="my-pg" />
              </div>
            )}
            <div className="form-group">
              <label>{dockerTr('docker_label_display_name')}</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{dockerTr('docker_label_image')}</label>
              <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="postgres:16" style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>{dockerTr('docker_label_container_name_opt')}</label>
              <input value={form.container_name} onChange={(e) => setForm({ ...form, container_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{dockerTr('docker_label_ports_map')}</label>
              <textarea value={form.portsText} onChange={(e) => setForm({ ...form, portsText: e.target.value })} style={{ minHeight: 56, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>{dockerTr('docker_label_env_lines')}</label>
              <textarea value={form.envText} onChange={(e) => setForm({ ...form, envText: e.target.value })} style={{ minHeight: 56, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>{dockerTr('docker_label_volumes')}</label>
              <textarea value={form.volumesText} onChange={(e) => setForm({ ...form, volumesText: e.target.value })} style={{ minHeight: 56, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>{dockerTr('docker_label_restart_opt')}</label>
              <input value={form.restart} onChange={(e) => setForm({ ...form, restart: e.target.value })} placeholder={dockerTr('docker_ph_restart_default')} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setModal(null)}>
                {dockerTr('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={saveCustom}>
                {dockerTr('gen_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DockerRunPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const [form, setForm] = React.useState({
    image: '',
    name: '',
    portsText: '',
    envText: '',
    volumesText: '',
    restart: '',
    detach: true,
  });
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState(null);

  const parseLines = (text) =>
    (text || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  const run = () => {
    const image = form.image.trim();
    if (!image) {
      showToast(dockerTr('docker_fill_image'), 'err');
      return;
    }
    const ports = parseLines(form.portsText).flatMap((line) => line.split(/[\s,]+/).filter(Boolean));
    const env = parseLines(form.envText);
    const volumes = parseLines(form.volumesText);
    setBusy(true);
    fetch(`${API}/env/docker/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image,
        name: form.name.trim() || undefined,
        ports,
        env,
        volumes,
        restart: form.restart.trim() || undefined,
        detach: !!form.detach,
      }),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setBusy(false);
        if (!httpOk) {
          const msg = typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail || d);
          setOut({ ok: false, stdout: '', stderr: msg });
          showToast(dockerTr('docker_req_rejected'), 'err');
          return;
        }
        setOut(d);
        if (d.ok) showToast(dockerTr('docker_run_ok'), 'ok');
        else showToast(dockerTr('docker_run_nonzero'), 'err');
      })
      .catch(() => {
        setBusy(false);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>
        {dockerTr('docker_run_title')}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
        {dockerTr('docker_run_intro')}
      </div>
      <div className="card">
        <div className="form-group">
          <label>{dockerTr('docker_label_image_req')}</label>
          <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="nginx:alpine" style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>{dockerTr('docker_label_container_name')}</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>{dockerTr('docker_label_ports_run')}</label>
          <textarea value={form.portsText} onChange={(e) => setForm({ ...form, portsText: e.target.value })} style={{ minHeight: 48, fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>{dockerTr('docker_label_env_run')}</label>
          <textarea value={form.envText} onChange={(e) => setForm({ ...form, envText: e.target.value })} style={{ minHeight: 48, fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>{dockerTr('docker_label_vol_run')}</label>
          <textarea value={form.volumesText} onChange={(e) => setForm({ ...form, volumesText: e.target.value })} style={{ minHeight: 48, fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>restart</label>
          <input value={form.restart} onChange={(e) => setForm({ ...form, restart: e.target.value })} placeholder="unless-stopped" />
        </div>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <input type="checkbox" checked={form.detach} onChange={(e) => setForm({ ...form, detach: e.target.checked })} /> {dockerTr('docker_label_detach')}
        </label>
        <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={run}>
          {busy ? dockerTr('docker_exec_busy') : dockerTr('docker_run_exec')}
        </button>
      </div>
      {out && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="section-title" style={{ color: out.ok ? '#86efac' : '#fca5a5', fontSize: 13 }}>
            {out.ok ? dockerTr('docker_run_result_ok') : dockerTr('docker_run_result_fail')} {out.returncode != null ? `(exit ${out.returncode})` : ''}
          </div>
          {out.stdout ? (
            <pre style={{ fontSize: 11, color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{out.stdout}</pre>
          ) : null}
          {out.stderr ? (
            <pre style={{ fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{out.stderr}</pre>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ComposePanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const [fileEntries, setFileEntries] = React.useState([]);
  const [file, setFile] = React.useState('docker-compose.yml');
  const [svcResult, setSvcResult] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [composeLogs, setComposeLogs] = React.useState('');
  const [logSvc, setLogSvc] = React.useState('');
  const [tail, setTail] = React.useState(200);
  const [lastAct, setLastAct] = React.useState(null);

  const [mcStores, setMcStores] = React.useState([]);
  const [mcSelId, setMcSelId] = React.useState('');
  const [mcVer, setMcVer] = React.useState(1);
  const [mcContent, setMcContent] = React.useState('');
  const [mcBump, setMcBump] = React.useState(true);
  const [mcNewName, setMcNewName] = React.useState('');
  const [mcNewContent, setMcNewContent] = React.useState(
    'version: "3.8"\nservices:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n'
  );
  const [mcSaving, setMcSaving] = React.useState(false);

  const reloadFileList = React.useCallback(() => {
    fetch(`${API}/env/docker/compose/files`)
      .then((r) => r.json())
      .then((d) => {
        const raw = d.files || [];
        const list = raw.map((x) =>
          typeof x === 'string'
            ? { path: x, label: x, kind: 'project' }
            : {
                path: x.path,
                kind: x.kind || 'project',
                label: x.kind === 'managed' ? dockerTr('docker_compose_managed_lbl', { name: x.name || x.path, path: x.path }) : x.path,
              }
        );
        setFileEntries(list);
      })
      .catch(() => showToast(dockerTr('docker_compose_list_fail'), 'err'));
  }, []);

  const reloadMcStores = React.useCallback(() => {
    fetch(`${API}/env/docker/managed-compose`)
      .then((r) => r.json())
      .then((d) => setMcStores(d.stores || []))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    reloadFileList();
    reloadMcStores();
  }, [reloadFileList, reloadMcStores]);

  React.useEffect(() => {
    const paths = fileEntries.map((e) => e.path);
    if (paths.length && !paths.includes(file)) setFile(paths[0]);
  }, [fileEntries, file]);

  const refreshServices = React.useCallback(() => {
    const q = new URLSearchParams({ file });
    fetch(`${API}/env/docker/compose/services?${q}`)
      .then((r) => r.json())
      .then(setSvcResult);
  }, [file]);

  React.useEffect(() => {
    refreshServices();
  }, [refreshServices]);

  const composeAct = (action) => {
    if (!confirm(dockerTr('docker_compose_confirm_act', { action, file }))) return;
    setBusy(action);
    setLastAct(null);
    const q = new URLSearchParams({ file });
    fetch(`${API}/env/docker/compose/${action}?${q}`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        setBusy(null);
        setLastAct(d);
        if (!d.ok) showToast((d.stderr || d.stdout || dockerTr('docker_compose_act_fail', { action })).slice(0, 200), 'err');
        else showToast(dockerTr('docker_compose_act_sent', { action }), 'ok');
        refreshServices();
      })
      .catch(() => {
        setBusy(null);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const fetchComposeLogs = () => {
    const q = new URLSearchParams({ file, tail: String(tail) });
    if (logSvc.trim()) q.set('service', logSvc.trim());
    fetch(`${API}/env/docker/logs/compose?${q}`)
      .then((r) => r.json())
      .then((d) => {
        const text = d.ok ? `${d.stdout || ''}${d.stderr || ''}` : JSON.stringify(d, null, 2);
        setComposeLogs(text);
      })
      .catch(() => setComposeLogs(dockerTr('gen_req_fail')));
  };

  const loadMcOne = (id, explicitVer) => {
    if (!id) return;
    let url = `${API}/env/docker/managed-compose/${encodeURIComponent(id)}`;
    if (explicitVer) url += `?version=${encodeURIComponent(String(explicitVer))}`;
    fetch(url)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_load_fail'), 'err');
          return;
        }
        setMcSelId(id);
        setMcVer(d.version || 1);
        setMcContent(d.content || '');
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const mcFirstId = mcStores[0] && mcStores[0].id;
  React.useEffect(() => {
    if (mcFirstId && !mcSelId) loadMcOne(mcFirstId);
  }, [mcFirstId, mcSelId]);

  const mcSave = () => {
    if (!mcSelId) return;
    setMcSaving(true);
    fetch(`${API}/env/docker/managed-compose/${encodeURIComponent(mcSelId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: mcContent, bump_version: mcBump }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setMcSaving(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_save_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_toast_saved'), 'ok');
        reloadMcStores();
        reloadFileList();
        loadMcOne(mcSelId);
      })
      .catch(() => {
        setMcSaving(false);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const mcCreate = () => {
    const nm = mcNewName.trim().toLowerCase();
    if (!nm) {
      showToast(dockerTr('docker_fill_name'), 'err');
      return;
    }
    fetch(`${API}/env/docker/managed-compose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nm, content: mcNewContent }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_create_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_toast_created'), 'ok');
        setMcNewName('');
        reloadMcStores();
        reloadFileList();
        if (d.id) {
          setMcSelId(d.id);
          loadMcOne(d.id);
          setFile(`managed:${d.id}`);
        }
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const mcDel = () => {
    if (!mcSelId || !confirm(dockerTr('docker_confirm_del_mc', { id: mcSelId }))) return;
    fetch(`${API}/env/docker/managed-compose/${encodeURIComponent(mcSelId)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast(dockerTr('auth_toast_deleted'), 'ok');
        setMcSelId('');
        setMcContent('');
        reloadMcStores();
        reloadFileList();
      })
      .catch(() => showToast(dockerTr('vibe_toast_del_fail'), 'err'));
  };

  const mcUpload = (ev, bump) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f || !mcSelId) return;
    const fd = new FormData();
    fd.append('file', f);
    const q = new URLSearchParams({ bump_version: bump ? 'true' : 'false' });
    fetch(`${API}/env/docker/managed-compose/${encodeURIComponent(mcSelId)}/upload?${q}`, {
      method: 'POST',
      body: fd,
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_upload_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_toast_uploaded'), 'ok');
        reloadMcStores();
        reloadFileList();
        loadMcOne(mcSelId);
      })
      .catch(() => showToast(dockerTr('gen_upload_fail'), 'err'));
  };

  const mcCur = mcStores.find((s) => s.id === mcSelId);
  const selectOpts = fileEntries.length ? fileEntries : [{ path: 'docker-compose.yml', label: 'docker-compose.yml', kind: 'project' }];

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>
        Docker Compose
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
        {dockerTr('docker_compose_page_blurb')}
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="form-group">
          <label>{dockerTr('docker_label_compose_file')}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={file} onChange={(e) => setFile(e.target.value)} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>
              {selectOpts.map((e) => (
                <option key={e.path} value={e.path}>
                  {e.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => { reloadFileList(); reloadMcStores(); }}>
              {dockerTr('docker_refresh_list')}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {['up', 'down', 'restart', 'pull'].map((a) => (
            <button key={a} type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => composeAct(a)}>
              {busy === a ? dockerTr('docker_exec_busy') : a}
            </button>
          ))}
          <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={refreshServices}>
            {dockerTr('docker_refresh_svc')}
          </button>
        </div>
        {svcResult && svcResult.error && (
          <div className="meta" style={{ color: '#fdba74', marginBottom: 8 }}>
            {svcResult.error}
          </div>
        )}
        <pre style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(svcResult && svcResult.services, null, 2) || ''}</pre>
      </div>

      <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
        {dockerTr('docker_mc_section')}
      </div>
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div className="card scroll-slim" style={{ maxHeight: 480, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>{dockerTr('docker_mc_symmetry')}</div>
          {mcStores.length === 0 ? <div className="empty">{dockerTr('docker_mc_empty')}</div> : null}
          {mcStores.map((s) => (
            <div
              key={s.id}
              className="list-item"
              style={{ cursor: 'pointer', background: mcSelId === s.id ? '#1e3a5f' : '', padding: '6px 8px', borderRadius: 4 }}
              onClick={() => loadMcOne(s.id)}
            >
              <div className="title" style={{ fontSize: 12 }}>
                {s.name}
              </div>
              <div className="meta">
                {s.id} · v{s.latest || 1}
              </div>
            </div>
          ))}
          <div className="section-title" style={{ fontSize: 12, marginTop: 16 }}>
            {dockerTr('docker_mc_new')}
          </div>
          <div className="form-group">
            <label>{dockerTr('docker_label_name_lower')}</label>
            <input value={mcNewName} onChange={(e) => setMcNewName(e.target.value)} placeholder="my-stack" style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label>{dockerTr('docker_label_compose_yaml')}</label>
            <textarea value={mcNewContent} onChange={(e) => setMcNewContent(e.target.value)} style={{ minHeight: 100, fontFamily: 'monospace', fontSize: 11 }} />
          </div>
          <button type="button" className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={mcCreate}>
            {dockerTr('docker_mc_create_btn')}
          </button>
        </div>
        <div className="card" style={{ minHeight: 280 }}>
          {!mcSelId ? (
            <div className="empty">{dockerTr('docker_mc_pick_one')}</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="title" style={{ fontSize: 14 }}>{mcCur && mcCur.name}</div>
                  <div className="meta">
                    {dockerTr('docker_mc_editor_meta', { id: mcSelId, ver: String(mcVer) })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => loadMcOne(mcSelId)}>
                    {dockerTr('docker_mc_load_latest')}
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#1e3a5f', color: '#93c5fd' }} onClick={() => setFile(`managed:${mcSelId}`)}>
                    {dockerTr('docker_mc_use_for_compose')}
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={mcDel}>
                    {dockerTr('gen_delete')}
                  </button>
                </div>
              </div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <input type="checkbox" checked={mcBump} onChange={(e) => setMcBump(e.target.checked)} /> {dockerTr('docker_mc_save_new_ver')}
              </label>
              <textarea value={mcContent} onChange={(e) => setMcContent(e.target.value)} style={{ width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 11, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: 8, borderRadius: 6 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={mcSaving} onClick={mcSave}>
                  {mcSaving ? dockerTr('gen_saving') : dockerTr('gen_save')}
                </button>
                <label className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', cursor: 'pointer', margin: 0 }}>
                  {dockerTr('docker_mc_upload_yml_new')}
                  <input type="file" accept=".yml,.yaml,application/x-yaml,text/yaml" style={{ display: 'none' }} onChange={(e) => mcUpload(e, true)} />
                </label>
                <label className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', cursor: 'pointer', margin: 0 }}>
                  {dockerTr('docker_mc_upload_overwrite')}
                  <input type="file" accept=".yml,.yaml,application/x-yaml,text/yaml" style={{ display: 'none' }} onChange={(e) => mcUpload(e, false)} />
                </label>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ fontSize: 13 }}>
          {dockerTr('docker_compose_logs')}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <input value={logSvc} onChange={(e) => setLogSvc(e.target.value)} placeholder={dockerTr('docker_ph_service')} style={{ flex: 1, minWidth: 120, fontFamily: 'monospace', fontSize: 12 }} />
          <label style={{ fontSize: 12, color: '#94a3b8' }}>
            tail
            <input type="number" min={10} max={10000} value={tail} onChange={(e) => setTail(Number(e.target.value) || 200)} style={{ width: 72, marginLeft: 6 }} />
          </label>
          <button type="button" className="btn btn-sm btn-primary" onClick={fetchComposeLogs}>
            {dockerTr('docker_logs_fetch')}
          </button>
        </div>
        <pre style={{ fontSize: 11, color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', marginTop: 10, background: '#0f172a', padding: 8, borderRadius: 6 }}>{composeLogs || dockerTr('docker_logs_placeholder')}</pre>
      </div>
      {lastAct && (
        <div className="card">
          <div className="section-title" style={{ fontSize: 13, color: lastAct.ok ? '#86efac' : '#fca5a5' }}>
            {dockerTr('docker_last_compose_out')} {lastAct.returncode != null ? `(exit ${lastAct.returncode})` : ''}
          </div>
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{lastAct.stdout || ''}</pre>
          {lastAct.stderr ? <pre style={{ fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap' }}>{lastAct.stderr}</pre> : null}
        </div>
      )}
    </div>
  );
}

function ManagedDockerfilePanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/env/docker/managed-dockerfiles`);
  const stores = (data && data.stores) || [];
  const [selId, setSelId] = React.useState('');
  const [ver, setVer] = React.useState(1);
  const [content, setContent] = React.useState('');
  const [bump, setBump] = React.useState(true);
  const [newName, setNewName] = React.useState('');
  const [newContent, setNewContent] = React.useState('FROM alpine:3.19\nRUN echo hello > /tmp/hi.txt\n');
  const [saving, setSaving] = React.useState(false);

  const loadOne = (id, explicitVer) => {
    if (!id) return;
    let url = `${API}/env/docker/managed-dockerfiles/${encodeURIComponent(id)}`;
    if (explicitVer) url += `?version=${encodeURIComponent(String(explicitVer))}`;
    fetch(url)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_load_fail'), 'err');
          return;
        }
        setSelId(id);
        setVer(d.version || 1);
        setContent(d.content || '');
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const firstId = stores[0] && stores[0].id;
  React.useEffect(() => {
    if (firstId && !selId) loadOne(firstId);
  }, [firstId, selId]);

  const save = () => {
    if (!selId) return;
    setSaving(true);
    fetch(`${API}/env/docker/managed-dockerfiles/${encodeURIComponent(selId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, bump_version: bump }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setSaving(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_save_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_toast_saved'), 'ok');
        reload();
        loadOne(selId);
      })
      .catch(() => {
        setSaving(false);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };

  const create = () => {
    const nm = newName.trim().toLowerCase();
    if (!nm) {
      showToast(dockerTr('docker_fill_name'), 'err');
      return;
    }
    fetch(`${API}/env/docker/managed-dockerfiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nm, content: newContent }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_create_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_toast_created'), 'ok');
        setNewName('');
        reload();
        if (d.id) {
          setSelId(d.id);
          loadOne(d.id);
        }
      })
      .catch(() => showToast(dockerTr('gen_req_fail'), 'err'));
  };

  const del = () => {
    if (!selId || !confirm(dockerTr('docker_confirm_del_managed', { id: selId }))) return;
    fetch(`${API}/env/docker/managed-dockerfiles/${encodeURIComponent(selId)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast(dockerTr('auth_toast_deleted'), 'ok');
        setSelId('');
        setContent('');
        reload();
      })
      .catch(() => showToast(dockerTr('vibe_toast_del_fail'), 'err'));
  };

  const dfUpload = (ev, bump) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f || !selId) return;
    const fd = new FormData();
    fd.append('file', f);
    const q = new URLSearchParams({ bump_version: bump ? 'true' : 'false' });
    fetch(`${API}/env/docker/managed-dockerfiles/${encodeURIComponent(selId)}/upload?${q}`, { method: 'POST', body: fd })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : dockerTr('gen_upload_fail'), 'err');
          return;
        }
        showToast(dockerTr('docker_toast_uploaded'), 'ok');
        reload();
        loadOne(selId);
      })
      .catch(() => showToast(dockerTr('gen_upload_fail'), 'err'));
  };

  if (loading) return <PageSkeleton cards={2} />;
  if (error) return <LoadError message={error} onRetry={reload} />;

  const cur = stores.find((s) => s.id === selId);

  return (
    <div className="grid-2">
      <div className="card scroll-slim" style={{ maxHeight: 560, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}>
            {dockerTr('docker_managed_list')}
          </div>
          <RefreshBtn onClick={reload} />
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>{dockerTr('docker_managed_intro')}</div>
        {stores.length === 0 ? <div className="empty">{dockerTr('docker_managed_empty')}</div> : null}
        {stores.map((s) => (
          <div
            key={s.id}
            className="list-item"
            style={{ cursor: 'pointer', background: selId === s.id ? '#1e3a5f' : '', padding: '6px 8px', borderRadius: 4 }}
            onClick={() => loadOne(s.id)}
          >
            <div style={{ flex: 1 }}>
              <div className="title" style={{ fontSize: 12 }}>
                {s.name}
              </div>
              <div className="meta">
                {s.id} · v{s.latest || 1}
              </div>
            </div>
          </div>
        ))}
        <div className="section-title" style={{ fontSize: 12, marginTop: 16 }}>
          {dockerTr('docker_managed_new')}
        </div>
        <div className="form-group">
          <label>{dockerTr('docker_label_name_lower')}</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-base-image" style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>{dockerTr('docker_label_df_content')}</label>
          <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
        <button type="button" className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={create}>
          {dockerTr('docker_managed_create')}
        </button>
      </div>
      <div className="card" style={{ minHeight: 320 }}>
        {!selId ? (
          <div className="empty">{dockerTr('docker_mc_pick_one')}</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div className="title" style={{ fontSize: 14 }}>{cur && cur.name}</div>
                <div className="meta">
                  {dockerTr('docker_managed_editor_meta', { id: selId, ver: String(ver) })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => loadOne(selId)}>
                  {dockerTr('docker_mc_load_latest')}
                </button>
                <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={del}>
                  {dockerTr('docker_managed_del_store')}
                </button>
              </div>
            </div>
            <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} /> {dockerTr('docker_managed_save_new')}
            </label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} style={{ width: '100%', minHeight: 280, fontFamily: 'monospace', fontSize: 11, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: 8, borderRadius: 6 }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-sm btn-primary" style={{ flex: '1 1 120px' }} disabled={saving} onClick={save}>
                {saving ? dockerTr('gen_saving') : dockerTr('gen_save')}
              </button>
              <label className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', cursor: 'pointer', margin: 0 }}>
                {dockerTr('docker_managed_upload_new')}
                <input type="file" accept=".dockerfile,.txt,text/plain,*/*" style={{ display: 'none' }} onChange={(e) => dfUpload(e, true)} />
              </label>
              <label className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', cursor: 'pointer', margin: 0 }}>
                {dockerTr('docker_managed_upload_over')}
                <input type="file" accept=".dockerfile,.txt,text/plain,*/*" style={{ display: 'none' }} onChange={(e) => dfUpload(e, false)} />
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BuildPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const [form, setForm] = React.useState({ tag: 'my-app:latest', dockerfile: 'Dockerfile', context: '.' });
  const [building, setBuilding] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const build = () => {
    setBuilding(true);
    setResult(null);
    const q = new URLSearchParams({ tag: form.tag, dockerfile: form.dockerfile, context: form.context });
    fetch(`${API}/env/docker/build?${q.toString()}`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        setBuilding(false);
        setResult(d);
        if (d.ok) showToast(dockerTr('docker_build_ok'), 'ok');
        else showToast(dockerTr('docker_build_fail'), 'err');
      })
      .catch(() => {
        setBuilding(false);
        showToast(dockerTr('gen_req_fail'), 'err');
      });
  };
  return (
    <div>
      <div className="section-title" style={{ marginBottom: 12 }}>
        {dockerTr('docker_build_title')}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
        {dockerTr('docker_build_intro')}
      </div>
      <div className="card">
        <div className="form-group">
          <label>{dockerTr('docker_label_tag')}</label>
          <input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="my-app:latest" style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-group">
            <label>{dockerTr('docker_label_df_rel')}</label>
            <input value={form.dockerfile} onChange={(e) => setForm({ ...form, dockerfile: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{dockerTr('docker_label_build_ctx')}</label>
            <input value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} />
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={build} disabled={building} style={{ width: '100%' }}>
          {building ? dockerTr('docker_build_busy') : dockerTr('docker_build_start')}
        </button>
      </div>
      {result && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="section-title" style={{ color: result.ok ? '#86efac' : '#fca5a5' }}>
            {result.ok ? dockerTr('docker_build_ok_title') : dockerTr('docker_build_fail_title')}
          </div>
          <pre style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>{result.stdout || result.stderr}</pre>
        </div>
      )}
    </div>
  );
}
