function AuthManager() {
  const {data,loading,error,reload} = useFetch(`${API}/auth/users`);
  const [modal,setModal] = React.useState(false);
  const [form,setForm] = React.useState({username:'',password:'',role:'admin'});
  const [initModal,setInitModal] = React.useState(false);
  const [initForm,setInitForm] = React.useState({username:'admin',password:''});

  const save = () => {
    fetch(`${API}/auth/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      .then(r=>r.json()).then(d=>{
        if(d.ok){setModal(false);reload();showToast('用户已添加','ok');}
        else {showToast(d.detail||'添加失败','err');}
      }).catch(()=>showToast('请求失败','err'));
  };
  const del = (username) => {
    if(!confirm(`删除用户 ${username}？`)) return;
    fetch(`${API}/auth/users/${username}`,{method:'DELETE'})
      .then((r)=>{if(!r.ok)throw new Error();})
      .then(()=>{reload();showToast('已删除','ok');})
      .catch(()=>showToast('删除失败','err'));
  };
  const initAdmin = () => {
    fetch(`${API}/auth/init`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(initForm)})
      .then(r=>r.json()).then(d=>{
        if(d.ok){setInitModal(false);reload();showToast('管理员已创建','ok');}
        else {showToast(d.detail||'初始化失败','err');}
      }).catch(()=>showToast('请求失败','err'));
  };

  if (loading) return <div><div className="section-title">👤 账号管理</div><PageSkeleton cards={1}/></div>;
  if (error) return <div><div className="section-title">👤 账号管理</div><LoadError message={error} onRetry={reload}/></div>;

  return <div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
      <div className="section-title">👤 账号管理</div>
      <div style={{display:'flex',gap:8}}>
        <RefreshBtn onClick={reload} />
        {(data||[]).length===0&&<button type="button" className="btn btn-sm" style={{background:'#f59e0b',color:'#000'}} onClick={()=>setInitModal(true)}>初始化管理员</button>}
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setModal(true);setForm({username:'',password:'',role:'admin'});}}>+ 添加用户</button>
      </div>
    </div>
    <div className="card">
      {(data||[]).length===0?<div className="empty">暂无用户，点击「初始化管理员」创建第一个账号</div>:
        (data||[]).map(u=><div key={u.username} className="list-item">
          <div style={{flex:1}}>
            <div className="title">{u.username}</div>
            <div className="meta">角色: {u.role}</div>
          </div>
          <button type="button" className="btn btn-sm" style={{background:'#7f1d1d',color:'#fca5a5'}} onClick={()=>del(u.username)}>删除</button>
        </div>)}
    </div>
    {initModal&&<div className="modal-bg" onClick={()=>setInitModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>初始化管理员账号</h3>
        <div className="form-group"><label>用户名</label><input value={initForm.username} onChange={e=>setInitForm({...initForm,username:e.target.value})}/></div>
        <div className="form-group"><label>密码</label><input type="password" value={initForm.password} onChange={e=>setInitForm({...initForm,password:e.target.value})}/></div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setInitModal(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={initAdmin}>创建</button>
        </div>
      </div>
    </div>}
    {modal&&<div className="modal-bg" onClick={()=>setModal(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h3>添加用户</h3>
        <div className="form-group"><label>用户名</label><input value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></div>
        <div className="form-group"><label>密码</label><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></div>
        <div className="form-group"><label>角色</label>
          <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
            <option value="admin">admin</option><option value="viewer">viewer</option>
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-cancel" onClick={()=>setModal(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>}
  </div>;
}
