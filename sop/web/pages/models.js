window.i18nExtend && window.i18nExtend({
  zh: {
    models_title: '🧠 模型配置',
    models_tab_list: '🤖 模型列表',
    models_tab_providers: '🔑 提供商',
    models_tab_roles: '⚙️ 角色配置',
    models_list_default: '模型列表 · 默认: {d}',
    models_custom_new: '+ 自定义模型',
    models_empty: '暂无模型数据',
    models_recommended: '推荐',
    models_set_default: '设为默认',
    models_del: '删除',
    models_providers_title: 'API 提供商配置',
    models_provider_new: '+ 配置提供商',
    models_providers_empty: '暂无配置，点击「配置提供商」添加 API Key',
    models_key_configured: '已配置',
    models_key_missing: '未配置',
    models_enabled: '启用',
    models_disabled: '禁用',
    models_edit: '编辑',
    models_role_title: '为每个 Agent 角色指定模型',
    models_use_default: '使用默认 ({d})',
    models_modal_provider: '配置提供商',
    models_modal_custom: '添加自定义模型',
    models_label_provider_name: '提供商名称',
    models_label_api_key: 'API Key',
    models_label_base_url: 'Base URL（可选）',
    models_label_model_id: '模型 ID',
    models_label_name: '名称',
    models_label_provider: '提供商',
    models_label_context: '上下文长度',
    models_cancel: '取消',
    models_save: '保存',
    models_toast_default: '已设为默认模型',
    models_toast_default_fail: '设置失败',
    models_toast_role: '角色模型已更新',
    models_toast_role_fail: '保存失败',
    models_toast_provider: '提供商已保存',
    models_toast_save_fail: '保存失败',
    models_toast_deleted: '已删除',
    models_toast_del_fail: '删除失败',
    models_toast_custom_ok: '自定义模型已添加',
  },
  en: {
    models_title: '🧠 Models',
    models_tab_list: '🤖 Models',
    models_tab_providers: '🔑 Providers',
    models_tab_roles: '⚙️ Roles',
    models_list_default: 'Models · default: {d}',
    models_custom_new: '+ Custom model',
    models_empty: 'No model data',
    models_recommended: 'Recommended',
    models_set_default: 'Set default',
    models_del: 'Delete',
    models_providers_title: 'API providers',
    models_provider_new: '+ Add provider',
    models_providers_empty: 'No providers — add API keys',
    models_key_configured: 'Configured',
    models_key_missing: 'Not set',
    models_enabled: 'On',
    models_disabled: 'Off',
    models_edit: 'Edit',
    models_role_title: 'Model per agent role',
    models_use_default: 'Use default ({d})',
    models_modal_provider: 'Configure provider',
    models_modal_custom: 'Add custom model',
    models_label_provider_name: 'Provider name',
    models_label_api_key: 'API key',
    models_label_base_url: 'Base URL (optional)',
    models_label_model_id: 'Model ID',
    models_label_name: 'Name',
    models_label_provider: 'Provider',
    models_label_context: 'Context length',
    models_cancel: 'Cancel',
    models_save: 'Save',
    models_toast_default: 'Default model updated',
    models_toast_default_fail: 'Update failed',
    models_toast_role: 'Role model updated',
    models_toast_role_fail: 'Save failed',
    models_toast_provider: 'Provider saved',
    models_toast_save_fail: 'Save failed',
    models_toast_deleted: 'Deleted',
    models_toast_del_fail: 'Delete failed',
    models_toast_custom_ok: 'Custom model added',
  },
});

function ModelManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const {data,loading,error,reload} = useFetch(`${API}/models`);
  const [tab,setTab] = React.useState('models');
  const [modal,setModal] = React.useState(null);
  const [form,setForm] = React.useState({});

  const setDefault = (id) => {
    apiFetch(`/models/default?model_id=${id}`,{method:'PUT'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('models_toast_default'),'ok');})
      .catch(()=>showToast(t('models_toast_default_fail'),'err'));
  };
  const setRoleModel = (role,model_id) => {
    apiFetch(`/models/role-model`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,model_id})})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('models_toast_role'),'ok');})
      .catch(()=>showToast(t('models_toast_role_fail'),'err'));
  };
  const saveProvider = () => {
    apiFetch(`/models/providers/${form.name}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(null);reload();showToast(t('models_toast_provider'),'ok');})
      .catch(()=>showToast(t('models_toast_save_fail'),'err'));
  };
  const delProvider = (name) => {
    apiFetch(`/models/providers/${name}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('models_toast_deleted'),'ok');})
      .catch(()=>showToast(t('models_toast_del_fail'),'err'));
  };

  const allModels = [...((data&&data.builtin)||[]), ...((data&&data.custom)||[])];
  const ROLES = ['Orchestrator','Planner','Coder-Backend','Coder-Frontend','Reviewer','Tester','Debugger'];
  const PROVIDERS = ['anthropic','openai','google','deepseek','ollama','custom'];

  if (loading) return <div><div className="section-title">{t('models_title')}</div><PageSkeleton cards={2}/></div>;
  if (error) return <div><div className="section-title">{t('models_title')}</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
      <div style={{display:'flex',gap:4}}>
        {[['models', t('models_tab_list')],['providers', t('models_tab_providers')],['role-config', t('models_tab_roles')]].map(([id,l])=>
          <button key={id} type="button" className={`btn btn-sm ${tab===id?'btn-primary':''}`} style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{l}</button>)}
      </div>
      <RefreshBtn onClick={reload} />
    </div>

    {tab==='models'&&<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div className="section-title">{t('models_list_default', { d: (data&&data.default)||'-' })}</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal('custom');setForm({id:'',provider:'custom',name:'',context:32000});}}>{t('models_custom_new')}</button>
      </div>
      <div className="card scroll-slim" style={{maxHeight:520,overflowY:'auto'}}>
        {allModels.length===0?<div className="empty">{t('models_empty')}</div>:
        allModels.map(m=><div key={m.id} className="list-item">
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="title">{m.name}</span>
              {m.recommended&&<span className="tag tag-done">{t('models_recommended')}</span>}
              <span className="tag tag-p2">{m.provider}</span>
              <span className="text-tertiary" style={{fontSize:11}}>{(m.context/1000).toFixed(0)}K ctx</span>
            </div>
            <div className="meta">{m.id}</div>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm" style={{background:'#14532d',color:'#86efac'}} onClick={()=>setDefault(m.id)}>{t('models_set_default')}</button>
            {!m.recommended&&<button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>{
              apiFetch(`/models/custom/${m.id}`,{method:'DELETE'})
                .then((r)=>{if(!r.ok)throw new Error();})
                .then(()=>{reload();showToast(t('models_toast_deleted'),'ok');})
                .catch(()=>showToast(t('models_toast_del_fail'),'err'));
            }}>{t('models_del')}</button>}
          </div>
        </div>)}
      </div>
    </div>}

    {tab==='providers'&&<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div className="section-title">{t('models_providers_title')}</div>
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal('provider');setForm({name:'anthropic',api_key:'',base_url:'',enabled:true});}}>{t('models_provider_new')}</button>
      </div>
      <div className="card">
        {Object.entries((data&&data.providers)||{}).length===0?<div className="empty">{t('models_providers_empty')}</div>:
          Object.entries((data&&data.providers)||{}).map(([name,cfg])=><div key={name} className="list-item">
            <div style={{flex:1}}>
              <div className="title">{name}</div>
              <div className="meta">API Key: {cfg.api_key?t('models_key_configured'):t('models_key_missing')} {cfg.base_url&&`· URL: ${cfg.base_url}`}</div>
            </div>
            <div style={{display:'flex',gap:4}}>
              <span className={`tag ${cfg.enabled?'tag-done':'tag-p3'}`}>{cfg.enabled?t('models_enabled'):t('models_disabled')}</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={()=>{setModal('provider');setForm({name,...cfg});}}>{t('models_edit')}</button>
              <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>delProvider(name)}>{t('models_del')}</button>
            </div>
          </div>)}
      </div>
    </div>}

    {tab==='role-config'&&<div>
      <div className="section-title" style={{marginBottom:12}}>{t('models_role_title')}</div>
      <div className="card">
        {ROLES.map(role=><div key={role} className="list-item">
          <div style={{flex:1}}><div className="title">{role}</div></div>
          <select className="input-surface" style={{padding:'4px 8px',borderRadius:6,fontSize:12}}
            value={(data&&data.role_models&&data.role_models[role])||(data&&data.default)||''} onChange={e=>setRoleModel(role,e.target.value)}>
            <option value="">{t('models_use_default', { d: (data&&data.default)||'' })}</option>
            {allModels.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>)}
      </div>
    </div>}

    {modal&&<div className="modal-bg" onClick={()=>setModal(null)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{modal==='provider'?t('models_modal_provider'):t('models_modal_custom')}</h3>
        {modal==='provider'&&<>
          <div className="form-group"><label>{t('models_label_provider_name')}</label>
            <select value={form.name} onChange={e=>setForm({...form,name:e.target.value})}>
              {PROVIDERS.map(p=><option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group"><label>{t('models_label_api_key')}</label><input type="password" value={form.api_key||''} onChange={e=>setForm({...form,api_key:e.target.value})} placeholder="sk-..."/></div>
          <div className="form-group"><label>{t('models_label_base_url')}</label><input value={form.base_url||''} onChange={e=>setForm({...form,base_url:e.target.value})} placeholder="https://api.openai.com/v1"/></div>
        </>}
        {modal==='custom'&&<>
          <div className="form-group"><label>{t('models_label_model_id')}</label><input value={form.id||''} onChange={e=>setForm({...form,id:e.target.value})} placeholder="my-model-v1"/></div>
          <div className="form-group"><label>{t('models_label_name')}</label><input value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})}/></div>
          <div className="form-group"><label>{t('models_label_provider')}</label><input value={form.provider||''} onChange={e=>setForm({...form,provider:e.target.value})}/></div>
          <div className="form-group"><label>{t('models_label_context')}</label><input type="number" value={form.context||32000} onChange={e=>setForm({...form,context:+e.target.value})}/></div>
        </>}
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(null)}>{t('models_cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={modal==='provider'?saveProvider:()=>{
            apiFetch(`/models/custom`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
              .then((r)=>{if(!r.ok)throw new Error();})
              .then(()=>{setModal(null);reload();showToast(t('models_toast_custom_ok'),'ok');})
              .catch(()=>showToast(t('models_toast_save_fail'),'err'));
          }}>{t('models_save')}</button>
        </div>
      </div>
    </div>}
  </div>;
}
