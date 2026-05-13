function DockerEnvManager() {
  const [tab, setTab] = React.useState('check');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ['check', '🔍 环境检查'],
          ['containers', '📦 容器'],
          ['images', '🖼 镜像'],
          ['presets', '⚡ 预设'],
          ['run', '▶ 运行'],
          ['build', '🔨 构建'],
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
      {tab === 'check' && <EnvCheckPanel />}
      {tab === 'containers' && <ContainersPanel />}
      {tab === 'images' && <ImagesPanel />}
      {tab === 'presets' && <PresetsPanel />}
      {tab === 'run' && <DockerRunPanel />}
      {tab === 'build' && <BuildPanel />}
    </div>
  );
}

function EnvCheckPanel() {
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
        showToast('环境检查失败', 'err');
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
          showToast(typeof d.detail === 'string' ? d.detail : 'AI 诊断失败', 'err');
          return;
        }
        setAiMd(d.markdown || '');
        setAiOpen(true);
      })
      .catch(() => {
        setAiBusy(false);
        showToast('请求失败', 'err');
      });
  };

  const remediate = (action) => {
    if (!confirm(action === 'install_integrations' ? '将执行 sop/tools/install-integrations.sh（可能较久），继续？' : '将执行 sop/tools/health-check.sh，继续？')) return;
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
          const msg = typeof d.detail === 'string' ? d.detail : (Array.isArray(d.detail) ? d.detail.map((x) => x.msg || '').join(';') : 'HTTP 错误');
          showToast(msg, 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '命令非零退出').slice(0, 240), 'err');
          run();
          return;
        }
        showToast('命令已执行', 'ok');
        run();
      })
      .catch(() => {
        setRemBusy(null);
        showToast('请求失败', 'err');
      });
  };

  const savePins = () => {
    let j;
    try {
      j = JSON.parse(pinJson || '{}');
    } catch (e) {
      showToast('版本约束 JSON 无法解析', 'err');
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
        showToast('版本约束已保存', 'ok');
        run();
      })
      .catch(() => showToast('保存失败', 'err'));
  };

  const addCustomCheck = () => {
    let argv = null;
    if (formCustom.kind !== 'file_exists') {
      try {
        argv = JSON.parse(formCustom.argvText || '[]');
      } catch (e) {
        showToast('argv 须为 JSON 数组，如 [\"which\",\"git\"]', 'err');
        return;
      }
      if (!Array.isArray(argv)) {
        showToast('argv 须为数组', 'err');
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
          showToast(typeof d.detail === 'string' ? d.detail : '添加失败', 'err');
          return;
        }
        showToast('已添加自定义检查', 'ok');
        setFormCustom({name: '', kind: 'command', argvText: '["which", "git"]', path: '', min_semver: '', timeout_sec: 15});
        run();
      })
      .catch(() => showToast('请求失败', 'err'));
  };

  const delCustom = (id) => {
    if (!confirm(`删除检查 ${id}？`)) return;
    fetch(`${API}/env/custom-checks/${encodeURIComponent(id)}`, {method: 'DELETE'})
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast('已删除', 'ok');
        run();
      })
      .catch(() => showToast('删除失败', 'err'));
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
          showToast(d.detail || '失败', 'err');
          return;
        }
        showToast('已追加命令白名单（.ai-memory/env_exec_allowlist_extra.json）', 'ok');
        setAllowBin('');
      })
      .catch(() => showToast('请求失败', 'err'));
  };

  const bi = (full && full.builtin) || {};
  const groups = full
    ? {
        开发工具: ['claude', 'opencode', 'git'],
        'Python 包': Object.keys(bi).filter((k) => k.startsWith('py:')),
        运行时: ['python3', 'java', 'mvn', 'node', 'npm', 'pnpm', 'go', 'uv'],
        Docker: ['docker', 'docker-compose'],
      }
    : {};

  return (
    <div>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8}}>
        <div>
          <div className="section-title">环境检查</div>
          <div style={{fontSize: 11, color: '#64748b', marginTop: 4}}>内置项 + 自定义命令/文件/版本；版本约束用于提示；AI 生成修复步骤；受控一键执行安装/健康脚本。</div>
        </div>
        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
          <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
            {loading ? '检查中...' : '↻ 重新检查'}
          </button>
          <button type="button" className="btn btn-sm" style={{background: '#4f46e5', color: '#fff'}} onClick={runAiPlan} disabled={aiBusy || loading}>
            {aiBusy ? 'AI 分析中...' : '🤖 AI 诊断与修复建议'}
          </button>
          <button type="button" className="btn btn-sm" style={{background: '#334155', color: '#94a3b8'}} disabled={!!remBusy} onClick={() => remediate('install_integrations')}>
            {remBusy === 'install_integrations' ? '执行中...' : '⚡ 安装 Python 集成依赖'}
          </button>
          <button type="button" className="btn btn-sm" style={{background: '#334155', color: '#94a3b8'}} disabled={!!remBusy} onClick={() => remediate('health_check')}>
            {remBusy === 'health_check' ? '执行中...' : '🩺 运行 health-check'}
          </button>
        </div>
      </div>

      {full && (full.pin_warnings || []).length > 0 && (
        <div className="card" style={{marginBottom: 10, borderColor: '#f59e0b'}}>
          <div className="section-title" style={{color: '#fdba74'}}>版本约束提示</div>
          {(full.pin_warnings || []).map((w, i) => (
            <div key={i} className="meta" style={{color: '#fed7aa'}}>
              {w}
            </div>
          ))}
        </div>
      )}

      {full &&
        Object.entries(groups).map(([g, keys]) => (
          <div key={g} className="card" style={{marginBottom: 10}}>
            <div className="section-title">{g}</div>
            {keys
              .filter((k) => bi[k])
              .map((k) => (
                <div key={k} className="list-item">
                  <div style={{flex: 1}}>
                    <div className="title">{k.replace('py:', '')}</div>
                    <div className="meta">{bi[k].version || '-'}</div>
                  </div>
                  <span className={`tag ${bi[k].available ? 'tag-done' : 'tag-p0'}`}>{bi[k].available ? '✅ 可用' : '❌ 缺失'}</span>
                </div>
              ))}
          </div>
        ))}

      {full && (full.custom_catalog || []).length > 0 && (
        <div className="card" style={{marginBottom: 10}}>
          <div className="section-title">自定义检查</div>
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
                <button type="button" className="btn btn-sm" style={{background: '#451a1a', color: '#fca5a5'}} onClick={() => delCustom(c.id)}>
                  删除
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{marginBottom: 10}}>
        <div className="section-title">添加自定义检查</div>
        <p style={{fontSize: 11, color: '#64748b', marginBottom: 8}}>
          command / version_command 的 argv 为 JSON 数组，首项须在命令白名单（可下方追加）。file_exists 填写相对项目根的路径。
        </p>
        <div className="form-group">
          <label>名称</label>
          <input value={formCustom.name} onChange={(e) => setFormCustom({...formCustom, name: e.target.value})} placeholder="例如：公司 Nexus 可达性" />
        </div>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
          <div className="form-group">
            <label>类型</label>
            <select value={formCustom.kind} onChange={(e) => setFormCustom({...formCustom, kind: e.target.value})}>
              <option value="command">command（返回码 0 为通过）</option>
              <option value="file_exists">file_exists</option>
              <option value="version_command">version_command（需 min_semver）</option>
            </select>
          </div>
          <div className="form-group">
            <label>超时（秒）</label>
            <input type="number" value={formCustom.timeout_sec} onChange={(e) => setFormCustom({...formCustom, timeout_sec: e.target.value})} />
          </div>
        </div>
        {formCustom.kind === 'file_exists' ? (
          <div className="form-group">
            <label>路径（相对项目根）</label>
            <input value={formCustom.path} onChange={(e) => setFormCustom({...formCustom, path: e.target.value})} placeholder="sop/tools/health-check.sh" />
          </div>
        ) : (
          <div className="form-group">
            <label>argv（JSON 数组）</label>
            <textarea value={formCustom.argvText} onChange={(e) => setFormCustom({...formCustom, argvText: e.target.value})} style={{minHeight: 56, fontFamily: 'monospace', fontSize: 12}} />
          </div>
        )}
        {formCustom.kind === 'version_command' && (
          <div className="form-group">
            <label>最低版本（如 &gt;=18 或 18.0）</label>
            <input value={formCustom.min_semver} onChange={(e) => setFormCustom({...formCustom, min_semver: e.target.value})} placeholder=">=18" />
          </div>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={addCustomCheck}>
          添加
        </button>
      </div>

      <div className="card" style={{marginBottom: 10}}>
        <div className="section-title">版本约束（JSON）</div>
        <textarea value={pinJson} onChange={(e) => setPinJson(e.target.value)} style={{minHeight: 120, fontFamily: 'monospace', fontSize: 12, width: '100%'}} />
        <button type="button" className="btn btn-primary btn-sm" style={{marginTop: 8}} onClick={savePins}>
          保存版本约束
        </button>
      </div>

      <div className="card" style={{marginBottom: 10}}>
        <div className="section-title">命令白名单扩展</div>
        <p style={{fontSize: 11, color: '#64748b', marginBottom: 8}}>自定义检查 argv 首段必须在此列表；写入 .ai-memory/env_exec_allowlist_extra.json。</p>
        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
          <input value={allowBin} onChange={(e) => setAllowBin(e.target.value)} placeholder="例如：gradle" style={{flex: 1, minWidth: 120}} />
          <button type="button" className="btn btn-sm" style={{background: '#334155', color: '#e2e8f0'}} onClick={appendAllow}>
            追加
          </button>
        </div>
      </div>

      {aiOpen && (
        <div className="modal-bg" onClick={() => setAiOpen(false)}>
          <div className="modal" style={{width: Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 24 : 720), maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto'}} onClick={(e) => e.stopPropagation()}>
            <h3>AI 环境诊断</h3>
            <p style={{fontSize: 12, color: '#64748b', marginBottom: 8}}>以下为模型根据当前检查结果生成的建议，请在审查后于终端或 CI 中执行；受控一键操作请使用上方「安装 Python 集成依赖」等按钮。</p>
            <pre style={{whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, color: '#e2e8f0', maxHeight: '60vh', overflow: 'auto'}}>{aiMd}</pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setAiOpen(false)}>
                关闭
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(aiMd).then(() => showToast('已复制', 'ok')).catch(() => showToast('复制失败', 'err'));
                }}
              >
                复制全文
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContainersPanel() {
  const [scope, setScope] = React.useState('running');
  const url = scope === 'all' ? `${API}/env/docker/ps-all` : `${API}/env/docker/ps`;
  const { data, loading, error, reload } = useFetch(url);

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
        showToast('已停止', 'ok');
      })
      .catch(() => showToast('停止失败', 'err'));
  };

  const startC = (name) => {
    if (!name) return;
    fetch(`${API}/env/docker/start/${encodeURIComponent(name)}`, { method: 'POST' })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : '启动失败', 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '').slice(0, 200), 'err');
        } else {
          showToast('已启动', 'ok');
        }
        reload();
      })
      .catch(() => showToast('请求失败', 'err'));
  };

  const remove = (name) => {
    if (!name) return;
    if (!confirm(`删除容器 ${name}？`)) return;
    fetch(`${API}/env/docker/remove/${encodeURIComponent(name)}`, { method: 'POST' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast('已删除', 'ok');
      })
      .catch(() => showToast('删除失败', 'err'));
  };

  if (loading) {
    return (
      <div>
        <div className="section-title">容器</div>
        <PageSkeleton cards={1} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">容器</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  const rows = (data && data.containers) || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="section-title">容器</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>查看运行中或全部容器；停止、启动（已停止）、删除（强制）。名称来自 docker ps JSON。</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
            <option value="running">仅运行中</option>
            <option value="all">全部（含已退出）</option>
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
      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">无容器</div>
        ) : (
          rows.map((c) => {
            const name = cname(c);
            const st = String(c.Status || c.State || '');
            const running = /Up /i.test(st) || String(c.State || '').toLowerCase() === 'running';
            return (
              <div key={c.ID || name} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div className="title">{name || c.ID}</div>
                  <div className="meta">
                    {c.Image} · {st} · {c.Ports || '-'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  {running ? (
                    <button type="button" className="btn btn-sm btn-warn" onClick={() => stop(name)}>
                      停止
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => startC(name)}>
                      启动
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} onClick={() => remove(name)}>
                    删除
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ImagesPanel() {
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
          showToast(typeof d.detail === 'string' ? d.detail : '拉取失败', 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '').slice(0, 240), 'err');
        } else {
          showToast('拉取完成', 'ok');
        }
        reload();
      })
      .catch(() => {
        setPullBusy(false);
        showToast('请求失败', 'err');
      });
  };

  const rmi = (ref) => {
    if (!confirm(`删除镜像 ${ref}？`)) return;
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
          showToast(typeof d.detail === 'string' ? d.detail : '删除失败', 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '').slice(0, 240), 'err');
        } else {
          showToast('已删除镜像', 'ok');
        }
        reload();
      })
      .catch(() => {
        setRmBusy(null);
        showToast('请求失败', 'err');
      });
  };

  if (loading) {
    return (
      <div>
        <div className="section-title">镜像</div>
        <PageSkeleton cards={1} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">镜像</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );
  }

  const imgs = (data && data.images) || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="section-title">本地镜像</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>列表来自 docker images；可拉取新镜像或删除引用（镜像 ID 或 name:tag）。</div>
        </div>
        <RefreshBtn onClick={reload} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title">拉取镜像</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input value={pullImg} onChange={(e) => setPullImg(e.target.value)} placeholder="例如 redis:7 或 ghcr.io/org/img:tag" style={{ flex: 1, minWidth: 200, fontFamily: 'monospace', fontSize: 12 }} />
          <button type="button" className="btn btn-sm btn-primary" disabled={pullBusy} onClick={pull}>
            {pullBusy ? '拉取中…' : 'docker pull'}
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
          <div className="empty">无镜像或 docker 不可用</div>
        ) : (
          imgs.map((im) => {
            const repo = im.Repository || im.repository || '';
            const tag = im.Tag || im.tag || '';
            const ref = repo && tag && tag !== '<none>' ? `${repo}:${tag}` : im.ID || im.Id || '';
            return (
              <div key={im.ID || im.Id || ref} className="list-item">
                <div style={{ flex: 1 }}>
                  <div className="title">{repo || '(无仓库名)'}</div>
                  <div className="meta">
                    {tag} · {im.Size || im.size || '-'} · {im.ID || im.Id || '-'}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" style={{ background: '#7f1d1d', color: '#fca5a5' }} disabled={!ref || rmBusy === ref} onClick={() => rmi(ref)}>
                  {rmBusy === ref ? '…' : '删除'}
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
        if (d.ok) showToast(`${key} 已下发 docker run`, 'ok');
        else showToast('启动失败', 'err');
      })
      .catch(() => {
        setStarting((p) => ({ ...p, [key]: false }));
        showToast('请求失败', 'err');
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
      showToast('请填写 key', 'err');
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
          showToast(typeof d.detail === 'string' ? d.detail : '保存失败', 'err');
          return;
        }
        showToast(isEdit ? '已更新' : '已添加', 'ok');
        setModal(null);
        setForm({ key: '', label: '', image: '', container_name: '', portsText: '', envText: '', volumesText: '', restart: '' });
        reload();
      })
      .catch(() => showToast('请求失败', 'err'));
  };

  const delCustom = (id) => {
    if (!confirm('删除该自定义预设？')) return;
    fetch(`${API}/env/docker/custom-presets/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        showToast('已删除', 'ok');
        reload();
      })
      .catch(() => showToast('删除失败', 'err'));
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
        <div className="section-title">预设</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="section-title">预设</div>
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
          <div className="section-title">快速启动预设</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>内置常用数据库/中间件；自定义预设持久化在 .ai-memory/docker_custom_presets.json，支持端口、环境变量、卷（项目内路径:容器绝对路径）、restart 策略。</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => { setModal('add'); setForm({ key: '', label: '', image: '', container_name: '', portsText: '', envText: '', volumesText: '', restart: '' }); }}>
            ＋ 自定义预设
          </button>
          <RefreshBtn onClick={reload} />
        </div>
      </div>

      <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
        内置
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
                {starting[name] ? '启动中...' : '▶ 启动'}
              </button>
            </div>
            <div className="meta">{cfg.image}</div>
            <div className="meta">端口: {(cfg.ports && cfg.ports.join(', ')) || ''}</div>
            {results[name] && (
              <div style={{ marginTop: 6, fontSize: 11, color: results[name].ok ? '#86efac' : '#fca5a5', background: '#0f172a', padding: '4px 8px', borderRadius: 4 }}>
                {results[name].ok ? '✅ 已执行' : `❌ ${(results[name].stderr || results[name].stdout || '').slice(0, 120)}`}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="section-title" style={{ fontSize: 13, margin: '16px 0 8px' }}>
        自定义
      </div>
      <div className="card">
        {custom.length === 0 ? (
          <div className="empty" style={{ fontSize: 12 }}>
            暂无自定义预设，点击「＋ 自定义预设」添加。
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
                    {row.image} · 容器名 {row.container_name || '-'} · restart {row.restart || '-'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <button type="button" className="btn btn-sm btn-primary" disabled={starting[row.key]} onClick={() => start(row.key)}>
                    {starting[row.key] ? '…' : '▶ 启动'}
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#e2e8f0' }} onClick={() => openEdit(row)}>
                    编辑
                  </button>
                  <button type="button" className="btn btn-sm" style={{ background: '#451a1a', color: '#fca5a5' }} onClick={() => delCustom(row.id)}>
                    删除
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
            <h3>{modal === 'edit' ? '编辑自定义预设' : '添加自定义预设'}</h3>
            <p style={{ fontSize: 11, color: '#64748b' }}>key 不可与内置 mysql/redis 等重名；volume 每行「相对项目根路径:容器内绝对路径」如 data/pg:/var/lib/postgresql/data。</p>
            {modal !== 'edit' && (
              <div className="form-group">
                <label>key（小写，唯一）</label>
                <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="my-pg" />
              </div>
            )}
            <div className="form-group">
              <label>显示名称</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div className="form-group">
              <label>镜像</label>
              <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="postgres:16" style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>容器名（可选）</label>
              <input value={form.container_name} onChange={(e) => setForm({ ...form, container_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>端口映射（每行 host:port 或逗号分隔）</label>
              <textarea value={form.portsText} onChange={(e) => setForm({ ...form, portsText: e.target.value })} style={{ minHeight: 56, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>环境变量（每行 KEY=value）</label>
              <textarea value={form.envText} onChange={(e) => setForm({ ...form, envText: e.target.value })} style={{ minHeight: 56, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>卷（每行 项目相对路径:容器绝对路径）</label>
              <textarea value={form.volumesText} onChange={(e) => setForm({ ...form, volumesText: e.target.value })} style={{ minHeight: 56, fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>restart（可选：unless-stopped / always / on-failure）</label>
              <input value={form.restart} onChange={(e) => setForm({ ...form, restart: e.target.value })} placeholder="留空表示默认" />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setModal(null)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={saveCustom}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DockerRunPanel() {
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
      showToast('请填写镜像', 'err');
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
          showToast('请求被拒绝', 'err');
          return;
        }
        setOut(d);
        if (d.ok) showToast('docker run 已执行', 'ok');
        else showToast('docker 返回非零', 'err');
      })
      .catch(() => {
        setBusy(false);
        showToast('请求失败', 'err');
      });
  };

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>
        自定义 docker run
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
        参数经服务端校验：端口 host:port、环境变量 KEY=value、卷须为项目内路径映射到容器绝对路径；镜像引用禁止 .. 与换行。
      </div>
      <div className="card">
        <div className="form-group">
          <label>镜像 *</label>
          <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="nginx:alpine" style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>容器名</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>端口（每行或逗号分隔，如 8080:80）</label>
          <textarea value={form.portsText} onChange={(e) => setForm({ ...form, portsText: e.target.value })} style={{ minHeight: 48, fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>环境变量（每行）</label>
          <textarea value={form.envText} onChange={(e) => setForm({ ...form, envText: e.target.value })} style={{ minHeight: 48, fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>卷（每行 相对项目路径:容器路径）</label>
          <textarea value={form.volumesText} onChange={(e) => setForm({ ...form, volumesText: e.target.value })} style={{ minHeight: 48, fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div className="form-group">
          <label>restart</label>
          <input value={form.restart} onChange={(e) => setForm({ ...form, restart: e.target.value })} placeholder="unless-stopped" />
        </div>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <input type="checkbox" checked={form.detach} onChange={(e) => setForm({ ...form, detach: e.target.checked })} /> 后台运行 (-d)
        </label>
        <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={run}>
          {busy ? '执行中…' : '▶ 执行 docker run'}
        </button>
      </div>
      {out && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="section-title" style={{ color: out.ok ? '#86efac' : '#fca5a5', fontSize: 13 }}>
            {out.ok ? '✅ 完成' : '❌ 失败'} {out.returncode != null ? `(exit ${out.returncode})` : ''}
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

function BuildPanel() {
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
        if (d.ok) showToast('构建完成', 'ok');
        else showToast('构建失败', 'err');
      })
      .catch(() => {
        setBuilding(false);
        showToast('请求失败', 'err');
      });
  };
  return (
    <div>
      <div className="section-title" style={{ marginBottom: 12 }}>
        构建 Docker 镜像
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
        Dockerfile 与上下文路径须位于 PROJECT_PATH 下（防路径穿越）；构建在服务端执行，大项目可能较慢。
      </div>
      <div className="card">
        <div className="form-group">
          <label>镜像标签</label>
          <input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="my-app:latest" style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-group">
            <label>Dockerfile（相对项目根）</label>
            <input value={form.dockerfile} onChange={(e) => setForm({ ...form, dockerfile: e.target.value })} />
          </div>
          <div className="form-group">
            <label>构建上下文</label>
            <input value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} />
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={build} disabled={building} style={{ width: '100%' }}>
          {building ? '构建中（可能需要数分钟）...' : '🔨 开始构建'}
        </button>
      </div>
      {result && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="section-title" style={{ color: result.ok ? '#86efac' : '#fca5a5' }}>
            {result.ok ? '✅ 构建成功' : '❌ 构建失败'}
          </div>
          <pre style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>{result.stdout || result.stderr}</pre>
        </div>
      )}
    </div>
  );
}
