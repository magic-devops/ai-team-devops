/** 技术方案管理：多文档、版本、导入、AI 完善 */
function DesignDocsManager() {
  const {data:list,loading:ll,error:el,reload:reloadList} = useFetch(`${API}/design-docs`);
  const [sel,setSel] = React.useState(null);
  const [meta,setMeta] = React.useState(null);
  const [content,setContent] = React.useState('');
  const [versions,setVersions] = React.useState([]);
  const [loadingDoc,setLoadingDoc] = React.useState(false);
  const [saving,setSaving] = React.useState(false);
  const [newOpen,setNewOpen] = React.useState(false);
  const [newForm,setNewForm] = React.useState({title:'',category:'architecture',tags:'',note:'创建'});
  const [importOpen,setImportOpen] = React.useState(false);
  const [impForm,setImpForm] = React.useState({title:'',category:'import',tags:'',content:'',note:'人工导入'});
  const [aiOpen,setAiOpen] = React.useState(false);
  const [aiForm,setAiForm] = React.useState({instruction:'',mode:'expand'});
  const [verPreview,setVerPreview] = React.useState(null);
  const saveRef = React.useRef(function () {});

  const loadDoc = (id) => {
    if(!id){setSel(null);setMeta(null);setContent('');setVersions([]);return;}
    setLoadingDoc(true);
    Promise.all([
      window.apiFetch(`${API}/design-docs/${encodeURIComponent(id)}`).then(r=>r.json()),
      window.apiFetch(`${API}/design-docs/${encodeURIComponent(id)}/versions`).then(r=>r.json()),
    ]).then(([d,v])=>{
      setLoadingDoc(false);
      if(!d.meta && !d.content && d.detail){showToast(String(d.detail),'err');return;}
      setSel(id);
      setMeta(d.meta);
      setContent(d.content||'');
      setVersions(v.versions||[]);
    }).catch(()=>{setLoadingDoc(false);showToast('加载失败','err');});
  };

  const saveVersion = () => {
    if(!sel)return;
    setSaving(true);
    window.apiFetch(`${API}/design-docs/${encodeURIComponent(sel)}/versions`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({content,note:'手动保存'}),
      timeoutMs:120000,
    }).then(r=>r.json().then(d=>({ok:r.ok,d})))
      .then(({ok,d})=>{
      setSaving(false);
      if(!ok||!d.version){showToast(d.detail||'保存失败','err');return;}
      reloadList();
      loadDoc(sel);
      showToast(`已保存为 v${d.version}`,'ok');
    }).catch(()=>{setSaving(false);showToast('保存失败','err');});
  };
  saveRef.current = saveVersion;

  React.useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return;
      if (!e.target || e.target.tagName !== 'TEXTAREA') return;
      if (!sel || saving) return;
      e.preventDefault();
      saveRef.current();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, saving]);

  const runAi = () => {
    if(!sel||!aiForm.instruction.trim())return;
    setSaving(true);
    window.apiFetch(`${API}/design-docs/${encodeURIComponent(sel)}/ai-improve`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({instruction:aiForm.instruction.trim(),mode:aiForm.mode}),
      timeoutMs:300000,
    }).then(r=>r.json().then(d=>({ok:r.ok,d})))
      .then(({ok,d})=>{
        setSaving(false);
        if(!ok){showToast(typeof d.detail==='string'?d.detail:'AI 失败','err');return;}
        setAiOpen(false);
        setAiForm({instruction:'',mode:'expand'});
        reloadList();
        loadDoc(sel);
        showToast(`AI 已写入 v${d.version}`,'ok');
      }).catch(()=>{setSaving(false);showToast('请求失败','err');});
  };

  const createDoc = () => {
    if(!newForm.title.trim()){showToast('请填写标题','err');return;}
    const tags = newForm.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
    fetch(`${API}/design-docs`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:newForm.title.trim(),category:newForm.category,tags,version_note:newForm.note})})
      .then(r=>r.json().then(d=>({ok:r.ok,d})))
      .then(({ok,d})=>{
        if(!ok||!d.id){showToast(d.detail||'创建失败','err');return;}
        setNewOpen(false);
        setNewForm({title:'',category:'architecture',tags:'',note:'创建'});
        reloadList();
        loadDoc(d.id);
        showToast('已创建','ok');
      }).catch(()=>showToast('创建失败','err'));
  };

  const importDoc = () => {
    if(!impForm.title.trim()||!impForm.content.trim()){showToast('请填写标题与正文','err');return;}
    const tags = impForm.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
    fetch(`${API}/design-docs/import`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:impForm.title.trim(),category:impForm.category,tags,content:impForm.content,version_note:impForm.note})})
      .then(r=>r.json().then(d=>({ok:r.ok,d})))
      .then(({ok,d})=>{
        if(!ok||!d.id){showToast(d.detail||'导入失败','err');return;}
        setImportOpen(false);
        setImpForm({title:'',category:'import',tags:'',content:'',note:'人工导入'});
        reloadList();
        loadDoc(d.id);
        showToast('已导入','ok');
      }).catch(()=>showToast('导入失败','err'));
  };

  const restoreVer = (v) => {
    if(!sel||!confirm(`将 v${v} 内容复制为新版本？`))return;
    fetch(`${API}/design-docs/${encodeURIComponent(sel)}/restore`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:v})})
      .then(r=>{if(!r.ok)throw new Error();})
      .then(()=>{reloadList();loadDoc(sel);showToast('已恢复并新版本','ok');})
      .catch(()=>showToast('恢复失败','err'));
  };

  const delDoc = () => {
    if(!sel||!confirm('删除整个文档及所有版本？'))return;
    fetch(`${API}/design-docs/${encodeURIComponent(sel)}`,{method:'DELETE'})
      .then(r=>{if(!r.ok)throw new Error();})
      .then(()=>{setSel(null);setMeta(null);setContent('');setVersions([]);reloadList();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };

  const viewVersion = (v) => {
    if (!sel) return;
    fetch(`${API}/design-docs/${encodeURIComponent(sel)}/versions/${v}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.content !== undefined) {
          setVerPreview({ v: v, content: d.content });
        }
      })
      .catch(() => {});
  };

  const items = list || [];

  if (ll) {
    return (
      <div>
        <div className="section-title">📐 技术方案管理</div>
        <PageSkeleton cards={2} />
      </div>
    );
  }
  if (el) {
    return (
      <div>
        <div className="section-title">📐 技术方案管理</div>
        <LoadError message={el} onRetry={reloadList} />
      </div>
    );
  }

  return (
    <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
      <div className="section-title">📐 技术方案管理</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>setNewOpen(true)}>＋ 新建方案</button>
        <button type="button" className="btn btn-sm" style={{background:'#4f46e5',color:'#fff'}} onClick={()=>setImportOpen(true)}>导入文档</button>
        <RefreshBtn onClick={reloadList} />
      </div>
    </div>
    <p style={{fontSize:12,color:'#64748b',marginBottom:12,maxWidth:900}}>
      多文档版本化管理，Markdown 存于项目 <code style={{color:'#93c5fd'}}>.ai-memory/tech_design/</code>。
      保存即新版本；AI 完善需 <code style={{color:'#93c5fd'}}>ANTHROPIC_API_KEY</code>。开发时可将方案路径提供给 Agent 作为单一事实来源。
    </p>
    <div style={{display:'flex',gap:12,minHeight:420,flexWrap:'wrap'}}>
      <div className="card scroll-slim" style={{width:280,flexShrink:0,maxHeight:560,overflowY:'auto'}}>
        <div className="section-title" style={{fontSize:12}}>文档 ({items.length})</div>
        {items.length===0?<div className="empty">暂无，请新建或导入</div>:
          items.map(d=><div key={d.id} className="list-item" style={{cursor:'pointer',background:sel===d.id?'#1e3a5f':'',flexDirection:'column',alignItems:'stretch'}}
            onClick={()=>loadDoc(d.id)}>
            <div className="title" style={{fontSize:13}}>{d.title||d.id}</div>
            <div className="meta">{d.category} · v{d.current_version||1}</div>
            <div className="meta" style={{fontSize:10}}>{d.id}</div>
          </div>)}
      </div>
      <div className="card" style={{flex:1,minWidth:280,minHeight:400}}>
        {!sel?<div className="empty">← 选择或新建文档</div>:
        loadingDoc?<PageSkeleton cards={1}/>:
        <>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10,flexWrap:'wrap',gap:8}}>
            <div>
              <div className="section-title" style={{margin:0}}>{meta?.title||sel}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{sel} · {meta?.category} · 当前 v{meta?.current_version}</div>
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={saveVersion}>{saving?'保存中...':'保存为新版本'}</button>
              <button type="button" className="btn btn-sm" style={{background:'#7c3aed',color:'#fff'}} disabled={saving} onClick={()=>setAiOpen(true)}>AI 完善</button>
              <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={delDoc}>删除</button>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{fontSize:11,color:'#94a3b8'}}>版本:</span>
            {(versions||[]).slice().reverse().slice(0,12).map(v=>
              <button key={v.v} type="button" className="btn btn-sm" style={{background:v.v===meta?.current_version?'#1e3a5f':'#334155',color:'#e2e8f0',padding:'2px 8px'}}
                onClick={()=>viewVersion(v.v)} title={v.note}>v{v.v}</button>)}
          </div>
          <textarea value={content} onChange={e=>setContent(e.target.value)} title="⌘/Ctrl+S 保存为新版本（须已选中文档）"
            style={{width:'100%',minHeight:320,fontFamily:'ui-monospace,monospace',fontSize:12,lineHeight:1.5,background:'var(--bg3)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,padding:10}} spellCheck={false}/>
        </>}
      </div>
    </div>

    {newOpen&&<div className="modal-bg" onClick={()=>setNewOpen(false)}>
      <div className="modal" style={{width:480}} onClick={e=>e.stopPropagation()}>
        <h3>新建技术方案</h3>
        <div className="form-group"><label>标题</label><input value={newForm.title} onChange={e=>setNewForm({...newForm,title:e.target.value})}/></div>
        <div className="form-group"><label>分类</label><input value={newForm.category} onChange={e=>setNewForm({...newForm,category:e.target.value})} placeholder="architecture"/></div>
        <div className="form-group"><label>标签（逗号分隔）</label><input value={newForm.tags} onChange={e=>setNewForm({...newForm,tags:e.target.value})}/></div>
        <div className="form-group"><label>首版说明</label><input value={newForm.note} onChange={e=>setNewForm({...newForm,note:e.target.value})}/></div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setNewOpen(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={createDoc}>创建</button>
        </div>
      </div>
    </div>}

    {importOpen&&<div className="modal-bg" onClick={()=>setImportOpen(false)}>
      <div className="modal" style={{width:560,maxWidth:'96vw'}} onClick={e=>e.stopPropagation()}>
        <h3>导入设计文档</h3>
        <div className="form-group"><label>标题</label><input value={impForm.title} onChange={e=>setImpForm({...impForm,title:e.target.value})}/></div>
        <div className="form-group"><label>分类</label><input value={impForm.category} onChange={e=>setImpForm({...impForm,category:e.target.value})}/></div>
        <div className="form-group"><label>标签</label><input value={impForm.tags} onChange={e=>setImpForm({...impForm,tags:e.target.value})}/></div>
        <div className="form-group"><label>Markdown 正文</label>
          <textarea value={impForm.content} onChange={e=>setImpForm({...impForm,content:e.target.value})} style={{minHeight:180,fontSize:12}} placeholder="粘贴全文..."/></div>
        <div className="form-group"><label>文件</label>
          <input type="file" accept=".md,.txt,text/markdown,text/plain" onChange={e=>{
            const f=e.target.files&&e.target.files[0]; if(!f)return;
            const rd=new FileReader(); rd.onload=()=>setImpForm(p=>({...p,content:String(rd.result||'')}));
            rd.readAsText(f);
          }}/></div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setImportOpen(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={importDoc}>导入</button>
        </div>
      </div>
    </div>}

    {aiOpen&&<div className="modal-bg" onClick={()=>!saving&&setAiOpen(false)}>
      <div className="modal" style={{width:520}} onClick={e=>e.stopPropagation()}>
        <h3>AI 完善设计文档</h3>
        <p style={{fontSize:11,color:'#64748b'}}>将基于当前正文生成**新版本**，不覆盖历史。</p>
        <div className="form-group"><label>模式</label>
          <select value={aiForm.mode} onChange={e=>setAiForm({...aiForm,mode:e.target.value})}>
            <option value="expand">扩展细节</option>
            <option value="review">架构评审修订</option>
            <option value="diagram">补充 Mermaid 图</option>
            <option value="free">自由指令</option>
          </select></div>
        <div className="form-group"><label>指令 / 补充上下文</label>
          <textarea value={aiForm.instruction} onChange={e=>setAiForm({...aiForm,instruction:e.target.value})} style={{minHeight:100}} placeholder="例如：补充与订单服务集成的时序图与幂等策略"/></div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setAiOpen(false)} disabled={saving}>取消</button>
          <button type="button" className="btn btn-primary" onClick={runAi} disabled={saving||!aiForm.instruction.trim()}>{saving?'生成中...':'生成新版本'}</button>
        </div>
      </div>
    </div>}

    {verPreview&&<div className="modal-bg" onClick={()=>setVerPreview(null)}>
      <div className="modal" style={{width:640,maxWidth:'96vw',maxHeight:'88vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}>
        <h3>版本 v{verPreview.v} 预览</h3>
        <pre style={{fontSize:11,whiteSpace:'pre-wrap',wordBreak:'break-word',background:'var(--bg3)',padding:10,borderRadius:8,maxHeight:'60vh',overflow:'auto'}}>{verPreview.content}</pre>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setVerPreview(null)}>关闭</button>
          <button type="button" className="btn btn-primary" onClick={()=>{setContent(verPreview.content);setVerPreview(null);showToast('已载入编辑器，请保存为新版本','ok');}}>载入到编辑器</button>
          <button type="button" className="btn btn-sm" style={{background:'#334155',color:'#e2e8f0'}} onClick={()=>restoreVer(verPreview.v)}>恢复为新版本</button>
        </div>
      </div>
    </div>}
    </div>
  );
}

window.DesignDocsManager = DesignDocsManager;
