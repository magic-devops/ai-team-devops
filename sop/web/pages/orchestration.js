function OrchestrationManager() {
  const [tab,setTab] = React.useState('tools');
  return <div>
    <div style={{display:'flex',gap:4,marginBottom:16}}>
      {[['tools','🔧 开发工具'],['workflows','🔄 工作流'],['quality','✅ 质量配置'],['versions','🏷️ 版本管理']].map(([id,l])=>
        <button key={id} className={`btn btn-sm ${tab===id?'btn-primary':''}`} style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{l}</button>)}
    </div>
    {tab==='tools'&&<DevToolsPanel/>}
    {tab==='workflows'&&<WorkflowPanel/>}
    {tab==='quality'&&<QualityConfigPanel/>}
    {tab==='versions'&&<VersionPanel/>}
  </div>;
}

function DevToolsPanel() {
  const {data, loading: lt, error: et, reload} = useFetch(`${API}/orchestration/tools`);
  const {data: meta, reload: reloadMeta} = useFetch(`${API}/orchestration/tools/meta`);
  const {data: cfg, loading: lc, error: ec, reload: reloadCfg} = useFetch(`${API}/orchestration/config`);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(null);
  const [form, setForm] = React.useState({id: '', name: '', cmd: '', description: ''});
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiMd, setAiMd] = React.useState('');
  const [aiBusy, setAiBusy] = React.useState(false);
  const [instBusy, setInstBusy] = React.useState(null);

  const loading = lt || lc;
  const errText = et || ec;
  const reloadAll = () => {
    reload();
    reloadCfg();
    reloadMeta();
  };

  const setDefault = (id) => {
    fetch(`${API}/orchestration/config`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({default_tool: id})})
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadCfg();
        showToast('已设为默认工具', 'ok');
      })
      .catch(() => showToast('设置失败', 'err'));
  };

  const openAdd = () => {
    setForm({id: '', name: '', cmd: '', description: ''});
    setAddOpen(true);
  };
  const openEdit = (t) => {
    setEditOpen(t);
    setForm({id: t.id, name: t.name || '', cmd: t.cmd || '', description: t.description || ''});
  };

  const saveNew = () => {
    fetch(`${API}/orchestration/tools`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: form.id.trim(), name: form.name.trim(), cmd: form.cmd.trim(), description: form.description.trim()}),
    })
      .then((r) => r.json().then((d) => ({ok: r.ok, d})))
      .then(({ok, d}) => {
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : '创建失败', 'err');
          return;
        }
        setAddOpen(false);
        reloadAll();
        showToast('已添加工具', 'ok');
      })
      .catch(() => showToast('请求失败', 'err'));
  };

  const saveEdit = () => {
    const id = editOpen && editOpen.id;
    if (!id) return;
    fetch(`${API}/orchestration/tools/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: form.name.trim(), cmd: form.cmd.trim(), description: form.description.trim()}),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        setEditOpen(null);
        reloadAll();
        showToast('已保存', 'ok');
      })
      .catch(() => showToast('保存失败', 'err'));
  };

  const delCustom = (id) => {
    if (!confirm(`删除自定义工具 ${id}？`)) return;
    fetch(`${API}/orchestration/tools/${encodeURIComponent(id)}`, {method: 'DELETE'})
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast('已删除', 'ok');
      })
      .catch(() => showToast('删除失败', 'err'));
  };

  const hideBuiltin = (id) => {
    if (!confirm(`从列表隐藏内置工具「${id}」？可在下方已隐藏列表恢复。`)) return;
    fetch(`${API}/orchestration/tools/hide`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})})
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast('已隐藏', 'ok');
      })
      .catch(() => showToast('操作失败', 'err'));
  };

  const unhideBuiltin = (id) => {
    fetch(`${API}/orchestration/tools/unhide`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})})
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reloadAll();
        showToast('已恢复显示', 'ok');
      })
      .catch(() => showToast('操作失败', 'err'));
  };

  const runAiPlan = (toolId) => {
    setAiBusy(true);
    fetch(`${API}/orchestration/tools/ai-install-plan`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tool_id: toolId || undefined, goal: toolId ? undefined : '为当前项目准备常用 AI 开发 CLI 环境'}),
    })
      .then((r) => r.json().then((d) => ({ok: r.ok, d})))
      .then(({ok, d}) => {
        setAiBusy(false);
        if (!ok) {
          showToast(typeof d.detail === 'string' ? d.detail : 'AI 失败', 'err');
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

  const runGuardInstall = (recipeId) => {
    if (!confirm('将执行受控安装命令（npm/pip），可能需数分钟，继续？')) return;
    setInstBusy(recipeId);
    fetch(`${API}/orchestration/tools/install-guarded`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({recipe_id: recipeId}),
    })
      .then((r) => r.json().then((d) => ({httpOk: r.ok, d})))
      .then(({httpOk, d}) => {
        setInstBusy(null);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : 'HTTP 错误', 'err');
          return;
        }
        if (!d.ok) {
          showToast((d.stderr || d.stdout || '安装失败').slice(0, 220), 'err');
        } else {
          showToast('安装命令已执行', 'ok');
        }
        reloadAll();
      })
      .catch(() => {
        setInstBusy(null);
        showToast('请求失败', 'err');
      });
  };

  if (loading) return <div><PageSkeleton cards={1}/></div>;
  if (errText) return <LoadError message={errText} onRetry={reloadAll}/>;

  const hidden = (meta && meta.hidden) || [];

  return (
    <div>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8}}>
        <div>
          <div className="section-title">
            开发工具 · 默认: <span style={{color: '#3b82f6'}}>{(cfg && cfg.default_tool) || 'claude'}</span>
          </div>
          <div style={{fontSize: 11, color: '#64748b', marginTop: 4}}>支持新增自定义工具、修改显示名/命令/说明（内置为覆盖配置）、AI 安装说明与受控一键安装（npm/pip 白名单）。</div>
        </div>
        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
          <RefreshBtn onClick={reloadAll} />
          <button type="button" className="btn btn-sm" style={{background: '#4f46e5', color: '#fff'}} disabled={aiBusy} onClick={() => runAiPlan(null)}>
            {aiBusy ? '…' : '🤖 AI 安装/环境说明'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
            ＋ 添加工具
          </button>
        </div>
      </div>

      <div className="card">
        {(data || []).map((t) => (
          <div key={t.id} className="list-item" style={{alignItems: 'flex-start'}}>
            <div style={{flex: 1}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                <span className="title">{t.name}</span>
                <span className={`tag ${t.available ? 'tag-done' : 'tag-p0'}`}>{t.available ? '已安装' : '未安装'}</span>
                {cfg && cfg.default_tool === t.id && <span className="tag tag-progress">默认</span>}
                <span className="tag tag-p2">{t.source === 'custom' ? '自定义' : '内置'}</span>
              </div>
              <div className="meta">
                {t.description} · 命令: <code style={{color: '#93c5fd'}}>{t.cmd}</code>
                {t.guard_install_recipe && <span style={{marginLeft: 8, fontSize: 11, color: '#64748b'}}>recipe: {t.guard_install_recipe}</span>}
              </div>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end'}}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDefault(t.id)}>
                设为默认
              </button>
              <button type="button" className="btn btn-sm" style={{background: '#334155', color: '#e2e8f0'}} onClick={() => openEdit(t)}>
                编辑
              </button>
              <button type="button" className="btn btn-sm" style={{background: '#334155', color: '#e2e8f0'}} disabled={aiBusy} onClick={() => runAiPlan(t.id)}>
                AI 安装说明
              </button>
              {t.guard_install_recipe && !t.available && (
                <button type="button" className="btn btn-sm btn-primary" disabled={!!instBusy} onClick={() => runGuardInstall(t.guard_install_recipe)}>
                  {instBusy === t.guard_install_recipe ? '安装中…' : '受控一键安装'}
                </button>
              )}
              {t.source === 'custom' && (
                <button type="button" className="btn btn-sm" style={{background: '#7f1d1d', color: '#fca5a5'}} onClick={() => delCustom(t.id)}>
                  删除
                </button>
              )}
              {t.source === 'builtin' && (
                <button type="button" className="btn btn-sm" style={{background: '#451a1a', color: '#fca5a5'}} onClick={() => hideBuiltin(t.id)}>
                  隐藏
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {hidden.length > 0 && (
        <div className="card" style={{marginTop: 12}}>
          <div className="section-title">已隐藏的内置工具</div>
          {hidden.map((hid) => (
            <div key={hid} className="list-item">
              <div className="title">{hid}</div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => unhideBuiltin(hid)}>
                恢复显示
              </button>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <div className="modal-bg" onClick={() => setAddOpen(false)}>
          <div className="modal" style={{width: 480}} onClick={(e) => e.stopPropagation()}>
            <h3>添加自定义开发工具</h3>
            <div className="form-group">
              <label>ID（小写，唯一）</label>
              <input value={form.id} onChange={(e) => setForm({...form, id: e.target.value})} placeholder="my-cli" />
            </div>
            <div className="form-group">
              <label>显示名称</label>
              <input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>可执行命令名（PATH）</label>
              <input value={form.cmd} onChange={(e) => setForm({...form, cmd: e.target.value})} placeholder="mycli" />
            </div>
            <div className="form-group">
              <label>说明</label>
              <textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} style={{minHeight: 64}} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setAddOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={saveNew}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="modal-bg" onClick={() => setEditOpen(null)}>
          <div className="modal" style={{width: 480}} onClick={(e) => e.stopPropagation()}>
            <h3>编辑工具 · {editOpen.id}</h3>
            <p style={{fontSize: 11, color: '#64748b'}}>{editOpen.source === 'builtin' ? '内置工具：修改将写入覆盖配置（不改动代码内建表）。' : '自定义工具：直接更新存储。'}</p>
            <div className="form-group">
              <label>显示名称</label>
              <input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>命令</label>
              <input value={form.cmd} onChange={(e) => setForm({...form, cmd: e.target.value})} />
            </div>
            <div className="form-group">
              <label>说明</label>
              <textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} style={{minHeight: 64}} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setEditOpen(null)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={saveEdit}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {aiOpen && (
        <div className="modal-bg" onClick={() => setAiOpen(false)}>
          <div className="modal" style={{width: Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 24 : 720), maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto'}} onClick={(e) => e.stopPropagation()}>
            <h3>AI 安装 / 环境说明</h3>
            <pre style={{whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.55, color: '#e2e8f0', maxHeight: '60vh', overflow: 'auto'}}>{aiMd}</pre>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setAiOpen(false)}>
                关闭
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => navigator.clipboard.writeText(aiMd).then(() => showToast('已复制', 'ok')).catch(() => showToast('复制失败', 'err'))}
              >
                复制
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/orchestration/workflows`);
  const {data:tools} = useFetch(`${API}/orchestration/tools`);
  const {data:agents} = useFetch(`${API}/agents/builtin`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({id:'',name:'',description:'',dev_tool:'claude',steps:[]});

  const save = () => {
    fetch(`${API}/orchestration/workflows`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast('工作流已保存','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const del = (id) => {
    fetch(`${API}/orchestration/workflows/${id}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };
  const addStep = () => setForm({...form,steps:[...form.steps,{agent:'Planner',tool:form.dev_tool,skill:'',prompt_template:''}]});

  if (loading) return <div><PageSkeleton cards={1}/></div>;
  if (error) return <LoadError message={error} onRetry={reload}/>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">工作流定义</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({id:'',name:'',description:'',dev_tool:'claude',steps:[]});}}>+ 新建工作流</button>
      </div>
    </div>
    <div className="card">
      {(data||[]).length===0?<div className="empty">暂无工作流，点击「新建工作流」创建 Agent 编排流程</div>:
        (data||[]).map(w=><div key={w.id} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{w.name}</div>
            <div className="meta">{w.description} · {(w.steps && w.steps.length) || 0} 步骤 · 工具: {w.dev_tool}</div>
          </div>
          <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(w.id)}>删除</button>
        </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" style={{width:560,maxHeight:'80vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
        <h3>新建工作流</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>ID</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value})} placeholder="my-workflow"/></div>
          <div className="form-group"><label>名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
        </div>
        <div className="form-group"><label>描述</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>默认开发工具</label>
          <select value={form.dev_tool} onChange={e=>setForm({...form,dev_tool:e.target.value})}>
            {(tools || []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.available ? '（未安装）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{marginBottom:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <span style={{fontSize:12,color:'#94a3b8'}}>步骤 ({form.steps.length})</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={addStep}>+ 添加步骤</button>
          </div>
          {form.steps.map((step,i)=><div key={i} style={{background:'#0f172a',borderRadius:6,padding:8,marginBottom:6}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:6}}>
              <select style={{background:'#1e293b',border:'1px solid #334155',color:'#e2e8f0',padding:'4px',borderRadius:4,fontSize:12}}
                value={step.agent} onChange={e=>{const s=[...form.steps];s[i]={...s[i],agent:e.target.value};setForm({...form,steps:s});}}>
                {(agents||[]).map(a=><option key={a.id} value={a.role}>{a.name}</option>)}
              </select>
              <input style={{background:'#1e293b',border:'1px solid #334155',color:'#e2e8f0',padding:'4px 8px',borderRadius:4,fontSize:12}}
                value={step.skill||''} onChange={e=>{const s=[...form.steps];s[i]={...s[i],skill:e.target.value};setForm({...form,steps:s});}} placeholder="技能 ID（可选）"/>
            </div>
            <div style={{display:'flex',gap:4}}>
              <input style={{flex:1,background:'#1e293b',border:'1px solid #334155',color:'#e2e8f0',padding:'4px 8px',borderRadius:4,fontSize:12}}
                value={step.prompt_template||''} onChange={e=>{const s=[...form.steps];s[i]={...s[i],prompt_template:e.target.value};setForm({...form,steps:s});}} placeholder="提示词模板..."/>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>{const s=form.steps.filter((_,j)=>j!==i);setForm({...form,steps:s});}}>×</button>
            </div>
          </div>)}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}

function QualityConfigPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/orchestration/config`);
  const [form,setForm] = React.useState({});
  React.useEffect(()=>{if(data)setForm(data.quality_config||{});},[data]);
  const save = () => {
    fetch(`${API}/orchestration/config`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({quality_config:form})})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('质量配置已保存','ok');})
      .catch(()=>showToast('保存失败','err'));
  };

  if (loading) return <PageSkeleton cards={1}/>;
  if (error) return <LoadError message={error} onRetry={reload}/>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">开发质量配置</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-primary btn-sm" onClick={save}>保存</button>
      </div>
    </div>
    <div className="card">
      {[['min_coverage','最低测试覆盖率 (%)','80'],['max_complexity','最大圈复杂度','10'],['min_confidence','最低置信度','0.70'],['max_retries','最大重试次数','3'],['review_threshold','触发 Review 置信度','0.85']].map(([k,label,placeholder])=>
        <div key={k} className="list-item">
          <div style={{flex:1}}><div className="title">{label}</div></div>
          <input style={{width:100,background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0',padding:'4px 8px',borderRadius:6,fontSize:12,textAlign:'right'}}
            value={form[k]||''} onChange={e=>setForm({...form,[k]:e.target.value})} placeholder={placeholder}/>
        </div>)}
    </div>
  </div>;
}

function VersionPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/orchestration/versions`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({tag:'',message:''});
  const create = () => {
    fetch(`${API}/orchestration/versions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then(r=>r.json()).then(d=>{
        if(d.ok){setModal(false);reload();showToast('版本标签已创建','ok');}
        else showToast(d.detail||'创建失败','err');
      }).catch(()=>showToast('请求失败','err'));
  };
  if (loading) return <div><PageSkeleton cards={1}/></div>;
  if (error) return <LoadError message={error} onRetry={reload}/>;
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">版本管理（Git Tags）</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({tag:'v1.0.0',message:''});}}>+ 创建版本</button>
      </div>
    </div>
    <div className="card">
      {(data||[]).length===0?<div className="empty">暂无版本标签，点击「创建版本」打 Git Tag</div>:
        (data||[]).map(tag=><div key={tag} className="list-item">
          <div className="title">{tag}</div>
          <span className="tag tag-p2">tag</span>
        </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>创建版本</h3>
        <div className="form-group"><label>版本号</label><input value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})} placeholder="v1.0.0"/></div>
        <div className="form-group"><label>说明</label><input value={form.message} onChange={e=>setForm({...form,message:e.target.value})} placeholder="版本说明..."/></div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={create}>创建</button>
        </div>
      </div>
    </div>}
  </div>;
}
