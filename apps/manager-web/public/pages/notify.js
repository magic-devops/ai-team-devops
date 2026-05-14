window.i18nExtend && window.i18nExtend({
  zh: {
    notify_title: '📣 消息通知配置',
    notify_add_ch: '+ 添加渠道',
    notify_empty: '暂无通知渠道，添加钉钉/企业微信/Slack Webhook 接收开发进度通知',
    notify_broadcast: '手动广播',
    notify_modal_add: '添加通知渠道',
    notify_label_ch_name: '渠道名称',
    notify_label_type: '类型',
    notify_label_url: 'Webhook URL',
    notify_label_events: '触发事件',
    notify_cancel: '取消',
    notify_save: '保存',
    notify_sending: '发送中...',
    notify_test: '测试',
    notify_del: '删除',
    notify_enabled: '启用',
    notify_disabled: '禁用',
    notify_events_prefix: '事件: ',
    notify_toast_saved: '渠道已保存',
    notify_toast_save_fail: '保存失败',
    notify_confirm_del: '删除渠道 {name}？',
    notify_toast_deleted: '已删除',
    notify_toast_del_fail: '删除失败',
    notify_toast_test_ok: '测试消息已发送',
    notify_toast_send_fail: '发送失败: {detail}',
    notify_unknown: '未知',
    notify_toast_test_req_fail: '测试请求失败',
    notify_bc_title: '标题',
    notify_bc_level: '级别',
    notify_bc_content: '内容',
    notify_bc_ph_title: '开发进度更新',
    notify_bc_ph_content: '消息内容...',
    notify_bc_btn: '📣 广播到所有渠道',
    notify_toast_bc_fail: '广播失败',
    notify_toast_bc_ok: '广播已提交',
    notify_toast_bc_req_fail: '广播请求失败',
    notify_type_dingtalk: '钉钉',
    notify_type_wechat: '企业微信',
    notify_type_slack: 'Slack',
    notify_type_webhook: '自定义 Webhook',
  },
  en: {
    notify_title: '📣 Notifications',
    notify_add_ch: '+ Add channel',
    notify_empty: 'No channels — add DingTalk, WeCom, Slack, or custom webhook',
    notify_broadcast: 'Manual broadcast',
    notify_modal_add: 'Add notification channel',
    notify_label_ch_name: 'Channel name',
    notify_label_type: 'Type',
    notify_label_url: 'Webhook URL',
    notify_label_events: 'Events',
    notify_cancel: 'Cancel',
    notify_save: 'Save',
    notify_sending: 'Sending...',
    notify_test: 'Test',
    notify_del: 'Delete',
    notify_enabled: 'On',
    notify_disabled: 'Off',
    notify_events_prefix: 'Events: ',
    notify_toast_saved: 'Channel saved',
    notify_toast_save_fail: 'Save failed',
    notify_confirm_del: 'Delete channel {name}?',
    notify_toast_deleted: 'Deleted',
    notify_toast_del_fail: 'Delete failed',
    notify_toast_test_ok: 'Test message sent',
    notify_toast_send_fail: 'Send failed: {detail}',
    notify_unknown: 'unknown',
    notify_toast_test_req_fail: 'Test request failed',
    notify_bc_title: 'Title',
    notify_bc_level: 'Level',
    notify_bc_content: 'Body',
    notify_bc_ph_title: 'Progress update',
    notify_bc_ph_content: 'Message body...',
    notify_bc_btn: '📣 Broadcast to all channels',
    notify_toast_bc_fail: 'Broadcast failed',
    notify_toast_bc_ok: 'Broadcast submitted',
    notify_toast_bc_req_fail: 'Broadcast request failed',
    notify_type_dingtalk: 'DingTalk',
    notify_type_wechat: 'WeCom',
    notify_type_slack: 'Slack',
    notify_type_webhook: 'Custom webhook',
  },
});

function NotifyManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const {data,loading,error,reload} = useFetch(`${API}/notify/channels`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({type:'dingtalk',name:'',webhook_url:'',enabled:true,events:['task_blocked','issue_p0','sprint_complete']});
  const [testing,setTesting] = React.useState({});

  const save = () => {
    apiFetch(`/notify/channels`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{setModal(false);reload();showToast(t('notify_toast_saved'),'ok');})
      .catch(()=>showToast(t('notify_toast_save_fail'),'err'));
  };
  const del = (name) => {
    if(!confirm(t('notify_confirm_del', { name }))) return;
    apiFetch(`/notify/channels/${name}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast(t('notify_toast_deleted'),'ok');})
      .catch(()=>showToast(t('notify_toast_del_fail'),'err'));
  };
  const test = (name) => {
    setTesting(p=>({...p,[name]:true}));
    apiFetch(`/notify/test/${name}`,{method:'POST'})
      .then(r=>r.json())
      .then(d=>{
        setTesting(p=>({...p,[name]:false}));
        if(d.ok) showToast(t('notify_toast_test_ok'),'ok');
        else showToast(t('notify_toast_send_fail', { detail: d.error||d.detail||t('notify_unknown') }),'err');
      })
      .catch(()=>{setTesting(p=>({...p,[name]:false}));showToast(t('notify_toast_test_req_fail'),'err');});
  };

  const EVENTS = ['task_blocked','issue_p0','sprint_complete','deploy','build_fail','review_needed'];
  const TYPES = [['dingtalk', t('notify_type_dingtalk')],['wechat_work', t('notify_type_wechat')],['slack', t('notify_type_slack')],['webhook', t('notify_type_webhook')]];

  if (loading) return <div><div className="section-title">{t('notify_title')}</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">{t('notify_title')}</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div className="section-title">{t('notify_title')}</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({type:'dingtalk',name:'',webhook_url:'',enabled:true,events:['task_blocked','issue_p0']});}}>{t('notify_add_ch')}</button>
      </div>
    </div>
    <div className="card" style={{marginBottom:12}}>
      {(data||[]).length===0?<div className="empty">{t('notify_empty')}</div>:
        (data||[]).map(ch=><div key={ch.name} className="list-item">
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="title">{ch.name}</span>
              <span className="tag tag-p2">{ch.type}</span>
              <span className={`tag ${ch.enabled?'tag-done':'tag-p3'}`}>{ch.enabled?t('notify_enabled'):t('notify_disabled')}</span>
            </div>
            <div className="meta">{t('notify_events_prefix')}{(ch.events && ch.events.join(', ')) || ''}</div>
          </div>
          <div style={{display:'flex',gap:4}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={()=>test(ch.name)} disabled={testing[ch.name]}>{testing[ch.name]?t('notify_sending'):t('notify_test')}</button>
            <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(ch.name)}>{t('notify_del')}</button>
          </div>
        </div>)}
    </div>
    <div className="card">
      <div className="section-title">{t('notify_broadcast')}</div>
      <BroadcastPanel t={t}/>
    </div>
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" style={{width:480}} onClick={e=>e.stopPropagation()}>
        <h3>{t('notify_modal_add')}</h3>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div className="form-group"><label>{t('notify_label_ch_name')}</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="my-dingtalk"/></div>
          <div className="form-group"><label>{t('notify_label_type')}</label>
            <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
              {TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group"><label>{t('notify_label_url')}</label><input value={form.webhook_url} onChange={e=>setForm({...form,webhook_url:e.target.value})} placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."/></div>
        <div className="form-group"><label>{t('notify_label_events')}</label>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {EVENTS.map(ev=><label key={ev} style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#94a3b8',cursor:'pointer'}}>
              <input type="checkbox" checked={form.events.includes(ev)} onChange={e=>{const s=new Set(form.events);e.target.checked?s.add(ev):s.delete(ev);setForm({...form,events:[...s]});}}/>
              {ev}
            </label>)}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(false)}>{t('notify_cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save}>{t('notify_save')}</button>
        </div>
      </div>
    </div>}
  </div>;
}

function BroadcastPanel({ t }) {
  const [form,setForm] = React.useState({title:'',content:'',level:'info',event:''});
  const [result,setResult] = React.useState(null);
  const send = () => {
    const p = new URLSearchParams({title:form.title,content:form.content,level:form.level,event:form.event});
    apiFetch(`/notify/broadcast?${p}`,{method:'POST'})
      .then(r=>r.json())
      .then(d=>{
        setResult(d);
        if(d&&(d.ok===false||d.success===false)) showToast(d.detail||d.error||t('notify_toast_bc_fail'),'err');
        else showToast(t('notify_toast_bc_ok'),'ok');
      })
      .catch(()=>showToast(t('notify_toast_bc_req_fail'),'err'));
  };
  return <div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
      <div className="form-group"><label>{t('notify_bc_title')}</label><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder={t('notify_bc_ph_title')}/></div>
      <div className="form-group"><label>{t('notify_bc_level')}</label>
        <select value={form.level} onChange={e=>setForm({...form,level:e.target.value})}>
          {['info','warn','error','success'].map(l=><option key={l}>{l}</option>)}
        </select>
      </div>
    </div>
    <div className="form-group"><label>{t('notify_bc_content')}</label><textarea value={form.content} onChange={e=>setForm({...form,content:e.target.value})} style={{minHeight:60}} placeholder={t('notify_bc_ph_content')}/></div>
    <button type="button" className="btn btn-primary" onClick={send} style={{width:'100%'}}>{t('notify_bc_btn')}</button>
    {result&&<div style={{marginTop:8,fontSize:12,color:'#94a3b8'}}>{JSON.stringify(result,null,2)}</div>}
  </div>;
}
