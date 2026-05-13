function SkillRepoManager() {
  const [tab,setTab] = React.useState('repos');
  return <div>
    <div style={{display:'flex',gap:4,marginBottom:16}}>
      {[['repos','📦 仓库管理'],['installed','✅ 已安装'],['import','⬆️ 导入技能']].map(([id,l])=>
        <button key={id} className={`btn btn-sm ${tab===id?'btn-primary':''}`} style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{l}</button>)}
    </div>
    {tab==='repos'&&<ReposPanel/>}
    {tab==='installed'&&<InstalledPanel/>}
    {tab==='import'&&<ImportPanel/>}
  </div>;
}

function ReposPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/skill-repo/repos`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({id:'',name:'',url:'',description:'',branch:'main'});
  const [syncing,setSyncing] = React.useState({});

  const save = () => {
    fetch(`${API}/skill-repo/repos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast('仓库已保存','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const del = (id) => {
    fetch(`${API}/skill-repo/repos/${id}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };
  const sync = (id) => {
    setSyncing(p=>({...p,[id]:true}));
    fetch(`${API}/skill-repo/repos/${id}/sync`,{method:'POST'}).then(r=>r.json()).then(d=>{
      setSyncing(p=>({...p,[id]:false}));
      reload();
      if(d.ok){showToast(`同步成功，发现 ${d.skills_found||0} 个技能`,'ok');}
      else showToast('同步失败: '+(d.error||'未知'),'err');
    }).catch(()=>{setSyncing(p=>({...p,[id]:false}));showToast('同步请求失败','err');});
  };

  if (loading) return <div><div className="section-title">技能仓库</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">技能仓库</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">技能仓库</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({id:'',name:'',url:'',description:'',branch:'main'});}}>+ 添加仓库</button>
      </div>
    </div>
    <div className="card">
      {(data||[]).length===0?<div className="empty">暂无技能仓库，点击「添加仓库」配置 Git 仓库</div>:
        (data||[]).map(r=><div key={r.id} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{r.name}</div>
            <div className="meta">{r.url} · 分支: {r.branch}</div>
            {r.skills&&<div className="meta" style={{color:'#86efac'}}>已同步 {r.skills.length} 个技能</div>}
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>sync(r.id)} disabled={syncing[r.id]}>{syncing[r.id]?'同步中...':'↻ 同步'}</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(r.id)}>删除</button>
          </div>
        </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>添加技能仓库</h3>
        <div className="form-group"><label>ID</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value})} placeholder="my-skills"/></div>
        <div className="form-group"><label>名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
        <div className="form-group"><label>Git URL</label><input value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="https://github.com/org/skills-repo.git"/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>分支</label><input value={form.branch} onChange={e=>setForm({...form,branch:e.target.value})}/></div>
          <div className="form-group"><label>描述</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}

function InstalledPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/skill-repo/installed`);
  const toggle = (key) => {
    fetch(`${API}/skill-repo/installed/${key}/toggle`,{method:'PATCH'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('状态已更新','ok');})
      .catch(()=>showToast('操作失败','err'));
  };
  const uninstall = (key) => { if(!confirm('确认卸载？')) return;
    fetch(`${API}/skill-repo/installed/${key}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已卸载','ok');})
      .catch(()=>showToast('卸载失败','err'));
  };
  const entries = Object.entries(data||{});
  if (loading) return <div><div className="section-title">已安装技能</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">已安装技能</div><LoadError message={error} onRetry={reload}/></div>;
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">已安装技能 ({entries.length})</div>
      <RefreshBtn onClick={reload} />
    </div>
    <div className="card">
      {entries.length===0?<div className="empty">暂无已安装技能</div>:
        entries.map(([key,s])=><div key={key} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{(s.data && s.data.name) || s.skill_id}</div>
            <div className="meta">{s.skill_id} · {key} · v{s.version}</div>
          </div>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            <span className={`tag ${s.enabled?'tag-done':'tag-p3'}`}>{s.enabled?'启用':'禁用'}</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>toggle(key)}>{s.enabled?'禁用':'启用'}</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>uninstall(key)}>卸载</button>
          </div>
        </div>)}
    </div>
  </div>;
}

function ImportPanel() {
  const [mode, setMode] = React.useState('descriptor');
  const [form, setForm] = React.useState({
    skill_id: 'CUSTOM-001',
    version: '1.0.0',
    name: '',
    description: '',
    agent_role: 'All',
    trigger: '',
    execution: '',
    npx_package: '',
  });
  const [zipFile, setZipFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [showOverrides, setShowOverrides] = React.useState(false);

  const agentRoles = ['All', 'Planner', 'Coder', 'Reviewer', 'Tester', 'Debugger', 'Worker'];

  const submitJson = () => {
    const sid = (form.skill_id || '').trim();
    if (!sid) {
      showToast('请填写技能 ID', 'err');
      return;
    }
    if (mode === 'npx' && !(form.npx_package || '').trim()) {
      showToast('请填写 npm 包名（将使用 npm pack 拉取，需服务器已安装 npm）', 'err');
      return;
    }
    if (mode === 'descriptor' && !(form.name || '').trim()) {
      showToast('请填写技能名称', 'err');
      return;
    }
    setBusy(true);
    setResult(null);
    const body = {
      mode: mode === 'npx' ? 'npx' : 'descriptor',
      skill_id: sid,
      version: (form.version || '1.0.0').trim(),
      name: (form.name || '').trim(),
      description: (form.description || '').trim(),
      agent_role: form.agent_role || 'All',
      trigger: (form.trigger || '').trim(),
      execution: (form.execution || '').trim(),
      npx_package: mode === 'npx' ? (form.npx_package || '').trim() : '',
    };
    fetch(`${API}/skill-repo/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setBusy(false);
        setResult(d);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : '导入失败', 'err');
          return;
        }
        if (d.ok) showToast('导入成功', 'ok');
        else showToast(d.detail || '导入失败', 'err');
      })
      .catch(() => {
        setBusy(false);
        showToast('请求失败', 'err');
      });
  };

  const submitZip = () => {
    const sid = (form.skill_id || '').trim();
    if (!sid) {
      showToast('请填写技能 ID', 'err');
      return;
    }
    if (!zipFile) {
      showToast('请选择 ZIP 文件', 'err');
      return;
    }
    const fd = new FormData();
    fd.append('skill_id', sid);
    fd.append('version', (form.version || '1.0.0').trim());
    fd.append('file', zipFile);
    setBusy(true);
    setResult(null);
    fetch(`${API}/skill-repo/import/zip`, { method: 'POST', body: fd })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setBusy(false);
        setResult(d);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : '导入失败', 'err');
          return;
        }
        if (d.ok) showToast('ZIP 导入成功', 'ok');
        else showToast(d.detail || '导入失败', 'err');
      })
      .catch(() => {
        setBusy(false);
        showToast('请求失败', 'err');
      });
  };

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>导入 / 开发技能</div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.55 }}>
        选择安装方式，按表单填写即可；服务端会拼装或拉取 <code style={{ color: '#fbbf24' }}>skill.json</code> 结构并写入「已安装」。无需手写 JSON。
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          ['descriptor', '📝 技能描述', '表单填写名称、触发与执行说明'],
          ['npx', '📦 NPM 包', 'npm pack 拉包并读取包内 skill.json'],
          ['zip', '🗜 ZIP 包', '上传含 skill.json 的 ZIP（任意子目录）'],
        ].map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${mode === id ? 'btn-primary' : ''}`}
            style={mode !== id ? { background: '#334155', color: '#94a3b8', maxWidth: 200, textAlign: 'left' } : { maxWidth: 200, textAlign: 'left' }}
            onClick={() => {
              setMode(id);
              setResult(null);
            }}
            title={hint}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          {mode === 'descriptor' && '适用于自建技能：填写展示名与触发/执行说明，由后台生成标准字段。'}
          {mode === 'npx' && '适用于已发布到 npm 的技能包：填写包名（如 @scope/myskill），服务器执行 npm pack 解压后查找 skill.json；可选覆盖部分字段。'}
          {mode === 'zip' && '适用于本地或 CI 打好的技能目录压缩包：ZIP 内需包含至少一个 skill.json。'}
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ fontSize: 14, marginBottom: 10 }}>① 标识与版本</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-group">
            <label>技能 ID *</label>
            <input
              value={form.skill_id}
              onChange={(e) => setForm({ ...form, skill_id: e.target.value })}
              placeholder="CUSTOM-001"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
          <div className="form-group">
            <label>版本</label>
            <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.0.0" />
          </div>
        </div>

        {mode === 'descriptor' && (
          <>
            <div className="section-title" style={{ fontSize: 14, margin: '16px 0 10px' }}>② 技能内容</div>
            <div className="form-group">
              <label>技能名称 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：代码审查助手" />
            </div>
            <div className="form-group">
              <label>描述</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="一句话说明技能用途" style={{ minHeight: 56, fontSize: 13 }} />
            </div>
            <div className="form-group">
              <label>适用角色</label>
              <select value={form.agent_role} onChange={(e) => setForm({ ...form, agent_role: e.target.value })}>
                {agentRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>触发条件</label>
              <textarea value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} placeholder="何时应激活本技能" style={{ minHeight: 64, fontSize: 13 }} />
            </div>
            <div className="form-group">
              <label>执行步骤 / 要点</label>
              <textarea value={form.execution} onChange={(e) => setForm({ ...form, execution: e.target.value })} placeholder="模型应遵循的步骤或检查清单" style={{ minHeight: 120, fontSize: 13 }} />
            </div>
          </>
        )}

        {mode === 'npx' && (
          <>
            <div className="section-title" style={{ fontSize: 14, margin: '16px 0 10px' }}>② NPM 包</div>
            <div className="form-group">
              <label>npm 包名 *</label>
              <input
                value={form.npx_package}
                onChange={(e) => setForm({ ...form, npx_package: e.target.value })}
                placeholder="例如 my-skill-pkg 或 @org/skill-name"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', marginBottom: 10 }} onClick={() => setShowOverrides(!showOverrides)}>
              {showOverrides ? '收起可选覆盖项' : '可选：覆盖包内部分字段'}
            </button>
            {showOverrides && (
              <div style={{ border: '1px solid #334155', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div className="form-group">
                  <label>覆盖名称（留空则用包内）</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>覆盖描述</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 48 }} />
                </div>
                <div className="form-group">
                  <label>覆盖角色</label>
                  <select value={form.agent_role} onChange={(e) => setForm({ ...form, agent_role: e.target.value })}>
                    {agentRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>覆盖触发</label>
                  <textarea value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} style={{ minHeight: 48 }} />
                </div>
                <div className="form-group">
                  <label>覆盖执行说明</label>
                  <textarea value={form.execution} onChange={(e) => setForm({ ...form, execution: e.target.value })} style={{ minHeight: 64 }} />
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'zip' && (
          <>
            <div className="section-title" style={{ fontSize: 14, margin: '16px 0 10px' }}>② 上传 ZIP</div>
            <div className="form-group">
              <label>选择文件 *</label>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  setZipFile(e.target.files && e.target.files[0] ? e.target.files[0] : null);
                  setResult(null);
                }}
              />
              {zipFile && <div className="meta" style={{ marginTop: 6 }}>已选：{zipFile.name}</div>}
            </div>
          </>
        )}

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 12 }}
          disabled={busy}
          onClick={() => (mode === 'zip' ? submitZip() : submitJson())}
        >
          {busy ? '导入中…' : mode === 'zip' ? '⬆️ 上传并导入 ZIP' : '⬆️ 导入技能'}
        </button>

        {result && (
          <div style={{ marginTop: 12, fontSize: 12, color: result.ok ? '#86efac' : '#fca5a5' }}>
            {result.ok ? `✅ 导入成功 · ${result.key || ''}${result.resolved_from ? `（来自 ${result.resolved_from}）` : ''}` : `❌ ${typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail || result)}`}
          </div>
        )}
      </div>
    </div>
  );
}
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
