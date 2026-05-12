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
            <div className="title">{s.skill_id}</div>
            <div className="meta">{key} · v{s.version}</div>
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
  const [form,setForm] = React.useState({skill_id:'',version:'1.0.0',content:''});
  const [result,setResult] = React.useState(null);
  const doImport = () => {
    fetch(`${API}/skill-repo/import?skill_id=${form.skill_id}&version=${form.version}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:form.content,skill_id:form.skill_id,version:form.version})})
      .then(r=>r.json())
      .then(d=>{
        setResult(d);
        if(d.ok) showToast('导入成功','ok');
        else showToast(d.detail||'导入失败','err');
      })
      .catch(()=>showToast('请求失败','err'));
  };
  const TEMPLATE = JSON.stringify({skill_id:"CUSTOM-001",name:"我的技能",description:"技能描述",agent_role:"All",trigger:"触发条件",execution:"执行步骤"},null,2);
  return <div>
    <div className="section-title" style={{marginBottom:12}}>导入/开发技能</div>
    <div className="card">
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <div className="form-group"><label>技能 ID</label><input value={form.skill_id} onChange={e=>setForm({...form,skill_id:e.target.value})} placeholder="CUSTOM-001"/></div>
        <div className="form-group"><label>版本</label><input value={form.version} onChange={e=>setForm({...form,version:e.target.value})}/></div>
      </div>
      <div className="form-group">
        <label>技能 JSON（<button style={{background:'none',border:'none',color:'#3b82f6',cursor:'pointer',fontSize:11}} onClick={()=>setForm({...form,content:TEMPLATE})}>填入模板</button>）</label>
        <textarea value={form.content} onChange={e=>setForm({...form,content:e.target.value})} style={{minHeight:200,fontFamily:'monospace',fontSize:12}} placeholder={TEMPLATE}/>
      </div>
      <button type="button" className="btn btn-primary" style={{width:'100%'}} onClick={doImport}>⬆️ 导入技能</button>
      {result&&<div style={{marginTop:8,fontSize:12,color:result.ok?'#86efac':'#fca5a5'}}>{result.ok?`✅ 导入成功: ${result.key}`:'❌ '+result.detail}</div>}
    </div>
  </div>;
}
