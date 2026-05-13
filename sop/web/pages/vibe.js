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
    <pre className="scroll-slim" style={{ maxHeight: '58vh', overflow: 'auto', fontSize: 12, margin: 0, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10 }}>
      <code ref={ref} />
    </pre>
  );
}

const VIBE_MODE_HINTS = {
  chat: '你是资深开发搭档，用清晰中文协助对话与决策。',
  code: '你是资深工程师，优先给出可运行、可落地的代码与步骤。',
  review: '你是代码审查者，从安全、性能、可维护性给出分级建议。',
  plan: '你是技术规划者，输出结构化任务拆解与依赖关系。',
};

let vibeDefaultSessionBootstrapStarted = false;

function VibeCoding() {
  const [tab, setTab] = React.useState('ide');
  const [focusSessionId, setFocusSessionId] = React.useState(null);
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ['ide', '🛠️ AI 开发 IDE'],
          ['sessions', '📚 会话管理'],
          ['templates', '📝 模板'],
          ['history', '📜 执行历史'],
          ['cli', '⌨️ CLI 快捷'],
        ].map(([id, l]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${tab === id ? 'btn-primary' : ''}`}
            style={tab !== id ? { background: '#334155', color: '#94a3b8' } : {}}
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
  const { data, loading, error, reload } = useFetch(`${API}/vibe/sessions`);
  const [q, setQ] = React.useState('');
  const sessions = (data && data.sessions) || [];
  const filtered = sessions.filter((s) => {
    const t = `${s.title || ''} ${s.id || ''}`.toLowerCase();
    return t.includes(q.trim().toLowerCase());
  });

  const exportOne = (s) => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vibe-session-${s.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已导出', 'ok');
  };

  const del = (id) => {
    if (!confirm('删除该会话？不可恢复。')) return;
    fetch(`${API}/vibe/sessions/${id}`, { method: 'DELETE' })
      .then(() => {
        reload();
        showToast('已删除', 'ok');
      })
      .catch(() => showToast('删除失败', 'err'));
  };

  const rename = (s) => {
    const t = window.prompt('会话标题', s.title || s.id);
    if (t == null || !t.trim()) return;
    fetch(`${API}/vibe/sessions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t.trim() }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        reload();
        showToast('已重命名', 'ok');
      })
      .catch(() => showToast('保存失败', 'err'));
  };

  if (loading) {
    return (
      <div>
        <div className="section-title">会话管理</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">会话管理</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">历史会话管理</div>
        <RefreshBtn onClick={reload} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>搜索标题 / ID</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入关键字过滤…" />
        </div>
      </div>
      <div className="card scroll-slim" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty">无匹配会话</div>
        ) : (
          filtered.map((s) => (
            <div key={s.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="title" style={{ fontWeight: 700 }}>
                    {s.title || s.id}
                  </div>
                  <div className="meta">
                    {s.id} · 更新 {(s.updated_at || '').slice(0, 19)} · 消息 {Array.isArray(s.messages) ? s.messages.length : 0} 条
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenInIde(s.id)}>
                    在 IDE 打开
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => rename(s)}>
                    重命名
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => exportOne(s)}>
                    导出 JSON
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={() => del(s.id)}>
                    删除
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
  const [path, setPath] = React.useState('');
  const [items, setItems] = React.useState([]);
  const [err, setErr] = React.useState(null);

  const load = React.useCallback(() => {
    fetch(`${API}/vibe/workspace/list?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setItems(d.items || []);
        setErr(null);
      })
      .catch(() => setErr('无法加载目录'));
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
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, wordBreak: 'break-all' }}>
        📁 {path || '(项目根)'}
      </div>
      {err && <div style={{ fontSize: 11, color: '#fca5a5', marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={parentPath} disabled={!path}>
          ↑ 上级
        </button>
        <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={load}>
          刷新
        </button>
      </div>
      <div className="scroll-slim" style={{ maxHeight: 280, overflowY: 'auto', fontSize: 12 }}>
        {items.length === 0 ? (
          <div className="empty" style={{ padding: 12, fontSize: 11 }}>
            空目录
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
              <span style={{ color: it.dir ? '#93c5fd' : '#94a3b8' }}>{it.dir ? '📂' : '📄'}</span>
              <span style={{ color: '#e2e8f0', marginLeft: 6 }}>{it.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VibeCliShortcutPanel() {
  const [cmd, setCmd] = React.useState('claude --print "说明你的任务"');
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">CLI 快捷参考</div>
      </div>
        <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          在本地终端执行（需已安装对应 CLI）。在「AI 开发 IDE」右栏「终端」可在服务端 PROJECT_PATH 下受控执行白名单命令（脚本见 bash path/to/script.sh）。
        </div>
        <textarea
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          style={{ width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: 12, background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: 8 }}
        />
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: 8, background: '#334155', color: '#94a3b8' }}
          onClick={() => navigator.clipboard.writeText(cmd).then(() => showToast('已复制', 'ok')).catch(() => showToast('复制失败', 'err'))}
        >
          复制命令
        </button>
      </div>
      <div className="card" style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
        <div><strong style={{ color: '#94a3b8' }}>Claude Code</strong>：npm i -g @anthropic-ai/claude-code</div>
        <div><strong style={{ color: '#94a3b8' }}>Aider</strong>：pip install aider-chat</div>
        <div><strong style={{ color: '#94a3b8' }}>直接 LLM</strong>：在 IDE 页选择「直接调用 LLM」，需配置 ANTHROPIC_API_KEY。</div>
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

  const availableTools = (tools || []).filter((t) => t.available);
  const allModels = [...((models && models.builtin) || []), ...((models && models.custom) || [])];
  const sessions = (sessListData && sessListData.sessions) || [];
  const sessionsFiltered = sessions.filter((s) => {
    if (!sessionQuery.trim()) return true;
    const t = `${s.title || ''} ${s.id}`.toLowerCase();
    return t.includes(sessionQuery.trim().toLowerCase());
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
    fetch(`${API}/vibe/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '默认会话' }),
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
    fetch(`${API}/vibe/sessions/${id}`)
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
      .catch(() => showToast('加载会话失败', 'err'));
  }, []);

  React.useEffect(() => {
    if (sessionId) loadSession(sessionId);
  }, [sessionId, loadSession]);

  const persistSession = React.useCallback(
    (patch) => {
      if (!sessionId) return;
      fetch(`${API}/vibe/sessions/${sessionId}`, {
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
    ? `专家组「${selectedGroup.name}」说明：${selectedGroup.description || ''}\n成员 Agent ID：${(selectedGroup.agents || []).join(', ')}。请按该协作视角回答。`
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
      showToast('请先创建或选择会话', 'err');
      return;
    }
    setRunning(true);
    setOutput(null);
    const modeSystem = VIBE_MODE_HINTS[form.mode] || VIBE_MODE_HINTS.chat;
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
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        setOutput(d);
        setRunning(false);
        if (!ok || d.ok === false) {
          showToast(d.detail || d.error || '执行失败', 'err');
          return;
        }
        showToast('执行完成', 'ok');
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
        showToast('网络或服务器错误', 'err');
      });
  };

  const newSession = () => {
    const title = window.prompt('会话标题', '新会话') || '新会话';
    fetch(`${API}/vibe/sessions`, {
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
          showToast('已创建会话', 'ok');
        }
      })
      .catch(() => showToast('创建失败', 'err'));
  };

  const renameCurrentSession = () => {
    if (!sessionId) return;
    const cur = sessions.find((s) => s.id === sessionId);
    const t = window.prompt('新标题', (cur && cur.title) || sessionId);
    if (t == null || !t.trim()) return;
    fetch(`${API}/vibe/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t.trim() }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        rs();
        showToast('已重命名', 'ok');
      })
      .catch(() => showToast('失败', 'err'));
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
    showToast('已导出', 'ok');
  };

  const deleteCurrentSession = () => {
    if (!sessionId || !confirm('删除当前会话？')) return;
    fetch(`${API}/vibe/sessions/${sessionId}`, { method: 'DELETE' })
      .then(() => {
        setSessionId(null);
        setMessages([]);
        setMemory('');
        setPreviewHtml('');
        setAttachments([]);
        setOutput(null);
        rs();
        showToast('已删除', 'ok');
      })
      .catch(() => showToast('删除失败', 'err'));
  };

  const onPickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !sessionId) return;
    const fd = new FormData();
    fd.append('session', sessionId);
    files.forEach((f) => fd.append('files', f));
    fetch(`${API}/vibe/upload`, { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok && d.detail) throw new Error();
        const add = (d.files || []).map((f) => ({ ...f, id: f.path }));
        setAttachments((a) => {
          const next = [...a, ...add];
          persistSession({ attachments: next });
          return next;
        });
        showToast(`已上传 ${add.length} 个文件`, 'ok');
      })
      .catch(() => showToast('上传失败', 'err'));
  };

  const extractDocToPrompt = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    showToast('正在抽取文本…', 'ok');
    fetch(`${API}/knowledge/extract-text`, { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((d) => {
        const t = d.text || d.content || '';
        if (!t) {
          showToast('未能抽取文本', 'err');
          return;
        }
        setForm((f) => ({ ...f, prompt: f.prompt + (f.prompt ? '\n\n' : '') + '【文档摘录】\n' + t.slice(0, 50000) }));
        showToast('已插入到提示词', 'ok');
      })
      .catch(() => showToast('抽取失败', 'err'));
  };

  const openWorkspaceFile = (relPath, name) => {
    fetch(`${API}/vibe/workspace/file?path=${encodeURIComponent(relPath)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setWorkspaceFile({ ...d, name: name || relPath });
        setRightTab('wfile');
      })
      .catch(() => {
        setWorkspaceFile(null);
        showToast('无法读取文件', 'err');
      });
  };

  const rightTabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      className={`btn btn-sm ${rightTab === id ? 'btn-primary' : ''}`}
      style={rightTab !== id ? { background: '#334155', color: '#94a3b8' } : {}}
      onClick={() => setRightTab(id)}
    >
      {label}
    </button>
  );

  const execTerminal = () => {
    const cmd = (termCommand || '').trim();
    if (!cmd) {
      showToast('请输入命令', 'err');
      return;
    }
    setTermBusy(true);
    fetch(`${API}/vibe/terminal/exec`, {
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
          showToast('执行被拒绝或参数错误', 'err');
          return;
        }
        setTermResult(d);
        if (!d.ok) showToast(d.stderr ? '命令失败（见 stderr）' : '命令非零退出', 'err');
      })
      .catch(() => {
        setTermBusy(false);
        showToast('请求失败', 'err');
      });
  };

  if (panelLoading) {
    return (
      <div>
        <div className="section-title">🎯 Vibe Coding</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (panelError) {
    return (
      <div>
        <div className="section-title">🎯 Vibe Coding</div>
        <LoadError message={panelError} onRetry={reloadDeps} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-title">🎯 Vibe Coding — AI 开发 IDE</div>
        <RefreshBtn onClick={reloadDeps} />
      </div>

      <div className="card vibe-ide-toolbar" style={{ marginBottom: 12, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>工作台</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>缩放</span>
        <button type="button" className="btn btn-sm" title="缩小" onClick={() => setIdeZoom((z) => Math.max(0.72, Math.round((z - 0.06) * 100) / 100))}>
          −
        </button>
        <span style={{ fontSize: 12, color: '#e2e8f0', minWidth: 44, textAlign: 'center' }}>{Math.round(ideZoom * 100)}%</span>
        <button type="button" className="btn btn-sm" title="放大" onClick={() => setIdeZoom((z) => Math.min(1.6, Math.round((z + 0.06) * 100) / 100))}>
          +
        </button>
        <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => setIdeZoom(1)}>
          重置缩放
        </button>
        <button
          type="button"
          className="btn btn-sm"
          style={{ background: '#334155', color: '#94a3b8' }}
          onClick={() => {
            setColLeft(250);
            setColRight(380);
            try {
              localStorage.removeItem('vibe-ide-col-left');
              localStorage.removeItem('vibe-ide-col-right');
            } catch (_) {}
          }}
        >
          重置分栏
        </button>
        <span style={{ flex: 1, minWidth: 8 }} />
        <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} title="浏览器全屏 API" onClick={() => { const el = leftCardRef.current; if (el && el.requestFullscreen) el.requestFullscreen(); }}>
          左栏全屏
        </button>
        <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => { const el = midWrapRef.current; if (el && el.requestFullscreen) el.requestFullscreen(); }}>
          中栏全屏
        </button>
        <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => { const el = rightCardRef.current; if (el && el.requestFullscreen) el.requestFullscreen(); }}>
          右栏全屏
        </button>
        <button type="button" className="btn btn-sm" style={{ background: '#1e3a5f', color: '#93c5fd' }} onClick={() => document.fullscreenElement && document.exitFullscreen && document.exitFullscreen()}>
          退出全屏
        </button>
        <span style={{ fontSize: 11, color: '#64748b' }}>拖拽竖条调宽度 · Esc 退出全屏 · 布局/缩放本地保存</span>
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
          <div style={{ fontSize: 12, color: '#94a3b8' }}>历史会话</div>
          <input
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            placeholder="筛选会话…"
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 12 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={newSession}>
              + 新建
            </button>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={renameCurrentSession} disabled={!sessionId}>
              重命名
            </button>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={exportCurrentSession} disabled={!sessionId}>
              导出
            </button>
          </div>
          <div className="scroll-slim" style={{ maxHeight: 200, overflowY: 'auto', minHeight: 0 }}>
            {sessionsFiltered.length === 0 ? (
              <div className="empty" style={{ fontSize: 11, padding: 12 }}>
                无匹配
              </div>
            ) : (
              sessionsFiltered.map((s) => (
                <div
                  key={s.id}
                  className="list-item"
                  style={{
                    cursor: 'pointer',
                    padding: '6px 8px',
                    background: s.id === sessionId ? '#1e3a5f' : '',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                  }}
                  onClick={() => setSessionId(s.id)}
                >
                  <div style={{ fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.id}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{(s.updated_at || '').slice(0, 16)}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ borderTop: '1px solid #334155', paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>持久记忆</div>
            <textarea
              value={memory}
              onChange={(e) => scheduleMemorySave(e.target.value)}
              placeholder="跨轮次约束、技术栈、路径约定…"
              disabled={!sessionId}
              style={{ width: '100%', minHeight: 88, fontSize: 11, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: 8 }}
            />
          </div>

          <div style={{ borderTop: '1px solid #334155', paddingTop: 10, flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>项目目录浏览</div>
            <VibeWorkspaceTree
              onOpenFile={(rel, name) => {
                openWorkspaceFile(rel, name);
              }}
            />
          </div>

          <button type="button" className="btn btn-sm" style={{ width: '100%', background: '#451a1a', color: '#fca5a5' }} onClick={deleteCurrentSession} disabled={!sessionId}>
            删除当前会话
          </button>
        </div>

        <div
          className="vibe-ide-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左栏宽度"
          onMouseDown={(e) => beginResize('left', e)}
          title="拖拽调整左栏"
        />

        <div ref={midWrapRef} style={{ minWidth: 0, zoom: ideZoom }} className="vibe-ide-midscale">
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>开发工具</label>
                <select value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value })}>
                  <option value="direct-llm">🤖 直接调用 LLM（支持图片）</option>
                  {availableTools.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>专家组</label>
                <select value={form.expertGroupId} onChange={(e) => setForm({ ...form, expertGroupId: e.target.value })}>
                  <option value="">（不启用）</option>
                  {(agentGroups || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>模型</label>
                <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                  <option value="">默认 ({(models && models.default) || '-'})</option>
                  {allModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>模式</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  {[
                    ['chat', '💬 对话'],
                    ['code', '💻 编码'],
                    ['review', '🔍 审查'],
                    ['plan', '📋 规划'],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => fileRef.current && fileRef.current.click()} disabled={!sessionId}>
                📎 图片 / 文件
              </button>
              <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onPickFiles} accept="image/*,.pdf,.txt,.md,.json,.yaml,.yml,.xml,.csv" />
              <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => docRef.current && docRef.current.click()}>
                📄 文档抽取
              </button>
              <input ref={docRef} type="file" style={{ display: 'none' }} onChange={extractDocToPrompt} accept=".pdf,.txt,.md,.markdown" />
            </div>

            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {attachments.map((a) => (
                  <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1e293b', borderRadius: 6, padding: '4px 8px', fontSize: 11 }}>
                    {a.mime && a.mime.startsWith('image/') ? (
                      <button
                        type="button"
                        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                        onClick={() => {
                          setDocPickPath(a.path);
                          setRightTab('gallery');
                        }}
                        title="大图查看"
                      >
                        <img src={uploadFileUrl(a.path)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                      </button>
                    ) : (
                      <span>📎</span>
                    )}
                    <span style={{ color: '#94a3b8', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
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
              <label>提示词</label>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                style={{ minHeight: 100, fontFamily: 'monospace', fontSize: 13 }}
                placeholder="任务描述、代码、上下文。直接 LLM 可带图片附件。"
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={run} disabled={running || !form.prompt.trim() || !sessionId} style={{ width: '100%', marginTop: 8, padding: '10px', fontSize: 14 }}>
              {running ? '⏳ 执行中…' : '▶ 执行'}
            </button>
            {!sessionId && <div style={{ fontSize: 11, color: '#f97316', marginTop: 6 }}>正在准备会话…</div>}
            {form.tool !== 'direct-llm' && attachments.length > 0 && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>CLI 无法传图；路径已写入提示词。看图请用「直接调用 LLM」。</div>
            )}
          </div>

          {messages.length > 0 && (
            <div className="card scroll-slim" style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 12 }}>
              <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
                会话消息（完整）
              </div>
              {messages.map((m, i) => (
                <div key={i} style={{ marginBottom: 12, borderBottom: i < messages.length - 1 ? '1px solid #1e293b' : 'none', paddingBottom: 10 }}>
                  <div style={{ fontSize: 11, marginBottom: 6 }}>
                    <span style={{ color: m.role === 'user' ? '#38bdf8' : '#86efac', fontWeight: 700 }}>{m.role === 'user' ? '你' : 'AI'}</span>
                    <span style={{ color: '#64748b', marginLeft: 8 }}>{(m.ts || '').replace('T', ' ').slice(0, 19)}</span>
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
          aria-label="调整右栏宽度"
          onMouseDown={(e) => beginResize('right', e)}
          title="拖拽调整右栏"
        />

        <div ref={rightCardRef} className="card scroll-slim" style={{ maxHeight: '82vh', overflowY: 'auto', minHeight: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {rightTabBtn('out', '输出')}
            {rightTabBtn('term', '终端')}
            {rightTabBtn('md', 'Markdown')}
            {rightTabBtn('code', '代码块')}
            {rightTabBtn('gallery', '图片')}
            {rightTabBtn('doc', '文档')}
            {rightTabBtn('preview', '页面')}
            {rightTabBtn('wfile', '项目文件')}
          </div>

          {rightTab === 'out' && (
            <>
              {!output ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  执行后查看原始输出
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div className="section-title" style={{ color: output.ok ? '#86efac' : '#fca5a5', margin: 0, fontSize: 13 }}>
                      {output.ok ? '✅ 成功' : '❌ 失败'}
                      {output.usage && (
                        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
                          tokens: {output.usage.input}↑ {output.usage.output}↓
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ background: '#334155', color: '#94a3b8' }}
                      onClick={() => {
                        const t = output.output || output.content || output.error || '';
                        navigator.clipboard.writeText(t).then(() => showToast('已复制', 'ok')).catch(() => showToast('复制失败', 'err'));
                      }}
                    >
                      复制
                    </button>
                  </div>
                  <pre style={{ fontSize: 11, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, maxHeight: '62vh', overflowY: 'auto' }}>{output.content || output.output || output.error}</pre>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginTop: 8, width: '100%', background: '#1e3a5f', color: '#93c5fd' }}
                    onClick={() => {
                      const t = String(output.content || output.output || '');
                      const html = vibeExtractHtmlFromOutput(t);
                      if (!html) {
                        showToast('未检测到 HTML 代码块', 'err');
                        return;
                      }
                      setPreviewHtml(html);
                      persistSession({ preview_html: html });
                      setRightTab('preview');
                      showToast('已更新预览', 'ok');
                    }}
                  >
                    提取 HTML → 页面
                  </button>
                </>
              )}
            </>
          )}

          {rightTab === 'term' && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
                在服务端 <code style={{ color: '#93c5fd' }}>PROJECT_PATH</code> 下执行；首段可执行文件须在白名单（与「环境 / Docker」自定义检查相同）。扩展白名单：{' '}
                <code style={{ color: '#93c5fd' }}>.ai-memory/env_exec_allowlist_extra.json</code>。支持{' '}
                <code style={{ color: '#93c5fd' }}>bash sop/tools/xxx.sh</code>（脚本须在项目内且扩展名为 .sh）。
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {[
                  ['git status', 'git status'],
                  ['git diff --stat', 'git diff --stat'],
                  ['python3 -V', 'python3 --version'],
                  ['node -v', 'node --version'],
                  ['npm -v', 'npm --version'],
                ].map(([label, c]) => (
                  <button key={label} type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8' }} onClick={() => setTermCommand(c)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="form-group" style={{ marginBottom: 6 }}>
                <label>工作目录（相对项目根，留空为根）</label>
                <input
                  value={termCwd}
                  onChange={(e) => setTermCwd(e.target.value)}
                  placeholder="例如 sop 或留空"
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 6 }}>
                <label>超时（秒，3–600）</label>
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
                <label>命令（shell 风格，由服务端 shlex 解析）</label>
                <textarea
                  value={termCommand}
                  onChange={(e) => setTermCommand(e.target.value)}
                  style={{ width: '100%', minHeight: 72, fontFamily: 'monospace', fontSize: 12, background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: 8 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={termBusy} onClick={execTerminal}>
                  {termBusy ? '执行中…' : '▶ 执行'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: '#334155', color: '#94a3b8' }}
                  disabled={!termResult}
                  onClick={() => {
                    const t = [termResult.argv && termResult.argv.join(' '), termResult.stdout, termResult.stderr].filter(Boolean).join('\n---\n');
                    navigator.clipboard.writeText(t).then(() => showToast('已复制', 'ok')).catch(() => showToast('复制失败', 'err'));
                  }}
                >
                  复制输出
                </button>
              </div>
              {termAllow && termAllow.programs && (
                <details style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
                  <summary style={{ cursor: 'pointer', color: '#94a3b8' }}>可执行白名单（{termAllow.programs.length}）</summary>
                  <div className="scroll-slim" style={{ maxHeight: 120, overflow: 'auto', marginTop: 6, fontFamily: 'monospace' }}>
                    {termAllow.programs.join(', ')}
                  </div>
                </details>
              )}
              {!termResult ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  输入命令后点击执行；stdout/stderr 将显示在下方。
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: termResult.ok ? '#86efac' : '#fca5a5' }}>
                    exit {termResult.returncode != null ? termResult.returncode : '?'} · cwd {termResult.cwd_display != null && termResult.cwd_display !== '' ? termResult.cwd_display : '.'}
                    {termResult.argv && termResult.argv.length > 0 && (
                      <span style={{ color: '#94a3b8', marginLeft: 8 }}>
                        argv: <code style={{ color: '#cbd5e1' }}>{termResult.argv.join(' ')}</code>
                      </span>
                    )}
                  </div>
                  {termResult.stdout ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>stdout</div>
                      <pre style={{ fontSize: 11, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '36vh', overflow: 'auto', background: '#0f172a', padding: 8, borderRadius: 6, border: '1px solid #334155', margin: 0 }}>{termResult.stdout}</pre>
                    </div>
                  ) : null}
                  {termResult.stderr ? (
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>stderr</div>
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
                  暂无输出；执行后将按 Markdown 渲染
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
                  输出中未解析到 ``` 代码块
                </div>
              ) : (
                <>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label>选择代码块 ({codeBlocks.length})</label>
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
                    className="btn btn-sm"
                    style={{ marginTop: 8, width: '100%', background: '#334155', color: '#94a3b8' }}
                    onClick={() => {
                      navigator.clipboard.writeText(codeBlocks[codeBlockIdx].code).then(() => showToast('已复制', 'ok')).catch(() => {});
                    }}
                  >
                    复制本块
                  </button>
                </>
              )}
            </div>
          )}

          {rightTab === 'gallery' && (
            <div>
              {imageAttachments.length === 0 ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  无图片附件；上传图片后在此大图查看
                </div>
              ) : (
                <div className="scroll-slim" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
                  {imageAttachments.map((a) => (
                    <div key={a.path} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{a.name}</div>
                      <img src={uploadFileUrl(a.path)} alt={a.name} style={{ maxWidth: '100%', borderRadius: 8, border: docPickPath === a.path ? '2px solid #3b82f6' : '1px solid #334155', cursor: 'pointer' }} onClick={() => setDocPickPath(a.path)} />
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
                  无 PDF/Markdown/文本附件
                </div>
              ) : (
                <>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <label>选择附件</label>
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
                        <object data={uploadFileUrl(att.path)} type="application/pdf" width="100%" height="520" style={{ borderRadius: 8, border: '1px solid #334155' }}>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>浏览器无法内嵌 PDF 时，请在新标签打开文件 URL。</div>
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
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>沙箱 iframe，不执行脚本。</div>
              {previewHtml ? (
                <iframe title="preview" sandbox="" srcDoc={previewHtml} style={{ width: '100%', minHeight: 380, border: '1px solid #334155', borderRadius: 6, background: '#fff' }} />
              ) : (
                <div className="empty" style={{ fontSize: 12 }}>
                  尚无 HTML 预览
                </div>
              )}
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 8, width: '100%', background: '#334155', color: '#94a3b8' }}
                onClick={() => {
                  persistSession({ preview_html: '' });
                  setPreviewHtml('');
                  showToast('已清空', 'ok');
                }}
              >
                清空预览
              </button>
            </div>
          )}

          {rightTab === 'wfile' && (
            <div>
              {!workspaceFile || !workspaceFile.ok ? (
                <div className="empty" style={{ fontSize: 12 }}>
                  在左侧目录树中点击文件打开
                </div>
              ) : workspaceFile.binary ? (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{workspaceFile.hint || '无法在 IDE 内预览该文件'}</div>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, wordBreak: 'break-all' }}>
                    {workspaceFile.path} {workspaceFile.truncated ? '（已截断）' : ''}
                  </div>
                  {(workspaceFile.path || '').toLowerCase().endsWith('.md') ? (
                    <div className="scroll-slim" style={{ maxHeight: '64vh', overflow: 'auto' }}>
                      <VibeMarkdownView markdown={workspaceFile.content || ''} />
                    </div>
                  ) : (
                    <pre className="scroll-slim" style={{ maxHeight: '64vh', overflow: 'auto', fontSize: 12, lineHeight: 1.45, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
  const [text, setText] = React.useState('');
  const [err, setErr] = React.useState(null);
  React.useEffect(() => {
    setText('');
    setErr(null);
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setText)
      .catch(() => setErr('无法加载（可能跨域或需登录）'));
  }, [url]);
  if (err) return <div style={{ fontSize: 12, color: '#fca5a5' }}>{err}</div>;
  if (!text) return <div style={{ fontSize: 12, color: '#64748b' }}>加载中…</div>;
  if (isMd) return <VibeMarkdownView markdown={text} />;
  return (
    <pre className="scroll-slim" style={{ maxHeight: '62vh', overflow: 'auto', fontSize: 12, lineHeight: 1.45, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text}
    </pre>
  );
}

function VibeTemplatesPanel() {
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
        <div className="section-title">提示词模板库</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">提示词模板库</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">提示词模板库</div>
        <RefreshBtn onClick={reload} />
      </div>
      <div className="grid-2">
        <div className="card scroll-slim" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {(data || []).length === 0 ? (
            <div className="empty">暂无模板</div>
          ) : (
            (data || []).map((t) => (
              <div key={t.id} className="list-item" style={{ cursor: 'pointer', background: selected && selected.id === t.id ? '#1e3a5f' : '' }} onClick={() => fill(t)}>
                <div style={{ flex: 1 }}>
                  <div className="title">{t.name}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="card">
          {!selected ? (
            <div className="empty">← 选择模板</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{selected.name}</div>
              <textarea
                value={filled}
                onChange={(e) => setFilled(e.target.value)}
                style={{ width: '100%', minHeight: 200, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: 8, borderRadius: 6, fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => {
                  navigator.clipboard.writeText(filled).then(() => showToast('已复制到剪贴板', 'ok')).catch(() => showToast('复制失败', 'err'));
                }}
              >
                📋 复制
              </button>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>复制后到「AI 开发 IDE」粘贴即可。</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VibeHistoryPanel() {
  const { data, loading, error, reload } = useFetch(`${API}/vibe/history`);
  const clear = () => {
    if (!confirm('清空历史？')) return;
    fetch(`${API}/vibe/history`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast('历史已清空', 'ok');
      })
      .catch(() => showToast('清空失败', 'err'));
  };
  if (loading) {
    return (
      <div>
        <div className="section-title">执行历史</div>
        <PageSkeleton cards={1} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">执行历史</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title">执行历史（全局摘要）</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <RefreshBtn onClick={reload} />
          <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={clear}>
            清空
          </button>
        </div>
      </div>
      <div className="card scroll-slim" style={{ maxHeight: 560, overflowY: 'auto' }}>
        {(data || []).length === 0 ? (
          <div className="empty">暂无历史记录</div>
        ) : (
          [...(data || [])].reverse().map((h, i) => (
            <div key={i} className="list-item" style={{ flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>{h.ts && h.ts.slice(0, 16)}</span>
                <span className={`tag ${h.ok ? 'tag-done' : 'tag-p0'}`}>{h.tool}</span>
                <span style={{ flex: 1, fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.prompt}</span>
              </div>
              {h.output && <div style={{ fontSize: 11, color: '#64748b', background: '#0f172a', padding: '4px 8px', borderRadius: 4, maxHeight: 60, overflow: 'hidden' }}>{h.output}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
