window.i18nExtend && window.i18nExtend({
  zh: {
    mcp_title: '🔌 MCP Server 管理',
    mcp_add: '+ 添加',
    mcp_configured: '已配置 ({n})',
    mcp_empty: '暂无 MCP Server，从下方内置列表添加',
    mcp_remove: '移除',
    mcp_builtin_title: '内置 MCP Server',
    mcp_builtin_add: '添加',
    mcp_modal_title: '添加 MCP Server',
    mcp_label_name: '名称',
    mcp_label_cmd: '命令',
    mcp_label_args: '参数（空格分隔）',
    mcp_label_desc: '描述',
    mcp_ph_cmd: 'npx 或 python3',
    mcp_cancel: '取消',
    mcp_save: '保存',
    mcp_confirm_del: '删除 MCP Server: {name}？',
    mcp_toast_added: '已添加 MCP',
    mcp_toast_add_fail: '添加失败',
    mcp_toast_removed: '已移除',
    mcp_toast_del_fail: '删除失败',
    mcp_toast_tpl_ok: '已从模板添加',
  },
  en: {
    mcp_title: '🔌 MCP servers',
    mcp_add: '+ Add',
    mcp_configured: 'Configured ({n})',
    mcp_empty: 'No MCP servers — add from built-in list below',
    mcp_remove: 'Remove',
    mcp_builtin_title: 'Built-in MCP servers',
    mcp_builtin_add: 'Add',
    mcp_modal_title: 'Add MCP server',
    mcp_label_name: 'Name',
    mcp_label_cmd: 'Command',
    mcp_label_args: 'Args (space-separated)',
    mcp_label_desc: 'Description',
    mcp_ph_cmd: 'npx or python3',
    mcp_cancel: 'Cancel',
    mcp_save: 'Save',
    mcp_confirm_del: 'Remove MCP server {name}?',
    mcp_toast_added: 'MCP server added',
    mcp_toast_add_fail: 'Add failed',
    mcp_toast_removed: 'Removed',
    mcp_toast_del_fail: 'Remove failed',
    mcp_toast_tpl_ok: 'Added from template',
  },
});

function McpManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
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
      .then(()=>{setModal(false);reload();showToast(t('mcp_toast_added'),'ok');})
      .catch(()=>showToast(t('mcp_toast_add_fail'),'err'));
  };
  const del = (name) => {
    if(!confirm(t('mcp_confirm_del', { name }))) return;
    apiFetch(`/mcp/${name}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('mcp_toast_removed'),'ok');})
      .catch(()=>showToast(t('mcp_toast_del_fail'),'err'));
  };
  const addBuiltin = (s) => {
    apiFetch(`/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('mcp_toast_tpl_ok'),'ok');})
      .catch(()=>showToast(t('mcp_toast_add_fail'),'err'));
  };

  if (loading) return <div><div className="section-title">{t('mcp_title')}</div><PageSkeleton cards={2}/></div>;
  if (errText) return <div><div className="section-title">{t('mcp_title')}</div><LoadError message={errText} onRetry={reloadAll}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div className="section-title">{t('mcp_title')}</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reloadAll} />
        <button className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({name:'',command:'',args:'',description:''});}}>{t('mcp_add')}</button>
      </div>
    </div>
    <div className="card" style={{marginBottom:12}}>
      <div className="section-title">{t('mcp_configured', { n: (data||[]).length })}</div>
      {(data||[]).length===0?<div className="empty">{t('mcp_empty')}</div>:
        (data||[]).map(s=><div key={s.name} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{s.name}</div>
            <div className="meta">{s.command} {(s.args||[]).join(' ')}</div>
            {s.description&&<div className="meta" style={{color:'#64748b'}}>{s.description}</div>}
          </div>
          <button className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(s.name)}>{t('mcp_remove')}</button>
        </div>)}
    </div>
    <div className="card">
      <div className="section-title">{t('mcp_builtin_title')}</div>
      {(builtin||[]).map(s=><div key={s.name} className="list-item">
        <div style={{flex:1}}>
          <div className="title">{s.name}</div>
          <div className="meta">{s.description}</div>
        </div>
        <button className="btn btn-sm btn-primary" onClick={()=>addBuiltin(s)}>{t('mcp_builtin_add')}</button>
      </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{t('mcp_modal_title')}</h3>
        <div className="form-group"><label>{t('mcp_label_name')}</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="my-server"/></div>
        <div className="form-group"><label>{t('mcp_label_cmd')}</label><input value={form.command} onChange={e=>setForm({...form,command:e.target.value})} placeholder={t('mcp_ph_cmd')}/></div>
        <div className="form-group"><label>{t('mcp_label_args')}</label><input value={form.args} onChange={e=>setForm({...form,args:e.target.value})} placeholder="-y @modelcontextprotocol/server-filesystem ."/></div>
        <div className="form-group"><label>{t('mcp_label_desc')}</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="modal-actions">
          <button className="btn btn-cancel" onClick={()=>setModal(false)}>{t('mcp_cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('mcp_save')}</button>
        </div>
      </div>
    </div>}
  </div>;
}
