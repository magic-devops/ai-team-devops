/** 从模型输出中提取 HTML 片段（优先 ```html 代码块） */
function vibeExtractHtmlFromOutput(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/```html\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  const m2 = text.match(/```\s*([\s\S]*?)```/);
  if (m2 && /<html[\s>]/i.test(m2[1])) return m2[1].trim();
  if (/<!DOCTYPE\s+html/i.test(text) || /<html[\s>]/i.test(text)) {
    const start = text.search(/<(!DOCTYPE|html)/i);
    if (start >= 0) return text.slice(start).trim();
  }
  return '';
}

/** 提取 fenced code blocks */
function vibeExtractCodeBlocks(text) {
  const out = [];
  if (!text) return out;
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const lang = (m[1] || '').trim() || 'text';
    out.push({ lang, code: m[2].replace(/\n$/, '') });
  }
  return out;
}

function vibeEscapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function vibeMarkdownToSafeHtml(md) {
  if (!md) return '';
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    try {
      marked.setOptions({ breaks: true, gfm: true });
      const raw = marked.parse(String(md));
      return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    } catch (e) {
      return `<pre class="vibe-md-fallback">${vibeEscapeHtml(md)}</pre>`;
    }
  }
  return `<pre class="vibe-md-fallback">${vibeEscapeHtml(md)}</pre>`;
}

function VibeMarkdownView({ markdown, className, style }) {
  const ref = React.useRef(null);
  const html = React.useMemo(() => vibeMarkdownToSafeHtml(markdown || ''), [markdown]);

  React.useLayoutEffect(() => {
    if (!ref.current || typeof hljs === 'undefined') return;
    ref.current.querySelectorAll('pre code').forEach((el) => {
      try {
        hljs.highlightElement(el);
      } catch (e) {
        /* ignore */
      }
    });
  }, [html]);

  return <div ref={ref} className={className || 'vibe-md-view scroll-slim'} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 代码块语法高亮（hljs） */
function VibeHighlightedCode({ lang, code }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    if (!ref.current || typeof hljs === 'undefined') return;
    const raw = String(code || '');
    const lg = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
    try {
      const { value } = hljs.highlight(raw, { language: lg });
      ref.current.innerHTML = value;
      ref.current.className = `hljs language-${lg}`;
    } catch (e) {
      ref.current.textContent = raw;
      ref.current.className = 'hljs';
    }
  }, [lang, code]);
  return (
    <pre className="scroll-slim" style={{ maxHeight: '58vh', overflow: 'auto', fontSize: 12, margin: 0, background: 'var(--surface-input)', border: '1px solid var(--vibe-divider)', borderRadius: 8, padding: 10 }}>
      <code ref={ref} />
    </pre>
  );
}

let vibeDefaultSessionBootstrapStarted = false;

function VibeCoding() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const [tab, setTab] = React.useState('ide');
  const [focusSessionId, setFocusSessionId] = React.useState(null);
  void langTick;
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ['ide', tr('vibe_tab_ide')],
          ['sessions', tr('vibe_tab_sessions')],
          ['templates', tr('vibe_tab_templates')],
          ['history', tr('vibe_tab_history')],
          ['cli', tr('vibe_tab_cli')],
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
      {tab === 'ide' && <VibeIdePanel focusSessionId={focusSessionId} onConsumedFocus={() => setFocusSessionId(null)} />}
      {tab === 'sessions' && <VibeSessionsManager onOpenInIde={(id) => { setFocusSessionId(id); setTab('ide'); }} />}
      {tab === 'templates' && <VibeTemplatesPanel />}
      {tab === 'history' && <VibeHistoryPanel />}
      {tab === 'cli' && <VibeCliShortcutPanel />}
    </div>
  );
}

function VibeSessionsManager({ onOpenInIde }) {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/vibe/sessions`);
  const [q, setQ] = React.useState('');
  const sessions = (data && data.sessions) || [];
  const filtered = sessions.filter((s) => {
    const line = `${s.title || ''} ${s.id || ''}`.toLowerCase();
    return line.includes(q.trim().toLowerCase());
  });

  const exportOne = (s) => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vibe-session-${s.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(tr('vibe_toast_exported'), 'ok');
  };

  const del = (id) => {
    if (!confirm(tr('vibe_sess_del_confirm'))) return;
    apiFetch(`/vibe/sessions/${id}`, { method: 'DELETE' })
      .then(() => {
        reload();
        showToast(tr('vibe_toast_deleted'), 'ok');
      })
      .catch(() => showToast(tr('vibe_toast_del_fail'), 'err'));
  };

  const rename = (s) => {
    const titleIn = window.prompt(tr('vibe_sess_rename_prompt'), s.title || s.id);
    if (titleIn == null || !titleIn.trim()) return;
    apiFetch(`/vibe/sessions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleIn.trim() }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        reload();
        showToast(tr('vibe_prompt_ok'), 'ok');
      })
      .catch(() => showToast(tr('vibe_prompt_save_fail'), 'err'));
  };

  if (loading) {
    return (
      <div>
        <div className="section-title">{tr('vibe_sess_title')}</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">{tr('vibe_sess_title')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">{tr('vibe_sess_hist_title')}</div>
        <RefreshBtn onClick={reload} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>{tr('vibe_sess_search_label')}</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('vibe_sess_search_ph')} />
        </div>
      </div>
      <div className="card scroll-slim" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty">{tr('vibe_sess_empty')}</div>
        ) : (
          filtered.map((s) => (
            <div key={s.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="title" style={{ fontWeight: 700 }}>
                    {s.title || s.id}
                  </div>
                  <div className="meta">
                    {tr('vibe_sess_meta', {
                      id: s.id,
                      ts: (s.updated_at || '').slice(0, 19),
                      n: Array.isArray(s.messages) ? s.messages.length : 0,
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenInIde(s.id)}>
                    {tr('vibe_sess_open')}
                  </button>
                  <button type="button" className="btn btn-sm btn-muted" onClick={() => rename(s)}>
                    {tr('vibe_sess_rename')}
                  </button>
                  <button type="button" className="btn btn-sm btn-muted" onClick={() => exportOne(s)}>
                    {tr('vibe_sess_export_json')}
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => del(s.id)}>
                    {tr('vibe_sess_del')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VibeWorkspaceTree({ onOpenFile }) {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const [path, setPath] = React.useState('');
  const [items, setItems] = React.useState([]);
  const [err, setErr] = React.useState(null);

  const load = React.useCallback(() => {
    apiFetch(`/vibe/workspace/list?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setItems(d.items || []);
        setErr(null);
      })
      .catch(() => setErr(typeof window.t === 'function' ? window.t('vibe_tree_err') : 'vibe_tree_err'));
  }, [path]);

  React.useEffect(() => {
    load();
  }, [load]);

  const parentPath = () => {
    if (!path) return;
    const i = path.lastIndexOf('/');
    setPath(i < 0 ? '' : path.slice(0, i));
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, wordBreak: 'break-all' }}>
        📁 {path || tr('vibe_tree_root')}
      </div>
      {err && <div style={{ fontSize: 11, color: '#fca5a5', marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button type="button" className="btn btn-sm btn-muted" onClick={parentPath} disabled={!path}>
          {tr('vibe_tree_up')}
        </button>
        <button type="button" className="btn btn-sm btn-muted" onClick={load}>
          {tr('vibe_tree_refresh')}
        </button>
      </div>
      <div className="scroll-slim" style={{ maxHeight: 280, overflowY: 'auto', fontSize: 12 }}>
        {items.length === 0 ? (
          <div className="empty" style={{ padding: 12, fontSize: 11 }}>
            {tr('vibe_tree_empty')}
          </div>
        ) : (
          items.map((it) => (
            <div
              key={it.path}
              className="list-item"
              style={{ padding: '6px 8px', cursor: 'pointer' }}
              onClick={() => {
                if (it.dir) setPath(it.path);
                else onOpenFile(it.path, it.name);
              }}
            >
              <span className={it.dir ? 'vibe-tree-icon-dir' : 'vibe-tree-icon-file'}>{it.dir ? '📂' : '📄'}</span>
              <span className="vibe-tree-name">{it.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VibeCliShortcutPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const [cmd, setCmd] = React.useState(() => (typeof window.t === 'function' ? window.t('vibe_cli_default_cmd') : 'claude --print "Describe your task"'));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">{tr('vibe_cli_title')}</div>
      </div>
        <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
          {tr('vibe_cli_p1')}
        </div>
        <textarea
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          className="textarea-surface"
          style={{ width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: 12, borderRadius: 6, padding: 8 }}
        />
        <button
          type="button"
          className="btn btn-sm btn-muted"
          style={{ marginTop: 8 }}
          onClick={() => navigator.clipboard.writeText(cmd).then(() => showToast(tr('vibe_toast_copy_ok'), 'ok')).catch(() => showToast(tr('vibe_toast_copy_fail'), 'err'))}
        >
          {tr('vibe_cli_copy')}
        </button>
      </div>
      <div className="card" style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
        <div><strong style={{ color: 'var(--text2)' }}>{tr('vibe_cli_hint1')}</strong>{tr('vibe_cli_hint1b')}</div>
        <div><strong style={{ color: 'var(--text2)' }}>{tr('vibe_cli_hint2')}</strong>{tr('vibe_cli_hint2b')}</div>
        <div><strong style={{ color: 'var(--text2)' }}>{tr('vibe_cli_hint3')}</strong>{tr('vibe_cli_hint3b')}</div>
      </div>
    </div>
  );
}

function VibeIdePanel({ focusSessionId, onConsumedFocus }) {
  const { data: tools, loading: lt, error: et, reload: rt } = useFetch(`${API}/orchestration/tools`);
  const { data: models, loading: lm, error: em, reload: rm } = useFetch(`${API}/models`);
  const { data: agentGroups, loading: lg, error: eg, reload: rg } = useFetch(`${API}/agents/groups`);
  const { data: sessListData, loading: ls, error: es, reload: rs } = useFetch(`${API}/vibe/sessions`);
  const { data: termAllow } = useFetch(`${API}/vibe/terminal/allowlist`);

  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);

  const [sessionId, setSessionId] = React.useState(null);
  const [sessionQuery, setSessionQuery] = React.useState('');
  const [memory, setMemory] = React.useState('');
  const [previewHtml, setPreviewHtml] = React.useState('');
  const [messages, setMessages] = React.useState([]);
  const [form, setForm] = React.useState({ prompt: '', tool: 'claude', model: '', mode: 'chat', expertGroupId: '' });
  const [attachments, setAttachments] = React.useState([]);
  const [running, setRunning] = React.useState(false);
  const [output, setOutput] = React.useState(null);
  const [rightTab, setRightTab] = React.useState('out');
  const [termCommand, setTermCommand] = React.useState('git status');
  const [termCwd, setTermCwd] = React.useState('');
  const [termTimeout, setTermTimeout] = React.useState(120);
  const [termResult, setTermResult] = React.useState(null);
  const [termBusy, setTermBusy] = React.useState(false);
  const [savedCmds, setSavedCmds] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('vibe-saved-cmds') || '[]'); } catch (_) { return []; }
  });
  const [savedCmdLabel, setSavedCmdLabel] = React.useState('');
  const [codeBlockIdx, setCodeBlockIdx] = React.useState(0);
  const [docPickPath, setDocPickPath] = React.useState(null);
  const [workspaceFile, setWorkspaceFile] = React.useState(null);
  const fileRef = React.useRef(null);
  const docRef = React.useRef(null);
  const memoryTimer = React.useRef(null);
  const leftCardRef = React.useRef(null);
  const midWrapRef = React.useRef(null);
  const rightCardRef = React.useRef(null);

  const [colLeft, setColLeft] = React.useState(() => {
    try {
      const v = parseInt(localStorage.getItem('vibe-ide-col-left'), 10);
      return Number.isFinite(v) ? Math.min(Math.max(v, 180), 560) : 250;
    } catch (_) {
      return 250;
    }
  });
  const [colRight, setColRight] = React.useState(() => {
    try {
      const v = parseInt(localStorage.getItem('vibe-ide-col-right'), 10);
      return Number.isFinite(v) ? Math.min(Math.max(v, 220), 800) : 380;
    } catch (_) {
      return 380;
    }
  });
  const [ideZoom, setIdeZoom] = React.useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('vibe-ide-zoom'));
      return Number.isFinite(v) ? Math.min(Math.max(v, 0.72), 1.6) : 1;
    } catch (_) {
      return 1;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem('vibe-ide-col-left', String(colLeft));
    } catch (_) {}
  }, [colLeft]);
  React.useEffect(() => {
    try {
      localStorage.setItem('vibe-ide-col-right', String(colRight));
    } catch (_) {}
  }, [colRight]);
  React.useEffect(() => {
    try {
      localStorage.setItem('vibe-ide-zoom', String(ideZoom));
    } catch (_) {}
  }, [ideZoom]);

  React.useEffect(() => {
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, []);

  const beginResize = (edge, ev) => {
    ev.preventDefault();
    const sx = ev.clientX;
    const sL = colLeft;
    const sR = colRight;
    const onMove = (e) => {
      const dx = e.clientX - sx;
      if (edge === 'left') setColLeft(Math.min(560, Math.max(180, sL + dx)));
      else setColRight(Math.min(800, Math.max(220, sR - dx)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const panelLoading = lt || lm || ls || lg;
  const panelError = et || em || es || eg;
  const reloadDeps = () => {
    rt();
    rm();
    rs();
    rg();
  };

  const availableTools = (tools || []).filter((tool) => ['agent_cli', 'ide', 'assistant'].includes(tool.category));
  const allModels = [...((models && models.builtin) || []), ...((models && models.custom) || [])];
  const sessions = (sessListData && sessListData.sessions) || [];
  const sessionsFiltered = sessions.filter((s) => {
    if (!sessionQuery.trim()) return true;
    const line = `${s.title || ''} ${s.id}`.toLowerCase();
    return line.includes(sessionQuery.trim().toLowerCase());
  });

  React.useEffect(() => {
    if (focusSessionId) {
      setSessionId(focusSessionId);
      if (onConsumedFocus) onConsumedFocus();
    }
  }, [focusSessionId, onConsumedFocus]);

  React.useEffect(() => {
    if (!sessionId && sessions.length > 0) {
      setSessionId(sessions[0].id);
    }
  }, [sessionId, sessions]);

  React.useEffect(() => {
    if (ls || es || vibeDefaultSessionBootstrapStarted) return;
    const list = sessListData && sessListData.sessions;
    if (!Array.isArray(list) || list.length > 0) return;
    vibeDefaultSessionBootstrapStarted = true;
    apiFetch(`/vibe/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: tr('vibe_default_session') }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.session && d.session.id) {
          setSessionId(d.session.id);
          rs();
        } else vibeDefaultSessionBootstrapStarted = false;
      })
      .catch(() => {
        vibeDefaultSessionBootstrapStarted = false;
      });
  }, [ls, es, sessListData, rs]);

  const loadSession = React.useCallback((id) => {
    if (!id) return;
    apiFetch(`/vibe/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s) => {
        setMemory(s.memory || '');
        const msgs = Array.isArray(s.messages) ? s.messages : [];
        setMessages(msgs);
        setPreviewHtml(s.preview_html || '');
        setAttachments(Array.isArray(s.attachments) ? s.attachments : []);
        const lastA = [...msgs].reverse().find((m) => m.role === 'assistant');
        if (lastA && lastA.text) setOutput({ ok: true, content: lastA.text });
        else setOutput(null);
      })
      .catch(() => showToast(tr('vibe_toast_load_fail'), 'err'));
  }, []);

  React.useEffect(() => {
    if (sessionId) loadSession(sessionId);
  }, [sessionId, loadSession]);

  const persistSession = React.useCallback(
    (patch) => {
      if (!sessionId) return;
      apiFetch(`/vibe/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => {});
    },
    [sessionId]
  );

  const scheduleMemorySave = (val) => {
    setMemory(val);
    if (memoryTimer.current) clearTimeout(memoryTimer.current);
    memoryTimer.current = setTimeout(() => {
      persistSession({ memory: val });
    }, 600);
  };

  const selectedGroup = (agentGroups || []).find((g) => g.id === form.expertGroupId);
  const expertSystem = selectedGroup
    ? tr('vibe_expert_system', {
        name: selectedGroup.name,
        desc: selectedGroup.description || '',
        agents: (selectedGroup.agents || []).join(', '),
      })
    : '';

  const uploadPaths = attachments.map((a) => a.path).filter(Boolean);
  const uploadFileUrl = (path) => `${API}/vibe/upload-file?path=${encodeURIComponent(path)}`;

  const rawOutputText = output ? String(output.content || output.output || output.error || '') : '';
  const codeBlocks = React.useMemo(() => vibeExtractCodeBlocks(rawOutputText), [rawOutputText]);

  React.useEffect(() => {
    setCodeBlockIdx(0);
  }, [rawOutputText]);

  const imageAttachments = attachments.filter((a) => a.mime && a.mime.startsWith('image/'));
  const docAttachments = attachments.filter((a) => {
    const n = (a.name || '').toLowerCase();
    return n.endsWith('.pdf') || n.endsWith('.md') || n.endsWith('.txt') || (a.mime && a.mime.includes('pdf'));
  });

  const run = () => {
    if (!form.prompt.trim()) return;
    if (!sessionId) {
      showToast(tr('vibe_toast_need_session'), 'err');
      return;
    }
    setRunning(true);
    setOutput(null);
    const modeSystem = tr('vibe_mode_hint_' + form.mode) || tr('vibe_mode_hint_chat');
    const endpoint = form.tool === 'direct-llm' ? `${API}/vibe/llm` : `${API}/vibe/run`;
    const mem = memory.trim() || null;
    const body =
      form.tool === 'direct-llm'
        ? {
            prompt: form.prompt,
            model: form.model || (models && models.default) || 'claude-opus-4-7',
            max_tokens: 8192,
            system: modeSystem,
            memory_context: mem,
            expert_system: expertSystem || null,
            attachment_paths: uploadPaths,
          }
        : {
            prompt: form.prompt,
            tool: form.tool,
            model: form.model || null,
            mode: form.mode,
            memory_context: mem,
            expert_system: expertSystem || null,
            attachment_paths: uploadPaths,
            context_files: [],
          };
    apiFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setOutput(d);
        setRunning(false);
        if (!ok || d.ok === false) {
          showToast(d.detail || d.error || tr('vibe_toast_run_fail'), 'err');
          return;
        }
        showToast(tr('vibe_toast_run_ok'), 'ok');
        const textOut = d.content || d.output || '';
        const now = new Date().toISOString();
        const nextMsgs = [
          ...messages,
          { role: 'user', text: form.prompt.slice(0, 8000), ts: now },
          { role: 'assistant', text: String(textOut).slice(0, 120000), ts: now },
        ];
        setMessages(nextMsgs);
        const html = vibeExtractHtmlFromOutput(String(textOut));
        const patch = { messages: nextMsgs };
        if (html) {
          setPreviewHtml(html);
          patch.preview_html = html;
          setRightTab('preview');
        }
        persistSession(patch);
      })
      .catch(() => {
        setRunning(false);
        showToast(tr('vibe_toast_network_err'), 'err');
      });
  };

  const newSession = () => {
    const title = window.prompt(tr('vibe_sess_create_title_prompt'), tr('vibe_new_session')) || tr('vibe_new_session');
    apiFetch(`/vibe/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.session) {
          setSessionId(d.session.id);
          setAttachments([]);
          setOutput(null);
          rs();
          showToast(tr('vibe_toast_created'), 'ok');
        }
      })
      .catch(() => showToast(tr('vibe_toast_create_fail'), 'err'));
  };

  const renameCurrentSession = () => {
    if (!sessionId) return;
    const cur = sessions.find((s) => s.id === sessionId);
    const titleIn = window.prompt(tr('vibe_rename_new_title'), (cur && cur.title) || sessionId);
    if (titleIn == null || !titleIn.trim()) return;
    apiFetch(`/vibe/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleIn.trim() }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        rs();
        showToast(tr('vibe_prompt_ok'), 'ok');
      })
      .catch(() => showToast(tr('vibe_toast_op_fail'), 'err'));
  };

  const exportCurrentSession = () => {
    const payload = {
      id: sessionId,
      title: (sessions.find((s) => s.id === sessionId) || {}).title,
      memory,
      messages,
      preview_html: previewHtml,
      attachments,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vibe-session-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(tr('vibe_toast_exported'), 'ok');
  };

  const deleteCurrentSession = () => {
    if (!sessionId || !confirm(tr('vibe_del_session_confirm'))) return;
    apiFetch(`/vibe/sessions/${sessionId}`, { method: 'DELETE' })
      .then(() => {
        setSessionId(null);
        setMessages([]);
        setMemory('');
        setPreviewHtml('');
        setAttachments([]);
        setOutput(null);
        rs();
        showToast(tr('vibe_toast_deleted'), 'ok');
      })
      .catch(() => showToast(tr('vibe_toast_del_fail'), 'err'));
  };

  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !sessionId) return;
    const fd = new FormData();
    fd.append('session', sessionId);
    files.forEach((f) => fd.append('files', f));
    apiFetch(`/vibe/upload`, { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok && d.detail) throw new Error();
        const add = (d.files || []).map((f) => ({ ...f, id: f.path }));
        setAttachments((a) => {
          const next = [...a, ...add];
          persistSession({ attachments: next });
          return next;
        });
        showToast(tr('vibe_toast_uploaded', { n: add.length }), 'ok');
      })
      .catch(() => showToast(tr('vibe_toast_upload_fail'), 'err'));
  };

  const extractDocToPrompt = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    showToast(tr('vibe_doc_extracting'), 'ok');
    apiFetch(`/knowledge/extract-text`, { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((d) => {
        const extracted = d.text || d.content || '';
        if (!extracted) {
          showToast(tr('vibe_doc_no_text'), 'err');
          return;
        }
        setForm((f) => ({
          ...f,
          prompt: f.prompt + (f.prompt ? '\n\n' : '') + tr('vibe_doc_snippet_prefix') + '\n' + extracted.slice(0, 50000),
        }));
        showToast(tr('vibe_doc_inserted'), 'ok');
      })
      .catch(() => showToast(tr('vibe_doc_extract_fail'), 'err'));
  };

  const openWorkspaceFile = (relPath, name) => {
    apiFetch(`/vibe/workspace/file?path=${encodeURIComponent(relPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setWorkspaceFile({ ...d, name: name || relPath });
        setRightTab('wfile');
      })
      .catch(() => {
        setWorkspaceFile(null);
        showToast(tr('vibe_file_read_fail'), 'err');
      });
  };

  const rightTabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      className={`btn btn-sm ${rightTab === id ? 'btn-primary' : ''}`}
      style={rightTab !== id ? { background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg2)' } : {}}
      onClick={() => setRightTab(id)}
    >
      {label}
    </button>
  );

  const execTerminal = () => {
    const cmd = (termCommand || '').trim();
    if (!cmd) {
      showToast(tr('vibe_term_need_cmd'), 'err');
      return;
    }
    setTermBusy(true);
    apiFetch(`/vibe/terminal/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: cmd,
        cwd: (termCwd || '').trim(),
        timeout_sec: Math.min(600, Math.max(3, Number(termTimeout) || 120)),
      }),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setTermBusy(false);
        if (!httpOk) {
          const msg = typeof d.detail === 'string' ? d.detail : Array.isArray(d.detail) ? d.detail.map((x) => x.msg || x).join('; ') : JSON.stringify(d.detail || d);
          setTermResult({ ok: false, returncode: -1, stdout: '', stderr: msg, argv: [], cwd_display: '' });
          showToast(tr('vibe_term_rejected'), 'err');
          return;
        }
        setTermResult(d);
        if (!d.ok) showToast(d.stderr ? tr('vibe_term_stderr_fail') : tr('vibe_term_nonzero'), 'err');
      })
      .catch(() => {
        setTermBusy(false);
        showToast(tr('vibe_term_req_fail'), 'err');
      });
  };

  if (panelLoading) {
    return (
      <div>
        <div className="section-title">{tr('vibe_ide_loading')}</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (panelError) {
    return (
      <div>
        <div className="section-title">{tr('vibe_ide_loading')}</div>
        <LoadError message={panelError} onRetry={reloadDeps} />
      </div>
    );
  }

  void langTick;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">{tr('vibe_ide_title')}</div>
        <RefreshBtn onClick={reloadDeps} />
      </div>

      <div className="card vibe-ide-toolbar" style={{ marginBottom: 12, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>{tr('vibe_toolbar_workspace')}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{tr('vibe_toolbar_zoom')}</span>
        <button type="button" className="btn btn-sm" title={tr('vibe_zoom_out_title')} onClick={() => setIdeZoom((z) => Math.max(0.72, Math.round((z - 0.06) * 100) / 100))}>
          −
        </button>
        <span style={{ fontSize: 12, color: 'var(--text)', minWidth: 44, textAlign: 'center' }}>{Math.round(ideZoom * 100)}%</span>
        <button type="button" className="btn btn-sm" title={tr('vibe_zoom_in_title')} onClick={() => setIdeZoom((z) => Math.min(1.6, Math.round((z + 0.06) * 100) / 100))}>
          +
        </button>
        <button type="button" className="btn btn-sm btn-muted" onClick={() => setIdeZoom(1)}>
          {tr('vibe_toolbar_zoom_reset')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-muted"
          onClick={() => {
            setColLeft(250);
            setColRight(380);
            try {
              localStorage.removeItem('vibe-ide-col-left');
              localStorage.removeItem('vibe-ide-col-right');
            } catch (_) {}
          }}
        >
          {tr('vibe_toolbar_cols_reset')}
        </button>
        <span style={{ flex: 1, minWidth: 8 }} />
        <button type="button" className="btn btn-sm btn-muted" title={tr('vibe_fs_browser_api')} onClick={() => { const el = leftCardRef.current; if (el && el.requestFullscreen) el.requestFullscreen(); }}>
          {tr('vibe_toolbar_fs_left')}
        </button>
        <button type="button" className="btn btn-sm btn-muted" onClick={() => { const el = midWrapRef.current; if (el && el.requestFullscreen) el.requestFullscreen(); }}>
          {tr('vibe_toolbar_fs_mid')}
        </button>
        <button type="button" className="btn btn-sm btn-muted" onClick={() => { const el = rightCardRef.current; if (el && el.requestFullscreen) el.requestFullscreen(); }}>
          {tr('vibe_toolbar_fs_right')}
        </button>
        <button type="button" className="btn btn-sm btn-muted" style={{ background: 'var(--list-select-bg)', color: 'var(--text)' }} onClick={() => document.fullscreenElement && document.exitFullscreen && document.exitFullscreen()}>
          {tr('vibe_toolbar_fs_exit')}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{tr('vibe_toolbar_hint')}</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${colLeft}px 6px minmax(240px, 1fr) 6px ${colRight}px`,
          gap: 0,
          alignItems: 'stretch',
          minHeight: 'min(82vh, 920px)',
        }}
        className="vibe-ide-grid"
      >
        <div
          ref={leftCardRef}
          className="card scroll-slim"
          style={{ maxHeight: '82vh', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}
        >
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{tr('vibe_hist_sess')}</div>
          <input
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            placeholder={tr('vibe_hist_filter_ph')}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--vibe-divider)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 12 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={newSession}>
              {tr('vibe_new')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={renameCurrentSession} disabled={!sessionId}>
              {tr('vibe_rename')}
            </button>
            <button type="button" className="btn btn-sm btn-muted" onClick={exportCurrentSession} disabled={!sessionId}>
              {tr('vibe_export')}
            </button>
          </div>
          <div className="scroll-slim" style={{ maxHeight: 200, overflowY: 'auto', minHeight: 0 }}>
            {sessionsFiltered.length === 0 ? (
              <div className="empty" style={{ fontSize: 11, padding: 12 }}>
                {tr('vibe_no_match')}
              </div>
            ) : (
              sessionsFiltered.map((s) => (
                <div
                  key={s.id}
                  className={'list-item' + (s.id === sessionId ? ' vibe-list-selected' : '')}
                  style={{
                    cursor: 'pointer',
                    padding: '6px 8px',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}
                  onClick={() => setSessionId(s.id)}
                >
                  <div style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>{(s.updated_at || '').slice(0, 16)}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--vibe-divider)', paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>{tr('vibe_memory')}</div>
            <textarea
              value={memory}
              onChange={(e) => scheduleMemorySave(e.target.value)}
              placeholder={tr('vibe_memory_ph')}
              disabled={!sessionId}
              style={{ width: '100%', minHeight: 88, fontSize: 11, background: 'var(--surface-input)', border: '1px solid var(--vibe-divider)', color: 'var(--text)', borderRadius: 6, padding: 8 }}
            />
          </div>

          <div style={{ borderTop: '1px solid var(--vibe-divider)', paddingTop: 10, flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>{tr('vibe_files')}</div>
            <VibeWorkspaceTree
              onOpenFile={(rel, name) => {
                openWorkspaceFile(rel, name);
              }}
            />
          </div>

          <button type="button" className="btn btn-sm btn-danger" style={{ width: '100%' }} onClick={deleteCurrentSession} disabled={!sessionId}>
            {tr('vibe_del_session')}
          </button>
        </div>

        <div
          className="vibe-ide-split"
          role="separator"
          aria-orientation="vertical"
          aria-label={tr('vibe_split_left')}
          onMouseDown={(e) => beginResize('left', e)}
          title={tr('vibe_split_left_title')}
        />

        <div ref={midWrapRef} style={{ minWidth: 0, zoom: ideZoom }} className="vibe-ide-midscale">
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>{tr('vibe_label_tool')}</label>
                <select value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value })}>
                  <option value="direct-llm">{tr('vibe_opt_direct_llm')}</option>
                  {availableTools.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>{tr('vibe_label_group')}</label>
                <select value={form.expertGroupId} onChange={(e) => setForm({ ...form, expertGroupId: e.target.value })}>
                  <option value="">{tr('vibe_opt_no_group')}</option>
                  {(agentGroups || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>{tr('vibe_label_model')}</label>
                <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                  <option value="">{tr('vibe_label_model_def', { d: (models && models.default) || '-' })}</option>
                  {allModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>{tr('vibe_label_mode')}</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  {[
                    ['chat', tr('vibe_mode_chat')],
                    ['code', tr('vibe_mode_code')],
                    ['review', tr('vibe_mode_review')],
                    ['plan', tr('vibe_mode_plan')],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <button type="button" className="btn btn-sm btn-muted" onClick={() => fileRef.current && fileRef.current.click()} disabled={!sessionId}>
                {tr('vibe_attach_img')}
              </button>
              <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onPickFiles} accept="image/*,.pdf,.txt,.md,.json,.yaml,.yml,.xml,.csv" />
              <button type="button" className="btn btn-sm btn-muted" onClick={() => docRef.current && docRef.current.click()}>
                {tr('vibe_attach_doc')}
              </button>
              <input ref={docRef} type="file" style={{ display: 'none' }} onChange={extractDocToPrompt} accept=".pdf,.txt,.md,.markdown" />
            </div>

            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {attachments.map((a) => (
                  <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-muted)', borderRadius: 6, padding: '4px 8px', fontSize: 11 }}>
                    {a.mime && a.mime.startsWith('image/') ? (
                      <button
                        type="button"
                        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                        onClick={() => {
                          setDocPickPath(a.path);
                          setRightTab('gallery');
                        }}
                        title={tr('vibe_img_view')}
                      >
                        <img src={uploadFileUrl(a.path)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                      </button>
                    ) : (
                      <span>📎</span>
                    )}
                    <span style={{ color: 'var(--text2)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ padding: '0 6px', minHeight: 22 }}
                      onClick={() => {
                        setAttachments((x) => {
                          const next = x.filter((y) => y.path !== a.path);
                          persistSession({ attachments: next });
                          return next;
                        });
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="form-group" style={{ margin: 0 }}>
              <label>{tr('vibe_prompt_label')}</label>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                style={{ minHeight: 100, fontFamily: 'monospace', fontSize: 13 }}
                placeholder={tr('vibe_prompt_ph')}
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={run} disabled={running || !form.prompt.trim() || !sessionId} style={{ width: '100%', marginTop: 8, padding: '10px', fontSize: 14 }}>
              {running ? tr('vibe_running') : tr('vibe_run')}
            </button>
            {!sessionId && <div style={{ fontSize: 11, color: '#f97316', marginTop: 6 }}>{tr('vibe_preparing')}</div>}
            {form.tool !== 'direct-llm' && attachments.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{tr('vibe_cli_img_warn')}</div>
            )}
          </div>

          {messages.length > 0 && (
            <div className="card scroll-slim" style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 12 }}>
              <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
                {tr('vibe_msgs_title')}
              </div>
              {messages.map((m, i) => (
                <div key={i} style={{ marginBottom: 12, borderBottom: i < messages.length - 1 ? '1px solid #1e293b' : 'none', paddingBottom: 10 }}>
                  <div style={{ fontSize: 11, marginBottom: 6 }}>
                    <span style={{ color: m.role === 'user' ? '#38bdf8' : '#86efac', fontWeight: 700 }}>{m.role === 'user' ? tr('vibe_role_user') : tr('vibe_role_ai')}</span>
                    <span style={{ color: 'var(--text3)', marginLeft: 8 }}>{(m.ts || '').replace('T', ' ').slice(0, 19)}</span>
                  </div>
                  {m.role === 'assistant' ? (
                    <div className="scroll-slim" style={{ maxHeight: 240, overflow: 'auto' }}>
                      <VibeMarkdownView markdown={m.text || ''} />
                    </div>
                  ) : (
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#cbd5e1', fontSize: 12, lineHeight: 1.5, margin: 0 }}>{m.text || ''}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="vibe-ide-split"
          role="separator"
          aria-orientation="vertical"
          aria-label={tr('vibe_split_right')}
          onMouseDown={(e) => beginResize('right', e)}
          title={tr('vibe_split_right_title')}
        />

        <div ref={rightCardRef} className="card scroll-slim" style={{ maxHeight: '82vh', overflowY: 'auto', minHeight: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {rightTabBtn('out', tr('vibe_rt_out'))}
            {rightTabBtn('term', tr('vibe_rt_term'))}
            {rightTabBtn('md', tr('vibe_rt_md'))}
            {rightTabBtn('code', tr('vibe_rt_code'))}
            {rightTabBtn('gallery', tr('vibe_rt_gallery'))}
            {rightTabBtn('doc', tr('vibe_rt_doc'))}
            {rightTabBtn('preview', tr('vibe_rt_preview'))}
            {rightTabBtn('wfile', tr('vibe_rt_wfile'))}
          </div>

          {rightTab === 'out' && (
            <>
              {!output ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_out_empty')}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div className="section-title" style={{ color: output.ok ? '#86efac' : '#fca5a5', margin: 0, fontSize: 13 }}>
                      {output.ok ? tr('vibe_out_ok') : tr('vibe_out_fail')}
                      {output.usage && (
                        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                          tokens: {output.usage.input}↑ {output.usage.output}↓
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-muted"
                      onClick={() => {
                        const outTxt = output.output || output.content || output.error || '';
                        navigator.clipboard.writeText(outTxt).then(() => showToast(tr('vibe_toast_copy_ok'), 'ok')).catch(() => showToast(tr('vibe_toast_copy_fail'), 'err'));
                      }}
                    >
                      {tr('vibe_copy')}
                    </button>
                  </div>
                  <pre style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, maxHeight: '62vh', overflowY: 'auto' }}>{output.content || output.output || output.error}</pre>
                  <button
                    type="button"
                    className="btn btn-sm btn-muted"
                    style={{ marginTop: 8, width: '100%', background: 'var(--list-select-bg)', color: 'var(--text)' }}
                    onClick={() => {
                      const t = String(output.content || output.output || '');
                      const html = vibeExtractHtmlFromOutput(t);
                      if (!html) {
                        showToast(tr('vibe_toast_no_html'), 'err');
                        return;
                      }
                      setPreviewHtml(html);
                      persistSession({ preview_html: html });
                      setRightTab('preview');
                      showToast(tr('vibe_toast_preview_up'), 'ok');
                    }}
                  >
                    {tr('vibe_extract_html')}
                  </button>
                </>
              )}
            </>
          )}

          {rightTab === 'term' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, lineHeight: 1.5 }}>
                {tr('vibe_term_intro', { p: 'PROJECT_PATH', f: '.ai-memory/env_exec_allowlist_extra.json', b: 'bash sop/tools/xxx.sh' })}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {[
                  ['git status', 'git status'],
                  ['git diff --stat', 'git diff --stat'],
                  ['git log --oneline -10', 'git log --oneline -10'],
                  ['python3 -V', 'python3 --version'],
                  ['node -v', 'node --version'],
                  ['npm -v', 'npm --version'],
                  ['ls -la', 'ls -la'],
                ].map(([label, c]) => (
                  <button key={label} type="button" className="btn btn-sm btn-muted" onClick={() => setTermCommand(c)}>
                    {label}
                  </button>
                ))}
              </div>
              {savedCmds.length > 0 && (
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>{tr('vibe_term_saved_title', { n: savedCmds.length })}</summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {savedCmds.map((sc, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button type="button" className="btn btn-sm btn-muted" style={{ flex: 1, textAlign: 'left', fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setTermCommand(sc.cmd)} title={sc.cmd}>
                          {sc.label || sc.cmd}
                        </button>
                        <button type="button" className="btn btn-sm btn-danger" style={{ padding: '2px 6px' }} onClick={() => {
                          const next = savedCmds.filter((_, j) => j !== i);
                          setSavedCmds(next);
                          try { localStorage.setItem('vibe-saved-cmds', JSON.stringify(next)); } catch (_) {}
                        }}>×</button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="form-group" style={{ marginBottom: 6 }}>
                <label>{tr('vibe_term_cwd_label')}</label>
                <input
                  value={termCwd}
                  onChange={(e) => setTermCwd(e.target.value)}
                  placeholder={tr('vibe_term_cwd_ph')}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 6 }}>
                <label>{tr('vibe_term_timeout_label')}</label>
                <input
                  type="number"
                  min={3}
                  max={600}
                  value={termTimeout}
                  onChange={(e) => setTermTimeout(Number(e.target.value))}
                  style={{ width: 100 }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label>{tr('vibe_term_cmd_label')}</label>
                <textarea
                  value={termCommand}
                  onChange={(e) => setTermCommand(e.target.value)}
                  style={{ width: '100%', minHeight: 72, fontFamily: 'monospace', fontSize: 12, background: 'var(--surface-input)', color: 'var(--text)', border: '1px solid var(--vibe-divider)', borderRadius: 6, padding: 8 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={savedCmdLabel}
                  onChange={(e) => setSavedCmdLabel(e.target.value)}
                  placeholder={tr('vibe_term_save_ph')}
                  style={{ flex: 1, minWidth: 80, fontSize: 11, fontFamily: 'monospace', background: 'var(--surface-input)', color: 'var(--text)', border: '1px solid var(--vibe-divider)', borderRadius: 4, padding: '4px 6px' }}
                />
                <button type="button" className="btn btn-sm btn-muted" disabled={!termCommand.trim()} onClick={() => {
                  const entry = { label: savedCmdLabel.trim() || termCommand.trim().slice(0, 32), cmd: termCommand.trim() };
                  const next = [...savedCmds, entry];
                  setSavedCmds(next);
                  setSavedCmdLabel('');
                  try { localStorage.setItem('vibe-saved-cmds', JSON.stringify(next)); } catch (_) {}
                  showToast(tr('vibe_term_save_ok'), 'ok');
                }}>{tr('vibe_term_save_btn')}</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={termBusy} onClick={execTerminal}>
                  {termBusy ? tr('vibe_running') : tr('vibe_run')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-muted"
                  disabled={!termResult}
                  onClick={() => {
                    const clip = [termResult.argv && termResult.argv.join(' '), termResult.stdout, termResult.stderr].filter(Boolean).join('\n---\n');
                    navigator.clipboard.writeText(clip).then(() => showToast(tr('vibe_toast_copy_ok'), 'ok')).catch(() => showToast(tr('vibe_toast_copy_fail'), 'err'));
                  }}
                >
                  {tr('vibe_term_copy_out')}
                </button>
              </div>
              {termAllow && termAllow.programs && (
                <details style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--text2)' }}>{tr('vibe_term_allowlist_title', { n: termAllow.programs.length })}</summary>
                  <div className="scroll-slim" style={{ maxHeight: 120, overflow: 'auto', marginTop: 6, fontFamily: 'monospace' }}>
                    {termAllow.programs.join(', ')}
                  </div>
                </details>
              )}
              {!termResult ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_term_run_hint')}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: termResult.ok ? '#86efac' : '#fca5a5' }}>
                    exit {termResult.returncode != null ? termResult.returncode : '?'} · cwd {termResult.cwd_display != null && termResult.cwd_display !== '' ? termResult.cwd_display : '.'}
                    {termResult.argv && termResult.argv.length > 0 && (
                      <span style={{ color: 'var(--text2)', marginLeft: 8 }}>
                        argv: <code style={{ color: '#cbd5e1' }}>{termResult.argv.join(' ')}</code>
                      </span>
                    )}
                  </div>
                  {termResult.stdout ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr('vibe_term_stdout')}</div>
                      <pre style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '36vh', overflow: 'auto', background: 'var(--surface-input)', padding: 8, borderRadius: 6, border: '1px solid var(--vibe-divider)', margin: 0 }}>{termResult.stdout}</pre>
                    </div>
                  ) : null}
                  {termResult.stderr ? (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr('vibe_term_stderr')}</div>
                      <pre style={{ fontSize: 11, color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '28vh', overflow: 'auto', background: '#1c1917', padding: 8, borderRadius: 6, border: '1px solid #451a1a', margin: 0 }}>{termResult.stderr}</pre>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {rightTab === 'md' && (
            <div>
              {!rawOutputText ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_md_empty')}
                </div>
              ) : (
                <div className="scroll-slim" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
                  <VibeMarkdownView markdown={rawOutputText} />
                </div>
              )}
            </div>
          )}

          {rightTab === 'code' && (
            <div>
              {codeBlocks.length === 0 ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_code_empty')}
                </div>
              ) : (
                <>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label>{tr('vibe_code_select', { n: codeBlocks.length })}</label>
                    <select value={codeBlockIdx} onChange={(e) => setCodeBlockIdx(Number(e.target.value))}>
                      {codeBlocks.map((b, i) => (
                        <option key={i} value={i}>
                          #{i + 1} [{b.lang}] {b.code.slice(0, 40).replace(/\n/g, ' ')}…
                        </option>
                      ))}
                    </select>
                  </div>
                  <VibeHighlightedCode lang={codeBlocks[codeBlockIdx].lang} code={codeBlocks[codeBlockIdx].code} />
                  <button
                    type="button"
                    className="btn btn-sm btn-muted"
                    style={{ marginTop: 8, width: '100%' }}
                    onClick={() => {
                      navigator.clipboard.writeText(codeBlocks[codeBlockIdx].code).then(() => showToast(tr('vibe_toast_copy_ok'), 'ok')).catch(() => {});
                    }}
                  >
                    {tr('vibe_code_copy_block')}
                  </button>
                </>
              )}
            </div>
          )}

          {rightTab === 'gallery' && (
            <div>
              {imageAttachments.length === 0 ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_gallery_empty')}
                </div>
              ) : (
                <div className="scroll-slim" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
                  {imageAttachments.map((a) => (
                    <div key={a.path} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{a.name}</div>
                      <img src={uploadFileUrl(a.path)} alt={a.name} style={{ maxWidth: '100%', borderRadius: 8, border: docPickPath === a.path ? '2px solid var(--accent)' : '1px solid var(--vibe-divider)', cursor: 'pointer' }} onClick={() => setDocPickPath(a.path)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {rightTab === 'doc' && (
            <div>
              {docAttachments.length === 0 ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_doc_empty')}
                </div>
              ) : (
                <>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label>{tr('vibe_doc_select')}</label>
                    <select value={docPickPath || (docAttachments[0] && docAttachments[0].path) || ''} onChange={(e) => setDocPickPath(e.target.value)}>
                      {docAttachments.map((a) => (
                        <option key={a.path} value={a.path}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(() => {
                    const p = docPickPath || (docAttachments[0] && docAttachments[0].path);
                    const att = docAttachments.find((x) => x.path === p) || docAttachments[0];
                    if (!att) return null;
                    const low = (att.name || '').toLowerCase();
                    if (low.endsWith('.pdf')) {
                      return (
                        <object data={uploadFileUrl(att.path)} type="application/pdf" width="100%" height="520" style={{ borderRadius: 8, border: '1px solid var(--vibe-divider)' }}>
                          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{tr('vibe_doc_pdf_fallback')}</div>
                        </object>
                      );
                    }
                    return <VibeDocTextPreview key={att.path} url={uploadFileUrl(att.path)} isMd={low.endsWith('.md')} />;
                  })()}
                </>
              )}
            </div>
          )}

          {rightTab === 'preview' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{tr('vibe_preview_sandbox')}</div>
              {previewHtml ? (
                <iframe title="preview" sandbox="" srcDoc={previewHtml} style={{ width: '100%', minHeight: 380, border: '1px solid var(--vibe-divider)', borderRadius: 6, background: 'var(--iframe-preview-bg)' }} />
              ) : (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_preview_empty')}
                </div>
              )}
              <button
                type="button"
                className="btn btn-sm btn-muted"
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => {
                  persistSession({ preview_html: '' });
                  setPreviewHtml('');
                  showToast(tr('vibe_toast_cleared'), 'ok');
                }}
              >
                {tr('vibe_preview_clear')}
              </button>
            </div>
          )}

          {rightTab === 'wfile' && (
            <div>
              {!workspaceFile || !workspaceFile.ok ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  {tr('vibe_wfile_open_hint')}
                </div>
              ) : workspaceFile.binary ? (
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>{workspaceFile.hint || tr('vibe_wfile_hint')}</div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, wordBreak: 'break-all' }}>
                    {workspaceFile.path} {workspaceFile.truncated ? tr('vibe_truncated_suffix') : ''}
                  </div>
                  {(workspaceFile.path || '').toLowerCase().endsWith('.md') ? (
                    <div className="scroll-slim" style={{ maxHeight: '64vh', overflow: 'auto' }}>
                      <VibeMarkdownView markdown={workspaceFile.content || ''} />
                    </div>
                  ) : (
                    <pre className="scroll-slim" style={{ maxHeight: '64vh', overflow: 'auto', fontSize: 12, lineHeight: 1.45, background: 'var(--surface-input)', border: '1px solid var(--vibe-divider)', borderRadius: 8, padding: 10, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {workspaceFile.content}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .vibe-ide-split {
          width: 6px;
          cursor: col-resize;
          background: transparent;
          align-self: stretch;
          min-height: 120px;
          border-radius: 4px;
          flex-shrink: 0;
          transition: background 0.12s ease;
        }
        .vibe-ide-split:hover,
        .vibe-ide-split:focus-visible {
          background: rgba(59, 130, 246, 0.28);
        }
        .vibe-ide-split:active {
          background: rgba(59, 130, 246, 0.45);
        }
        .vibe-ide-toolbar .btn-sm {
          min-height: 30px;
        }
        @media (max-width: 1100px) {
          .vibe-ide-grid {
            display: flex !important;
            flex-direction: column;
            gap: 12px !important;
            min-height: 0 !important;
          }
          .vibe-ide-split {
            display: none !important;
          }
          .vibe-ide-midscale {
            zoom: 1 !important;
          }
        }
      `}</style>
    </div>
  );
}

function VibeDocTextPreview({ url, isMd }) {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const [text, setText] = React.useState('');
  const [err, setErr] = React.useState(null);
  React.useEffect(() => {
    setText('');
    setErr(null);
    apiFetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setText)
      .catch(() => setErr(typeof window.t === 'function' ? window.t('vibe_fetch_err') : 'vibe_fetch_err'));
  }, [url]);
  if (err) return <div style={{ fontSize: 12, color: '#fca5a5' }}>{err}</div>;
  if (!text) return <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('vibe_loading')}</div>;
  if (isMd) return <VibeMarkdownView markdown={text} />;
  return (
    <pre className="scroll-slim" style={{ maxHeight: '62vh', overflow: 'auto', fontSize: 12, lineHeight: 1.45, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text}
    </pre>
  );
}

function VibeTemplatesPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/vibe/templates`);
  const [selected, setSelected] = React.useState(null);
  const [filled, setFilled] = React.useState('');

  const fill = (tpl) => {
    setSelected(tpl);
    setFilled(tpl.template);
  };

  if (loading) {
    return (
      <div>
        <div className="section-title">{tr('vibe_tpl_title')}</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">{tr('vibe_tpl_title')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">{tr('vibe_tpl_title')}</div>
        <RefreshBtn onClick={reload} />
      </div>
      <div className="grid-2">
        <div className="card scroll-slim" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {(data || []).length === 0 ? (
            <div className="empty">{tr('vibe_tpl_empty')}</div>
          ) : (
            (data || []).map((tpl) => (
              <div
                key={tpl.id}
                className={'list-item' + (selected && selected.id === tpl.id ? ' vibe-list-selected' : '')}
                style={{ cursor: 'pointer' }}
                onClick={() => fill(tpl)}
              >
                <div style={{ flex: 1 }}>
                  <div className="title">{tpl.name}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="card">
          {!selected ? (
            <div className="empty">{tr('vibe_tpl_pick')}</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{selected.name}</div>
              <textarea
                value={filled}
                onChange={(e) => setFilled(e.target.value)}
                style={{ width: '100%', minHeight: 200, background: 'var(--surface-input)', border: '1px solid var(--vibe-divider)', color: 'var(--text)', padding: 8, borderRadius: 6, fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => {
                  navigator.clipboard.writeText(filled).then(() => showToast(tr('vibe_tpl_copy_ok'), 'ok')).catch(() => showToast(tr('vibe_toast_copy_fail'), 'err'));
                }}
              >
                {tr('vibe_tpl_copy')}
              </button>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>{tr('vibe_tpl_footer')}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VibeHistoryPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/vibe/history`);
  const clear = () => {
    if (!confirm(tr('vibe_hist_clear_confirm'))) return;
    apiFetch(`/vibe/history`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast(tr('vibe_hist_cleared'), 'ok');
      })
      .catch(() => showToast(tr('vibe_hist_clear_fail'), 'err'));
  };
  if (loading) {
    return (
      <div>
        <div className="section-title">{tr('vibe_hist_panel')}</div>
        <PageSkeleton cards={1} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">{tr('vibe_hist_panel')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">{tr('vibe_hist_panel_sub')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <RefreshBtn onClick={reload} />
          <button type="button" className="btn btn-sm btn-danger" onClick={clear}>
            {tr('vibe_hist_clear')}
          </button>
        </div>
      </div>
      <div className="card scroll-slim" style={{ maxHeight: 560, overflowY: 'auto' }}>
        {(data || []).length === 0 ? (
          <div className="empty">{tr('vibe_hist_empty')}</div>
        ) : (
          [...(data || [])].reverse().map((h, i) => (
            <div key={i} className="list-item" style={{ flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{h.ts && h.ts.slice(0, 16)}</span>
                <span className={`tag ${h.ok ? 'tag-done' : 'tag-p0'}`}>{h.tool}</span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.prompt}</span>
              </div>
              {h.output && <div style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface-input)', padding: '4px 8px', borderRadius: 4, maxHeight: 60, overflow: 'hidden' }}>{h.output}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
