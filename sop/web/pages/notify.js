function NotifyManager() {
  const {data,loading,error,reload} = useFetch(`${API}/notify/channels`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({type:'dingtalk',name:'',webhook_url:'',enabled:true,events:['task_blocked','issue_p0','sprint_complete']});
  const [testing,setTesting] = React.useState({});

  const save = () => {
    fetch(`${API}/notify/channels`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast('渠道已保存','ok');})
      .catch(()=>showToast('保存失败','err'));
  };
  const del = (name) => {
    if(!confirm(`删除渠道 ${name}？`)) return;
    fetch(`${API}/notify/channels/${name}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };
  const test = (name) => {
    setTesting(p=>({...p,[name]:true}));
    fetch(`${API}/notify/test/${name}`,{method:'POST'})
      .then(r=>r.json())
      .then(d=>{
        setTesting(p=>({...p,[name]:false}));
        if(d.ok) showToast('测试消息已发送','ok');
        else showToast('发送失败: '+(d.error||d.detail||'未知'),'err');
      })
      .catch(()=>{setTesting(p=>({...p,[name]:false}));showToast('测试请求失败','err');});
  };

  const EVENTS = ['task_blocked','issue_p0','sprint_complete','deploy','build_fail','review_needed'];
  const TYPES = [['dingtalk','钉钉'],['wechat_work','企业微信'],['slack','Slack'],['webhook','自定义 Webhook']];

  if (loading) return <div><div className="section-title">📣 消息通知配置</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">📣 消息通知配置</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div className="section-title">📣 消息通知配置</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({type:'dingtalk',name:'',webhook_url:'',enabled:true,events:['task_blocked','issue_p0']});}}>+ 添加渠道</button>
      </div>
    </div>
    <div className="card" style={{marginBottom:12}}>
      {(data||[]).length===0?<div className="empty">暂无通知渠道，添加钉钉/企业微信/Slack Webhook 接收开发进度通知</div>:
        (data||[]).map(ch=><div key={ch.name} className="list-item">
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="title">{ch.name}</span>
              <span className="tag tag-p2">{ch.type}</span>
              <span className={`tag ${ch.enabled?'tag-done':'tag-p3'}`}>{ch.enabled?'启用':'禁用'}</span>
            </div>
            <div className="meta">事件: {ch.events?.join(', ')}</div>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>test(ch.name)} disabled={testing[ch.name]}>{testing[ch.name]?'发送中...':'测试'}</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(ch.name)}>删除</button>
          </div>
        </div>)}
    </div>
    <div className="card">
      <div className="section-title">手动广播</div>
      <BroadcastPanel/>
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" style={{width:480}} onClick={e=>e.stopPropagation()}>
        <h3>添加通知渠道</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>渠道名称</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="my-dingtalk"/></div>
          <div className="form-group"><label>类型</label>
            <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
              {TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group"><label>Webhook URL</label><input value={form.webhook_url} onChange={e=>setForm({...form,webhook_url:e.target.value})} placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."/></div>
        <div className="form-group"><label>触发事件</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {EVENTS.map(ev=><label key={ev} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#94a3b8',cursor:'pointer'}}>
              <input type="checkbox" checked={form.events.includes(ev)} onChange={e=>{const s=new Set(form.events);e.target.checked?s.add(ev):s.delete(ev);setForm({...form,events:[...s]});}}/>
              {ev}
            </label>)}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}

function BroadcastPanel() {
  const [form,setForm] = React.useState({title:'',content:'',level:'info',event:''});
  const [result,setResult] = React.useState(null);
  const send = () => {
    const p = new URLSearchParams({title:form.title,content:form.content,level:form.level,event:form.event});
    fetch(`${API}/notify/broadcast?${p}`,{method:'POST'})
      .then(r=>r.json())
      .then(d=>{
        setResult(d);
        if(d&&(d.ok===false||d.success===false)) showToast(d.detail||d.error||'广播失败','err');
        else showToast('广播已提交','ok');
      })
      .catch(()=>showToast('广播请求失败','err'));
  };
  return <div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
      <div className="form-group"><label>标题</label><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="开发进度更新"/></div>
      <div className="form-group"><label>级别</label>
        <select value={form.level} onChange={e=>setForm({...form,level:e.target.value})}>
          {['info','warn','error','success'].map(l=><option key={l}>{l}</option>)}
        </select>
      </div>
    </div>
    <div className="form-group"><label>内容</label><textarea value={form.content} onChange={e=>setForm({...form,content:e.target.value})} style={{minHeight:60}} placeholder="消息内容..."/></div>
    <button type="button" className="btn btn-primary" onClick={send} style={{width:'100%'}}>📣 广播到所有渠道</button>
    {result&&<div style={{marginTop:8,fontSize:12,color:'#94a3b8'}}>{JSON.stringify(result,null,2)}</div>}
  </div>;
}
