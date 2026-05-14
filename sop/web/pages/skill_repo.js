window.i18nExtend && window.i18nExtend({
  zh: {
    sr_tab_repos: '📦 仓库管理', sr_tab_installed: '✅ 已安装', sr_tab_import: '⬆️ 导入技能',
    sr_repos_title: '技能仓库', sr_add_repo: '+ 添加仓库', sr_empty_repos: '暂无技能仓库，点击「添加仓库」配置 Git 仓库',
    sr_branch: '分支', sr_synced_n: '已同步 {n} 个技能', sr_sync: '↻ 同步', sr_syncing: '同步中...', sr_delete: '删除',
    sr_modal_repo: '添加技能仓库', sr_label_id: 'ID', sr_name: '名称', sr_git_url: 'Git URL', sr_desc: '描述',
    sr_cancel: '取消', sr_save: '保存',
    sr_toast_repo_ok: '仓库已保存', sr_toast_fail: '保存失败', sr_toast_del_ok: '已删除', sr_toast_del_fail: '删除失败',
    sr_toast_sync_ok: '同步成功，发现 {n} 个技能', sr_toast_sync_fail: '同步失败: {e}', sr_unknown: '未知', sr_toast_sync_req: '同步请求失败',
    sr_installed_title: '已安装技能', sr_installed_n: '已安装技能 ({n})', sr_empty_installed: '暂无已安装技能',
    sr_on: '启用', sr_off: '禁用', sr_disable: '禁用', sr_enable: '启用', sr_uninstall: '卸载',
    sr_toast_toggle_ok: '状态已更新', sr_toast_op_fail: '操作失败', sr_confirm_uninstall: '确认卸载？',
    sr_toast_un_ok: '已卸载', sr_toast_un_fail: '卸载失败',
    sr_imp_title: '导入 / 开发技能',
    sr_imp_intro_before: '选择安装方式，按表单填写即可；服务端会拼装或拉取 ',
    sr_imp_intro_after: ' 结构并写入「已安装」。无需手写 JSON。',
    sr_imp_mode_d: '📝 技能描述', sr_imp_mode_d_h: '表单填写名称、触发与执行说明',
    sr_imp_mode_n: '📦 NPM 包', sr_imp_mode_n_h: 'npm pack 拉包并读取包内 skill.json',
    sr_imp_mode_z: '🗜 ZIP 包', sr_imp_mode_z_h: '上传含 skill.json 的 ZIP（任意子目录）',
    sr_imp_hint_d: '适用于自建技能：填写展示名与触发/执行说明，由后台生成标准字段。',
    sr_imp_hint_n: '适用于已发布到 npm 的技能包：填写包名，服务器执行 npm pack 解压后查找 skill.json；可选覆盖部分字段。',
    sr_imp_hint_z: '适用于本地或 CI 打好的技能目录压缩包：ZIP 内需包含至少一个 skill.json。',
    sr_imp_sec_id: '① 标识与版本', sr_imp_skill_id: '技能 ID *', sr_imp_version: '版本',
    sr_imp_sec_content: '② 技能内容', sr_imp_skill_name: '技能名称 *', sr_imp_skill_desc: '描述',
    sr_imp_agent_role: '适用角色', sr_imp_trigger: '触发条件', sr_imp_exec: '执行步骤 / 要点',
    sr_imp_ph_name: '例如：代码审查助手', sr_imp_ph_desc: '一句话说明技能用途', sr_imp_ph_trigger: '何时应激活本技能', sr_imp_ph_exec: '模型应遵循的步骤或检查清单',
    sr_imp_sec_npm: '② NPM 包', sr_imp_npm_pkg: 'npm 包名 *', sr_imp_toggle_hide: '收起可选覆盖项', sr_imp_toggle_show: '可选：覆盖包内部分字段',
    sr_imp_ov_name: '覆盖名称（留空则用包内）', sr_imp_ov_desc: '覆盖描述', sr_imp_ov_role: '覆盖角色', sr_imp_ov_trigger: '覆盖触发', sr_imp_ov_exec: '覆盖执行说明',
    sr_imp_sec_zip: '② 上传 ZIP', sr_imp_zip_file: '选择文件 *', sr_imp_zip_picked: '已选：{name}',
    sr_imp_btn_busy: '导入中…', sr_imp_btn_zip: '⬆️ 上传并导入 ZIP', sr_imp_btn_go: '⬆️ 导入技能',
    sr_imp_result_ok: '✅ 导入成功 · {key}{from}', sr_imp_from: '（来自 {from}）',
    sr_imp_toast_id: '请填写技能 ID', sr_imp_toast_npm: '请填写 npm 包名（将使用 npm pack 拉取，需服务器已安装 npm）', sr_imp_toast_name: '请填写技能名称',
    sr_imp_toast_zip: '请选择 ZIP 文件', sr_imp_toast_import_fail: '导入失败', sr_imp_toast_ok: '导入成功', sr_imp_toast_zip_ok: 'ZIP 导入成功', sr_imp_toast_req: '请求失败',
  },
  en: {
    sr_tab_repos: '📦 Repositories', sr_tab_installed: '✅ Installed', sr_tab_import: '⬆️ Import',
    sr_repos_title: 'Skill repositories', sr_add_repo: '+ Add repository', sr_empty_repos: 'No repositories — add a Git remote',
    sr_branch: 'Branch', sr_synced_n: 'Synced {n} skills', sr_sync: '↻ Sync', sr_syncing: 'Syncing...', sr_delete: 'Delete',
    sr_modal_repo: 'Add repository', sr_label_id: 'ID', sr_name: 'Name', sr_git_url: 'Git URL', sr_desc: 'Description',
    sr_cancel: 'Cancel', sr_save: 'Save',
    sr_toast_repo_ok: 'Repository saved', sr_toast_fail: 'Save failed', sr_toast_del_ok: 'Deleted', sr_toast_del_fail: 'Delete failed',
    sr_toast_sync_ok: 'Synced; found {n} skills', sr_toast_sync_fail: 'Sync failed: {e}', sr_unknown: 'unknown', sr_toast_sync_req: 'Sync request failed',
    sr_installed_title: 'Installed skills', sr_installed_n: 'Installed ({n})', sr_empty_installed: 'Nothing installed yet',
    sr_on: 'On', sr_off: 'Off', sr_disable: 'Disable', sr_enable: 'Enable', sr_uninstall: 'Uninstall',
    sr_toast_toggle_ok: 'Status updated', sr_toast_op_fail: 'Operation failed', sr_confirm_uninstall: 'Uninstall this skill?',
    sr_toast_un_ok: 'Uninstalled', sr_toast_un_fail: 'Uninstall failed',
    sr_imp_title: 'Import / develop skills',
    sr_imp_intro_before: 'Pick a mode and fill the form; the server builds or fetches a ',
    sr_imp_intro_after: ' payload and registers it under Installed. No hand-written JSON.',
    sr_imp_mode_d: '📝 Descriptor', sr_imp_mode_d_h: 'Name, trigger, execution text',
    sr_imp_mode_n: '📦 NPM package', sr_imp_mode_n_h: 'npm pack then read skill.json',
    sr_imp_mode_z: '🗜 ZIP upload', sr_imp_mode_z_h: 'ZIP containing skill.json anywhere',
    sr_imp_hint_d: 'For custom skills: display name + trigger/execution; server fills standard fields.',
    sr_imp_hint_n: 'For published npm packages: package name; server runs npm pack and locates skill.json; optional overrides.',
    sr_imp_hint_z: 'For local/CI zips: must contain at least one skill.json.',
    sr_imp_sec_id: '① Id & version', sr_imp_skill_id: 'Skill ID *', sr_imp_version: 'Version',
    sr_imp_sec_content: '② Content', sr_imp_skill_name: 'Display name *', sr_imp_skill_desc: 'Description',
    sr_imp_agent_role: 'Agent role', sr_imp_trigger: 'Trigger', sr_imp_exec: 'Execution / checklist',
    sr_imp_ph_name: 'e.g. Code review helper', sr_imp_ph_desc: 'One-line purpose', sr_imp_ph_trigger: 'When to activate', sr_imp_ph_exec: 'Steps the model should follow',
    sr_imp_sec_npm: '② NPM package', sr_imp_npm_pkg: 'npm package name *', sr_imp_toggle_hide: 'Hide overrides', sr_imp_toggle_show: 'Optional field overrides',
    sr_imp_ov_name: 'Override name (empty = from package)', sr_imp_ov_desc: 'Override description', sr_imp_ov_role: 'Override role', sr_imp_ov_trigger: 'Override trigger', sr_imp_ov_exec: 'Override execution',
    sr_imp_sec_zip: '② Upload ZIP', sr_imp_zip_file: 'File *', sr_imp_zip_picked: 'Selected: {name}',
    sr_imp_btn_busy: 'Importing…', sr_imp_btn_zip: '⬆️ Upload & import ZIP', sr_imp_btn_go: '⬆️ Import skill',
    sr_imp_result_ok: '✅ Imported · {key}{from}', sr_imp_from: ' (from {from})',
    sr_imp_toast_id: 'Enter skill ID', sr_imp_toast_npm: 'Enter npm package name (requires npm on server)', sr_imp_toast_name: 'Enter skill name',
    sr_imp_toast_zip: 'Choose a ZIP file', sr_imp_toast_import_fail: 'Import failed', sr_imp_toast_ok: 'Imported', sr_imp_toast_zip_ok: 'ZIP imported', sr_imp_toast_req: 'Request failed',
  },
});

function SkillRepoManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const [tab,setTab] = React.useState('repos');
  return <div>
    <div style={{display:'flex',gap:4,marginBottom:16}}>
      {[['repos', t('sr_tab_repos')],['installed', t('sr_tab_installed')],['import', t('sr_tab_import')]].map(([id,l])=>
        <button key={id} className={`btn btn-sm ${tab===id?'btn-primary':''}`} style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{l}</button>)}
    </div>
    {tab==='repos'&&<ReposPanel/>}
    {tab==='installed'&&<InstalledPanel/>}
    {tab==='import'&&<ImportPanel/>}
  </div>;
}

function ReposPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const {data,loading,error,reload} = useFetch(`${API}/skill-repo/repos`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({id:'',name:'',url:'',description:'',branch:'main'});
  const [syncing,setSyncing] = React.useState({});

  const save = () => {
    apiFetch(`/skill-repo/repos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast(t('sr_toast_repo_ok'),'ok');})
      .catch(()=>showToast(t('sr_toast_fail'),'err'));
  };
  const del = (id) => {
    apiFetch(`/skill-repo/repos/${id}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('sr_toast_del_ok'),'ok');})
      .catch(()=>showToast(t('sr_toast_del_fail'),'err'));
  };
  const sync = (id) => {
    setSyncing(p=>({...p,[id]:true}));
    apiFetch(`/skill-repo/repos/${id}/sync`,{method:'POST'}).then(r=>r.json()).then(d=>{
      setSyncing(p=>({...p,[id]:false}));
      reload();
      if(d.ok){showToast(t('sr_toast_sync_ok', { n: d.skills_found||0 }),'ok');}
      else showToast(t('sr_toast_sync_fail', { e: d.error||t('sr_unknown') }),'err');
    }).catch(()=>{setSyncing(p=>({...p,[id]:false}));showToast(t('sr_toast_sync_req'),'err');});
  };

  if (loading) return <div><div className="section-title">{t('sr_repos_title')}</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">{t('sr_repos_title')}</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">{t('sr_repos_title')}</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({id:'',name:'',url:'',description:'',branch:'main'});}}>{t('sr_add_repo')}</button>
      </div>
    </div>
    <div className="card">
      {(data||[]).length===0?<div className="empty">{t('sr_empty_repos')}</div>:
        (data||[]).map(r=><div key={r.id} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{r.name}</div>
            <div className="meta">{r.url} · {t('sr_branch')}: {r.branch}</div>
            {r.skills&&<div className="meta" style={{color:'#86efac'}}>{t('sr_synced_n', { n: r.skills.length })}</div>}
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>sync(r.id)} disabled={syncing[r.id]}>{syncing[r.id]?t('sr_syncing'):t('sr_sync')}</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(r.id)}>{t('sr_delete')}</button>
          </div>
        </div>)}
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>{t('sr_modal_repo')}</h3>
        <div className="form-group"><label>{t('sr_label_id')}</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value})} placeholder="my-skills"/></div>
        <div className="form-group"><label>{t('sr_name')}</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
        <div className="form-group"><label>{t('sr_git_url')}</label><input value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="https://github.com/org/skills-repo.git"/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>{t('sr_branch')}</label><input value={form.branch} onChange={e=>setForm({...form,branch:e.target.value})}/></div>
          <div className="form-group"><label>{t('sr_desc')}</label><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(false)}>{t('sr_cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save}>{t('sr_save')}</button>
        </div>
      </div>
    </div>}
  </div>;
}

function InstalledPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const {data,loading,error,reload} = useFetch(`${API}/skill-repo/installed`);
  const toggle = (key) => {
    apiFetch(`/skill-repo/installed/${key}/toggle`,{method:'PATCH'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('sr_toast_toggle_ok'),'ok');})
      .catch(()=>showToast(t('sr_toast_op_fail'),'err'));
  };
  const uninstall = (key) => { if(!confirm(t('sr_confirm_uninstall'))) return;
    apiFetch(`/skill-repo/installed/${key}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('sr_toast_un_ok'),'ok');})
      .catch(()=>showToast(t('sr_toast_un_fail'),'err'));
  };
  const entries = Object.entries(data||{});
  if (loading) return <div><div className="section-title">{t('sr_installed_title')}</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">{t('sr_installed_title')}</div><LoadError message={error} onRetry={reload}/></div>;
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">{t('sr_installed_n', { n: entries.length })}</div>
      <RefreshBtn onClick={reload} />
    </div>
    <div className="card">
      {entries.length===0?<div className="empty">{t('sr_empty_installed')}</div>:
        entries.map(([key,s])=><div key={key} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{(s.data && s.data.name) || s.skill_id}</div>
            <div className="meta">{s.skill_id} · {key} · v{s.version}</div>
          </div>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            <span className={`tag ${s.enabled?'tag-done':'tag-p3'}`}>{s.enabled?t('sr_on'):t('sr_off')}</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>toggle(key)}>{s.enabled?t('sr_disable'):t('sr_enable')}</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>uninstall(key)}>{t('sr_uninstall')}</button>
          </div>
        </div>)}
    </div>
  </div>;
}

function ImportPanel() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const [mode, setMode] = React.useState('descriptor');
  const [form, setForm] = React.useState({
    skill_id: 'CUSTOM-001',
    version: '1.0.0',
    name: '',
    description: '',
    agent_role: 'All',
    trigger: '',
    execution: '',
    npx_package: '',
  });
  const [zipFile, setZipFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [showOverrides, setShowOverrides] = React.useState(false);

  const agentRoles = ['All', 'Planner', 'Coder', 'Reviewer', 'Tester', 'Debugger', 'Worker'];

  const submitJson = () => {
    const sid = (form.skill_id || '').trim();
    if (!sid) {
      showToast(t('sr_imp_toast_id'), 'err');
      return;
    }
    if (mode === 'npx' && !(form.npx_package || '').trim()) {
      showToast(t('sr_imp_toast_npm'), 'err');
      return;
    }
    if (mode === 'descriptor' && !(form.name || '').trim()) {
      showToast(t('sr_imp_toast_name'), 'err');
      return;
    }
    setBusy(true);
    setResult(null);
    const body = {
      mode: mode === 'npx' ? 'npx' : 'descriptor',
      skill_id: sid,
      version: (form.version || '1.0.0').trim(),
      name: (form.name || '').trim(),
      description: (form.description || '').trim(),
      agent_role: form.agent_role || 'All',
      trigger: (form.trigger || '').trim(),
      execution: (form.execution || '').trim(),
      npx_package: mode === 'npx' ? (form.npx_package || '').trim() : '',
    };
    apiFetch(`/skill-repo/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setBusy(false);
        setResult(d);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : t('sr_imp_toast_import_fail'), 'err');
          return;
        }
        if (d.ok) showToast(t('sr_imp_toast_ok'), 'ok');
        else showToast(d.detail || t('sr_imp_toast_import_fail'), 'err');
      })
      .catch(() => {
        setBusy(false);
        showToast(t('sr_imp_toast_req'), 'err');
      });
  };

  const submitZip = () => {
    const sid = (form.skill_id || '').trim();
    if (!sid) {
      showToast(t('sr_imp_toast_id'), 'err');
      return;
    }
    if (!zipFile) {
      showToast(t('sr_imp_toast_zip'), 'err');
      return;
    }
    const fd = new FormData();
    fd.append('skill_id', sid);
    fd.append('version', (form.version || '1.0.0').trim());
    fd.append('file', zipFile);
    setBusy(true);
    setResult(null);
    apiFetch(`/skill-repo/import/zip`, { method: 'POST', body: fd })
      .then((r) => r.json().then((d) => ({ httpOk: r.ok, d })))
      .then(({ httpOk, d }) => {
        setBusy(false);
        setResult(d);
        if (!httpOk) {
          showToast(typeof d.detail === 'string' ? d.detail : t('sr_imp_toast_import_fail'), 'err');
          return;
        }
        if (d.ok) showToast(t('sr_imp_toast_zip_ok'), 'ok');
        else showToast(d.detail || t('sr_imp_toast_import_fail'), 'err');
      })
      .catch(() => {
        setBusy(false);
        showToast(t('sr_imp_toast_req'), 'err');
      });
  };

  const modeButtons = [
    ['descriptor', t('sr_imp_mode_d'), t('sr_imp_mode_d_h')],
    ['npx', t('sr_imp_mode_n'), t('sr_imp_mode_n_h')],
    ['zip', t('sr_imp_mode_z'), t('sr_imp_mode_z_h')],
  ];

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>{t('sr_imp_title')}</div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.55 }}>
        {t('sr_imp_intro_before')}<code style={{ color: '#fbbf24' }}>skill.json</code>{t('sr_imp_intro_after')}
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {modeButtons.map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${mode === id ? 'btn-primary' : ''}`}
            style={mode !== id ? { background: '#334155', color: '#94a3b8', maxWidth: 200, textAlign: 'left' } : { maxWidth: 200, textAlign: 'left' }}
            onClick={() => {
              setMode(id);
              setResult(null);
            }}
            title={hint}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          {mode === 'descriptor' && t('sr_imp_hint_d')}
          {mode === 'npx' && t('sr_imp_hint_n')}
          {mode === 'zip' && t('sr_imp_hint_z')}
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ fontSize: 14, marginBottom: 10 }}>{t('sr_imp_sec_id')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-group">
            <label>{t('sr_imp_skill_id')}</label>
            <input
              value={form.skill_id}
              onChange={(e) => setForm({ ...form, skill_id: e.target.value })}
              placeholder="CUSTOM-001"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
          <div className="form-group">
            <label>{t('sr_imp_version')}</label>
            <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.0.0" />
          </div>
        </div>

        {mode === 'descriptor' && (
          <>
            <div className="section-title" style={{ fontSize: 14, margin: '16px 0 10px' }}>{t('sr_imp_sec_content')}</div>
            <div className="form-group">
              <label>{t('sr_imp_skill_name')}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('sr_imp_ph_name')} />
            </div>
            <div className="form-group">
              <label>{t('sr_imp_skill_desc')}</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('sr_imp_ph_desc')} style={{ minHeight: 56, fontSize: 13 }} />
            </div>
            <div className="form-group">
              <label>{t('sr_imp_agent_role')}</label>
              <select value={form.agent_role} onChange={(e) => setForm({ ...form, agent_role: e.target.value })}>
                {agentRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('sr_imp_trigger')}</label>
              <textarea value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} placeholder={t('sr_imp_ph_trigger')} style={{ minHeight: 64, fontSize: 13 }} />
            </div>
            <div className="form-group">
              <label>{t('sr_imp_exec')}</label>
              <textarea value={form.execution} onChange={(e) => setForm({ ...form, execution: e.target.value })} placeholder={t('sr_imp_ph_exec')} style={{ minHeight: 120, fontSize: 13 }} />
            </div>
          </>
        )}

        {mode === 'npx' && (
          <>
            <div className="section-title" style={{ fontSize: 14, margin: '16px 0 10px' }}>{t('sr_imp_sec_npm')}</div>
            <div className="form-group">
              <label>{t('sr_imp_npm_pkg')}</label>
              <input
                value={form.npx_package}
                onChange={(e) => setForm({ ...form, npx_package: e.target.value })}
                placeholder="例如 my-skill-pkg 或 @org/skill-name"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
            <button type="button" className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', marginBottom: 10 }} onClick={() => setShowOverrides(!showOverrides)}>
              {showOverrides ? t('sr_imp_toggle_hide') : t('sr_imp_toggle_show')}
            </button>
            {showOverrides && (
              <div style={{ border: '1px solid #334155', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div className="form-group">
                  <label>{t('sr_imp_ov_name')}</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('sr_imp_ov_desc')}</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 48 }} />
                </div>
                <div className="form-group">
                  <label>{t('sr_imp_ov_role')}</label>
                  <select value={form.agent_role} onChange={(e) => setForm({ ...form, agent_role: e.target.value })}>
                    {agentRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>{t('sr_imp_ov_trigger')}</label>
                  <textarea value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} style={{ minHeight: 48 }} />
                </div>
                <div className="form-group">
                  <label>{t('sr_imp_ov_exec')}</label>
                  <textarea value={form.execution} onChange={(e) => setForm({ ...form, execution: e.target.value })} style={{ minHeight: 64 }} />
                </div>
              </div>
            )}
          </>
        )}

        {mode === 'zip' && (
          <>
            <div className="section-title" style={{ fontSize: 14, margin: '16px 0 10px' }}>{t('sr_imp_sec_zip')}</div>
            <div className="form-group">
              <label>{t('sr_imp_zip_file')}</label>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  setZipFile(e.target.files && e.target.files[0] ? e.target.files[0] : null);
                  setResult(null);
                }}
              />
              {zipFile && <div className="meta" style={{ marginTop: 6 }}>{t('sr_imp_zip_picked', { name: zipFile.name })}</div>}
            </div>
          </>
        )}

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 12 }}
          disabled={busy}
          onClick={() => (mode === 'zip' ? submitZip() : submitJson())}
        >
          {busy ? t('sr_imp_btn_busy') : mode === 'zip' ? t('sr_imp_btn_zip') : t('sr_imp_btn_go')}
        </button>

        {result && (
          <div style={{ marginTop: 12, fontSize: 12, color: result.ok ? '#86efac' : '#fca5a5' }}>
            {result.ok
              ? t('sr_imp_result_ok', {
                  key: result.key || '',
                  from: result.resolved_from ? t('sr_imp_from', { from: result.resolved_from }) : '',
                })
              : `❌ ${typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail || result)}`}
          </div>
        )}
      </div>
    </div>
  );
}
