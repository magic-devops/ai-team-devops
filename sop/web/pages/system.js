function SystemManager() {
  const [tab,setTab] = React.useState('scripts');
  const tabs = [['scripts','📜 脚本'],['config','⚙️ 配置'],['memory','🧠 记忆']];
  return <div>
    <div style={{display:'flex',gap:4,marginBottom:16}}>
      {tabs.map(([id,label])=><button key={id} className={`btn btn-sm ${tab===id?'btn-primary':''}`}
        style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{label}</button>)}
    </div>
    {tab==='scripts'&&<ScriptManager/>}
    {tab==='config'&&<ConfigManager/>}
    {tab==='memory'&&<MemoryManager/>}
  </div>;
}

function ScriptManager() {
  const {data,loading,error,reload} = useFetch(`${API}/system/scripts`);
  const [selected,setSelected] = React.useState(null);
  const [content,setContent] = React.useState('');
  const [editing,setEditing] = React.useState(false);
  const [running,setRunning] = React.useState(false);
  const [output,setOutput] = React.useState(null);

  const open = (f) => {
    setSelected(f);setEditing(false);setOutput(null);
    fetch(`${API}/system/scripts/${f.name}/content`)
      .then(r=>r.json())
      .then(d=>setContent(d.content||''))
      .catch(()=>showToast('读取脚本失败','err'));
  };
  const save = () => {
    fetch(`${API}/system/scripts/${selected.name}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setEditing(false);showToast('保存成功','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const run = () => {
    if(!confirm(`运行 ${selected.name}？`)) return;
    setRunning(true);setOutput(null);
    fetch(`${API}/system/scripts/${selected.name}/run`,{method:'POST'})
      .then(r=>r.json())
      .then(d=>{setOutput(d);setRunning(false);if(d&&d.returncode!==0)showToast('脚本退出码非 0','err');})
      .catch(()=>{setRunning(false);showToast('运行请求失败','err');});
  };

  if (loading) return <div><PageSkeleton cards={2}/></div>;
  if (error) return <LoadError message={error} onRetry={reload}/>;

  return <div className="grid-2">
    <div className="card scroll-slim" style={{maxHeight:560,overflowY:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div className="section-title" style={{margin:0}}>脚本列表</div>
        <RefreshBtn onClick={reload} />
      </div>
      {(data||[]).map(f=><div key={f.name} className="list-item" style={{cursor:'pointer',background:selected?.name===f.name?'#1e3a5f':'',padding:'6px 8px',borderRadius:4}} onClick={()=>open(f)}>
        <div style={{flex:1}}><div className="title" style={{fontSize:12}}>{f.name}</div><div className="meta">{(f.size/1024).toFixed(1)}KB {f.executable&&'· 可执行'}</div></div>
      </div>)}
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {selected&&<div className="card" style={{flex:1}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <span style={{fontSize:12,color:'#64748b'}}>{selected.name}</span>
          <div style={{display:'flex',gap:4}}>
            {selected.name.endsWith('.sh')&&<button type="button" className="btn btn-sm" style={{background:'#14532d',color:'#86efac'}} onClick={run} disabled={running}>{running?'运行中...':'▶ 运行'}</button>}
            {!editing&&<button type="button" className="btn btn-sm btn-primary" onClick={()=>setEditing(true)}>编辑</button>}
            {editing&&<><button type="button" className="btn btn-sm btn-cancel" onClick={()=>setEditing(false)}>取消</button><button type="button" className="btn btn-sm btn-primary" onClick={save}>保存</button></>}
          </div>
        </div>
        {editing?<textarea value={content} onChange={e=>setContent(e.target.value)} style={{width:'100%',minHeight:300,background:'#0f172a',border:'1px solid #334155',color:'#e2e8f0',padding:8,borderRadius:6,fontSize:12,fontFamily:'monospace',resize:'vertical'}}/>:
          <pre style={{fontSize:11,color:'#e2e8f0',whiteSpace:'pre-wrap',maxHeight:300,overflowY:'auto'}}>{content}</pre>}
      </div>}
      {output&&<div className="card">
        <div className="section-title" style={{color:output.returncode===0?'#86efac':'#fca5a5'}}>
          {output.returncode===0?'✅ 执行成功':'❌ 执行失败'} (exit {output.returncode})
        </div>
        {output.stdout&&<pre style={{fontSize:11,color:'#e2e8f0',whiteSpace:'pre-wrap',maxHeight:150,overflowY:'auto'}}>{output.stdout}</pre>}
        {output.stderr&&<pre style={{fontSize:11,color:'#fca5a5',whiteSpace:'pre-wrap'}}>{output.stderr}</pre>}
      </div>}
    </div>
  </div>;
}

function ConfigManager() {
  const {data,loading,error,reload} = useFetch(`${API}/system/config`);
  if(loading) return <PageSkeleton cards={2}/>;
  if(error) return <LoadError message={error} onRetry={reload}/>;
  return <div className="grid-2">
    <div className="card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div className="section-title" style={{margin:0}}>Claude Code 配置</div>
        <RefreshBtn onClick={reload} />
      </div>
      <pre className="scroll-slim" style={{fontSize:11,color:'#e2e8f0',whiteSpace:'pre-wrap',maxHeight:400,overflowY:'auto'}}>{JSON.stringify(data?.claude_settings||{},null,2)}</pre>
    </div>
    <div className="card">
      <div className="section-title">opencode 配置</div>
      <pre className="scroll-slim" style={{fontSize:11,color:'#e2e8f0',whiteSpace:'pre-wrap',maxHeight:400,overflowY:'auto'}}>{JSON.stringify(data?.opencode||{},null,2)}</pre>
    </div>
  </div>;
}

function MemoryManager() {
  const {data,loading,error,reload} = useFetch(`${API}/system/memory`);
  const [tableStats,setTableStats] = React.useState({});

  const loadStats = (tbl) => {
    fetch(`${API}/system/memory/lancedb/${tbl}/stats`)
      .then(r=>r.json())
      .then(d=>setTableStats(p=>({...p,[tbl]:d})))
      .catch(()=>showToast('统计加载失败','err'));
  };

  if(loading) return <PageSkeleton cards={2}/>;
  if(error) return <LoadError message={error} onRetry={reload}/>;
  return <div>
    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}><RefreshBtn onClick={reload} /></div>
    <div className="grid-2" style={{marginBottom:12}}>
      <div className="card">
        <div className="section-title">规则文件 ({(data?.rules||[]).length})</div>
        {(data?.rules||[]).map(f=><div key={f} className="list-item"><div className="title" style={{fontSize:12}}>{f}</div></div>)}
      </div>
      <div className="card">
        <div className="section-title">快照 ({(data?.snapshots||[]).length})</div>
        {(data?.snapshots||[]).map(f=><div key={f} className="list-item">
          <div className="title" style={{fontSize:12,flex:1}}>{f}</div>
          <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5',padding:'2px 6px'}}
            onClick={()=>fetch(`${API}/system/memory/snapshots/${f}`,{method:'DELETE'})
              .then((r)=>{if(!r.ok)throw new Error();})
              .then(()=>{reload();showToast('快照已删除','ok');})
              .catch(()=>showToast('删除失败','err'))}>×</button>
        </div>)}
      </div>
    </div>
    <div className="card">
      <div className="section-title">LanceDB 表</div>
      {(data?.lancedb_tables||[]).map(tbl=><div key={tbl} className="list-item">
        <div style={{flex:1}}>
          <div className="title" style={{fontSize:12}}>{tbl}</div>
          {tableStats[tbl]&&<div className="meta">{tableStats[tbl].rows} 行 · {tableStats[tbl].columns?.length} 列</div>}
        </div>
        <button type="button" className="btn btn-sm" style={{background:'#334155',color:'#94a3b8'}} onClick={()=>loadStats(tbl)}>查看统计</button>
      </div>)}
    </div>
  </div>;
}
