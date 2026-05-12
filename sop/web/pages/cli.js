function CliManager() {
  const {data,loading,error,reload} = useFetch(`${API}/cli`);
  const {data:meta,loading:lm,error:em,reload:reloadMeta} = useFetch(`${API}/cli/meta`);
  const [selected,setSelected] = React.useState(null);
  const [args,setArgs] = React.useState('');
  const [running,setRunning] = React.useState(false);
  const [output,setOutput] = React.useState(null);
  const [modal,setModal] = React.useState(null);
  const [form,setForm] = React.useState({id:'',name:'',cmd:'',description:'',install_hint:''});

  React.useEffect(()=>{
    if(!selected||!data)return;
    const n=data.find(x=>x.id===selected.id);
    if(n) setSelected(n);
    else setSelected(null);
  },[data]);

  const panelLoading = loading || lm;
  const panelError = error || em;
  const reloadAll = () => { reload(); reloadMeta(); };

  const run = () => {
    if(!selected) return;
    setRunning(true);setOutput(null);
    fetch(`${API}/cli/run`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tool:selected.id,args:args.split(' ').filter(Boolean)})})
      .then(r=>r.json())
      .then(d=>{setOutput(d);setRunning(false);if(d&&d.ok)showToast('运行完成','ok');else showToast(d?.error||'命令失败','err');})
      .catch(()=>{setRunning(false);showToast('请求失败','err');});
  };

  const openCreate = () => {
    setModal('create');
    setForm({id:'',name:'',cmd:'',description:'',install_hint:''});
  };
  const openEdit = (t,e) => {
    e.stopPropagation();
    setModal(t.is_builtin ? 'edit-builtin' : 'edit-custom');
    setForm({
      id:t.id,
      name:t.name||t.description,
      cmd:t.cmd,
      description:t.description||'',
      install_hint:t.install_hint||'',
    });
  };
  const saveForm = () => {
    const body = {name:form.name.trim(),cmd:form.cmd.trim(),description:form.description.trim(),install_hint:form.install_hint.trim()};
    if(!body.name||!body.cmd){showToast('请填写显示名称与命令','err');return;}
    if(modal==='create'){
      const id = (form.id||'').trim().toLowerCase();
      if(!id){showToast('请填写工具 ID','err');return;}
      fetch(`${API}/cli/tools/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
        .then(r=>r.json().then(d=>({ok:r.ok,d})))
        .then(({ok,d})=>{
          if(!ok){showToast(d.detail||'保存失败','err');return;}
          setModal(null);reloadAll();showToast('已添加自定义工具','ok');
        }).catch(()=>showToast('请求失败','err'));
      return;
    }
    fetch(`${API}/cli/tools/${encodeURIComponent(form.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(r=>r.json().then(d=>({ok:r.ok,d})))
      .then(({ok,d})=>{
        if(!ok){showToast(d.detail||'保存失败','err');return;}
        setModal(null);reloadAll();
        showToast('已保存','ok');
      }).catch(()=>showToast('请求失败','err'));
  };
  const removeTool = (t,e) => {
    e.stopPropagation();
    const msg = t.is_builtin?'从列表中移除该内置工具（可稍后在下方恢复）？':'永久删除该自定义工具？';
    if(!confirm(msg)) return;
    fetch(`${API}/cli/tools/${encodeURIComponent(t.id)}`,{method:'DELETE'})
      .then(r=>r.json().then(d=>({ok:r.ok,d})))
      .then(({ok,d})=>{
        if(!ok){showToast(d.detail||'操作失败','err');return;}
        reloadAll();
        if(selected?.id===t.id)setSelected(null);
        showToast(t.is_builtin?'已从列表移除':'已删除','ok');
      }).catch(()=>showToast('请求失败','err'));
  };
  const restoreBuiltin = (id) => {
    fetch(`${API}/cli/tools/${encodeURIComponent(id)}/restore`,{method:'POST'})
      .then(r=>{if(!r.ok)throw new Error();})
      .then(()=>{reloadAll();showToast('已恢复内置工具','ok');})
      .catch(()=>showToast('恢复失败','err'));
  };

  const available = (data||[]).filter(t=>t.available);
  const unavailable = (data||[]).filter(t=>!t.available);
  const hidden = meta?.hidden_builtin||[];

  if (panelLoading) return <div><div className="section-title">🛠️ CLI 工具管理</div><PageSkeleton cards={2}/></div>;
  if (panelError) return <div><div className="section-title">🛠️ CLI 工具管理</div><LoadError message={panelError} onRetry={reloadAll}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
      <div className="section-title">🛠️ CLI 工具管理</div>
      <div style={{display:'flex',gap:8}}>
        <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>+ 自定义工具</button>
        <RefreshBtn onClick={reloadAll} />
      </div>
    </div>
    <div className="grid-2">
      <div>
        <div className="card scroll-slim" style={{marginBottom:10,maxHeight:320,overflowY:'auto'}}>
          <div className="section-title">已安装 ({available.length})</div>
          {available.length===0?<div className="empty">暂无已安装 CLI</div>:
            available.map(t=><div key={t.id} className="list-item" style={{cursor:'pointer',background:selected?.id===t.id?'#1e3a5f':'',alignItems:'center'}} onClick={()=>setSelected(t)}>
            <div style={{flex:1,minWidth:0}}><div className="title">{t.name}</div><div className="meta">{t.description} · <code style={{color:'#93c5fd'}}>{t.cmd}</code></div></div>
            <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}} onClick={e=>e.stopPropagation()}>
              <button type="button" className="btn btn-sm" style={{background:'#334155',color:'#94a3b8'}} onClick={(e)=>openEdit(t,e)}>编辑</button>
              <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={(e)=>removeTool(t,e)}>{t.is_builtin?'移除':'删除'}</button>
            </div>
            <span className="tag tag-done">✅</span>
          </div>)}
        </div>
        <div className="card scroll-slim" style={{marginBottom:10,maxHeight:240,overflowY:'auto'}}>
          <div className="section-title">未安装 ({unavailable.length})</div>
          {unavailable.map(t=><div key={t.id} className="list-item" style={{alignItems:'center'}}>
            <div style={{flex:1,minWidth:0}}><div className="title">{t.name}</div><div className="meta">{t.description}</div></div>
            <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
              <button type="button" className="btn btn-sm" style={{background:'#334155',color:'#94a3b8'}} onClick={(e)=>openEdit(t,e)}>编辑</button>
              <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={(e)=>removeTool(t,e)}>{t.is_builtin?'移除':'删除'}</button>
            </div>
            <span className="tag tag-p0">未安装</span>
          </div>)}
        </div>
        {hidden.length>0&&<div className="card" style={{padding:12}}>
          <div className="section-title" style={{fontSize:12,marginBottom:8}}>已隐藏的内置工具</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {hidden.map(id=><button key={id} type="button" className="btn btn-sm btn-primary" onClick={()=>restoreBuiltin(id)}>恢复 {id}</button>)}
          </div>
        </div>}
      </div>
      <div>
        {selected&&<div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div className="section-title">运行 {selected.name}</div>
            <button type="button" className="btn btn-sm" style={{background:'#334155',color:'#94a3b8'}} onClick={(e)=>openEdit(selected,e)}>编辑</button>
          </div>
          <div className="form-group"><label>参数（空格分隔）</label>
            <input value={args} onChange={e=>setArgs(e.target.value)} placeholder="--version 或其他参数" onKeyDown={e=>e.key==='Enter'&&run()}/>
          </div>
          <button type="button" className="btn btn-primary" style={{width:'100%'}} onClick={run} disabled={running}>{running?'运行中...':'▶ 运行'}</button>
          {output&&<div style={{marginTop:10}}>
            <div style={{fontSize:11,color:output.ok?'#86efac':'#fca5a5',marginBottom:4}}>{output.ok?'✅ 成功':'❌ 失败'} (exit {output.returncode})</div>
            <pre className="scroll-slim" style={{fontSize:11,color:'#e2e8f0',whiteSpace:'pre-wrap',maxHeight:300,overflowY:'auto',background:'#0f172a',padding:8,borderRadius:6}}>{output.stdout||output.error}</pre>
          </div>}
        </div>}
        {!selected&&<div className="card"><div className="empty">← 选择工具运行</div></div>}
        <div className="card scroll-slim" style={{marginTop:10,maxHeight:220,overflowY:'auto'}}>
          <div className="section-title">安装提示</div>
          {unavailable.map(t=><div key={t.id} style={{marginBottom:8}}>
            <div style={{fontSize:12,color:'#94a3b8',marginBottom:2}}>{t.name}</div>
            <code style={{fontSize:11,color:'#93c5fd',background:'#0f172a',padding:'2px 6px',borderRadius:4,display:'block',whiteSpace:'pre-wrap'}}>{t.install_hint||`参考 ${t.id} 官方文档`}</code>
          </div>)}
        </div>
      </div>
    </div>

    {modal&&<div className="modal-bg" onClick={()=>setModal(null)}>
      <div className="modal" style={{width:480,maxWidth:'96vw'}} onClick={e=>e.stopPropagation()}>
        <h3>{modal==='create'?'添加自定义 CLI 工具':`编辑 · ${form.id}`}</h3>
        {modal==='create'&&<div className="form-group"><label>工具 ID（小写、唯一）</label>
          <input value={form.id} onChange={e=>setForm({...form,id:e.target.value.toLowerCase()})} placeholder="my-cli-tool"/>
        </div>}
        <div className="form-group"><label>显示名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
        <div className="form-group"><label>可执行命令（可含参数前缀，如 npx -y pkg）</label><input value={form.cmd} onChange={e=>setForm({...form,cmd:e.target.value})} placeholder="claude"/></div>
        <div className="form-group"><label>描述</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>安装提示 / 文档链接</label>
          <textarea value={form.install_hint} onChange={e=>setForm({...form,install_hint:e.target.value})} style={{minHeight:72,fontSize:12}} placeholder="留空则内置工具使用默认提示"/>
        </div>
        {modal!=='create'&&<p style={{fontSize:11,color:'#64748b',marginBottom:10}}>
          {form.id&&data&&data.find(x=>x.id===form.id)?.is_builtin?'内置工具：保存后写入覆盖配置；「移除」可隐藏并清除覆盖。':'自定义工具：可随时删除。'}
        </p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(null)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={saveForm}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}
