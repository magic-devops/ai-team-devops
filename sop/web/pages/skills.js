function SkillManager() {
  const {data,loading,error,reload} = useFetch(`${API}/skills`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({skill_id:'',name:'',description:'',agent_role:'All',trigger:'',execution:'',a2a_exposed:false,mcp_tool:false,lancedb_context:false,context_budget:10000});

  const save = () => {
    fetch(`${API}/skills`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast('技能已保存','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const del = (id) => {
    if(!confirm('确认删除？')) return;
    fetch(`${API}/skills/${id}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };

  if (loading) return <div><div className="section-title">⚡ 技能管理</div><PageSkeleton cards={2}/></div>;
  if (error) return <div><div className="section-title">⚡ 技能管理</div><LoadError message={error} onRetry={reload}/></div>;

  const skills = data||[];
  const builtin = skills.filter(s=>s.builtin);
  const custom = skills.filter(s=>!s.builtin);

  const Badge = ({label,color='#334155'}) => <span style={{background:color,color:'#e2e8f0',padding:'1px 6px',borderRadius:4,fontSize:10,fontWeight:600}}>{label}</span>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div className="section-title">⚡ 技能管理</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({skill_id:'',name:'',description:'',agent_role:'All',trigger:'',execution:'',a2a_exposed:false,mcp_tool:false,lancedb_context:false,context_budget:10000});}}>+ 自定义技能</button>
      </div>
    </div>
    <div className="card" style={{marginBottom:12}}>
      <div className="section-title">内置技能 ({builtin.length})</div>
      {builtin.map(s=><div key={s.skill_id} className="list-item">
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span className="title">{s.skill_id}</span>
            <span style={{fontSize:13,color:'#94a3b8'}}>{s.name}</span>
            {s.a2a_exposed&&<Badge label="A2A" color="#1e3a5f"/>}
            {s.mcp_tool&&<Badge label="MCP" color="#14532d"/>}
          </div>
          <div className="meta">{s.agent_role}</div>
        </div>
      </div>)}
    </div>
    <div className="card">
      <div className="section-title">自定义技能 ({custom.length})</div>
      {custom.length===0?<div className="empty">暂无自定义技能</div>:custom.map(s=><div key={s.skill_id} className="list-item">
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span className="title">{s.skill_id}</span>
            <span style={{fontSize:13,color:'#94a3b8'}}>{s.name}</span>
            {s.a2a_exposed&&<Badge label="A2A" color="#1e3a5f"/>}
            {s.mcp_tool&&<Badge label="MCP" color="#14532d"/>}
            {s.lancedb_context&&<Badge label="LanceDB" color="#4c1d95"/>}
          </div>
          <div className="meta">{s.description}</div>
        </div>
        <button className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(s.skill_id)}>删除</button>
      </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" style={{width:500}} onClick={e=>e.stopPropagation()}>
        <h3>自定义技能</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>技能 ID</label><input value={form.skill_id} onChange={e=>setForm({...form,skill_id:e.target.value})} placeholder="CUSTOM-001"/></div>
          <div className="form-group"><label>名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
          <div className="form-group"><label>适用角色</label>
            <select value={form.agent_role} onChange={e=>setForm({...form,agent_role:e.target.value})}>
              {['All','Planner','Coder','Reviewer','Tester','Debugger','Worker'].map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Token 预算</label><input type="number" value={form.context_budget} onChange={e=>setForm({...form,context_budget:+e.target.value})}/></div>
        </div>
        <div className="form-group"><label>描述</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>触发条件</label><input value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})} placeholder="任务开始前..."/></div>
        <div className="form-group"><label>执行步骤</label><textarea value={form.execution} onChange={e=>setForm({...form,execution:e.target.value})} style={{minHeight:80}} placeholder="执行命令或步骤描述..."/></div>
        <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:12}}>
          {[['a2a_exposed','A2A 暴露'],['mcp_tool','MCP 工具'],['lancedb_context','LanceDB 上下文']].map(([k,l])=><label key={k} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#94a3b8',cursor:'pointer'}}>
            <input type="checkbox" checked={form[k]||false} onChange={e=>setForm({...form,[k]:e.target.checked})}/>{l}
          </label>)}
        </div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
