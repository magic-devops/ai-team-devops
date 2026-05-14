/** 编排 — 本机环境检查（独立子页，与「开发工具」列表分离） */
function OrchEnvCheckPanel(props) {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  var onGoTool = props && props.onGoTool ? props.onGoTool : function () {};

  const { data: tools, reload: reloadTools } = useFetch(`${API}/orchestration/tools`);
  const { data: envChecks, reload: reloadEnv } = useFetch(`${API}/orchestration/environment-checks`);

  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiMd, setAiMd] = React.useState('');
  const [aiActions, setAiActions] = React.useState([]);
  const [aiGoal, setAiGoal] = React.useState(function () {
    try {
      return localStorage.getItem('sop_orch_ai_goal') || '';
    } catch (e) {
      return '';
    }
  });
  const [aiToolIdForPlan, setAiToolIdForPlan] = React.useState(null);
  const [instBusy, setInstBusy] = React.useState(null);

  React.useEffect(
    function () {
      try {
        localStorage.setItem('sop_orch_ai_goal', aiGoal);
      } catch (e) {}
    },
    [aiGoal]
  );

  const resolveEnvLinkedToolId = React.useCallback(
    function (envKey) {
      if (!envKey || String(envKey).indexOf('py:') === 0) return null;
      if (!(tools || []).some(function (x) { return x.id === envKey; })) return null;
      return envKey;
    },
    [tools]
  );

  const goToolForEnv = function (envKey) {
    var tid = resolveEnvLinkedToolId(envKey);
    if (!tid) return;
    onGoTool(tid);
  };

  const runAiPlan = function (toolId, forcedGoal) {
    setAiToolIdForPlan(toolId || null);
    setAiBusy(true);
    setAiOpen(true);
    setAiMd('');
    setAiActions([]);
    var payload = { tool_id: toolId || undefined };
    var g = forcedGoal != null && String(forcedGoal).trim() !== '' ? String(forcedGoal).trim() : (aiGoal || '').trim();
    if (g) payload.goal = g;
    else if (!toolId) payload.goal = t('orch_ai_goal_default');
    apiFetch(`/orchestration/tools/ai-install-plan-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (_ref) {
        var ok = _ref.ok;
        var d = _ref.d;
        setAiBusy(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : t('gen_req_fail'), 'err');
          return;
        }
        setAiMd(d.markdown || '');
        setAiActions(Array.isArray(d.actions) ? d.actions : []);
      })
      .catch(function () {
        setAiBusy(false);
        showToast(t('gen_req_fail'), 'err');
      });
  };

  const regenerateAiPlan = function () {
    runAiPlan(aiToolIdForPlan || undefined);
  };

  const openAiForEnv = function (envKey) {
    var g = t('orch_env_ai_goal_prefill', { item: envKey });
    setAiGoal(g);
    runAiPlan(null, g);
  };

  const runGuardedRecipe = function (recipeId) {
    if (!recipeId || !confirm(t('orch_confirm_guard'))) return;
    setInstBusy('recipe:' + recipeId);
    apiFetch(`/orchestration/tools/install-guarded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe_id: recipeId }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { httpOk: r.ok, d: d };
        });
      })
      .then(function (_ref2) {
        var httpOk = _ref2.httpOk;
        var d = _ref2.d;
        setInstBusy(null);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : t('gen_req_fail'), 'err');
          return;
        }
        if (!d.ok) showToast(t('orch_toast_install_cmd_fail'), 'err');
        else showToast(t('orch_toast_install_cmd_ok'), 'ok');
        reloadEnv();
        reloadTools();
      })
      .catch(function () {
        setInstBusy(null);
        showToast(t('gen_req_fail'), 'err');
      });
  };

  var envKeys = envChecks && typeof envChecks === 'object' ? Object.keys(envChecks).sort() : [];

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>{t('orch_env_page_blurb')}</div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div>
            <div className="section-title" style={{ marginBottom: 4 }}>
              {t('orch_env_section')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t('orch_env_section_sub')}</div>
          </div>
          <button type="button" className="btn btn-sm input-surface" onClick={() => reloadEnv()}>
            {t('orch_env_refresh')}
          </button>
        </div>
        {envKeys.length === 0 ? (
          <div className="empty">{t('idx_none')}</div>
        ) : (
          envKeys.map(function (k) {
            var row = envChecks[k];
            var ok = row && row.available;
            var ver = (row && row.version) || '';
            if (!ok && row && row.error_code === 'cmd_not_found') ver = t('orch_env_cmd_not_found', { cmd: row.exe || k });
            else if (!ok && row && row.error_code === 'timeout') ver = t('orch_env_timeout');
            var linked = resolveEnvLinkedToolId(k);
            return (
              <div key={k} className="list-item" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title" style={{ fontFamily: 'ui-monospace,monospace', fontSize: 13 }}>
                    {k}
                  </div>
                  <div className="meta text-tertiary" style={{ fontSize: 11, wordBreak: 'break-word' }}>
                    {ver}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span className={'tag ' + (ok ? 'tag-done' : 'tag-p0')}>{ok ? t('orch_env_ok') : t('orch_env_missing')}</span>
                  {!ok ? (
                    <button type="button" className="btn btn-sm btn-primary" disabled={aiBusy} onClick={() => openAiForEnv(k)}>
                      {t('orch_env_ai_btn')}
                    </button>
                  ) : null}
                  {linked ? (
                    <button type="button" className="btn btn-sm input-surface" onClick={() => goToolForEnv(k)}>
                      {t('orch_env_go_tool')}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {aiOpen && (
        <div className="modal-bg" onClick={() => !aiBusy && setAiOpen(false)}>
          <div
            className="modal"
            style={{
              width: Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 24 : 720),
              maxWidth: '96vw',
              maxHeight: '88vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{t('orch_ai_modal_title')}</h3>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text3)' }}>{t('orch_ai_goal_label')}</label>
              <textarea
                className="textarea-surface"
                rows={2}
                style={{ width: '100%', fontSize: 12 }}
                value={aiGoal}
                onChange={(e) => setAiGoal(e.target.value)}
                placeholder={t('orch_ai_goal_ph')}
                disabled={aiBusy}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-primary" disabled={aiBusy} onClick={regenerateAiPlan}>
                {t('orch_ai_regenerate')}
              </button>
            </div>
            {aiBusy ? (
              <div className="empty" style={{ marginBottom: 12 }}>
                …
              </div>
            ) : null}
            {!aiBusy && aiActions && aiActions.length > 0 ? (
              <div className="card" style={{ marginBottom: 12, padding: '10px 12px' }}>
                <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
                  {t('orch_ai_actions_title')}
                </div>
                {aiActions.map(function (act, i) {
                  return (
                    <div key={i} className="list-item" style={{ alignItems: 'flex-start', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="meta" style={{ fontSize: 12 }}>
                          {act.label}
                        </div>
                        <code style={{ fontSize: 10, color: 'var(--link-inline)' }}>{act.recipe_id}</code>
                        {act.argv_shell ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{t('orch_argv_caption')}</div>
                              <button
                                type="button"
                                className="btn btn-sm input-surface"
                                style={{ fontSize: 10, padding: '2px 8px' }}
                                onClick={() =>
                                  navigator.clipboard
                                    .writeText(act.argv_shell)
                                    .then(() => showToast(t('vibe_toast_copy_ok'), 'ok'))
                                    .catch(() => showToast(t('vibe_toast_copy_fail'), 'err'))
                                }
                              >
                                {t('orch_argv_copy')}
                              </button>
                            </div>
                            <pre
                              style={{
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: 10,
                                lineHeight: 1.4,
                                margin: 0,
                                padding: 6,
                                background: 'var(--bg3)',
                                borderRadius: 4,
                                color: 'var(--text2)',
                                wordBreak: 'break-all',
                              }}
                            >
                              {act.argv_shell}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                      <button type="button" className="btn btn-sm btn-primary" disabled={!!instBusy} onClick={() => runGuardedRecipe(act.recipe_id)}>
                        {t('orch_run_recipe_btn')}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <pre
              className="doc-plain-pre"
              style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, maxHeight: '48vh', overflow: 'auto', marginBottom: 12 }}
            >
              {aiMd || (aiBusy ? '…' : '')}
            </pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" disabled={aiBusy} onClick={() => setAiOpen(false)}>
                {t('gen_close')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={aiBusy || !aiMd}
                onClick={() =>
                  navigator.clipboard.writeText(aiMd).then(() => showToast(t('vibe_toast_copy_ok'), 'ok')).catch(() => showToast(t('vibe_toast_copy_fail'), 'err'))
                }
              >
                {t('df_copy')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrchestrationManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const [tab, setTab] = React.useState('tools');
  const [orchNavFocus, setOrchNavFocus] = React.useState(null);
  const [wide, setWide] = React.useState(function () {
    return typeof window !== 'undefined' && window.innerWidth >= 880;
  });
  React.useEffect(function () {
    function onR() {
      setWide(window.innerWidth >= 880);
    }
    window.addEventListener('resize', onR);
    return function () {
      window.removeEventListener('resize', onR);
    };
  }, []);
  const tabs = [
    ['tools', t('orch_tab_tools')],
    ['envcheck', t('orch_tab_env')],
    ['workflows', t('orch_tab_wf')],
    ['quality', t('orch_tab_quality')],
    ['versions', t('orch_tab_versions')],
  ];
  const navBtn = function (id, label) {
    var active = tab === id;
    return (
      <button
        key={id}
        type="button"
        className={'btn btn-sm' + (active ? ' btn-primary' : '')}
        style={
          active
            ? wide
              ? { width: '100%', justifyContent: 'flex-start', textAlign: 'left' }
              : {}
            : wide
              ? { width: '100%', background: 'var(--bg4)', color: 'var(--text3)', justifyContent: 'flex-start', textAlign: 'left' }
              : { background: 'var(--bg4)', color: 'var(--text3)' }
        }
        onClick={function () {
          setTab(id);
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div
      style={
        wide
          ? { display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }
          : {}
      }
    >
      <div
        style={
          wide
            ? {
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 12,
                background: 'var(--bg3)',
                position: 'sticky',
                top: 8,
              }
            : { marginBottom: 12 }
        }
      >
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{t('orch_layout_nav_hint')}</div>
        <nav style={{ display: 'flex', flexDirection: wide ? 'column' : 'row', flexWrap: wide ? 'nowrap' : 'wrap', gap: 6 }}>
          {tabs.map(function (pair) {
            return navBtn(pair[0], pair[1]);
          })}
        </nav>
      </div>
      <div style={{ minWidth: 0 }}>
        {tab === 'tools' && (
          <DevToolsPanel
            orchNavFocus={orchNavFocus}
            onConsumedOrchNavFocus={function () {
              setOrchNavFocus(null);
            }}
          />
        )}
        {tab === 'envcheck' && (
          <OrchEnvCheckPanel
            onGoTool={function (id) {
              setOrchNavFocus({ toolId: id });
              setTab('tools');
            }}
          />
        )}
        {tab === 'workflows' && <WorkflowPanel />}
        {tab === 'quality' && <QualityConfigPanel />}
        {tab === 'versions' && <VersionPanel />}
      </div>
    </div>
  );
}

function DevToolsPanel(props) {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  var orchNavFocus = props && props.orchNavFocus;
  var onConsumedOrchNavFocus = props && props.onConsumedOrchNavFocus ? props.onConsumedOrchNavFocus : function () {};
  /** 将受控安装 API 的机器可读 stderr/log 前缀转为界面语言说明（并保留原始日志）。 */
  const humanizeInstallResult = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.error_code === 'timeout') return t('orch_install_timeout');
    if (obj.error_code === 'cmd_not_found') return t('orch_env_cmd_not_found', { cmd: obj.exe || '' });
    var e = String(obj.stderr || '').trim();
    var L = String(obj.log || '').trim();
    if (e === 'timeout' || L === 'timeout' || e === '执行超时' || L === '执行超时') return t('orch_install_timeout');
    if (e.indexOf('cmd_not_found:') === 0) return t('orch_env_cmd_not_found', { cmd: e.slice('cmd_not_found:'.length) });
    if (L.indexOf('cmd_not_found:') === 0) {
      var first = L.split('\n')[0] || L;
      if (first.indexOf('cmd_not_found:') === 0) return t('orch_env_cmd_not_found', { cmd: first.slice('cmd_not_found:'.length) });
    }
    return null;
  };
  const { data, loading: lt, error: et, reload } = useFetch(`${API}/orchestration/tools`);
  const { data: meta, reload: reloadMeta } = useFetch(`${API}/orchestration/tools/meta`);
  const { data: cfg, loading: lc, error: ec, reload: reloadCfg } = useFetch(`${API}/orchestration/config`);
  const [catFilter, setCatFilter] = React.useState('all');
  const [toolSearch, setToolSearch] = React.useState('');
  const [addOpen, setAddOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(null);
  const [form, setForm] = React.useState({ id: '', name: '', cmd: '', description: '', category: 'agent_cli' });
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiMd, setAiMd] = React.useState('');
  const [aiActions, setAiActions] = React.useState([]);
  const [aiGoal, setAiGoal] = React.useState(function () {
    try {
      return localStorage.getItem('sop_orch_ai_goal') || '';
    } catch (e) {
      return '';
    }
  });
  const [aiToolIdForPlan, setAiToolIdForPlan] = React.useState(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [instBusy, setInstBusy] = React.useState(null);
  const [logOpen, setLogOpen] = React.useState(false);
  const [logTitle, setLogTitle] = React.useState('');
  const [logBody, setLogBody] = React.useState('');
  const [consoleText, setConsoleText] = React.useState('');
  const [histItems, setHistItems] = React.useState([]);
  const [navWide, setNavWide] = React.useState(function () {
    return typeof window !== 'undefined' && window.innerWidth >= 860;
  });
  const [catCollapsed, setCatCollapsed] = React.useState(function () {
    try {
      return localStorage.getItem('orch-devtools-cat-collapsed') === '1';
    } catch (e) {
      return false;
    }
  });

  const loading = lt || lc;
  const errText = et || ec;

  const loadInstallLogs = () => {
    apiFetch(`/orchestration/tools/install-logs?limit=40`)
      .then((r) => r.json())
      .then((d) => setHistItems(d.items || []))
      .catch(() => {});
  };

  const reloadAll = () => {
    reload();
    reloadCfg();
    reloadMeta();
    loadInstallLogs();
  };

  React.useEffect(function () {
    loadInstallLogs();
  }, []);

  React.useEffect(function () {
    function onR() {
      setNavWide(window.innerWidth >= 860);
    }
    window.addEventListener('resize', onR);
    return function () {
      window.removeEventListener('resize', onR);
    };
  }, []);

  const toggleCatCollapse = () => {
    setCatCollapsed(function (c) {
      var n = !c;
      try {
        localStorage.setItem('orch-devtools-cat-collapsed', n ? '1' : '0');
      } catch (e) {}
      return n;
    });
  };

  React.useEffect(
    function () {
      try {
        localStorage.setItem('sop_orch_ai_goal', aiGoal);
      } catch (e) {}
    },
    [aiGoal]
  );

  const catCounts = React.useMemo(
    function () {
      var out = { all: (data || []).length, agent_cli: 0, ide: 0, assistant: 0, chain: 0 };
      var known = { agent_cli: 1, ide: 1, assistant: 1, chain: 1 };
      (data || []).forEach(function (x) {
        var k = x.category || 'agent_cli';
        if (known[k]) out[k]++;
        else out.chain++;
      });
      return out;
    },
    [data]
  );

  const filtered = React.useMemo(
    function () {
      if (!data) return [];
      var base =
        catFilter === 'all'
          ? [...data]
          : data.filter(function (x) {
              return (x.category || 'agent_cli') === catFilter;
            });
      var q = (toolSearch || '').trim().toLowerCase();
      if (q) {
        base = base.filter(function (x) {
          var blob = [x.name, x.id, x.cmd, x.description, x.guard_install_recipe].join(' ').toLowerCase();
          return blob.indexOf(q) >= 0;
        });
      }
      return base.sort(function (a, b) {
        return String(a.name || a.id).localeCompare(String(b.name || b.id));
      });
    },
    [data, catFilter, toolSearch]
  );

  const scrollToLinkedTool = function (toolId) {
    window.requestAnimationFrame(function () {
      var el = document.getElementById('orch-tool-' + toolId);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  React.useEffect(
    function () {
      if (!orchNavFocus || !orchNavFocus.toolId) return;
      if (loading) return;
      if (!data) return;
      var tid = orchNavFocus.toolId;
      var tool = (data || []).find(function (x) { return x.id === tid; });
      if (!tool) {
        onConsumedOrchNavFocus();
        return;
      }
      var cat = tool.category || 'chain';
      if (cat !== 'agent_cli' && cat !== 'ide' && cat !== 'assistant' && cat !== 'chain') cat = 'chain';
      setCatFilter(cat);
      setToolSearch('');
      scrollToLinkedTool(tid);
      onConsumedOrchNavFocus();
    },
    [orchNavFocus, data, loading, onConsumedOrchNavFocus]
  );

  const showInstallLog = (title, d, opts) => {
    const body =
      (d && d.log) ||
      [d && d.stdout ? '--- stdout ---\n' + d.stdout : '', d && d.stderr ? '--- stderr ---\n' + d.stderr : ''].filter(Boolean).join('\n') ||
      JSON.stringify(d || {});
    const hint = humanizeInstallResult(d);
    const full = hint ? hint + '\n\n---\n' + body : body;
    setLogTitle(title);
    setLogBody(full);
    setConsoleText(full);
    if (!opts || opts.openModal !== false) {
      setLogOpen(true);
    }
  };

  const openHistRow = (row) => {
    const body =
      (row && row.log) ||
      [row && row.stdout ? '--- stdout ---\n' + row.stdout : '', row && row.stderr ? '--- stderr ---\n' + row.stderr : '']
        .filter(Boolean)
        .join('\n') ||
      JSON.stringify(row || {});
    const hint = humanizeInstallResult(row || {});
    const full = hint ? hint + '\n\n---\n' + body : body;
    const label = (row && (row.tool_id || row.recipe_id || row.kind)) || '';
    setLogTitle(t('orch_install_log_title') + (label ? ' · ' + label : ''));
    setLogBody(full);
    setConsoleText(full);
  };

  const openLogModalFromConsole = () => {
    setLogBody(consoleText);
    setLogTitle(t('orch_install_console'));
    setLogOpen(true);
  };

  const setDefault = (id) => {
    apiFetch(`/orchestration/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_tool: id }) })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadCfg();
        showToast(t('orch_toast_default_ok'), 'ok');
      })
      .catch(() => showToast(t('orch_toast_default_fail'), 'err'));
  };

  const openAdd = () => {
    setForm({ id: '', name: '', cmd: '', description: '', category: 'agent_cli' });
    setAddOpen(true);
  };
  const openEdit = (tool) => {
    setEditOpen(tool);
    setForm({
      id: tool.id,
      name: tool.name || '',
      cmd: tool.cmd || '',
      description: tool.description || '',
      category: tool.category || 'agent_cli',
    });
  };

  const saveNew = () => {
    apiFetch(`/orchestration/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: form.id.trim(),
        name: form.name.trim(),
        cmd: form.cmd.trim(),
        description: form.description.trim(),
        category: form.category || 'agent_cli',
      }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : t('gen_create_fail'), 'err');
          return;
        }
        setAddOpen(false);
        reloadAll();
        showToast(t('orch_toast_added'), 'ok');
      })
      .catch(() => showToast(t('gen_req_fail'), 'err'));
  };

  const saveEdit = () => {
    const id = editOpen && editOpen.id;
    if (!id) return;
    apiFetch(`/orchestration/tools/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        cmd: form.cmd.trim(),
        description: form.description.trim(),
        category: form.category || 'agent_cli',
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        setEditOpen(null);
        reloadAll();
        showToast(t('orch_toast_saved'), 'ok');
      })
      .catch(() => showToast(t('gen_save_fail'), 'err'));
  };

  const delCustom = (id) => {
    if (!confirm(t('orch_confirm_del_custom', { id }))) return;
    apiFetch(`/orchestration/tools/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast(t('orch_toast_deleted'), 'ok');
      })
      .catch(() => showToast(t('gen_req_fail'), 'err'));
  };

  const hideBuiltin = (id) => {
    if (!confirm(t('orch_confirm_hide', { id }))) return;
    apiFetch(`/orchestration/tools/hide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast(t('orch_toast_hidden'), 'ok');
      })
      .catch(() => showToast(t('gen_req_fail'), 'err'));
  };

  const unhideBuiltin = (id) => {
    apiFetch(`/orchestration/tools/unhide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast(t('orch_toast_restored'), 'ok');
      })
      .catch(() => showToast(t('gen_req_fail'), 'err'));
  };

  const runAiPlan = (toolId, forcedGoal) => {
    setAiToolIdForPlan(toolId || null);
    setAiBusy(true);
    setAiOpen(true);
    setAiMd('');
    setAiActions([]);
    var payload = { tool_id: toolId || undefined };
    var g = forcedGoal != null && String(forcedGoal).trim() !== '' ? String(forcedGoal).trim() : (aiGoal || '').trim();
    if (g) payload.goal = g;
    else if (!toolId) payload.goal = t('orch_ai_goal_default');
    apiFetch(`/orchestration/tools/ai-install-plan-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setAiBusy(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : t('gen_req_fail'), 'err');
          return;
        }
        setAiMd(d.markdown || '');
        setAiActions(Array.isArray(d.actions) ? d.actions : []);
      })
      .catch(() => {
        setAiBusy(false);
        showToast(t('gen_req_fail'), 'err');
      });
  };

  const regenerateAiPlan = () => {
    runAiPlan(aiToolIdForPlan || undefined);
  };

  const runGuardedRecipe = (recipeId) => {
    if (!recipeId || !confirm(t('orch_confirm_guard'))) return;
    setInstBusy('recipe:' + recipeId);
    setConsoleText((prev) => (prev ? prev + '\n\n' : '') + t('orch_install_running') + '\nrecipe: ' + recipeId);
    apiFetch(`/orchestration/tools/install-guarded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipe_id: recipeId }),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setInstBusy(null);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : t('gen_req_fail'), 'err');
          return;
        }
        showInstallLog(t('orch_install_log_title') + ' · ' + recipeId, d, { openModal: false });
        if (!d.ok) showToast(t('orch_toast_install_cmd_fail'), 'err');
        else showToast(t('orch_toast_install_cmd_ok'), 'ok');
        reloadAll();
      })
      .catch(() => {
        setInstBusy(null);
        showToast(t('gen_req_fail'), 'err');
      });
  };

  const unhideAllBuiltins = () => {
    if (!confirm(t('orch_unhide_all') + '?')) return;
    apiFetch(`/orchestration/tools/unhide-all`, { method: 'POST' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast(t('orch_unhide_all_ok'), 'ok');
      })
      .catch(() => showToast(t('gen_req_fail'), 'err'));
  };

  const runAiAutoInstall = (toolId) => {
    if (!confirm(t('orch_confirm_ai_auto'))) return;
    setInstBusy('ai:' + toolId);
    setConsoleText(t('orch_install_running') + '\ntool: ' + toolId);
    apiFetch(`/orchestration/tools/ai-auto-install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_id: toolId }),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setInstBusy(null);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : t('gen_req_fail'), 'err');
          return;
        }
        showInstallLog(t('orch_install_log_title') + ' · ' + toolId, d, { openModal: false });
        if (!d.ok) showToast(t('orch_toast_install_cmd_fail'), 'err');
        else showToast(t('orch_toast_install_cmd_ok'), 'ok');
        reloadAll();
      })
      .catch(() => {
        setInstBusy(null);
        showToast(t('gen_req_fail'), 'err');
      });
  };

  if (loading) return <div><PageSkeleton cards={1}/></div>;
  if (errText) return <LoadError message={errText} onRetry={reloadAll}/>;

  const hidden = (meta && meta.hidden) || [];
  const CAT_DEFS = [
    { id: 'all', icon: '📦', label: t('orch_cat_all') },
    { id: 'agent_cli', icon: '🤖', label: t('orch_cat_agent_cli') },
    { id: 'ide', icon: '💻', label: t('orch_cat_ide') },
    { id: 'assistant', icon: '✨', label: t('orch_cat_assistant') },
    { id: 'chain', icon: '⛓️', label: t('orch_cat_chain') },
  ];
  const CAT_KEYS = CAT_DEFS.map(function (d) {
    return [d.id, d.label];
  });

  var collapsedStrip = navWide && catCollapsed;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="section-title">
            {t('orch_title_tools')} · {t('orch_default_suffix')}: <span style={{ color: 'var(--link-inline)' }}>{(cfg && cfg.default_tool) || 'claude'}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{t('orch_sub_tools')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <RefreshBtn onClick={reloadAll} />
          <button type="button" className="btn btn-sm" style={{ background: '#4f46e5', color: '#fff' }} disabled={aiBusy} onClick={() => runAiPlan(null)}>
            {aiBusy ? '…' : t('orch_ai_env_btn')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
            {t('orch_add_tool')}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12, padding: '12px 14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{t('orch_ai_goal_label')}</div>
            <textarea
              className="textarea-surface"
              rows={2}
              style={{ width: '100%', fontSize: 12 }}
              value={aiGoal}
              onChange={(e) => setAiGoal(e.target.value)}
              placeholder={t('orch_ai_goal_ph')}
            />
          </div>
          {hidden.length > 0 ? (
            <button type="button" className="btn btn-sm btn-muted" onClick={unhideAllBuiltins}>
              {t('orch_unhide_all')}
            </button>
          ) : null}
        </div>
      </div>

      {!navWide ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.02em' }}>{t('orch_cat_nav_title')}</span>
            <span style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.45, maxWidth: 440 }}>{t('orch_catnav_hint')}</span>
          </div>
          <div
            className="scroll-slim"
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 6,
              margin: '0 -2px',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {CAT_DEFS.map(function (def) {
              var n = catCounts[def.id] != null ? catCounts[def.id] : 0;
              var active = catFilter === def.id;
              return (
                <button
                  key={def.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={function () {
                    setCatFilter(def.id);
                  }}
                  style={{
                    flex: '0 0 auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 14px',
                    borderRadius: 999,
                    border: '1px solid ' + (active ? 'color-mix(in srgb, var(--accent) 55%, var(--border))' : 'var(--border)'),
                    background: active ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 26%, var(--bg2)), var(--bg3))' : 'var(--bg2)',
                    color: active ? 'var(--text)' : 'var(--text2)',
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 22px color-mix(in srgb, var(--accent) 14%, transparent)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 15 }} aria-hidden="true">
                    {def.icon}
                  </span>
                  <span>{def.label}</span>
                  <span style={{ fontSize: 11, opacity: 0.88, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        style={
          navWide
            ? {
                display: 'grid',
                gridTemplateColumns: collapsedStrip ? '58px minmax(0, 1fr)' : 'min(236px, 27vw) minmax(0, 1fr)',
                gap: 18,
                alignItems: 'start',
              }
            : {}
        }
      >
        {navWide ? (
          <aside
            style={{
              position: 'sticky',
              top: 12,
              alignSelf: 'start',
              borderRadius: 14,
              border: '1px solid var(--border)',
              background: 'linear-gradient(165deg, color-mix(in srgb, var(--bg2) 90%, var(--accent) 7%) 0%, var(--bg3) 100%)',
              boxShadow: '0 8px 36px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.06)',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            <button
              type="button"
              onClick={toggleCatCollapse}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsedStrip ? 'center' : 'space-between',
                gap: 6,
                padding: collapsedStrip ? '10px 6px' : '10px 12px',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                background: 'color-mix(in srgb, var(--bg3) 75%, transparent)',
                color: 'var(--text2)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
              title={collapsedStrip ? t('orch_catnav_expand') : t('orch_catnav_collapse')}
            >
              {collapsedStrip ? (
                <span aria-hidden="true" style={{ fontSize: 15 }}>
                  ▸
                </span>
              ) : (
                <React.Fragment>
                  <span style={{ textTransform: 'uppercase' }}>{t('orch_cat_nav_title')}</span>
                  <span aria-hidden="true" style={{ fontSize: 12, opacity: 0.65 }}>
                    ◀
                  </span>
                </React.Fragment>
              )}
            </button>
            <div style={{ padding: collapsedStrip ? '8px 6px 12px' : '12px 10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CAT_DEFS.map(function (def) {
                var n = catCounts[def.id] != null ? catCounts[def.id] : 0;
                var active = catFilter === def.id;
                return (
                  <button
                    key={def.id}
                    type="button"
                    title={collapsedStrip ? def.label + ' (' + n + ')' : def.label + ' · ' + n}
                    aria-current={active ? 'page' : undefined}
                    onClick={function () {
                      setCatFilter(def.id);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: collapsedStrip ? 0 : 10,
                      width: '100%',
                      padding: collapsedStrip ? '11px 6px' : '11px 12px',
                      justifyContent: collapsedStrip ? 'center' : 'flex-start',
                      borderRadius: 12,
                      border: '1px solid ' + (active ? 'color-mix(in srgb, var(--accent) 42%, var(--border))' : 'transparent'),
                      background: active
                        ? 'linear-gradient(105deg, color-mix(in srgb, var(--accent) 22%, transparent), color-mix(in srgb, var(--accent) 6%, var(--bg3)))'
                        : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text2)',
                      fontSize: 13,
                      fontWeight: active ? 650 : 500,
                      cursor: 'pointer',
                      boxShadow: active ? 'inset 3px 0 0 var(--accent), 0 1px 0 rgba(255,255,255,.05)' : 'none',
                      transition: 'background .18s, border-color .18s, color .18s, box-shadow .18s',
                    }}
                  >
                    <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
                      {def.icon}
                    </span>
                    {!collapsedStrip ? (
                      <React.Fragment>
                        <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>{def.label}</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            color: active ? 'var(--text)' : 'var(--text3)',
                            background: active ? 'rgba(255,255,255,.07)' : 'var(--bg4)',
                            padding: '3px 9px',
                            borderRadius: 999,
                            border: active ? '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' : '1px solid transparent',
                          }}
                        >
                          {n}
                        </span>
                      </React.Fragment>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}

        <div style={{ minWidth: 0, width: navWide ? 'auto' : '100%' }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <input
                type="search"
                className="input-surface"
                style={{ flex: '1 1 200px', minWidth: 120, fontSize: 12 }}
                placeholder={t('orch_tool_search_ph')}
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                aria-label={t('orch_tool_search_ph')}
              />
              <span className="text-tertiary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                {t('orch_tool_search_count', { n: filtered.length })}
              </span>
              {toolSearch ? (
                <button type="button" className="btn btn-sm input-surface" onClick={() => setToolSearch('')}>
                  {t('orch_tool_search_clear')}
                </button>
              ) : null}
            </div>
            {filtered.length === 0 ? (
              <div className="empty" style={{ fontSize: 12 }}>
                {t('orch_tool_search_empty')}
              </div>
            ) : filtered.map((tool) => (
              <div key={tool.id} id={'orch-tool-' + tool.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="title">{tool.name}</span>
                    <span className={'tag ' + (tool.available ? 'tag-done' : 'tag-p0')}>{tool.available ? t('orch_installed') : t('orch_not_installed')}</span>
                    {cfg && cfg.default_tool === tool.id && <span className="tag tag-progress">{t('orch_tag_default')}</span>}
                    <span className="tag tag-p2">{tool.source === 'custom' ? t('orch_tag_custom') : t('orch_tag_builtin')}</span>
                    <span className="tag tag-p3">
                      {(CAT_DEFS.find(function (d) {
                        return d.id === (tool.category || 'agent_cli');
                      }) || {}).label || tool.category}
                    </span>
                  </div>
                  <div className="meta">
                    {tool.description} · {t('orch_cmd_label')}: <code style={{ color: 'var(--link-inline)' }}>{tool.cmd}</code>
                    {tool.guard_install_recipe && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text3)' }}>
                        {t('orch_recipe')}: {tool.guard_install_recipe}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setDefault(tool.id)}>
                    {t('orch_set_default')}
                  </button>
                  <button type="button" className="btn btn-sm input-surface" style={{ color: 'var(--text)' }} onClick={() => openEdit(tool)}>
                    {t('orch_edit')}
                  </button>
                  <button type="button" className="btn btn-sm input-surface" style={{ color: 'var(--text)' }} disabled={aiBusy} onClick={() => runAiPlan(tool.id)}>
                    {t('orch_ai_tool_hint')}
                  </button>
                  {tool.guard_install_recipe && !tool.available && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!!instBusy}
                      onClick={() => runAiAutoInstall(tool.id)}
                    >
                      {instBusy === 'ai:' + tool.id ? t('orch_installing') : t('orch_one_click_install')}
                    </button>
                  )}
                  {!tool.guard_install_recipe && !tool.available && (
                    <span className="text-tertiary" style={{ fontSize: 10, maxWidth: 160, textAlign: 'right' }}>
                      {t('orch_no_recipe_hint')}
                    </span>
                  )}
                  {tool.source === 'custom' && (
                    <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={() => delCustom(tool.id)}>
                      {t('gen_delete')}
                    </button>
                  )}
                  {tool.source === 'builtin' && (
                    <button type="button" className="btn btn-sm" style={{ background: '#451a1a', color: '#fca5a5' }} onClick={() => hideBuiltin(tool.id)}>
                      {t('orch_hide')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div>
                <div className="section-title" style={{ marginBottom: 4 }}>
                  {t('orch_install_console')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t('orch_install_console_sub')}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <button type="button" className="btn btn-sm input-surface" onClick={() => loadInstallLogs()}>
                  {t('orch_refresh_logs')}
                </button>
                <button type="button" className="btn btn-sm btn-primary" disabled={!consoleText} onClick={openLogModalFromConsole}>
                  {t('orch_open_log_modal')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm input-surface"
                  disabled={!consoleText}
                  onClick={() =>
                    navigator.clipboard
                      .writeText(consoleText)
                      .then(() => showToast(t('vibe_toast_copy_ok'), 'ok'))
                      .catch(() => showToast(t('vibe_toast_copy_fail'), 'err'))
                  }
                >
                  {t('orch_copy_log')}
                </button>
              </div>
            </div>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11,
                lineHeight: 1.45,
                color: 'var(--text2)',
                maxHeight: '220px',
                overflow: 'auto',
                background: 'var(--bg3)',
                padding: 10,
                borderRadius: 6,
                marginBottom: 12,
              }}
            >
              {consoleText || t('orch_console_placeholder')}
            </pre>
            <div className="section-title" style={{ fontSize: 13, marginBottom: 6 }}>
              {t('orch_install_history')}
            </div>
            {histItems.length === 0 ? (
              <div className="empty" style={{ fontSize: 12 }}>
                {t('idx_none')}
              </div>
            ) : (
              [...histItems].reverse().map((hi, idx) => {
                const ok = hi && hi.ok;
                const sub = hi.tool_id || hi.recipe_id || hi.kind || '';
                const ts = hi.ts || '';
                return (
                  <div key={idx + '-' + ts} className="list-item" style={{ alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="title" style={{ fontSize: 12, wordBreak: 'break-word' }}>
                        {ts} {sub ? '· ' + sub : ''}
                      </div>
                      <div className="meta text-tertiary" style={{ fontSize: 11 }}>
                        {hi.kind || ''}
                      </div>
                    </div>
                    <span className={'tag ' + (ok ? 'tag-done' : 'tag-p0')}>{ok ? t('orch_hist_ok') : t('orch_hist_fail')}</span>
                    <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: 8 }} onClick={() => openHistRow(hi)}>
                      {t('orch_hist_open')}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {hidden.length > 0 && (
        <div className="card" style={{marginTop: 12}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>{t('orch_hidden_title')}</div>
            <button type="button" className="btn btn-sm btn-primary" onClick={unhideAllBuiltins}>
              {t('orch_unhide_all')}
            </button>
          </div>
          {hidden.map((hid) => (
            <div key={hid} className="list-item">
              <div className="title">{hid}</div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => unhideBuiltin(hid)}>
                {t('orch_restore')}
              </button>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <div className="modal-bg" onClick={() => setAddOpen(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3>{t('orch_add_modal_title')}</h3>
            <div className="form-group">
              <label>{t('orch_label_id')}</label>
              <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder={t('orch_ph_id')} />
            </div>
            <div className="form-group">
              <label>{t('orch_label_name')}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('orch_label_cmd_exec')}</label>
              <input value={form.cmd} onChange={(e) => setForm({ ...form, cmd: e.target.value })} placeholder={t('orch_ph_cmd_tool')} />
            </div>
            <div className="form-group">
              <label>{t('orch_label_category')}</label>
              <select value={form.category || 'agent_cli'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CAT_KEYS.filter(([k]) => k !== 'all').map(([k, lab]) => (
                  <option key={k} value={k}>
                    {lab}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('orch_label_desc')}</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 64 }} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setAddOpen(false)}>
                {t('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={saveNew}>
                {t('gen_save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="modal-bg" onClick={() => setEditOpen(null)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              {t('orch_edit_modal_title')} · {editOpen.id}
            </h3>
            <p style={{ fontSize: 11, color: '#64748b' }}>{editOpen.source === 'builtin' ? t('orch_edit_builtin_note') : t('orch_edit_custom_note')}</p>
            <div className="form-group">
              <label>{t('orch_label_name')}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('orch_cmd_label')}</label>
              <input value={form.cmd} onChange={(e) => setForm({ ...form, cmd: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('orch_label_category')}</label>
              <select value={form.category || 'agent_cli'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CAT_KEYS.filter(([k]) => k !== 'all').map(([k, lab]) => (
                  <option key={k} value={k}>
                    {lab}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('orch_label_desc')}</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 64 }} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setEditOpen(null)}>
                {t('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={saveEdit}>
                {t('gen_save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiOpen && (
        <div className="modal-bg" onClick={() => !aiBusy && setAiOpen(false)}>
          <div
            className="modal"
            style={{
              width: Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 24 : 720),
              maxWidth: '96vw',
              maxHeight: '88vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{t('orch_ai_modal_title')}</h3>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text3)' }}>{t('orch_ai_goal_label')}</label>
              <textarea
                className="textarea-surface"
                rows={2}
                style={{ width: '100%', fontSize: 12 }}
                value={aiGoal}
                onChange={(e) => setAiGoal(e.target.value)}
                placeholder={t('orch_ai_goal_ph')}
                disabled={aiBusy}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-primary" disabled={aiBusy} onClick={regenerateAiPlan}>
                {t('orch_ai_regenerate')}
              </button>
            </div>
            {aiBusy ? (
              <div className="empty" style={{ marginBottom: 12 }}>
                …
              </div>
            ) : null}
            {!aiBusy && aiActions && aiActions.length > 0 ? (
              <div className="card" style={{ marginBottom: 12, padding: '10px 12px' }}>
                <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
                  {t('orch_ai_actions_title')}
                </div>
                {aiActions.map(function (act, i) {
                  return (
                    <div key={i} className="list-item" style={{ alignItems: 'flex-start', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="meta" style={{ fontSize: 12 }}>
                          {act.label}
                        </div>
                        <code style={{ fontSize: 10, color: 'var(--link-inline)' }}>{act.recipe_id}</code>
                        {act.argv_shell ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{t('orch_argv_caption')}</div>
                              <button
                                type="button"
                                className="btn btn-sm input-surface"
                                style={{ fontSize: 10, padding: '2px 8px' }}
                                onClick={() =>
                                  navigator.clipboard
                                    .writeText(act.argv_shell)
                                    .then(() => showToast(t('vibe_toast_copy_ok'), 'ok'))
                                    .catch(() => showToast(t('vibe_toast_copy_fail'), 'err'))
                                }
                              >
                                {t('orch_argv_copy')}
                              </button>
                            </div>
                            <pre
                              style={{
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: 10,
                                lineHeight: 1.4,
                                margin: 0,
                                padding: 6,
                                background: 'var(--bg3)',
                                borderRadius: 4,
                                color: 'var(--text2)',
                                wordBreak: 'break-all',
                              }}
                            >
                              {act.argv_shell}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                      <button type="button" className="btn btn-sm btn-primary" disabled={!!instBusy} onClick={() => runGuardedRecipe(act.recipe_id)}>
                        {t('orch_run_recipe_btn')}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <pre
              className="doc-plain-pre"
              style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, maxHeight: '48vh', overflow: 'auto', marginBottom: 12 }}
            >
              {aiMd || (aiBusy ? '…' : '')}
            </pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" disabled={aiBusy} onClick={() => setAiOpen(false)}>
                {t('gen_close')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={aiBusy || !aiMd}
                onClick={() =>
                  navigator.clipboard.writeText(aiMd).then(() => showToast(t('vibe_toast_copy_ok'), 'ok')).catch(() => showToast(t('vibe_toast_copy_fail'), 'err'))
                }
              >
                {t('df_copy')}
              </button>
            </div>
          </div>
        </div>
      )}

      {logOpen && (
        <div className="modal-bg" onClick={() => setLogOpen(false)}>
          <div
            className="modal"
            style={{
              width: Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 24 : 720),
              maxWidth: '96vw',
              maxHeight: '88vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ wordBreak: 'break-word' }}>{logTitle}</h3>
            <p style={{ fontSize: 11, color: 'var(--text3)' }}>{t('orch_install_log_sub')}</p>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11,
                lineHeight: 1.45,
                color: 'var(--text2)',
                maxHeight: '55vh',
                overflow: 'auto',
                background: 'var(--bg3)',
                padding: 10,
                borderRadius: 6,
              }}
            >
              {logBody}
            </pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setLogOpen(false)}>
                {t('gen_close')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(logBody)
                    .then(() => showToast(t('vibe_toast_copy_ok'), 'ok'))
                    .catch(() => showToast(t('vibe_toast_copy_fail'), 'err'))
                }
              >
                {t('orch_copy_log')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const { data, loading, error, reload } = useFetch(`${API}/orchestration/workflows`);
  const { data: toolRows } = useFetch(`${API}/orchestration/tools`);
  const { data: agents } = useFetch(`${API}/agents/builtin`);
  const [modal, setModal] = React.useState(false);
  const [form, setForm] = React.useState({ id: '', name: '', description: '', dev_tool: 'claude', steps: [] });

  const save = () => {
    var wid = (form.id || '').trim();
    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(wid)) {
      showToast(t('orch_wf_id_invalid'), 'err');
      return;
    }
    apiFetch(`/orchestration/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, id: wid }),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        if (!httpOk) {
          var msg = (d && (typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? JSON.stringify(d.detail) : d.detail)) || t('orch_wf_toast_save_fail');
          showToast(String(msg), 'err');
          return;
        }
        setModal(false);
        reload();
        showToast(t('orch_wf_toast_ok'), 'ok');
      })
      .catch(() => showToast(t('orch_wf_toast_save_fail'), 'err'));
  };
  const del = (id) => {
    if (!confirm(t('orch_wf_confirm_del', { id }))) return;
    apiFetch(`/orchestration/workflows/${id}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast(t('orch_wf_toast_del_ok'), 'ok');
      })
      .catch(() => showToast(t('orch_wf_toast_del_fail'), 'err'));
  };
  const addStep = () => {
    const id0 = (agents && agents[0] && agents[0].id) || 'planner';
    setForm({ ...form, steps: [...form.steps, { agent: id0, tool: form.dev_tool, skill: '', prompt_template: '' }] });
  };

  if (loading) return <div><PageSkeleton cards={1} /></div>;
  if (error) return <LoadError message={error} onRetry={reload} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">{t('orch_wf_title')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <RefreshBtn onClick={reload} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setModal(true);
              setForm({ id: '', name: '', description: '', dev_tool: 'claude', steps: [] });
            }}
          >
            {t('orch_wf_new_btn')}
          </button>
        </div>
      </div>
      <div className="card">
        {(data || []).length === 0 ? (
          <div className="empty">{t('orch_wf_empty')}</div>
        ) : (
          (data || []).map((w) => (
            <div key={w.id} className="list-item">
              <div style={{ flex: 1 }}>
                <div className="title">{w.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>
                  <code>{w.id}</code>
                </div>
                <div className="meta">
                  {t('orch_wf_meta', {
                    desc: w.description || '—',
                    n: (w.steps && w.steps.length) || 0,
                    tool: w.dev_tool || '—',
                  })}
                </div>
              </div>
              <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={() => del(w.id)}>
                {t('orch_wf_delete')}
              </button>
            </div>
          ))
        )}
      </div>
      {modal && (
        <div className="modal-bg" onClick={() => setModal(false)}>
          <div className="modal" style={{ width: 560, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>{t('orch_wf_modal_title')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>{t('orch_wf_label_id')}</label>
                <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder={t('orch_wf_ph_id')} />
              </div>
              <div className="form-group">
                <label>{t('orch_wf_label_name')}</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>{t('orch_wf_label_desc')}</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{t('orch_wf_label_devtool')}</label>
              <select value={form.dev_tool} onChange={(e) => setForm({ ...form, dev_tool: e.target.value })}>
                {(toolRows || []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {!row.available ? t('orch_wf_not_installed') : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>{t('orch_wf_steps_label', { n: form.steps.length })}</span>
                <button type="button" className="btn btn-sm btn-primary" onClick={addStep}>
                  {t('orch_wf_add_step')}
                </button>
              </div>
              {form.steps.map((step, i) => {
                const agentOptions = agents || [];
                const stepAgent = step.agent || '';
                const inList = agentOptions.some((a) => a.id === stepAgent || a.name === stepAgent || a.role === stepAgent);
                return (
                <div key={i} style={{ background: 'var(--bg3)', borderRadius: 6, padding: 8, marginBottom: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                    <select
                      style={{
                        background: 'var(--bg4)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        padding: '4px',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                      value={stepAgent}
                      onChange={(e) => {
                        const s = [...form.steps];
                        s[i] = { ...s[i], agent: e.target.value };
                        setForm({ ...form, steps: s });
                      }}
                      aria-label={t('orch_wf_label_agent')}
                    >
                      {!inList && stepAgent ? (
                        <option value={stepAgent}>
                          {stepAgent} · {t('orch_wf_legacy_suffix')}
                        </option>
                      ) : null}
                      {agentOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      style={{
                        background: 'var(--bg4)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                      value={step.skill || ''}
                      onChange={(e) => {
                        const s = [...form.steps];
                        s[i] = { ...s[i], skill: e.target.value };
                        setForm({ ...form, steps: s });
                      }}
                      placeholder={t('orch_wf_ph_skill')}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      style={{
                        flex: 1,
                        background: 'var(--bg4)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                      value={step.prompt_template || ''}
                      onChange={(e) => {
                        const s = [...form.steps];
                        s[i] = { ...s[i], prompt_template: e.target.value };
                        setForm({ ...form, steps: s });
                      }}
                      placeholder={t('orch_wf_ph_prompt')}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ background: '#7f1d1d', color: '#fca5a5' }}
                      onClick={() => {
                        const s = form.steps.filter((_, j) => j !== i);
                        setForm({ ...form, steps: s });
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
              })}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setModal(false)}>
                {t('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={save}>
                {t('gen_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QualityConfigPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const QC_FIELDS = ['min_coverage', 'max_complexity', 'min_confidence', 'max_retries', 'review_threshold'];
  const { data, loading, error, reload } = useFetch(`${API}/orchestration/config`);
  const [form, setForm] = React.useState({});
  React.useEffect(() => {
    if (data) setForm(data.quality_config || {});
  }, [data]);
  const save = () => {
    apiFetch(`/orchestration/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quality_config: form }) })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast(t('orch_qc_toast_ok'), 'ok');
      })
      .catch(() => showToast(t('orch_qc_toast_fail'), 'err'));
  };

  if (loading) return <PageSkeleton cards={1} />;
  if (error) return <LoadError message={error} onRetry={reload} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div className="section-title">{t('orch_qc_title')}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{t('orch_qc_sub')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <RefreshBtn onClick={reload} />
          <button type="button" className="btn btn-primary btn-sm" onClick={save}>
            {t('orch_qc_save')}
          </button>
        </div>
      </div>
      <div className="card">
        {QC_FIELDS.map((k) => (
          <div key={k} className="list-item">
            <div style={{ flex: 1 }}>
              <div className="title">{t('orch_qc_' + k)}</div>
            </div>
            <input
              style={{
                width: 100,
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '4px 8px',
                borderRadius: 6,
                fontSize: 12,
                textAlign: 'right',
              }}
              value={form[k] || ''}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              placeholder={t('orch_qc_ph_' + k)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const { data, loading, error, reload } = useFetch(`${API}/orchestration/versions`);
  const [modal, setModal] = React.useState(false);
  const [form, setForm] = React.useState({ tag: '', message: '' });
  const create = () => {
    apiFetch(`/orchestration/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        if (!httpOk) {
          var msg = (d && (typeof d.detail === 'string' ? d.detail : d.message)) || t('orch_ver_toast_fail');
          showToast(String(msg), 'err');
          return;
        }
        if (d && d.ok) {
          setModal(false);
          reload();
          showToast(t('orch_ver_toast_ok'), 'ok');
        } else showToast((d && d.detail) || t('orch_ver_toast_fail'), 'err');
      })
      .catch(() => showToast(t('orch_ver_toast_req_fail'), 'err'));
  };
  if (loading) return <div><PageSkeleton cards={1} /></div>;
  if (error) return <LoadError message={error} onRetry={reload} />;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">{t('orch_ver_title')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <RefreshBtn onClick={reload} />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setModal(true);
              setForm({ tag: 'v1.0.0', message: '' });
            }}
          >
            {t('orch_ver_new')}
          </button>
        </div>
      </div>
      <div className="card">
        {(data || []).length === 0 ? (
          <div className="empty">{t('orch_ver_empty')}</div>
        ) : (
          (data || []).map((tag) => (
            <div key={tag} className="list-item">
              <div className="title">{tag}</div>
              <span className="tag tag-p2">{t('orch_ver_tag_badge')}</span>
            </div>
          ))
        )}
      </div>
      {modal && (
        <div className="modal-bg" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('orch_ver_modal_title')}</h3>
            <div className="form-group">
              <label>{t('orch_ver_label_tag')}</label>
              <input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder={t('orch_ver_ph_tag')} />
            </div>
            <div className="form-group">
              <label>{t('orch_ver_label_msg')}</label>
              <input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder={t('orch_ver_ph_msg')} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setModal(false)}>
                {t('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={create}>
                {t('orch_ver_create_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
