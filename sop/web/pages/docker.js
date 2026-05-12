function DockerEnvManager() {
  const [tab,setTab] = React.useState('check');
  return <div>
    <div style={{display:'flex',gap:4,marginBottom:16}}>
      {[['check','🔍 环境检查'],['containers','📦 容器'],['presets','⚡ 快速启动'],['build','🔨 构建镜像']].map(([id,l])=>
        <button key={id} className={`btn btn-sm ${tab===id?'btn-primary':''}`} style={tab!==id?{background:'#334155',color:'#94a3b8'}:{}} onClick={()=>setTab(id)}>{l}</button>)}
    </div>
    {tab==='check'&&<EnvCheckPanel/>}
    {tab==='containers'&&<ContainersPanel/>}
    {tab==='presets'&&<PresetsPanel/>}
    {tab==='build'&&<BuildPanel/>}
  </div>;
}

function EnvCheckPanel() {
  const [data,setData] = React.useState(null);
  const [loading,setLoading] = React.useState(false);
  const run = () => {
    setLoading(true);
    fetch(`${API}/env/check`)
      .then(r=>r.json())
      .then(d=>{setData(d);setLoading(false);})
      .catch(()=>{setLoading(false);showToast('环境检查失败','err');});
  };
  React.useEffect(()=>{run();},[]);
  const groups = data ? {
    '开发工具': ['claude','opencode','git'],
    'Python 包': Object.keys(data).filter(k=>k.startsWith('py:')),
    '运行时': ['python3','java','mvn','node','npm'],
    'Docker': ['docker','docker-compose'],
  } : {};
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">环境检查</div>
      <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={loading}>{loading?'检查中...':'↻ 重新检查'}</button>
    </div>
    {data&&Object.entries(groups).map(([g,keys])=><div key={g} className="card" style={{marginBottom:10}}>
      <div className="section-title">{g}</div>
      {keys.filter(k=>data[k]).map(k=><div key={k} className="list-item">
        <div style={{flex:1}}><div className="title">{k.replace('py:','')}</div><div className="meta">{data[k].version||'-'}</div></div>
        <span className={`tag ${data[k].available?'tag-done':'tag-p0'}`}>{data[k].available?'✅ 可用':'❌ 缺失'}</span>
      </div>)}
    </div>)}
  </div>;
}

function ContainersPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/env/docker/ps`);
  const stop = (name) => {
    fetch(`${API}/env/docker/stop/${name}`,{method:'POST'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已停止','ok');})
      .catch(()=>showToast('停止失败','err'));
  };
  const remove = (name) => {
    if(!confirm(`删除容器 ${name}？`)) return;
    fetch(`${API}/env/docker/remove/${name}`,{method:'POST'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };
  if (loading) return <div><div className="section-title">运行中的容器</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">运行中的容器</div><LoadError message={error} onRetry={reload}/></div>;
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">运行中的容器</div>
      <RefreshBtn onClick={reload} />
    </div>
    <div className="card">
      {(data?.containers||[]).length===0?<div className="empty">无运行中的容器</div>:
        (data?.containers||[]).map(c=><div key={c.ID||c.Names} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{c.Names||c.Name}</div>
            <div className="meta">{c.Image} · {c.Status||c.State} · {c.Ports}</div>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm btn-warn" onClick={()=>stop(c.Names||c.Name)}>停止</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>remove(c.Names||c.Name)}>删除</button>
          </div>
        </div>)}
    </div>
  </div>;
}

function PresetsPanel() {
  const {data,loading,error,reload} = useFetch(`${API}/env/docker/presets`);
  const [starting,setStarting] = React.useState({});
  const [results,setResults] = React.useState({});
  const start = (name) => {
    setStarting(p=>({...p,[name]:true}));
    fetch(`${API}/env/docker/presets/${name}/start`,{method:'POST'}).then(r=>r.json()).then(d=>{
      setStarting(p=>({...p,[name]:false}));
      setResults(p=>({...p,[name]:d}));
      if(d.ok) showToast(`${name} 启动成功`,'ok');
      else showToast('启动失败','err');
    }).catch(()=>{setStarting(p=>({...p,[name]:false}));showToast('请求失败','err');});
  };
  const ICONS = {mysql:'🐬',redis:'🔴',postgres:'🐘',mongo:'🍃',rabbitmq:'🐰',minio:'📦'};
  if (loading) return <div><div className="section-title">快速启动</div><PageSkeleton cards={2}/></div>;
  if (error) return <div><div className="section-title">快速启动</div><LoadError message={error} onRetry={reload}/></div>;
  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <div className="section-title">快速启动开发组件</div>
      <RefreshBtn onClick={reload} />
    </div>
    <div className="grid-2">
      {Object.entries(data||{}).map(([name,cfg])=><div key={name} className="card">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <span style={{fontSize:16}}>{ICONS[name]||'📦'} <strong style={{color:'#f1f5f9'}}>{name}</strong></span>
          <button type="button" className="btn btn-sm btn-primary" onClick={()=>start(name)} disabled={starting[name]}>{starting[name]?'启动中...':'▶ 启动'}</button>
        </div>
        <div className="meta">{cfg.image}</div>
        <div className="meta">端口: {cfg.ports?.join(', ')}</div>
        {results[name]&&<div style={{marginTop:6,fontSize:11,color:results[name].ok?'#86efac':'#fca5a5',background:'#0f172a',padding:'4px 8px',borderRadius:4}}>
          {results[name].ok?'✅ 启动成功':'❌ '+results[name].stderr?.slice(0,100)}
        </div>}
      </div>)}
    </div>
  </div>;
}

function BuildPanel() {
  const [form,setForm] = React.useState({tag:'my-app:latest',dockerfile:'Dockerfile',context:'.'});
  const [building,setBuilding] = React.useState(false);
  const [result,setResult] = React.useState(null);
  const build = () => {
    setBuilding(true);setResult(null);
    fetch(`${API}/env/docker/build?tag=${form.tag}&dockerfile=${form.dockerfile}&context=${form.context}`,{method:'POST'})
      .then(r=>r.json())
      .then(d=>{setBuilding(false);setResult(d);if(d.ok)showToast('构建完成','ok');else showToast('构建失败','err');})
      .catch(()=>{setBuilding(false);showToast('请求失败','err');});
  };
  return <div>
    <div className="section-title" style={{marginBottom:12}}>构建 Docker 镜像</div>
    <div className="card">
      <div className="form-group"><label>镜像标签</label><input value={form.tag} onChange={e=>setForm({...form,tag:e.target.value})} placeholder="my-app:latest"/></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <div className="form-group"><label>Dockerfile 路径</label><input value={form.dockerfile} onChange={e=>setForm({...form,dockerfile:e.target.value})}/></div>
        <div className="form-group"><label>构建上下文</label><input value={form.context} onChange={e=>setForm({...form,context:e.target.value})}/></div>
      </div>
      <button type="button" className="btn btn-primary" onClick={build} disabled={building} style={{width:'100%'}}>{building?'构建中（可能需要几分钟）...':'🔨 开始构建'}</button>
    </div>
    {result&&<div className="card" style={{marginTop:10}}>
      <div className="section-title" style={{color:result.ok?'#86efac':'#fca5a5'}}>{result.ok?'✅ 构建成功':'❌ 构建失败'}</div>
      <pre style={{fontSize:11,color:'#94a3b8',whiteSpace:'pre-wrap',maxHeight:300,overflowY:'auto'}}>{result.stdout||result.stderr}</pre>
    </div>}
  </div>;
}
