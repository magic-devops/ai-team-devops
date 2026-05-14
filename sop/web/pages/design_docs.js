/** Design docs: versions, import, AI improve */
function DesignDocsManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data: list, loading: ll, error: el, reload: reloadList } = useFetch(`${API}/design-docs`);
  const [sel, setSel] = React.useState(null);
  const [meta, setMeta] = React.useState(null);
  const [content, setContent] = React.useState('');
  const [versions, setVersions] = React.useState([]);
  const [loadingDoc, setLoadingDoc] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newForm, setNewForm] = React.useState({ title: '', category: 'architecture', tags: '', note: '' });
  const [importOpen, setImportOpen] = React.useState(false);
  const [impForm, setImpForm] = React.useState({ title: '', category: 'import', tags: '', content: '', note: '' });
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiForm, setAiForm] = React.useState({ instruction: '', mode: 'expand' });
  const [verPreview, setVerPreview] = React.useState(null);
  const saveRef = React.useRef(function () {});

  const loadDoc = (id) => {
    if (!id) {
      setSel(null);
      setMeta(null);
      setContent('');
      setVersions([]);
      return;
    }
    setLoadingDoc(true);
    Promise.all([
      window.apiFetch(`${API}/design-docs/${encodeURIComponent(id)}`).then((r) => r.json()),
      window.apiFetch(`${API}/design-docs/${encodeURIComponent(id)}/versions`).then((r) => r.json()),
    ])
      .then(([d, v]) => {
        setLoadingDoc(false);
        if (!d.meta && !d.content && d.detail) {
          showToast(String(d.detail), 'err');
          return;
        }
        setSel(id);
        setMeta(d.meta);
        setContent(d.content || '');
        setVersions(v.versions || []);
      })
      .catch(() => {
        setLoadingDoc(false);
        showToast(tr('dd_toast_load_fail'), 'err');
      });
  };

  const saveVersion = () => {
    if (!sel) return;
    setSaving(true);
    window
      .apiFetch(`${API}/design-docs/${encodeURIComponent(sel)}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, note: tr('dd_note_manual') }),
        timeoutMs: 120000,
      })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setSaving(false);
        if (!ok || !d.version) {
          showToast(d.detail || tr('dd_toast_save_fail'), 'err');
          return;
        }
        reloadList();
        loadDoc(sel);
        showToast(tr('dd_toast_saved_as', { v: d.version }), 'ok');
      })
      .catch(() => {
        setSaving(false);
        showToast(tr('dd_toast_save_fail'), 'err');
      });
  };
  saveRef.current = saveVersion;

  React.useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return;
      if (!e.target || e.target.tagName !== 'TEXTAREA') return;
      if (!sel || saving) return;
      e.preventDefault();
      saveRef.current();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, saving]);

  const runAi = () => {
    if (!sel || !aiForm.instruction.trim()) return;
    setSaving(true);
    window
      .apiFetch(`${API}/design-docs/${encodeURIComponent(sel)}/ai-improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: aiForm.instruction.trim(), mode: aiForm.mode }),
        timeoutMs: 300000,
      })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setSaving(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : tr('dd_toast_ai_fail'), 'err');
          return;
        }
        setAiOpen(false);
        setAiForm({ instruction: '', mode: 'expand' });
        reloadList();
        loadDoc(sel);
        showToast(tr('dd_toast_ai_ok', { v: d.version }), 'ok');
      })
      .catch(() => {
        setSaving(false);
        showToast(tr('gen_req_fail'), 'err');
      });
  };

  const createDoc = () => {
    if (!newForm.title.trim()) {
      showToast(tr('dd_toast_need_title'), 'err');
      return;
    }
    const tags = newForm.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    apiFetch(`/design-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newForm.title.trim(),
        category: newForm.category,
        tags,
        version_note: newForm.note.trim() || tr('dd_note_create'),
      }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || !d.id) {
          showToast(d.detail || tr('dd_toast_create_fail'), 'err');
          return;
        }
        setNewOpen(false);
        setNewForm({ title: '', category: 'architecture', tags: '', note: '' });
        reloadList();
        loadDoc(d.id);
        showToast(tr('dd_toast_created'), 'ok');
      })
      .catch(() => showToast(tr('dd_toast_create_fail'), 'err'));
  };

  const importDoc = () => {
    if (!impForm.title.trim() || !impForm.content.trim()) {
      showToast(tr('dd_toast_need_title_body'), 'err');
      return;
    }
    const tags = impForm.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    apiFetch(`/design-docs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: impForm.title.trim(),
        category: impForm.category,
        tags,
        content: impForm.content,
        version_note: impForm.note.trim() || tr('dd_note_import'),
      }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || !d.id) {
          showToast(d.detail || tr('dd_toast_import_fail'), 'err');
          return;
        }
        setImportOpen(false);
        setImpForm({ title: '', category: 'import', tags: '', content: '', note: '' });
        reloadList();
        loadDoc(d.id);
        showToast(tr('dd_toast_imported'), 'ok');
      })
      .catch(() => showToast(tr('dd_toast_import_fail'), 'err'));
  };

  const restoreVer = (v) => {
    if (!sel || !confirm(tr('dd_confirm_restore', { v }))) return;
    apiFetch(`/design-docs/${encodeURIComponent(sel)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: v }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadList();
        loadDoc(sel);
        showToast(tr('dd_toast_restore_ok'), 'ok');
      })
      .catch(() => showToast(tr('dd_toast_restore_fail'), 'err'));
  };

  const delDoc = () => {
    if (!sel || !confirm(tr('dd_confirm_del_doc'))) return;
    apiFetch(`/design-docs/${encodeURIComponent(sel)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        setSel(null);
        setMeta(null);
        setContent('');
        setVersions([]);
        reloadList();
        showToast(tr('auth_toast_deleted'), 'ok');
      })
      .catch(() => showToast(tr('vibe_toast_del_fail'), 'err'));
  };

  const viewVersion = (v) => {
    if (!sel) return;
    apiFetch(`/design-docs/${encodeURIComponent(sel)}/versions/${v}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.content !== undefined) {
          setVerPreview({ v: v, content: d.content });
        }
      })
      .catch(() => {});
  };

  const items = list || [];

  if (ll) {
    return (
      <div>
        <div className="section-title">{tr('dd_title')}</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (el) {
    return (
      <div>
        <div className="section-title">{tr('dd_title')}</div>
        <LoadError message={el} onRetry={reloadList} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">{tr('dd_title')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
            {tr('dd_new_doc')}
          </button>
          <button type="button" className="btn btn-sm btn-muted" style={{ background: '#4f46e5', color: '#fff' }} onClick={() => setImportOpen(true)}>
            {tr('dd_import')}
          </button>
          <RefreshBtn onClick={reloadList} />
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, maxWidth: 900 }}>
        {tr('dd_intro')} <code style={{ color: 'var(--link-inline)' }}>.ai-memory/tech_design/</code>。{tr('dd_intro2')}{' '}
        <code style={{ color: 'var(--link-inline)' }}>ANTHROPIC_API_KEY</code>
        {tr('dd_intro3')}
      </p>
      <div style={{ display: 'flex', gap: 12, minHeight: 420, flexWrap: 'wrap' }}>
        <div className="card scroll-slim" style={{ width: 280, flexShrink: 0, maxHeight: 560, overflowY: 'auto' }}>
          <div className="section-title" style={{ fontSize: 12 }}>
            {tr('dd_docs_count', { n: items.length })}
          </div>
          {items.length === 0 ? (
            <div className="empty">{tr('dd_list_empty')}</div>
          ) : (
            items.map((d) => (
              <div
                key={d.id}
                className={'list-item' + (sel === d.id ? ' vibe-list-selected' : '')}
                style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'stretch' }}
                onClick={() => loadDoc(d.id)}
              >
                <div className="title" style={{ fontSize: 13 }}>
                  {d.title || d.id}
                </div>
                <div className="meta">
                  {d.category} · v{d.current_version || 1}
                </div>
                <div className="meta" style={{ fontSize: 10 }}>
                  {d.id}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="card" style={{ flex: 1, minWidth: 280, minHeight: 400 }}>
          {!sel ? (
            <div className="empty">{tr('dd_pick_doc')}</div>
          ) : loadingDoc ? (
            <PageSkeleton cards={1} />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="section-title" style={{ margin: 0 }}>
                    {(meta && meta.title) || sel}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {tr('dd_doc_meta', { id: sel, cat: (meta && meta.category) || '', ver: (meta && meta.current_version) || '' })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={saveVersion}>
                    {saving ? tr('dd_saving') : tr('dd_save_version')}
                  </button>
                  <button type="button" className="btn btn-sm btn-muted" style={{ background: '#7c3aed', color: '#fff' }} disabled={saving} onClick={() => setAiOpen(true)}>
                    {tr('dd_ai_improve')}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={delDoc}>
                    {tr('gen_delete')}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{tr('dd_versions')}</span>
                {(versions || [])
                  .slice()
                  .reverse()
                  .slice(0, 12)
                  .map((v) => (
                    <button
                      key={v.v}
                      type="button"
                      className={'btn btn-sm' + (v.v === (meta && meta.current_version) ? ' btn-primary' : '')}
                      style={v.v === (meta && meta.current_version) ? {} : { background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg2)', padding: '2px 8px' }}
                      onClick={() => viewVersion(v.v)}
                      title={v.note}
                    >
                      v{v.v}
                    </button>
                  ))}
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                title={tr('dd_editor_title')}
                style={{
                  width: '100%',
                  minHeight: 320,
                  fontFamily: 'ui-monospace,monospace',
                  fontSize: 12,
                  lineHeight: 1.5,
                  background: 'var(--bg3)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                }}
                spellCheck={false}
              />
            </>
          )}
        </div>
      </div>

      {newOpen && (
        <div className="modal-bg" onClick={() => setNewOpen(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3>{tr('dd_modal_new')}</h3>
            <div className="form-group">
              <label>{tr('gen_title')}</label>
              <input value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('dd_label_category')}</label>
              <input value={newForm.category} onChange={(e) => setNewForm({ ...newForm, category: e.target.value })} placeholder={tr('dd_ph_arch')} />
            </div>
            <div className="form-group">
              <label>{tr('dd_label_tags')}</label>
              <input value={newForm.tags} onChange={(e) => setNewForm({ ...newForm, tags: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('dd_label_first_note')}</label>
              <input value={newForm.note} onChange={(e) => setNewForm({ ...newForm, note: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setNewOpen(false)}>
                {tr('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={createDoc}>
                {tr('gen_create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-bg" onClick={() => setImportOpen(false)}>
          <div className="modal" style={{ width: 560, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h3>{tr('dd_modal_import')}</h3>
            <div className="form-group">
              <label>{tr('gen_title')}</label>
              <input value={impForm.title} onChange={(e) => setImpForm({ ...impForm, title: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('dd_label_category')}</label>
              <input value={impForm.category} onChange={(e) => setImpForm({ ...impForm, category: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('dd_label_tags_short')}</label>
              <input value={impForm.tags} onChange={(e) => setImpForm({ ...impForm, tags: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('dd_label_md_body')}</label>
              <textarea value={impForm.content} onChange={(e) => setImpForm({ ...impForm, content: e.target.value })} style={{ minHeight: 180, fontSize: 12 }} placeholder={tr('dd_ph_paste')} />
            </div>
            <div className="form-group">
              <label>{tr('dd_label_file')}</label>
              <input
                type="file"
                accept=".md,.txt,text/markdown,text/plain"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (!f) return;
                  const rd = new FileReader();
                  rd.onload = () => setImpForm((p) => ({ ...p, content: String(rd.result || '') }));
                  rd.readAsText(f);
                }}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setImportOpen(false)}>
                {tr('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={importDoc}>
                {tr('dd_import_do')}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiOpen && (
        <div className="modal-bg" onClick={() => !saving && setAiOpen(false)}>
          <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3>{tr('dd_modal_ai')}</h3>
            <p style={{ fontSize: 11, color: 'var(--text3)' }}>{tr('dd_modal_ai_hint')}</p>
            <div className="form-group">
              <label>{tr('dd_label_mode')}</label>
              <select value={aiForm.mode} onChange={(e) => setAiForm({ ...aiForm, mode: e.target.value })}>
                <option value="expand">{tr('dd_mode_expand')}</option>
                <option value="review">{tr('dd_mode_review')}</option>
                <option value="diagram">{tr('dd_mode_diagram')}</option>
                <option value="free">{tr('dd_mode_free')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{tr('dd_label_instruction')}</label>
              <textarea value={aiForm.instruction} onChange={(e) => setAiForm({ ...aiForm, instruction: e.target.value })} style={{ minHeight: 100 }} placeholder={tr('dd_ph_ai')} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setAiOpen(false)} disabled={saving}>
                {tr('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={runAi} disabled={saving || !aiForm.instruction.trim()}>
                {saving ? tr('dd_generating') : tr('dd_gen_new_version')}
              </button>
            </div>
          </div>
        </div>
      )}

      {verPreview && (
        <div className="modal-bg" onClick={() => setVerPreview(null)}>
          <div className="modal" style={{ width: 640, maxWidth: '96vw', maxHeight: '88vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>{tr('dd_ver_preview', { v: verPreview.v })}</h3>
            <pre
              style={{
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--bg3)',
                padding: 10,
                borderRadius: 8,
                maxHeight: '60vh',
                overflow: 'auto',
              }}
            >
              {verPreview.content}
            </pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setVerPreview(null)}>
                {tr('gen_close')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setContent(verPreview.content);
                  setVerPreview(null);
                  showToast(tr('dd_toast_loaded_editor'), 'ok');
                }}
              >
                {tr('dd_load_editor')}
              </button>
              <button type="button" className="btn btn-sm btn-muted" onClick={() => restoreVer(verPreview.v)}>
                {tr('dd_restore_new')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.DesignDocsManager = DesignDocsManager;
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
