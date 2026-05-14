window.i18nExtend && window.i18nExtend({
  zh: {
    skills_title: '⚡ 技能管理',
    skills_custom_new: '+ 自定义技能',
    skills_builtin_n: '内置技能 ({n})',
    skills_custom_n: '自定义技能 ({n})',
    skills_empty_custom: '暂无自定义技能',
    skills_modal_title: '自定义技能',
    skills_label_id: '技能 ID',
    skills_label_name: '名称',
    skills_label_role: '适用角色',
    skills_label_budget: 'Token 预算',
    skills_label_desc: '描述',
    skills_label_trigger: '触发条件',
    skills_label_exec: '执行步骤',
    skills_ph_trigger: '任务开始前...',
    skills_ph_exec: '执行命令或步骤描述...',
    skills_flag_a2a: 'A2A 暴露',
    skills_flag_mcp: 'MCP 工具',
    skills_flag_lance: 'LanceDB 上下文',
    skills_cancel: '取消',
    skills_save: '保存',
    skills_del: '删除',
    skills_toast_saved: '技能已保存',
    skills_toast_save_fail: '保存失败',
    skills_confirm_del: '确认删除？',
    skills_toast_deleted: '已删除',
    skills_toast_del_fail: '删除失败',
  },
  en: {
    skills_title: '⚡ Skills',
    skills_custom_new: '+ Custom skill',
    skills_builtin_n: 'Built-in ({n})',
    skills_custom_n: 'Custom ({n})',
    skills_empty_custom: 'No custom skills yet',
    skills_modal_title: 'Custom skill',
    skills_label_id: 'Skill ID',
    skills_label_name: 'Name',
    skills_label_role: 'Agent role',
    skills_label_budget: 'Token budget',
    skills_label_desc: 'Description',
    skills_label_trigger: 'Trigger',
    skills_label_exec: 'Execution steps',
    skills_ph_trigger: 'Before task starts...',
    skills_ph_exec: 'Commands or step description...',
    skills_flag_a2a: 'Expose A2A',
    skills_flag_mcp: 'MCP tool',
    skills_flag_lance: 'LanceDB context',
    skills_cancel: 'Cancel',
    skills_save: 'Save',
    skills_del: 'Delete',
    skills_toast_saved: 'Skill saved',
    skills_toast_save_fail: 'Save failed',
    skills_confirm_del: 'Delete this skill?',
    skills_toast_deleted: 'Deleted',
    skills_toast_del_fail: 'Delete failed',
  },
});

function SkillManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const {data,loading,error,reload} = useFetch(`${API}/skills`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({skill_id:'',name:'',description:'',agent_role:'All',trigger:'',execution:'',a2a_exposed:false,mcp_tool:false,lancedb_context:false,context_budget:10000});

  const save = () => {
    apiFetch(`/skills`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast(t('skills_toast_saved'),'ok');})
      .catch(()=>showToast(t('skills_toast_save_fail'),'err'));
  };
  const del = (id) => {
    if(!confirm(t('skills_confirm_del'))) return;
    apiFetch(`/skills/${id}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('skills_toast_deleted'),'ok');})
      .catch(()=>showToast(t('skills_toast_del_fail'),'err'));
  };

  if (loading) return <div><div className="section-title">{t('skills_title')}</div><PageSkeleton cards={2}/></div>;
  if (error) return <div><div className="section-title">{t('skills_title')}</div><LoadError message={error} onRetry={reload}/></div>;

  const skills = data||[];
  const builtin = skills.filter(s=>s.builtin);
  const custom = skills.filter(s=>!s.builtin);

  const Badge = ({label,color='#334155'}) => <span style={{background:color,color:'#e2e8f0',padding:'1px 6px',borderRadius:4,fontSize:10,fontWeight:600}}>{label}</span>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div className="section-title">{t('skills_title')}</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({skill_id:'',name:'',description:'',agent_role:'All',trigger:'',execution:'',a2a_exposed:false,mcp_tool:false,lancedb_context:false,context_budget:10000});}}>{t('skills_custom_new')}</button>
      </div>
    </div>
    <div className="card" style={{marginBottom:12}}>
      <div className="section-title">{t('skills_builtin_n', { n: builtin.length })}</div>
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
      <div className="section-title">{t('skills_custom_n', { n: custom.length })}</div>
      {custom.length===0?<div className="empty">{t('skills_empty_custom')}</div>:custom.map(s=><div key={s.skill_id} className="list-item">
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
        <button className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(s.skill_id)}>{t('skills_del')}</button>
      </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" style={{width:500}} onClick={e=>e.stopPropagation()}>
        <h3>{t('skills_modal_title')}</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>{t('skills_label_id')}</label><input value={form.skill_id} onChange={e=>setForm({...form,skill_id:e.target.value})} placeholder="CUSTOM-001"/></div>
          <div className="form-group"><label>{t('skills_label_name')}</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
          <div className="form-group"><label>{t('skills_label_role')}</label>
            <select value={form.agent_role} onChange={e=>setForm({...form,agent_role:e.target.value})}>
              {['All','Planner','Coder','Reviewer','Tester','Debugger','Worker'].map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group"><label>{t('skills_label_budget')}</label><input type="number" value={form.context_budget} onChange={e=>setForm({...form,context_budget:+e.target.value})}/></div>
        </div>
        <div className="form-group"><label>{t('skills_label_desc')}</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="form-group"><label>{t('skills_label_trigger')}</label><input value={form.trigger} onChange={e=>setForm({...form,trigger:e.target.value})} placeholder={t('skills_ph_trigger')}/></div>
        <div className="form-group"><label>{t('skills_label_exec')}</label><textarea value={form.execution} onChange={e=>setForm({...form,execution:e.target.value})} style={{minHeight:80}} placeholder={t('skills_ph_exec')}/></div>
        <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:12}}>
          {[['a2a_exposed', t('skills_flag_a2a')],['mcp_tool', t('skills_flag_mcp')],['lancedb_context', t('skills_flag_lance')]].map(([k,l])=><label key={k} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#94a3b8',cursor:'pointer'}}>
            <input type="checkbox" checked={form[k]||false} onChange={e=>setForm({...form,[k]:e.target.checked})}/>{l}
          </label>)}
        </div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(false)}>{t('skills_cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('skills_save')}</button>
        </div>
      </div>
    </div>}
  </div>;
}
