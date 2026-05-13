// Agent 管理页面 - 定义、专家组、内置 Agent
function AgentManager() {
  const {data:agents,loading:la,error:ea,reload:reloadAgents} = useFetch(`${API}/agents`);
  const {data:builtin,loading:lb,error:eb,reload:reloadBuiltin} = useFetch(`${API}/agents/builtin`);
  const {data:groups,loading:lg,error:eg,reload:reloadGroups} = useFetch(`${API}/agents/groups`);
  const [modal,setModal] = React.useState(null);
  const [form,setForm] = React.useState({id:'',name:'',role:'',description:'',model:'claude-opus-4-7',skills:[],specs_to_load:[],system_prompt:'',a2a_enabled:false,port:null});
  const [tab,setTab] = React.useState('custom');

  const loading = la || lb || lg;
  const errText = ea || eb || eg;
  const reloadAll = () => { reloadAgents(); reloadBuiltin(); reloadGroups(); };

  const save = () => {
    const isEdit = modal && modal.id && modal !== 'create';
    const url = isEdit ? `${API}/agents/${modal.id}` : `${API}/agents`;
    fetch(url,{method:isEdit?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{ if(!r.ok) throw new Error(); })
      .then(()=>{setModal(null);reloadAgents();showToast('已保存','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const del = (id) => {
    if(!confirm('确认删除？')) return;
    fetch(`${API}/agents/${id}`,{method:'DELETE'})
      .then((r)=>{ if(!r.ok) throw new Error(); })
      .then(()=>{reloadAgents();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };

  const allAgents = [...(builtin||[]).map(a=>({...a,builtin:true})), ...(agents||[]).map(a=>({...a,builtin:false}))];

  if (loading) {
    return <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div className="section-title">🤖 Agent 管理</div>
        <RefreshBtn onClick={reloadAll} />
      </div>
      <PageSkeleton cards={2} />
    </div>;
  }
  if (errText) {
    return <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div className="section-title">🤖 Agent 管理</div>
        <RefreshBtn onClick={reloadAll} />
      </div>
      <LoadError message={errText} onRetry={reloadAll} />
    </div>;
  }

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
      <div className="section-title">🤖 Agent 管理</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <RefreshBtn onClick={reloadAll} />
        <button type="button" className={`btn btn-sm ${tab==='custom'?'btn-primary':''}`} style={tab!=='custom'?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab('custom')}>自定义</button>
        <button type="button" className={`btn btn-sm ${tab==='builtin'?'btn-primary':''}`} style={tab!=='builtin'?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab('builtin')}>内置</button>
        <button type="button" className={`btn btn-sm ${tab==='groups'?'btn-primary':''}`} style={tab!=='groups'?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab('groups')}>专家组</button>
        {tab==='custom'&&<button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal('create');setForm({id:'',name:'',role:'',description:'',model:'claude-opus-4-7',skills:[],specs_to_load:[],system_prompt:'',a2a_enabled:false,port:null});}}>+ 新建 Agent</button>}
      </div>
    </div>

    {tab==='builtin'&&<div className="card">
      <div className="section-title" style={{marginTop:0}}>内置角色（只读）</div>
      {(builtin||[]).length===0?<div className="empty">未返回内置列表，请检查接口 /api/agents/builtin</div>:
        (builtin||[]).map(a=><div key={a.id} className="list-item">
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span className="title">{a.name}</span>
            <span className="tag tag-p2">{a.role}</span>
            {a.a2a_enabled&&<span className="tag tag-done">A2A</span>}
            {a.port!=null&&<span style={{fontSize:11,color:'#64748b'}}>端口 {a.port}</span>}
          </div>
          <div className="meta">{a.description}</div>
          <div className="meta">模型: {a.model} · 技能: {(a.skills||[]).join(', ')||'—'}</div>
        </div>
      </div>)}
    </div>}

    {tab==='custom'&&<div className="card">
      {(agents||[]).length===0?<div className="empty" style={{padding:'28px 20px'}}>
        <div style={{fontSize:15,marginBottom:8,color:'var(--text)'}}>暂无自定义 Agent</div>
        <div style={{fontSize:13,color:'var(--text3)',marginBottom:16}}>自定义 Agent 保存在 <code style={{fontSize:12}}>.ai-memory/agents/</code>，点击「新建 Agent」即可创建。</div>
      </div>:
        (agents||[]).map(a=><div key={a.id} className="list-item">
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span className="title">{a.name}</span>
              <span className="tag tag-p2">{a.role}</span>
              {a.a2a_enabled&&<span className="tag tag-done">A2A :{a.port}</span>}
            </div>
            <div className="meta">{a.description}</div>
            <div className="meta">模型: {a.model}</div>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>{setModal(a);setForm({...a});}}>编辑</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(a.id)}>删除</button>
          </div>
        </div>)}
    </div>}

    {tab==='groups'&&<GroupManager groups={groups} reload={reloadGroups} allAgents={allAgents}/>}

    {modal&&<div className="modal-bg" onClick={()=>setModal(null)}>
      <div className="modal" style={{width:520}} onClick={e=>e.stopPropagation()}>
        <h3>{modal==='create'?'新建 Agent':'编辑 Agent'}</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>ID</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value})} placeholder="coder-java" disabled={modal!=='create'}/></div>
          <div className="form-group"><label>名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Java 编码者"/></div>
          <div className="form-group"><label>角色</label><input value={form.role} onChange={e=>setForm({...form,role:e.target.value})} placeholder="Coder"/></div>
          <div className="form-group"><label>模型</label>
            <select value={form.model} onChange={e=>setForm({...form,model:e.target.value})}>
              {['claude-opus-4-7','claude-sonnet-4-5','gpt-4o','gemini-1.5-pro'].map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group"><label>描述</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>System Prompt</label><textarea value={form.system_prompt||''} onChange={e=>setForm({...form,system_prompt:e.target.value})} style={{minHeight:80}} placeholder="Agent 的系统提示词..."/></div>
        <div className="form-group"><label>加载规范（逗号分隔）</label><input value={(form.specs_to_load||[]).join(',')} onChange={e=>setForm({...form,specs_to_load:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})} placeholder="specs/backend/JAVA_SPEC.md"/></div>
        <div style={{display:'flex',gap:16,alignItems:'center',marginBottom:12}}>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'#94a3b8',cursor:'pointer'}}>
            <input type="checkbox" checked={form.a2a_enabled||false} onChange={e=>setForm({...form,a2a_enabled:e.target.checked})}/>
            启用 A2A 协议
          </label>
          {form.a2a_enabled&&<div className="form-group" style={{margin:0,flex:1}}><input type="number" value={form.port||''} onChange={e=>setForm({...form,port:+e.target.value})} placeholder="端口 8001"/></div>}
        </div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(null)}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}

function GroupManager({groups,reload,allAgents}) {
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({id:'',name:'',description:'',agents:[]});
  const save = () => {
    fetch(`${API}/agents/groups`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast('专家组已创建','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  return <div>
    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
      <button className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({id:'',name:'',description:'',agents:[]});}}>+ 新建专家组</button>
    </div>
    <div className="card">
      {(groups||[]).length===0?<div className="empty">暂无专家组</div>:(groups||[]).map(g=><div key={g.id} className="list-item">
        <div style={{flex:1}}>
          <div className="title">{g.name}</div>
          <div className="meta">{g.description}</div>
          <div className="meta">成员: {(g.agents && g.agents.join(', ')) || ''}</div>
        </div>
      </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>新建专家组</h3>
        <div className="form-group"><label>ID</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value})}/></div>
        <div className="form-group"><label>名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
        <div className="form-group"><label>描述</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>成员 Agent</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {(allAgents||[]).map(a=><label key={a.id} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#94a3b8',cursor:'pointer'}}>
              <input type="checkbox" checked={form.agents.includes(a.id)} onChange={e=>{const s=new Set(form.agents);e.target.checked?s.add(a.id):s.delete(a.id);setForm({...form,agents:[...s]});}}/>
              {a.name}
            </label>)}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}
