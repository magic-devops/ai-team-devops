function AuthManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/auth/users`);
  const [modal, setModal] = React.useState(false);
  const [form, setForm] = React.useState({ username: '', password: '', role: 'admin' });
  const [initModal, setInitModal] = React.useState(false);
  const [initForm, setInitForm] = React.useState({ username: 'admin', password: '' });

  const save = () => {
    fetch(`${API}/auth/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setModal(false);
          reload();
          showToast(tr('auth_toast_user_added'), 'ok');
        } else {
          showToast(d.detail || tr('auth_toast_add_fail'), 'err');
        }
      })
      .catch(() => showToast(tr('gen_req_fail'), 'err'));
  };
  const del = (username) => {
    if (!confirm(tr('auth_confirm_del_user', { username }))) return;
    fetch(`${API}/auth/users/${username}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .then(() => {
        reload();
        showToast(tr('auth_toast_deleted'), 'ok');
      })
      .catch(() => showToast(tr('auth_toast_del_fail'), 'err'));
  };
  const initAdmin = () => {
    fetch(`${API}/auth/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(initForm) })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setInitModal(false);
          reload();
          showToast(tr('auth_toast_admin_ok'), 'ok');
        } else {
          showToast(d.detail || tr('auth_toast_init_fail'), 'err');
        }
      })
      .catch(() => showToast(tr('gen_req_fail'), 'err'));
  };

  if (loading)
    return (
      <div>
        <div className="section-title">{tr('auth_title')}</div>
        <PageSkeleton cards={1} />
      </div>
    );
  if (error)
    return (
      <div>
        <div className="section-title">{tr('auth_title')}</div>
        <LoadError message={error} onRetry={reload} />
      </div>
    );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="section-title">{tr('auth_title')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <RefreshBtn onClick={reload} />
          {(data || []).length === 0 && (
            <button type="button" className="btn btn-sm btn-primary" style={{ background: '#f59e0b', color: '#000' }} onClick={() => setInitModal(true)}>
              {tr('auth_init_admin')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setModal(true);
              setForm({ username: '', password: '', role: 'admin' });
            }}
          >
            {tr('auth_add_user')}
          </button>
        </div>
      </div>
      <div className="card">
        {(data || []).length === 0 ? (
          <div className="empty">{tr('auth_empty')}</div>
        ) : (
          (data || []).map((u) => (
            <div key={u.username} className="list-item">
              <div style={{ flex: 1 }}>
                <div className="title">{u.username}</div>
                <div className="meta">
                  {tr('auth_role')}: {u.role}
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => del(u.username)}>
                {tr('gen_delete')}
              </button>
            </div>
          ))
        )}
      </div>
      {initModal && (
        <div className="modal-bg" onClick={() => setInitModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('auth_modal_init')}</h3>
            <div className="form-group">
              <label>{tr('auth_label_username')}</label>
              <input value={initForm.username} onChange={(e) => setInitForm({ ...initForm, username: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('auth_label_password')}</label>
              <input type="password" value={initForm.password} onChange={(e) => setInitForm({ ...initForm, password: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setInitModal(false)}>
                {tr('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={initAdmin}>
                {tr('gen_create')}
              </button>
            </div>
          </div>
        </div>
      )}
      {modal && (
        <div className="modal-bg" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('auth_modal_add')}</h3>
            <div className="form-group">
              <label>{tr('auth_label_username')}</label>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('auth_label_password')}</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('auth_label_role')}</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setModal(false)}>
                {tr('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={save}>
                {tr('gen_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
