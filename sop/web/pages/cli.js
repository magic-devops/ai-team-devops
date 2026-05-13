function CliManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);

  const { data, loading, error, reload } = useFetch(`${API}/cli`);
  const { data: meta, loading: lm, error: em, reload: reloadMeta } = useFetch(`${API}/cli/meta`);
  const [selected, setSelected] = React.useState(null);
  const [args, setArgs] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [output, setOutput] = React.useState(null);
  const [modal, setModal] = React.useState(null);
  const [form, setForm] = React.useState({ id: '', name: '', cmd: '', description: '', install_hint: '' });

  React.useEffect(() => {
    if (!selected || !data) return;
    const n = data.find((x) => x.id === selected.id);
    if (n) setSelected(n);
    else setSelected(null);
  }, [data, selected]);

  const panelLoading = loading || lm;
  const panelError = error || em;
  const reloadAll = () => {
    reload();
    reloadMeta();
  };

  const run = () => {
    if (!selected) return;
    setRunning(true);
    setOutput(null);
    fetch(`${API}/cli/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: selected.id, args: args.split(' ').filter(Boolean) }),
    })
      .then((r) => r.json())
      .then((d) => {
        setRunning(false);
        setOutput(d);
        if (d && d.ok) showToast(t('cli_toast_done'), 'ok');
        else showToast((d && d.error) || t('cli_toast_fail'), 'err');
      })
      .catch(() => {
        setRunning(false);
        showToast(t('cli_toast_req_fail'), 'err');
      });
  };

  const openCreate = () => {
    setModal('create');
    setForm({ id: '', name: '', cmd: '', description: '', install_hint: '' });
  };
  const openEdit = (tool, e) => {
    e.stopPropagation();
    setModal(tool.is_builtin ? 'edit-builtin' : 'edit-custom');
    setForm({
      id: tool.id,
      name: tool.name || tool.description,
      cmd: tool.cmd,
      description: tool.description || '',
      install_hint: tool.install_hint || '',
    });
  };
  const saveForm = () => {
    const body = {
      name: form.name.trim(),
      cmd: form.cmd.trim(),
      description: form.description.trim(),
      install_hint: form.install_hint.trim(),
    };
    if (!body.name || !body.cmd) {
      showToast(t('cli_toast_fill'), 'err');
      return;
    }
    if (modal === 'create') {
      const id = (form.id || '').trim().toLowerCase();
      if (!id) {
        showToast(t('cli_toast_id'), 'err');
        return;
      }
      fetch(`${API}/cli/tools/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) {
            showToast(d.detail || t('cli_toast_fail'), 'err');
            return;
          }
          setModal(null);
          reloadAll();
          showToast(t('cli_toast_added'), 'ok');
        })
        .catch(() => showToast(t('cli_toast_req_fail'), 'err'));
      return;
    }
    fetch(`${API}/cli/tools/${encodeURIComponent(form.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(d.detail || t('cli_toast_fail'), 'err');
          return;
        }
        setModal(null);
        reloadAll();
        showToast(t('cli_toast_saved'), 'ok');
      })
      .catch(() => showToast(t('cli_toast_req_fail'), 'err'));
  };
  const removeTool = (tool, e) => {
    e.stopPropagation();
    const msg = tool.is_builtin ? t('cli_confirm_remove_builtin') : t('cli_confirm_remove_custom');
    if (!confirm(msg)) return;
    fetch(`${API}/cli/tools/${encodeURIComponent(tool.id)}`, { method: 'DELETE' })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(d.detail || t('cli_toast_fail'), 'err');
          return;
        }
        reloadAll();
        if (selected && selected.id === tool.id) setSelected(null);
        showToast(tool.is_builtin ? t('cli_toast_removed') : t('cli_toast_deleted'), 'ok');
      })
      .catch(() => showToast(t('cli_toast_req_fail'), 'err'));
  };
  const restoreBuiltin = (id) => {
    fetch(`${API}/cli/tools/${encodeURIComponent(id)}/restore`, { method: 'POST' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast(t('cli_toast_restored'), 'ok');
      })
      .catch(() => showToast(t('cli_toast_restore_fail'), 'err'));
  };

  const available = (data || []).filter((x) => x.available);
  const unavailable = (data || []).filter((x) => !x.available);
  const hidden = (meta && meta.hidden_builtin) || [];

  if (panelLoading) {
    return (
      <div>
        <div className="section-title">{t('cli_title')}</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (panelError) {
    return (
      <div>
        <div className="section-title">{t('cli_title')}</div>
        <LoadError message={panelError} onRetry={reloadAll} />
      </div>
    );
  }

  void langTick;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">{t('cli_title')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            {t('cli_add')}
          </button>
          <RefreshBtn onClick={reloadAll} />
        </div>
      </div>
      <div className="grid-2">
        <div>
          <div className="card scroll-slim" style={{ marginBottom: 10, maxHeight: 320, overflowY: 'auto' }}>
            <div className="section-title">{t('cli_installed', { n: available.length })}</div>
            {available.length === 0 ? (
              <div className="empty">{t('cli_none_installed')}</div>
            ) : (
              available.map((tool) => (
                <div
                  key={tool.id}
                  className={'list-item' + (selected && selected.id === tool.id ? ' vibe-list-selected' : '')}
                  style={{ cursor: 'pointer', alignItems: 'center' }}
                  onClick={() => setSelected(tool)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title">{tool.name}</div>
                    <div className="meta">
                      {tool.description} · <code style={{ color: 'var(--link-inline)' }}>{tool.cmd}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn btn-sm btn-muted" onClick={(e) => openEdit(tool, e)}>
                      {t('cli_edit')}
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={(e) => removeTool(tool, e)}>
                      {tool.is_builtin ? t('cli_remove') : t('cli_delete')}
                    </button>
                  </div>
                  <span className="tag tag-done">✅</span>
                </div>
              ))
            )}
          </div>
          <div className="card scroll-slim" style={{ marginBottom: 10, maxHeight: 240, overflowY: 'auto' }}>
            <div className="section-title">{t('cli_not_installed', { n: unavailable.length })}</div>
            {unavailable.map((tool) => (
              <div key={tool.id} className="list-item" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title">{tool.name}</div>
                  <div className="meta">{tool.description}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn btn-sm btn-muted" onClick={(e) => openEdit(tool, e)}>
                    {t('cli_edit')}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={(e) => removeTool(tool, e)}>
                    {tool.is_builtin ? t('cli_remove') : t('cli_delete')}
                  </button>
                </div>
                <span className="tag tag-p0">{t('cli_tag_not_installed')}</span>
              </div>
            ))}
          </div>
          {hidden.length > 0 && (
            <div className="card" style={{ padding: 12 }}>
              <div className="section-title" style={{ fontSize: 12, marginBottom: 8 }}>
                {t('cli_hidden_builtin')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {hidden.map((id) => (
                  <button key={id} type="button" className="btn btn-sm btn-primary" onClick={() => restoreBuiltin(id)}>
                    {t('cli_restore', { id })}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          {selected && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="section-title">{t('cli_run_title', { name: selected.name })}</div>
                <button type="button" className="btn btn-sm btn-muted" onClick={(e) => openEdit(selected, e)}>
                  {t('cli_edit')}
                </button>
              </div>
              <div className="form-group">
                <label>{t('cli_args_label')}</label>
                <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder={t('cli_args_ph')} onKeyDown={(e) => e.key === 'Enter' && run()} />
              </div>
              <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={run} disabled={running}>
                {running ? t('cli_running') : t('cli_run_go')}
              </button>
              {output && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: output.ok ? 'var(--toast-ok)' : 'var(--toast-err)', marginBottom: 4 }}>
                    {output.ok ? '✅' : '❌'} (exit {output.returncode})
                  </div>
                  <pre className="code-surface scroll-slim" style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', padding: 8 }}>
                    {output.stdout || output.error}
                  </pre>
                </div>
              )}
            </div>
          )}
          {!selected && (
            <div className="card">
              <div className="empty">{t('cli_pick_tool')}</div>
            </div>
          )}
          <div className="card scroll-slim" style={{ marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
            <div className="section-title">{t('cli_install_hints')}</div>
            {unavailable.map((tool) => (
              <div key={tool.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 2 }}>{tool.name}</div>
                <code className="code-surface" style={{ fontSize: 11, padding: '6px 8px', display: 'block', whiteSpace: 'pre-wrap' }}>
                  {tool.install_hint || t('cli_install_fallback', { id: tool.id })}
                </code>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modal && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" style={{ width: 480, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h3>{modal === 'create' ? t('cli_modal_create') : t('cli_modal_edit', { id: form.id })}</h3>
            {modal === 'create' && (
              <div className="form-group">
                <label>{t('cli_field_id')}</label>
                <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })} placeholder={t('cli_field_id_ph')} />
              </div>
            )}
            <div className="form-group">
              <label>{t('cli_field_name')}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('cli_field_cmd')}</label>
              <input value={form.cmd} onChange={(e) => setForm({ ...form, cmd: e.target.value })} placeholder={t('cli_field_cmd_ph')} />
            </div>
            <div className="form-group">
              <label>{t('cli_field_desc')}</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('cli_field_hint')}</label>
              <textarea value={form.install_hint} onChange={(e) => setForm({ ...form, install_hint: e.target.value })} style={{ minHeight: 72, fontSize: 12 }} placeholder={t('cli_field_hint_ph')} />
            </div>
            {modal !== 'create' && (
              <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
                {form.id && data && (data.find((x) => x.id === form.id) || {}).is_builtin ? t('cli_modal_note_builtin') : t('cli_modal_note_custom')}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setModal(null)}>
                {t('cli_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={saveForm}>
                {t('cli_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
