function VibeCoding() {
  const [tab,setTab] = React.useState('chat');
  return <div>
    <div style={{display:'flex',gap:4,marginBottom:16}}>
      {[['chat','💬 Vibe Chat'],['templates','📝 模板'],['history','📜 历史']].map(([id,l])=>
        <button key={id} type="button" className={`btn btn-sm ${tab===id?'btn-primary':''}`} style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{l}</button>)}
    </div>
    {tab==='chat'&&<VibeChatPanel/>}
    {tab==='templates'&&<VibeTemplatesPanel/>}
    {tab==='history'&&<VibeHistoryPanel/>}
  </div>;
}

function VibeChatPanel() {
  const {data:tools,loading:lt,error:et,reload:rt} = useFetch(`${API}/orchestration/tools`);
  const {data:models,loading:lm,error:em,reload:rm} = useFetch(`${API}/models`);
  const [form,setForm] = React.useState({prompt:'',tool:'claude',model:'',mode:'chat',context_files:[]});
  const [running,setRunning] = React.useState(false);
  const [output,setOutput] = React.useState(null);
  const [history,setHistory] = React.useState([]);

  const panelLoading = lt || lm;
  const panelError = et || em;
  const reloadDeps = () => { rt(); rm(); };

  const availableTools = (tools||[]).filter(t=>t.available);
  const allModels = [...(models?.builtin||[]),...(models?.custom||[])];

  const run = () => {
    if(!form.prompt.trim()) return;
    setRunning(true);setOutput(null);
    const endpoint = form.tool==='direct-llm' ? `${API}/vibe/llm` : `${API}/vibe/run`;
    const body = form.tool==='direct-llm'
      ? {prompt:form.prompt, model:form.model||models?.default||'claude-opus-4-7'}
      : form;
    fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(r=>r.json().then(d=>({ok:r.ok,d})))
      .then(({ok,d})=>{
        setOutput(d);setRunning(false);
        if(!ok||d.ok===false){showToast(d.detail||d.error||'执行失败','err');}
        else showToast('执行完成','ok');
        setHistory(h=>[{prompt:form.prompt.slice(0,100),tool:form.tool,ok:!!d.ok,ts:new Date().toLocaleTimeString()},...h.slice(0,19)]);
      })
      .catch(()=>{setRunning(false);showToast('网络或服务器错误','err');});
  };

  if (panelLoading) return <div><div className="section-title">🎯 Vibe Coding</div><PageSkeleton cards={2}/></div>;
  if (panelError) return <div><div className="section-title">🎯 Vibe Coding</div><LoadError message={panelError} onRetry={reloadDeps}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:8}}>
      <div className="section-title">🎯 Vibe Coding — 界面化 AI 开发</div>
      <RefreshBtn onClick={reloadDeps} />
    </div>
    <div className="card" style={{marginBottom:12}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
        <div className="form-group" style={{margin:0}}>
          <label>开发工具</label>
          <select value={form.tool} onChange={e=>setForm({...form,tool:e.target.value})}>
            <option value="direct-llm">🤖 直接调用 LLM</option>
            {availableTools.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{margin:0}}>
          <label>模型</label>
          <select value={form.model} onChange={e=>setForm({...form,model:e.target.value})}>
            <option value="">默认 ({models?.default||'-'})</option>
            {allModels.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{margin:0}}>
          <label>模式</label>
          <select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}>
            {[['chat','💬 对话'],['code','💻 编码'],['review','🔍 审查'],['plan','📋 规划']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group" style={{margin:0}}>
        <label>提示词</label>
        <textarea value={form.prompt} onChange={e=>setForm({...form,prompt:e.target.value})}
          style={{minHeight:120,fontFamily:'monospace',fontSize:13}}
          placeholder="描述你想要实现的功能、需要审查的代码、或者任何开发任务...&#10;&#10;例如：实现一个用户注册 API，包含邮箱验证，使用 Spring Boot + MySQL"/>
      </div>
      <button type="button" className="btn btn-primary" onClick={run} disabled={running||!form.prompt.trim()}
        style={{width:'100%',marginTop:8,padding:'10px',fontSize:14}}>
        {running?'⏳ 执行中...':'▶ 执行'}
      </button>
    </div>

    {output&&<div className="card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div className="section-title" style={{color:output.ok?'#86efac':'#fca5a5',margin:0}}>
          {output.ok?'✅ 执行成功':'❌ 执行失败'}
          {output.usage&&<span style={{fontSize:11,color:'#64748b',marginLeft:8}}>tokens: {output.usage.input}↑ {output.usage.output}↓</span>}
        </div>
        <button type="button" className="btn btn-sm" style={{background:'#334155',color:'#94a3b8'}} onClick={()=>{
          const t = output.output||output.content||output.error||'';
          navigator.clipboard.writeText(t).then(()=>showToast('已复制','ok')).catch(()=>showToast('复制失败','err'));
        }}>复制</button>
      </div>
      <pre className="scroll-slim" style={{fontSize:12,color:'#e2e8f0',whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:500,overflowY:'auto',lineHeight:1.6}}>
        {output.content||output.output||output.error}
      </pre>
    </div>}

    {history.length>0&&<div style={{marginTop:12}}>
      <div style={{fontSize:11,color:'#64748b',marginBottom:6}}>本次会话历史</div>
      {history.map((h,i)=><div key={i} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 0',borderBottom:'1px solid #1e293b',fontSize:11}}>
        <span style={{color:'#64748b'}}>{h.ts}</span>
        <span className={`tag ${h.ok?'tag-done':'tag-p0'}`} style={{padding:'1px 4px'}}>{h.tool}</span>
        <span style={{color:'#94a3b8',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.prompt}</span>
      </div>)}
    </div>}
  </div>;
}

function VibeTemplatesPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/vibe/templates`);
  const [selected,setSelected] = React.useState(null);
  const [filled,setFilled] = React.useState('');

  const fill = (tpl) => {
    setSelected(tpl);
    setFilled(tpl.template);
  };

  if (loading) return <div><div className="section-title">提示词模板库</div><PageSkeleton cards={2}/></div>;
  if (error) return <div><div className="section-title">提示词模板库</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">提示词模板库</div>
      <RefreshBtn onClick={reload} />
    </div>
    <div className="grid-2">
      <div className="card scroll-slim" style={{maxHeight:420,overflowY:'auto'}}>
        {(data||[]).length===0?<div className="empty">暂无模板</div>:
          (data||[]).map(t=><div key={t.id} className="list-item" style={{cursor:'pointer',background:selected?.id===t.id?'#1e3a5f':''}} onClick={()=>fill(t)}>
          <div style={{flex:1}}><div className="title">{t.name}</div></div>
        </div>)}
      </div>
      <div className="card">
        {!selected?<div className="empty">← 选择模板</div>:<>
          <div style={{fontSize:12,color:'#64748b',marginBottom:8}}>{selected.name}</div>
          <textarea value={filled} onChange={e=>setFilled(e.target.value)}
            style={{width:'100%',minHeight:200,background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0',padding:8,borderRadius:6,fontSize:12,fontFamily:'monospace',resize:'vertical'}}/>
          <button type="button" className="btn btn-primary" style={{width:'100%',marginTop:8}} onClick={()=>{
            navigator.clipboard.writeText(filled).then(()=>showToast('已复制到剪贴板','ok')).catch(()=>showToast('复制失败','err'));
          }}>📋 复制</button>
        </>}
      </div>
    </div>
  </div>;
}

function VibeHistoryPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/vibe/history`);
  const clear = () => {
    if(!confirm('清空历史？')) return;
    fetch(`${API}/vibe/history`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('历史已清空','ok');})
      .catch(()=>showToast('清空失败','err'));
  };
  if (loading) return <div><div className="section-title">执行历史</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">执行历史</div><LoadError message={error} onRetry={reload}/></div>;
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">执行历史</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={clear}>清空</button>
      </div>
    </div>
    <div className="card scroll-slim" style={{maxHeight:560,overflowY:'auto'}}>
      {(data||[]).length===0?<div className="empty">暂无历史记录</div>:
        [...(data||[])].reverse().map((h,i)=><div key={i} className="list-item" style={{flexDirection:'column',gap:4}}>
          <div style={{display:'flex',gap:8,alignItems:'center',width:'100%'}}>
            <span style={{fontSize:11,color:'#64748b'}}>{h.ts?.slice(0,16)}</span>
            <span className={`tag ${h.ok?'tag-done':'tag-p0'}`}>{h.tool}</span>
            <span style={{flex:1,fontSize:12,color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.prompt}</span>
          </div>
          {h.output&&<div style={{fontSize:11,color:'#64748b',background:'#0f172a',padding:'4px 8px',borderRadius:4,maxHeight:60,overflow:'hidden'}}>{h.output}</div>}
        </div>)}
    </div>
  </div>;
}
