function AuthManager() {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  const tr = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  void langTick;
  const { data, loading, error, reload } = useFetch(`${API}/auth/users`);
  const [rc, setRc] = React.useState({ user_roles: [], project_member_roles: [] });
  const [modal, setModal] = React.useState(false);
  const [form, setForm] = React.useState({ username: '', password: '', role: 'developer' });
  const [editUser, setEditUser] = React.useState(null);
  const [editForm, setEditForm] = React.useState({ role: 'developer', status: 'active', email: '', password: '' });
  const [initModal, setInitModal] = React.useState(false);
  const [initForm, setInitForm] = React.useState({ username: 'admin', password: '' });

  React.useEffect(function () {
    if (typeof apiFetch !== 'function') return;
    apiFetch(API + '/auth/role-constants', { timeoutMs: 10000 })
      .then(function (r) {
        return r.json();
      })
      .then(setRc)
      .catch(function () {
        setRc({ user_roles: [], project_member_roles: [] });
      });
  }, []);

  const roleLabel = React.useCallback(
    function (r) {
      var k = 'role_' + r;
      var s = tr(k);
      return s === k ? r : s;
    },
    [tr]
  );

  const assignableUserRoles = React.useMemo(function () {
    var list =
      rc && rc.user_roles && rc.user_roles.length
        ? rc.user_roles.slice()
        : ['super_admin', 'tenant_admin', 'project_admin', 'developer', 'devops', 'product_manager', 'analyst', 'viewer'];
    var me = typeof window !== 'undefined' && window.__CURRENT_USER__ ? window.__CURRENT_USER__ : {};
    var isSuper = me.role === 'super_admin';
    return list.filter(function (rid) {
      return isSuper || rid !== 'super_admin';
    });
  }, [rc]);

  const save = () => {
    if (typeof apiFetch !== 'function') return;
    apiFetch(API + '/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
      timeoutMs: 20000,
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          setModal(false);
          reload();
          showToast(tr('auth_toast_user_added'), 'ok');
        } else {
          var msg = res.d && (res.d.detail || res.d.message);
          showToast(typeof msg === 'string' ? msg : tr('auth_toast_add_fail'), 'err');
        }
      })
      .catch(function () {
        showToast(tr('gen_req_fail'), 'err');
      });
  };

  const del = (id, username) => {
    if (!confirm(tr('auth_confirm_del_user', { username }))) return;
    if (typeof apiFetch !== 'function') return;
    apiFetch(API + '/auth/users/' + encodeURIComponent(id), { method: 'DELETE', timeoutMs: 20000 })
      .then(function (r) {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(function () {
        reload();
        showToast(tr('auth_toast_deleted'), 'ok');
      })
      .catch(function () {
        showToast(tr('auth_toast_del_fail'), 'err');
      });
  };

  const openEdit = (u) => {
    setEditUser(u);
    setEditForm({ role: u.role || 'developer', status: u.status || 'active', email: u.email || '', password: '' });
  };

  const saveEdit = () => {
    if (!editUser || typeof apiFetch !== 'function') return;
    var body = { role: editForm.role, status: editForm.status, email: editForm.email };
    if (editForm.password && String(editForm.password).length >= 8) body.password = editForm.password;
    apiFetch(API + '/auth/users/' + encodeURIComponent(editUser.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 20000,
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          setEditUser(null);
          reload();
          showToast(tr('auth_toast_user_updated'), 'ok');
        } else {
          var msg = res.d && (res.d.detail || res.d.message);
          showToast(typeof msg === 'string' ? msg : tr('auth_toast_update_fail'), 'err');
        }
      })
      .catch(function () {
        showToast(tr('gen_req_fail'), 'err');
      });
  };

  const initAdmin = () => {
    if (typeof apiFetch !== 'function') return;
    apiFetch(API + '/auth/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initForm),
      timeoutMs: 20000,
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d.ok) {
          setInitModal(false);
          reload();
          showToast(tr('auth_toast_admin_ok'), 'ok');
        } else {
          showToast(d.detail || tr('auth_toast_init_fail'), 'err');
        }
      })
      .catch(function () {
        showToast(tr('gen_req_fail'), 'err');
      });
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
              setForm({ username: '', password: '', role: 'developer' });
            }}
          >
            {tr('auth_add_user')}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.55 }}>{tr('auth_role_intro')}</p>
      <div className="card">
        {(data || []).length === 0 ? (
          <div className="empty">{tr('auth_empty')}</div>
        ) : (
          (data || []).map((u) => (
            <div key={u.id} className="list-item">
              <div style={{ flex: 1 }}>
                <div className="title">{u.username}</div>
                <div className="meta">
                  {tr('auth_role')}: {roleLabel(u.role)} · {tr('auth_label_status')}: {u.status || '—'}
                  {u.email ? <span> · {u.email}</span> : null}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" className="btn btn-sm btn-muted" onClick={() => openEdit(u)}>
                  {tr('gen_edit')}
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => del(u.id, u.username)}>
                  {tr('gen_delete')}
                </button>
              </div>
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
                {assignableUserRoles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
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
      {editUser && (
        <div className="modal-bg" onClick={() => setEditUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('auth_modal_edit')}</h3>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{editUser.username}</p>
            <div className="form-group">
              <label>{tr('auth_label_email')}</label>
              <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>{tr('auth_label_role')}</label>
              <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                {assignableUserRoles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{tr('auth_label_status')}</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </div>
            <div className="form-group">
              <label>{tr('auth_label_password_reset')}</label>
              <input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder={tr('auth_pw_reset_ph')}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel" onClick={() => setEditUser(null)}>
                {tr('gen_cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={saveEdit}>
                {tr('gen_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
window.i18nExtend &&
  window.i18nExtend({
    zh: {},
    en: {},
  });
