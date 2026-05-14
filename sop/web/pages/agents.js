// Agent definitions, built-ins, expert groups
window.i18nExtend && window.i18nExtend({
  zh: {
    page_agents: 'Agent 管理',
    agent_title: '🤖 Agent 管理',
    agent_tab_custom: '自定义',
    agent_tab_builtin: '内置',
    agent_tab_groups: '专家组',
    agent_new: '+ 新建 Agent',
    agent_builtin_readonly: '内置角色（只读）',
    agent_builtin_empty: '未返回内置列表，请检查接口 /api/v1/agents/builtin',
    agent_port: '端口 {n}',
    agent_meta_model: '模型: {model} · 技能: {skills}',
    agent_meta_model_only: '模型: {model}',
    agent_custom_empty_title: '暂无自定义 Agent',
    agent_custom_empty_hint: '自定义 Agent 保存在 .ai-memory/agents/，点击「新建 Agent」即可创建。',
    agent_edit: '编辑',
    agent_del: '删除',
    agent_modal_create: '新建 Agent',
    agent_modal_edit: '编辑 Agent',
    agent_label_id: 'ID',
    agent_label_name: '名称',
    agent_label_role: '角色',
    agent_label_model: '模型',
    agent_label_desc: '描述',
    agent_label_specs: '加载规范（逗号分隔）',
    agent_ph_name: 'Java 编码者',
    agent_ph_role: 'Coder',
    agent_ph_prompt: 'Agent 的系统提示词...',
    agent_a2a_enable: '启用 A2A 协议',
    agent_ph_port: '端口 8001',
    agent_cancel: '取消',
    agent_save: '保存',
    agent_toast_saved: '已保存',
    agent_toast_save_fail: '保存失败',
    agent_confirm_del: '确认删除？',
    agent_toast_deleted: '已删除',
    agent_toast_del_fail: '删除失败',
    agent_group_new: '+ 新建专家组',
    agent_group_empty: '暂无专家组',
    agent_group_members: '成员: {list}',
    agent_group_modal_title: '新建专家组',
    agent_label_group_id: 'ID',
    agent_group_name: '名称',
    agent_group_desc: '描述',
    agent_group_members_label: '成员 Agent',
    agent_toast_group_ok: '专家组已创建',
  },
  en: {
    page_agents: 'Agents',
    agent_title: '🤖 Agents',
    agent_tab_custom: 'Custom',
    agent_tab_builtin: 'Built-in',
    agent_tab_groups: 'Groups',
    agent_new: '+ New agent',
    agent_builtin_readonly: 'Built-in roles (read-only)',
    agent_builtin_empty: 'No built-in list returned. Check GET /api/v1/agents/builtin',
    agent_port: 'Port {n}',
    agent_meta_model: 'Model: {model} · Skills: {skills}',
    agent_meta_model_only: 'Model: {model}',
    agent_custom_empty_title: 'No custom agents yet',
    agent_custom_empty_hint: 'Custom agents live under .ai-memory/agents/. Click New agent to create one.',
    agent_edit: 'Edit',
    agent_del: 'Delete',
    agent_modal_create: 'New agent',
    agent_modal_edit: 'Edit agent',
    agent_label_id: 'ID',
    agent_label_name: 'Name',
    agent_label_role: 'Role',
    agent_label_model: 'Model',
    agent_label_desc: 'Description',
    agent_label_specs: 'Specs to load (comma-separated)',
    agent_ph_name: 'Java coder',
    agent_ph_role: 'Coder',
    agent_ph_prompt: 'System prompt...',
    agent_a2a_enable: 'Enable A2A',
    agent_ph_port: 'Port 8001',
    agent_cancel: 'Cancel',
    agent_save: 'Save',
    agent_toast_saved: 'Saved',
    agent_toast_save_fail: 'Save failed',
    agent_confirm_del: 'Delete this agent?',
    agent_toast_deleted: 'Deleted',
    agent_toast_del_fail: 'Delete failed',
    agent_group_new: '+ New group',
    agent_group_empty: 'No expert groups yet',
    agent_group_members: 'Members: {list}',
    agent_group_modal_title: 'New expert group',
    agent_label_group_id: 'ID',
    agent_group_name: 'Name',
    agent_group_desc: 'Description',
    agent_group_members_label: 'Member agents',
    agent_toast_group_ok: 'Group created',
  },
});

function AgentManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
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
    apiFetch(url,{method:isEdit?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{ if(!r.ok) throw new Error(); })
      .then(()=>{setModal(null);reloadAgents();showToast(t('agent_toast_saved'),'ok');})
      .catch(()=>showToast(t('agent_toast_save_fail'),'err'));
  };
  const del = (id) => {
    if(!confirm(t('agent_confirm_del'))) return;
    apiFetch(`/agents/${id}`,{method:'DELETE'})
      .then((r)=>{ if(!r.ok) throw new Error(); })
      .then(()=>{reloadAgents();showToast(t('agent_toast_deleted'),'ok');})
      .catch(()=>showToast(t('agent_toast_del_fail'),'err'));
  };

  const allAgents = [...(builtin||[]).map(a=>({...a,builtin:true})), ...(agents||[]).map(a=>({...a,builtin:false}))];

  if (loading) {
    return <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div className="section-title">{t('agent_title')}</div>
        <RefreshBtn onClick={reloadAll} />
      </div>
      <PageSkeleton cards={2} />
    </div>;
  }
  if (errText) {
    return <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div className="section-title">{t('agent_title')}</div>
        <RefreshBtn onClick={reloadAll} />
      </div>
      <LoadError message={errText} onRetry={reloadAll} />
    </div>;
  }

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
      <div className="section-title">{t('agent_title')}</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <RefreshBtn onClick={reloadAll} />
        <button type="button" className={`btn btn-sm ${tab==='custom'?'btn-primary':''}`} style={tab!=='custom'?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab('custom')}>{t('agent_tab_custom')}</button>
        <button type="button" className={`btn btn-sm ${tab==='builtin'?'btn-primary':''}`} style={tab!=='builtin'?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab('builtin')}>{t('agent_tab_builtin')}</button>
        <button type="button" className={`btn btn-sm ${tab==='groups'?'btn-primary':''}`} style={tab!=='groups'?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab('groups')}>{t('agent_tab_groups')}</button>
        {tab==='custom'&&<button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal('create');setForm({id:'',name:'',role:'',description:'',model:'claude-opus-4-7',skills:[],specs_to_load:[],system_prompt:'',a2a_enabled:false,port:null});}}>{t('agent_new')}</button>}
      </div>
    </div>

    {tab==='builtin'&&<div className="card">
      <div className="section-title" style={{marginTop:0}}>{t('agent_builtin_readonly')}</div>
      {(builtin||[]).length===0?<div className="empty">{t('agent_builtin_empty')}</div>:
        (builtin||[]).map(a=><div key={a.id} className="list-item">
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span className="title">{a.name}</span>
            <span className="tag tag-p2">{a.role}</span>
            {a.a2a_enabled&&<span className="tag tag-done">A2A</span>}
            {a.port!=null&&<span style={{fontSize:11,color:'#64748b'}}>{t('agent_port', { n: a.port })}</span>}
          </div>
          <div className="meta">{a.description}</div>
          <div className="meta">{t('agent_meta_model', { model: a.model, skills: (a.skills||[]).join(', ')||'—' })}</div>
        </div>
      </div>)}
    </div>}

    {tab==='custom'&&<div className="card">
      {(agents||[]).length===0?<div className="empty" style={{padding:'28px 20px'}}>
        <div style={{fontSize:15,marginBottom:8,color:'var(--text)'}}>{t('agent_custom_empty_title')}</div>
        <div style={{fontSize:13,color:'var(--text3)',marginBottom:16}}>{t('agent_custom_empty_hint')}</div>
      </div>:
        (agents||[]).map(a=><div key={a.id} className="list-item">
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span className="title">{a.name}</span>
              <span className="tag tag-p2">{a.role}</span>
              {a.a2a_enabled&&<span className="tag tag-done">A2A :{a.port}</span>}
            </div>
            <div className="meta">{a.description}</div>
            <div className="meta">{t('agent_meta_model_only', { model: a.model })}</div>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>{setModal(a);setForm({...a});}}>{t('agent_edit')}</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(a.id)}>{t('agent_del')}</button>
          </div>
        </div>)}
    </div>}

    {tab==='groups'&&<GroupManager groups={groups} reload={reloadGroups} allAgents={allAgents} t={t}/>}

    {modal&&<div className="modal-bg" onClick={()=>setModal(null)}>
      <div className="modal" style={{width:520}} onClick={e=>e.stopPropagation()}>
        <h3>{modal==='create'?t('agent_modal_create'):t('agent_modal_edit')}</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>{t('agent_label_id')}</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value})} placeholder="coder-java" disabled={modal!=='create'}/></div>
          <div className="form-group"><label>{t('agent_label_name')}</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder={t('agent_ph_name')}/></div>
          <div className="form-group"><label>{t('agent_label_role')}</label><input value={form.role} onChange={e=>setForm({...form,role:e.target.value})} placeholder={t('agent_ph_role')}/></div>
          <div className="form-group"><label>{t('agent_label_model')}</label>
            <select value={form.model} onChange={e=>setForm({...form,model:e.target.value})}>
              {['claude-opus-4-7','claude-sonnet-4-5','gpt-4o','gemini-1.5-pro'].map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group"><label>{t('agent_label_desc')}</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>System Prompt</label><textarea value={form.system_prompt||''} onChange={e=>setForm({...form,system_prompt:e.target.value})} style={{minHeight:80}} placeholder={t('agent_ph_prompt')}/></div>
        <div className="form-group"><label>{t('agent_label_specs')}</label><input value={(form.specs_to_load||[]).join(',')} onChange={e=>setForm({...form,specs_to_load:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})} placeholder="specs/backend/JAVA_SPEC.md"/></div>
        <div style={{display:'flex',gap:16,alignItems:'center',marginBottom:12}}>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'#94a3b8',cursor:'pointer'}}>
            <input type="checkbox" checked={form.a2a_enabled||false} onChange={e=>setForm({...form,a2a_enabled:e.target.checked})}/>
            {t('agent_a2a_enable')}
          </label>
          {form.a2a_enabled&&<div className="form-group" style={{margin:0,flex:1}}><input type="number" value={form.port||''} onChange={e=>setForm({...form,port:+e.target.value})} placeholder={t('agent_ph_port')}/></div>}
        </div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(null)}>{t('agent_cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('agent_save')}</button>
        </div>
      </div>
    </div>}
  </div>;
}

function GroupManager({groups,reload,allAgents,t}) {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const tr = t || ((k, v) => (typeof window.t === 'function' ? window.t(k, v) : k));
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({id:'',name:'',description:'',agents:[]});
  const save = () => {
    apiFetch(`/agents/groups`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast(tr('agent_toast_group_ok'),'ok');})
      .catch(()=>showToast(tr('agent_toast_save_fail'),'err'));
  };
  return <div>
    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
      <button className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({id:'',name:'',description:'',agents:[]});}}>{tr('agent_group_new')}</button>
    </div>
    <div className="card">
      {(groups||[]).length===0?<div className="empty">{tr('agent_group_empty')}</div>:(groups||[]).map(g=><div key={g.id} className="list-item">
        <div style={{flex:1}}>
          <div className="title">{g.name}</div>
          <div className="meta">{g.description}</div>
          <div className="meta">{tr('agent_group_members', { list: (g.agents && g.agents.join(', ')) || '' })}</div>
        </div>
      </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{tr('agent_group_modal_title')}</h3>
        <div className="form-group"><label>{tr('agent_label_group_id')}</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value})}/></div>
        <div className="form-group"><label>{tr('agent_group_name')}</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
        <div className="form-group"><label>{tr('agent_group_desc')}</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>{tr('agent_group_members_label')}</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {(allAgents||[]).map(a=><label key={a.id} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#94a3b8',cursor:'pointer'}}>
              <input type="checkbox" checked={form.agents.includes(a.id)} onChange={e=>{const s=new Set(form.agents);e.target.checked?s.add(a.id):s.delete(a.id);setForm({...form,agents:[...s]});}}/>
              {a.name}
            </label>)}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(false)}>{tr('agent_cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{tr('agent_save')}</button>
        </div>
      </div>
    </div>}
  </div>;
}
