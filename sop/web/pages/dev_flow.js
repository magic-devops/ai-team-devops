/**
 * 研发全流程枢纽：可视化阶段 + 一键跳转 + 低 Token 提示短句（精简要义，引用路径而非贴全文）
 */
function devFlowNavigate(tabId) {
  window.dispatchEvent(new CustomEvent('app-set-tab', { detail: { tab: tabId } }));
}

/** workspace/context.nav 项：与侧栏 page_* 键一致（id 中 - 转为 _） */
function workspaceNavLabel(navId, t) {
  const id = String(navId || '').trim();
  if (!id) return '';
  const key = 'page_' + id.replace(/-/g, '_');
  const s = t(key);
  return s && s !== key ? s : id;
}

function DevFlowHub() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);

  const stages = React.useMemo(
    () => (typeof window.dfStagesT === 'function' ? window.dfStagesT(t) : []),
    [langTick]
  );
  const prompts = React.useMemo(
    () => (typeof window.dfPromptsT === 'function' ? window.dfPromptsT(t) : []),
    [langTick]
  );

  const { data, loading, error, reload } = useFetch(`${API}/dev-flow/summary`);
  const { data: wsCtx, loading: wsLoading, reload: reloadWs } = useFetch(`${API}/system/workspace/context`);
  const [openPrompt, setOpenPrompt] = React.useState(0);
  const [artForm, setArtForm] = React.useState({ title: '', kind: 'url', url: '', path: '', notes: '' });
  const [artBusy, setArtBusy] = React.useState(false);

  const addWorkspaceArtifact = () => {
    const title = (artForm.title || '').trim();
    if (!title) {
      showToast(t('df_toast_title'), 'err');
      return;
    }
    setArtBusy(true);
    const body =
      artForm.kind === 'path'
        ? { title, kind: 'path', path: (artForm.path || '').trim(), notes: (artForm.notes || '').trim() }
        : { title, kind: 'url', url: (artForm.url || '').trim(), notes: (artForm.notes || '').trim() };
    apiFetch(`/system/workspace/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setArtBusy(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : t('df_toast_add_fail'), 'err');
          return;
        }
        showToast(t('df_toast_add_ok'), 'ok');
        setArtForm({ title: '', kind: 'url', url: '', path: '', notes: '' });
        reloadWs();
      })
      .catch(() => {
        setArtBusy(false);
        showToast(t('cli_toast_req_fail'), 'err');
      });
  };

  const delWorkspaceArtifact = (id) => {
    if (!confirm(t('df_confirm_del_bm'))) return;
    apiFetch(`/system/workspace/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadWs();
        showToast(t('df_toast_del_ok'), 'ok');
      })
      .catch(() => showToast(t('df_toast_del_fail'), 'err'));
  };

  const copyText = (txt) => {
    navigator.clipboard.writeText(txt).then(() => showToast(t('df_toast_copy_ok'), 'ok')).catch(() => showToast(t('df_toast_copy_fail'), 'err'));
  };

  const hints = React.useMemo(() => {
    const h = [];
    if (!data) return h;
    if (!(data.requirements && data.requirements.total)) h.push({ type: 'warn', text: t('df_hint_req_empty') });
    else if (data.requirements && data.requirements.p0 > 0) h.push({ type: 'info', text: t('df_hint_p0', { n: data.requirements.p0 }) });
    if (data.tasks && data.tasks.total_all && data.tasks.linked_to_requirement / data.tasks.total_all < 0.25) {
      h.push({ type: 'warn', text: t('df_hint_tasks') });
    }
    if (!(data.design_docs && data.design_docs.count)) h.push({ type: 'info', text: t('df_hint_design') });
    if (data.issues && data.issues.critical_open > 0) h.push({ type: 'err', text: t('df_hint_crit', { n: data.issues.critical_open }) });
    if (!(data.repo_hints && data.repo_hints.dockerfile) && !(data.repo_hints && data.repo_hints.compose)) h.push({ type: 'info', text: t('df_hint_docker') });
    if (((data.agents && data.agents.definitions) || 0) >= 1 && ((data.agents && data.agents.groups) || 0) === 0) {
      h.push({ type: 'info', text: t('df_hint_agents') });
    }
    return h;
  }, [data, langTick]);

  if (loading) {
    return (
      <div>
        <div className="section-title">{t('df_loading')}</div>
        <PageSkeleton cards={3} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">{t('df_loading')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  const R = data.requirements || {};
  const T = data.tasks || {};
  const I = data.issues || {};
  const S = data.sprint;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">{t('df_title')}</div>
        <RefreshBtn onClick={reload} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.6 }}>
        {t('df_intro_1')}
        <strong style={{ color: 'var(--text2)' }}>{t('df_intro_strong')}</strong>
        {t('df_intro_2')}
      </div>

      {!wsLoading && wsCtx && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div className="section-title" style={{ fontSize: 14, margin: 0 }}>
              {t('df_workspace_title')}
            </div>
            <RefreshBtn onClick={reloadWs}>{''}</RefreshBtn>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.55 }}>
            {t('df_workspace_p1')}{' '}
            {t('df_workspace_p2')} <code style={{ color: 'var(--link-inline)' }}>.ai-memory/workspace_artifacts.json</code>
            {' '}
            {t('df_workspace_p3')} <code style={{ color: 'var(--link-inline)' }}>ADMIN_PUBLIC_BASE_URL</code>.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => copyText(wsCtx.project_path || '')}>
              {t('df_copy_root')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => copyText((wsCtx.admin_ui_base || '') + '/#vibe')}>
              {t('df_copy_vibe')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => copyText(wsCtx.api_base || '')}>
              {t('df_copy_api')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => window.open(wsCtx.docs && wsCtx.docs.openapi, '_blank')}>
              {t('df_openapi')}
            </button>
          </div>
          {(wsCtx.nav || []).length > 0 && (
            <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--text2)' }}>
              {t('df_nav_label')}
              {(wsCtx.nav || []).slice(0, 8).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="btn btn-sm"
                  style={{ marginRight: 6, marginBottom: 6, background: 'var(--surface-muted)', color: 'var(--text2)' }}
                  onClick={() => devFlowNavigate(n.id)}
                >
                  {workspaceNavLabel(n.id, t)}
                </button>
              ))}
            </div>
          )}
          {(wsCtx.artifacts || []).length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>{t('df_bookmarks_saved')}</div>
              {(wsCtx.artifacts || []).map((a) => (
                <div key={a.id} className="list-item" style={{ padding: '6px 0', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{a.title}</div>
                    <div className="meta" style={{ wordBreak: 'break-all' }}>
                      {a.kind === 'url' ? a.url : `${a.path}${a.resolved_path ? ' → ' + a.resolved_path : ''}`}
                    </div>
                  </div>
                  {a.kind === 'url' && a.url && (
                    <button type="button" className="btn btn-sm btn-primary" style={{ marginRight: 6 }} onClick={() => window.open(a.url, '_blank')}>
                      {t('df_open')}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => delWorkspaceArtifact(a.id)}>
                    {t('df_del_short')}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ borderTop: '1px solid var(--vibe-divider)', paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>{t('df_add_bookmark')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>{t('df_bm_title')}</label>
                <input value={artForm.title} onChange={(e) => setArtForm({ ...artForm, title: e.target.value })} placeholder={t('df_bm_title_ph')} style={{ fontSize: 12 }} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>{t('df_bm_type')}</label>
                <select value={artForm.kind} onChange={(e) => setArtForm({ ...artForm, kind: e.target.value })} style={{ fontSize: 12 }}>
                  <option value="url">{t('df_bm_kind_url')}</option>
                  <option value="path">{t('df_bm_kind_path')}</option>
                </select>
              </div>
            </div>
            {artForm.kind === 'url' ? (
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11 }}>{t('df_bm_url')}</label>
                <input value={artForm.url} onChange={(e) => setArtForm({ ...artForm, url: e.target.value })} placeholder={t('df_bm_url_ph')} style={{ fontSize: 12, fontFamily: 'monospace' }} />
              </div>
            ) : (
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11 }}>{t('df_bm_path')}</label>
                <input value={artForm.path} onChange={(e) => setArtForm({ ...artForm, path: e.target.value })} placeholder={t('df_bm_path_ph')} style={{ fontSize: 12, fontFamily: 'monospace' }} />
              </div>
            )}
            <button type="button" className="btn btn-sm btn-primary" disabled={artBusy} onClick={addWorkspaceArtifact}>
              {artBusy ? t('df_bm_saving') : t('df_bm_save')}
            </button>
          </div>
        </div>
      )}
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>{t('df_stat_req')}</h3>
          <div className="stat-val">{R.total != null ? R.total : 0}</div>
          <div className="stat-sub">P0 {R.p0 != null ? R.p0 : 0}</div>
        </div>
        <div className="card">
          <h3>{t('df_stat_task')}</h3>
          <div className="stat-val">{T.sprint_scope != null ? T.sprint_scope : 0}</div>
          <div className="stat-sub">
            {t('df_stat_task_sub', {
              d: T.done_sprint != null ? T.done_sprint : 0,
              l: T.linked_to_requirement != null ? T.linked_to_requirement : 0,
              a: T.total_all != null ? T.total_all : 0,
            })}
          </div>
        </div>
        <div className="card">
          <h3>{t('df_stat_issue')}</h3>
          <div className="stat-val">{I.open != null ? I.open : 0}</div>
          <div className="stat-sub">{t('df_stat_issue_sub', { n: I.critical_open != null ? I.critical_open : 0 })}</div>
        </div>
        <div className="card">
          <h3>{t('df_stat_agent')}</h3>
          <div className="stat-val">{data.design_docs && data.design_docs.count != null ? data.design_docs.count : 0}</div>
          <div className="stat-sub">
            {t('df_stat_agent_sub', {
              a: data.agents && data.agents.definitions != null ? data.agents.definitions : 0,
              g: data.agents && data.agents.groups != null ? data.agents.groups : 0,
            })}
          </div>
        </div>
      </div>

      {S && (
        <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>
          <span className="text-secondary">{t('df_sprint')}</span>{' '}
          <strong style={{ color: 'var(--text)' }}>{S.id || '-'}</strong> · {S.goal || t('df_sprint_empty')}
        </div>
      )}

      {hints.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
            {t('df_hints_title')}
          </div>
          {hints.map((x, i) => (
            <div key={i} className={'flow-hint ' + (x.type === 'err' ? 'flow-hint--err' : x.type === 'warn' ? 'flow-hint--warn' : 'flow-hint--info')}>
              {x.text}
            </div>
          ))}
        </div>
      )}

      <div className="section-title" style={{ marginBottom: 10 }}>
        {t('df_stages_title')}
      </div>
      <div className="scroll-slim" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 10, marginBottom: 20 }}>
        {stages.map((st) => (
          <button key={st.id} type="button" className="dev-stage-nav-btn" onClick={() => devFlowNavigate(st.tab)}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{st.icon}</div>
            <div className="dev-stage-nav-title">{st.label}</div>
            <div className="dev-stage-nav-sub">{st.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title" style={{ fontSize: 14 }}>
            {t('df_prompts_title')}
          </div>
          {prompts.map((p, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--vibe-divider)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <button type="button" className="btn btn-sm" style={{ background: 'transparent', color: 'var(--link-inline)', textAlign: 'left', flex: 1 }} onClick={() => setOpenPrompt(openPrompt === i ? -1 : i)}>
                  {openPrompt === i ? '▼' : '▶'} {p.title}
                </button>
                <button type="button" className="btn btn-sm btn-muted" onClick={() => copyText(p.text)}>
                  {t('df_copy')}
                </button>
              </div>
              {openPrompt === i && (
                <pre style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.55, maxHeight: 160, overflow: 'auto' }}>{p.text}</pre>
              )}
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
            {t('df_prompts_footer')}
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ fontSize: 14 }}>
            {t('df_repo_title')}
          </div>
          <ul style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.9, paddingLeft: 18 }}>
            <li>
              {t('df_repo_path')} <code style={{ color: 'var(--text)' }}>{data.project_path}</code>
            </li>
            <li>
              {t('df_repo_specs')} {data.repo_hints && data.repo_hints.specs_dir ? t('df_repo_specs_ok') : t('df_repo_specs_no')}
            </li>
            <li>
              {t('df_repo_df')} {data.repo_hints && data.repo_hints.dockerfile ? t('df_repo_yes') : t('df_repo_dash')}
            </li>
            <li>
              {t('df_repo_compose')} {data.repo_hints && data.repo_hints.compose ? t('df_repo_yes') : t('df_repo_dash')}
            </li>
          </ul>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => devFlowNavigate('knowledge-mgr')}>
              {t('df_nav_kb')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => devFlowNavigate('specs')}>
              {t('df_nav_specs')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => devFlowNavigate('cli')}>
              {t('df_nav_cli')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => devFlowNavigate('models')}>
              {t('df_nav_models')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={() => devFlowNavigate('mcp')}>
              {t('df_nav_mcp')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
