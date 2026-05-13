function ModelManager() {
  const {data,loading,error,reload} = useFetch(`${API}/models`);
  const [tab,setTab] = React.useState('models');
  const [modal,setModal] = React.useState(null);
  const [form,setForm] = React.useState({});

  const setDefault = (id) => {
    fetch(`${API}/models/default?model_id=${id}`,{method:'PUT'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已设为默认模型','ok');})
      .catch(()=>showToast('设置失败','err'));
  };
  const setRoleModel = (role,model_id) => {
    fetch(`${API}/models/role-model`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,model_id})})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('角色模型已更新','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const saveProvider = () => {
    fetch(`${API}/models/providers/${form.name}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(null);reload();showToast('提供商已保存','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const delProvider = (name) => {
    fetch(`${API}/models/providers/${name}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };

  const allModels = [...((data&&data.builtin)||[]), ...((data&&data.custom)||[])];
  const ROLES = ['Orchestrator','Planner','Coder-Backend','Coder-Frontend','Reviewer','Tester','Debugger'];
  const PROVIDERS = ['anthropic','openai','google','deepseek','ollama','custom'];

  if (loading) return <div><div className="section-title">🧠 模型配置</div><PageSkeleton cards={2}/></div>;
  if (error) return <div><div className="section-title">🧠 模型配置</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
      <div style={{display:'flex',gap:4}}>
        {[['models','🤖 模型列表'],['providers','🔑 提供商'],['role-config','⚙️ 角色配置']].map(([id,l])=>
          <button key={id} type="button" className={`btn btn-sm ${tab===id?'btn-primary':''}`} style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{l}</button>)}
      </div>
      <RefreshBtn onClick={reload} />
    </div>

    {tab==='models'&&<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div className="section-title">模型列表 · 默认: <span style={{color:'#3b82f6'}}>{(data&&data.default)||'-'}</span></div>
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal('custom');setForm({id:'',provider:'custom',name:'',context:32000});}}>+ 自定义模型</button>
      </div>
      <div className="card scroll-slim" style={{maxHeight:520,overflowY:'auto'}}>
        {allModels.length===0?<div className="empty">暂无模型数据</div>:
        allModels.map(m=><div key={m.id} className="list-item">
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="title">{m.name}</span>
              {m.recommended&&<span className="tag tag-done">推荐</span>}
              <span className="tag tag-p2">{m.provider}</span>
              <span className="text-tertiary" style={{fontSize:11}}>{(m.context/1000).toFixed(0)}K ctx</span>
            </div>
            <div className="meta">{m.id}</div>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm" style={{background:'#14532d',color:'#86efac'}} onClick={()=>setDefault(m.id)}>设为默认</button>
            {!m.recommended&&<button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>{
              fetch(`${API}/models/custom/${m.id}`,{method:'DELETE'})
                .then((r)=>{if(!r.ok)throw new Error();})
                .then(()=>{reload();showToast('已删除','ok');})
                .catch(()=>showToast('删除失败','err'));
            }}>删除</button>}
          </div>
        </div>)}
      </div>
    </div>}

    {tab==='providers'&&<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div className="section-title">API 提供商配置</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal('provider');setForm({name:'anthropic',api_key:'',base_url:'',enabled:true});}}>+ 配置提供商</button>
      </div>
      <div className="card">
        {Object.entries((data&&data.providers)||{}).length===0?<div className="empty">暂无配置，点击「配置提供商」添加 API Key</div>:
          Object.entries((data&&data.providers)||{}).map(([name,cfg])=><div key={name} className="list-item">
            <div style={{flex:1}}>
              <div className="title">{name}</div>
              <div className="meta">API Key: {cfg.api_key?'已配置':'未配置'} {cfg.base_url&&`· URL: ${cfg.base_url}`}</div>
            </div>
            <div style={{display:'flex',gap:4}}>
              <span className={`tag ${cfg.enabled?'tag-done':'tag-p3'}`}>{cfg.enabled?'启用':'禁用'}</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={()=>{setModal('provider');setForm({name,...cfg});}}>编辑</button>
              <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>delProvider(name)}>删除</button>
            </div>
          </div>)}
      </div>
    </div>}

    {tab==='role-config'&&<div>
      <div className="section-title" style={{marginBottom:12}}>为每个 Agent 角色指定模型</div>
      <div className="card">
        {ROLES.map(role=><div key={role} className="list-item">
          <div style={{flex:1}}><div className="title">{role}</div></div>
          <select className="input-surface" style={{padding:'4px 8px',borderRadius:6,fontSize:12}}
            value={(data&&data.role_models&&data.role_models[role])||(data&&data.default)||''} onChange={e=>setRoleModel(role,e.target.value)}>
            <option value="">使用默认 ({data&&data.default})</option>
            {allModels.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>)}
      </div>
    </div>}

    {modal&&<div className="modal-bg" onClick={()=>setModal(null)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{modal==='provider'?'配置提供商':'添加自定义模型'}</h3>
        {modal==='provider'&&<>
          <div className="form-group"><label>提供商名称</label>
            <select value={form.name} onChange={e=>setForm({...form,name:e.target.value})}>
              {PROVIDERS.map(p=><option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group"><label>API Key</label><input type="password" value={form.api_key||''} onChange={e=>setForm({...form,api_key:e.target.value})} placeholder="sk-..."/></div>
          <div className="form-group"><label>Base URL（可选）</label><input value={form.base_url||''} onChange={e=>setForm({...form,base_url:e.target.value})} placeholder="https://api.openai.com/v1"/></div>
        </>}
        {modal==='custom'&&<>
          <div className="form-group"><label>模型 ID</label><input value={form.id||''} onChange={e=>setForm({...form,id:e.target.value})} placeholder="my-model-v1"/></div>
          <div className="form-group"><label>名称</label><input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></div>
          <div className="form-group"><label>提供商</label><input value={form.provider||''} onChange={e=>setForm({...form,provider:e.target.value})}/></div>
          <div className="form-group"><label>上下文长度</label><input type="number" value={form.context||32000} onChange={e=>setForm({...form,context:+e.target.value})}/></div>
        </>}
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(null)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={modal==='provider'?saveProvider:()=>{
            fetch(`${API}/models/custom`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
              .then((r)=>{if(!r.ok)throw new Error();})
              .then(()=>{setModal(null);reload();showToast('自定义模型已添加','ok');})
              .catch(()=>showToast('保存失败','err'));
          }}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}
window.i18nExtend && window.i18nExtend({zh:{},en:{}});
