function McpManager() {
  const {data,loading:lc,error:ec,reload} = useFetch(`${API}/mcp`);
  const {data:builtin,loading:lb,error:eb,reload:reloadBuiltin} = useFetch(`${API}/mcp/builtin`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({name:'',command:'',args:'',description:''});

  const loading = lc || lb;
  const errText = ec || eb;
  const reloadAll = () => { reload(); reloadBuiltin(); };

  const save = () => {
    apiFetch(`/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...form,args:form.args.split(' ').filter(Boolean)})})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast('已添加 MCP','ok');})
      .catch(()=>showToast('添加失败','err'));
  };
  const del = (name) => {
    if(!confirm(`删除 MCP Server: ${name}？`)) return;
    apiFetch(`/mcp/${name}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已移除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };
  const addBuiltin = (s) => {
    apiFetch(`/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已从模板添加','ok');})
      .catch(()=>showToast('添加失败','err'));
  };

  if (loading) return <div><div className="section-title">🔌 MCP Server 管理</div><PageSkeleton cards={2}/></div>;
  if (errText) return <div><div className="section-title">🔌 MCP Server 管理</div><LoadError message={errText} onRetry={reloadAll}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div className="section-title">🔌 MCP Server 管理</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reloadAll} />
        <button className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({name:'',command:'',args:'',description:''});}}>+ 添加</button>
      </div>
    </div>
    <div className="card" style={{marginBottom:12}}>
      <div className="section-title">已配置 ({(data||[]).length})</div>
      {(data||[]).length===0?<div className="empty">暂无 MCP Server，从下方内置列表添加</div>:
        (data||[]).map(s=><div key={s.name} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{s.name}</div>
            <div className="meta">{s.command} {(s.args||[]).join(' ')}</div>
            {s.description&&<div className="meta" style={{color:'#64748b'}}>{s.description}</div>}
          </div>
          <button className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(s.name)}>移除</button>
        </div>)}
    </div>
    <div className="card">
      <div className="section-title">内置 MCP Server</div>
      {(builtin||[]).map(s=><div key={s.name} className="list-item">
        <div style={{flex:1}}>
          <div className="title">{s.name}</div>
          <div className="meta">{s.description}</div>
        </div>
        <button className="btn btn-sm btn-primary" onClick={()=>addBuiltin(s)}>添加</button>
      </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>添加 MCP Server</h3>
        <div className="form-group"><label>名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="my-server"/></div>
        <div className="form-group"><label>命令</label><input value={form.command} onChange={e=>setForm({...form,command:e.target.value})} placeholder="npx 或 python3"/></div>
        <div className="form-group"><label>参数（空格分隔）</label><input value={form.args} onChange={e=>setForm({...form,args:e.target.value})} placeholder="-y @modelcontextprotocol/server-filesystem ."/></div>
        <div className="form-group"><label>描述</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
