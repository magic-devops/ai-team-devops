// Tenants & projects (SaaS + single-project)
window.i18nExtend && window.i18nExtend({
  zh: {
    page_tenants: '组织管理',
    tenant_projects: '项目管理',
    tenant_templates: '项目模板',
    tenant_businesses: '业务线',
    tenant_users: '用户管理',
    tenant_tenants: '租户管理',
    tenant_clone: '从此模板克隆',
    tenant_set_tpl: '设为模板',
    tenant_unset_tpl: '取消模板',
    tenant_clone_reqs: '需求列表（状态重置为 pending）',
    tenant_clone_tasks: '任务模板',
    tenant_clone_kb: '知识库（向量数据）',
    tenant_clone_rules: '规则库',
    tenant_no_tpl: '暂无模板，在「项目管理」中将项目设为模板',
    tenant_op_fail: '操作失败',
    tenant_op_ok: '操作成功',
    tenant_mode_cur: '当前模式: {mode}',
    tenant_mode_saas: '多租户 SaaS',
    tenant_mode_single: '单项目',
    tenant_new_project: '+ 新建项目',
    tenant_badge_template: '模板',
    tenant_members: '成员',
    tenant_delete: '删除',
    tenant_tpl_intro: '将项目标记为模板后，可在此处克隆为新项目，复用需求、知识库、规则等。',
    tenant_stat_req: '需求: {n}',
    tenant_stat_task: '任务: {n}',
    tenant_new_business: '+ 新建业务线',
    tenant_n_projects: '{n} 个项目',
    tenant_new_user: '+ 新建用户',
    tenant_th_username: '用户名',
    tenant_th_email: '邮箱',
    tenant_th_role: '角色',
    tenant_th_status: '状态',
    tenant_th_actions: '操作',
    tenant_new_tenant: '+ 新建租户',
    tenant_modal_project: '新建项目',
    tenant_modal_business: '新建业务线',
    tenant_modal_user: '新建用户',
    tenant_modal_tenant: '新建租户',
    tenant_modal_members: '项目成员管理',
    tenant_f_name: '项目名称',
    tenant_f_desc: '描述',
    tenant_f_path: '本地路径',
    tenant_f_path_ph: '可选，单项目模式下的项目根路径',
    tenant_f_vector: '向量数据库',
    tenant_vec_lance: 'LanceDB（本地）',
    tenant_vec_milvus: 'Milvus（分布式）',
    tenant_f_milvus_uri: 'Milvus URI',
    tenant_f_milvus_ph: 'http://localhost:19530',
    tenant_cancel: '取消',
    tenant_saving: '保存中...',
    tenant_create: '创建',
    tenant_f_biz_name: '业务线名称',
    tenant_f_username: '用户名',
    tenant_f_password: '密码',
    tenant_f_email: '邮箱',
    tenant_f_role: '角色',
    tenant_f_tenant_name: '租户名称',
    tenant_f_slug: 'Slug（唯一标识）',
    tenant_f_plan: '套餐',
    tenant_remove: '移除',
    tenant_pick_user: '选择用户...',
    tenant_add: '添加',
    tenant_close: '关闭',
    tenant_clone_title: '从模板「{name}」克隆新项目',
    tenant_f_new_name: '新项目名称',
    tenant_f_clone_path: '本地路径（可选）',
    tenant_clone_pick: '克隆内容',
    tenant_cb_reqs: '需求列表（状态重置为 pending）',
    tenant_cb_tasks: '任务模板（状态重置为 pending）',
    tenant_clone_busy: '克隆中...',
    tenant_clone_go: '开始克隆',
    tenant_confirm_project: '删除项目 {name}？',
    tenant_confirm_business: '删除业务线 {name}？',
    tenant_confirm_user: '删除用户 {name}？',
    tenant_confirm_tenant: '删除租户 {name}？',
  },
  en: {
    page_tenants: 'Organization',
    tenant_projects: 'Projects',
    tenant_templates: 'Templates',
    tenant_businesses: 'Business lines',
    tenant_users: 'Users',
    tenant_tenants: 'Tenants',
    tenant_clone: 'Clone from template',
    tenant_set_tpl: 'Set as template',
    tenant_unset_tpl: 'Unset template',
    tenant_clone_reqs: 'Requirements (reset to pending)',
    tenant_clone_tasks: 'Task templates',
    tenant_clone_kb: 'Knowledge base (vectors)',
    tenant_clone_rules: 'Rules',
    tenant_no_tpl: 'No templates yet. Mark a project as template under Projects.',
    tenant_op_fail: 'Operation failed',
    tenant_op_ok: 'Success',
    tenant_mode_cur: 'Mode: {mode}',
    tenant_mode_saas: 'Multi-tenant SaaS',
    tenant_mode_single: 'Single project',
    tenant_new_project: '+ New project',
    tenant_badge_template: 'Template',
    tenant_members: 'Members',
    tenant_delete: 'Delete',
    tenant_tpl_intro: 'Mark a project as a template to clone it here with requirements, KB, and rules.',
    tenant_stat_req: 'Req: {n}',
    tenant_stat_task: 'Tasks: {n}',
    tenant_new_business: '+ New business line',
    tenant_n_projects: '{n} projects',
    tenant_new_user: '+ New user',
    tenant_th_username: 'Username',
    tenant_th_email: 'Email',
    tenant_th_role: 'Role',
    tenant_th_status: 'Status',
    tenant_th_actions: 'Actions',
    tenant_new_tenant: '+ New tenant',
    tenant_modal_project: 'New project',
    tenant_modal_business: 'New business line',
    tenant_modal_user: 'New user',
    tenant_modal_tenant: 'New tenant',
    tenant_modal_members: 'Project members',
    tenant_f_name: 'Project name',
    tenant_f_desc: 'Description',
    tenant_f_path: 'Local path',
    tenant_f_path_ph: 'Optional project root in single-project mode',
    tenant_f_vector: 'Vector database',
    tenant_vec_lance: 'LanceDB (local)',
    tenant_vec_milvus: 'Milvus (cluster)',
    tenant_f_milvus_uri: 'Milvus URI',
    tenant_f_milvus_ph: 'http://localhost:19530',
    tenant_cancel: 'Cancel',
    tenant_saving: 'Saving...',
    tenant_create: 'Create',
    tenant_f_biz_name: 'Business line name',
    tenant_f_username: 'Username',
    tenant_f_password: 'Password',
    tenant_f_email: 'Email',
    tenant_f_role: 'Role',
    tenant_f_tenant_name: 'Tenant name',
    tenant_f_slug: 'Slug (unique)',
    tenant_f_plan: 'Plan',
    tenant_remove: 'Remove',
    tenant_pick_user: 'Select user...',
    tenant_add: 'Add',
    tenant_close: 'Close',
    tenant_clone_title: 'Clone new project from template "{name}"',
    tenant_f_new_name: 'New project name',
    tenant_f_clone_path: 'Local path (optional)',
    tenant_clone_pick: 'Clone options',
    tenant_cb_reqs: 'Requirements (reset to pending)',
    tenant_cb_tasks: 'Task templates (reset to pending)',
    tenant_clone_busy: 'Cloning...',
    tenant_clone_go: 'Clone',
    tenant_confirm_project: 'Delete project {name}?',
    tenant_confirm_business: 'Delete business line {name}?',
    tenant_confirm_user: 'Delete user {name}?',
    tenant_confirm_tenant: 'Delete tenant {name}?',
  },
});
const TENANT_CREATE_USER_ROLES = ['tenant_admin', 'project_admin', 'developer', 'devops', 'product_manager', 'analyst', 'viewer'];
const PROJECT_MEMBER_ROLE_OPTIONS = ['project_admin', 'developer', 'devops', 'product_manager', 'analyst', 'viewer'];
const TenantsPage = () => {
  const langTick = typeof window.useLangTick === 'function' ? window.useLangTick() : 0;
  void langTick;
  const t = (k, v) => (typeof window.t === 'function' ? window.t(k, v) : k);
  const [mode] = React.useState(window.__ADMIN_MODE__ || 'single');
  const [tab, setTab] = React.useState('projects');
  const [tenants, setTenants] = React.useState([]);
  const [businesses, setBusinesses] = React.useState([]);
  const [projects, setProjects] = React.useState([]);
  const [members, setMembers] = React.useState({});
  const [users, setUsers] = React.useState([]);
  const [modal, setModal] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const [templates, setTemplates] = React.useState([]);

  const load = () => {
    apiFetch('/api/v1/projects', { headers: authHeaders() }).then(r => r.json()).then(setProjects).catch(() => {});
    apiFetch('/api/v1/projects/templates', { headers: authHeaders() }).then(r => r.json()).then(setTemplates).catch(() => {});
    apiFetch('/api/v1/businesses', { headers: authHeaders() }).then(r => r.json()).then(setBusinesses).catch(() => {});
    apiFetch('/api/v1/auth/users', { headers: authHeaders() }).then(r => r.json()).then(setUsers).catch(() => {});
    if (mode === 'saas') {
      apiFetch('/api/v1/tenants', { headers: authHeaders() }).then(r => r.json()).then(setTenants).catch(() => {});
    }
  };

  React.useEffect(() => { load(); }, []);

  const loadMembers = (pid) => {
    apiFetch(`/api/v1/projects/${pid}/members`, { headers: authHeaders() })
      .then(r => r.json()).then(d => setMembers(p => ({ ...p, [pid]: d }))).catch(() => {});
  };

  const api = async (url, method, body) => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch(url, {
        method, headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || t('tenant_op_fail'));
      setMsg({ ok: true, text: t('tenant_op_ok') });
      load(); setModal(null); setForm({});
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  };

  const tabs = [
    { id: 'projects', label: t('tenant_projects') },
    { id: 'templates', label: t('tenant_templates') },
    { id: 'businesses', label: t('tenant_businesses') },
    { id: 'users', label: t('tenant_users') },
    ...(mode === 'saas' ? [{ id: 'tenants', label: t('tenant_tenants') }] : []),
  ];

  const modalTitles = {
    project: t('tenant_modal_project'),
    business: t('tenant_modal_business'),
    user: t('tenant_modal_user'),
    tenant: t('tenant_modal_tenant'),
    members: t('tenant_modal_members'),
  };

  return React.createElement('div', { style: { padding: '24px 32px' } },
    React.createElement('h2', { style: { color: 'var(--text)', fontSize: 20, marginBottom: 4 } }, t('page_tenants')),
    React.createElement('div', { style: { fontSize: 13, color: 'var(--text3)', marginBottom: 20 } },
      t('tenant_mode_cur', { mode: mode === 'saas' ? t('tenant_mode_saas') : t('tenant_mode_single') })),

    msg && React.createElement('div', {
      style: {
        padding: '8px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13,
        background: msg.ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)',
        color: msg.ok ? '#4ade80' : '#f87171'
      }
    }, msg.text),

    React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 } },
      tabs.map(tb => React.createElement('button', {
        key: tb.id,
        onClick: () => setTab(tb.id),
        style: {
          padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, borderRadius: '6px 6px 0 0',
          background: tab === tb.id ? 'var(--accent)' : 'transparent',
          color: tab === tb.id ? '#fff' : 'var(--text2)',
          borderBottom: tab === tb.id ? '2px solid var(--accent)' : '2px solid transparent',
        }
      }, tb.label))
    ),

    tab === 'projects' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', {
          style: btnStyle('accent'),
          onClick: () => { setModal('project'); setForm({ vector_db: 'lance', vector_db_config: {} }); }
        }, t('tenant_new_project'))
      ),
      React.createElement('div', { style: { display: 'grid', gap: 12 } },
        projects.map(p => React.createElement('div', { key: p.id, style: cardStyle() },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
            React.createElement('div', null,
              React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 15 } }, p.name),
              React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginTop: 2 } }, p.id),
              p.description && React.createElement('div', { style: { fontSize: 13, color: 'var(--text2)', marginTop: 4 } }, p.description),
            ),
            React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              React.createElement('span', { style: badgeStyle(p.vector_db === 'milvus' ? 'purple' : 'green') }, p.vector_db),
              React.createElement('span', { style: badgeStyle(p.status === 'active' ? 'blue' : 'gray') }, p.status),
              p.is_template && React.createElement('span', { style: badgeStyle('yellow') }, t('tenant_badge_template')),
              React.createElement('button', {
                style: { ...btnStyle('muted'), fontSize: 12 },
                onClick: () => { loadMembers(p.id); setModal('members'); setForm({ project_id: p.id }); }
              }, t('tenant_members')),
              React.createElement('button', {
                style: { ...btnStyle('muted'), fontSize: 12 },
                onClick: () => api(`/api/v1/projects/${p.id}/set-template`, 'PATCH', { is_template: !p.is_template })
              }, p.is_template ? t('tenant_unset_tpl') : t('tenant_set_tpl')),
              React.createElement('button', {
                style: { ...btnStyle('danger'), fontSize: 12 },
                onClick: () => { if (confirm(t('tenant_confirm_project', { name: p.name }))) api(`/api/v1/projects/${p.id}`, 'DELETE'); }
              }, t('tenant_delete')),
            )
          )
        ))
      )
    ),

    tab === 'templates' && React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 13, color: 'var(--text3)', marginBottom: 14 } },
        t('tenant_tpl_intro')
      ),
      templates.length === 0
        ? React.createElement('div', { style: { color: 'var(--text3)', padding: '32px 0', textAlign: 'center' } }, t('tenant_no_tpl'))
        : React.createElement('div', { style: { display: 'grid', gap: 12 } },
          templates.map(tpl => React.createElement('div', { key: tpl.id, style: cardStyle() },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
              React.createElement('div', null,
                React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 15 } }, tpl.name),
                React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginTop: 2 } }, tpl.id),
                tpl.description && React.createElement('div', { style: { fontSize: 13, color: 'var(--text2)', marginTop: 4 } }, tpl.description),
                React.createElement('div', { style: { display: 'flex', gap: 12, marginTop: 6, fontSize: 12, color: 'var(--text3)' } },
                  React.createElement('span', null, t('tenant_stat_req', { n: tpl.req_count })),
                  React.createElement('span', null, t('tenant_stat_task', { n: tpl.task_count })),
                  React.createElement('span', { style: badgeStyle(tpl.vector_db === 'milvus' ? 'purple' : 'green') }, tpl.vector_db),
                )
              ),
              React.createElement('button', {
                style: btnStyle('accent'),
                onClick: () => { setModal('clone'); setForm({ template_id: tpl.id, template_name: tpl.name, vector_db: tpl.vector_db, clone_requirements: true, clone_knowledge: true, clone_rules: true, clone_tasks: false }); }
              }, t('tenant_clone'))
            )
          ))
        )
    ),

    tab === 'businesses' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', { style: btnStyle('accent'), onClick: () => { setModal('business'); setForm({}); } }, t('tenant_new_business'))
      ),
      React.createElement('div', { style: { display: 'grid', gap: 8 } },
        businesses.map(b => React.createElement('div', { key: b.id, style: { ...cardStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)' } }, b.name),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)' } }, t('tenant_n_projects', { n: b.project_count || 0 })),
          ),
          React.createElement('button', {
            style: { ...btnStyle('danger'), fontSize: 12 },
            onClick: () => { if (confirm(t('tenant_confirm_business', { name: b.name }))) api(`/api/v1/businesses/${b.id}`, 'DELETE'); }
          }, t('tenant_delete'))
        ))
      )
    ),

    tab === 'users' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', { style: btnStyle('accent'), onClick: () => { setModal('user'); setForm({ role: 'developer' }); } }, t('tenant_new_user'))
      ),
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
        React.createElement('thead', null,
          React.createElement('tr', null, [t('tenant_th_username'), t('tenant_th_email'), t('tenant_th_role'), t('tenant_th_status'), t('tenant_th_actions')].map(h =>
            React.createElement('th', { key: h, style: thStyle() }, h)
          ))
        ),
        React.createElement('tbody', null,
          users.map(u => React.createElement('tr', { key: u.id },
            React.createElement('td', { style: tdStyle() }, u.username),
            React.createElement('td', { style: tdStyle() }, u.email || '—'),
            React.createElement('td', { style: tdStyle() }, React.createElement('span', { style: badgeStyle('blue') }, u.role)),
            React.createElement('td', { style: tdStyle() }, React.createElement('span', { style: badgeStyle(u.status === 'active' ? 'green' : 'gray') }, u.status)),
            React.createElement('td', { style: tdStyle() },
              React.createElement('button', {
                style: { ...btnStyle('danger'), fontSize: 11, padding: '3px 8px' },
                onClick: () => { if (confirm(t('tenant_confirm_user', { name: u.username }))) api(`/api/v1/auth/users/${u.id}`, 'DELETE'); }
              }, t('tenant_delete'))
            )
          ))
        )
      )
    ),

    tab === 'tenants' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', { style: btnStyle('accent'), onClick: () => { setModal('tenant'); setForm({ plan: 'free' }); } }, t('tenant_new_tenant'))
      ),
      React.createElement('div', { style: { display: 'grid', gap: 8 } },
        tenants.map(tn => React.createElement('div', { key: tn.id, style: { ...cardStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)' } }, tn.name),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)' } }, `slug: ${tn.slug}`),
          ),
          React.createElement('div', { style: { display: 'flex', gap: 6 } },
            React.createElement('span', { style: badgeStyle('blue') }, tn.plan),
            React.createElement('span', { style: badgeStyle(tn.status === 'active' ? 'green' : 'gray') }, tn.status),
            React.createElement('button', {
              style: { ...btnStyle('danger'), fontSize: 12 },
              onClick: () => { if (confirm(t('tenant_confirm_tenant', { name: tn.name }))) api(`/api/v1/tenants/${tn.id}`, 'DELETE'); }
            }, t('tenant_delete'))
          )
        ))
      )
    ),

    modal && React.createElement('div', {
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      onClick: e => { if (e.target === e.currentTarget) setModal(null); }
    },
      React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, minWidth: 380, maxWidth: 520 } },
        React.createElement('h3', { style: { color: 'var(--text)', marginBottom: 20, fontSize: 16 } }, modalTitles[modal]),

        modal === 'project' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field(t('tenant_f_name'), 'name', form, setForm, 'text', true),
          field(t('tenant_f_desc'), 'description', form, setForm),
          field(t('tenant_f_path'), 'project_path', form, setForm, 'text', false, t('tenant_f_path_ph')),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, t('tenant_f_vector')),
            React.createElement('select', {
              style: inputStyle(),
              value: form.vector_db || 'lance',
              onChange: e => setForm(p => ({ ...p, vector_db: e.target.value }))
            },
              React.createElement('option', { value: 'lance' }, t('tenant_vec_lance')),
              React.createElement('option', { value: 'milvus' }, t('tenant_vec_milvus')),
            )
          ),
          form.vector_db === 'milvus' && field(t('tenant_f_milvus_uri'), 'milvus_uri', form, setForm, 'text', false, t('tenant_f_milvus_ph')),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, t('tenant_cancel')),
            React.createElement('button', {
              style: btnStyle('accent'), disabled: saving,
              onClick: () => {
                const body = { ...form };
                if (body.milvus_uri) { body.vector_db_config = { uri: body.milvus_uri }; delete body.milvus_uri; }
                api('/api/v1/projects', 'POST', body);
              }
            }, saving ? t('tenant_saving') : t('tenant_create'))
          )
        ),

        modal === 'business' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field(t('tenant_f_biz_name'), 'name', form, setForm, 'text', true),
          field(t('tenant_f_desc'), 'description', form, setForm),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, t('tenant_cancel')),
            React.createElement('button', { style: btnStyle('accent'), disabled: saving, onClick: () => api('/api/v1/businesses', 'POST', form) }, saving ? t('tenant_saving') : t('tenant_create'))
          )
        ),

        modal === 'user' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field(t('tenant_f_username'), 'username', form, setForm, 'text', true),
          field(t('tenant_f_password'), 'password', form, setForm, 'password', true),
          field(t('tenant_f_email'), 'email', form, setForm, 'email'),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, t('tenant_f_role')),
            React.createElement('select', {
              style: inputStyle(), value: form.role || 'developer',
              onChange: e => setForm(p => ({ ...p, role: e.target.value }))
            },
              TENANT_CREATE_USER_ROLES.map(r =>
                React.createElement('option', { key: r, value: r }, r)
              )
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, t('tenant_cancel')),
            React.createElement('button', { style: btnStyle('accent'), disabled: saving, onClick: () => api('/api/v1/auth/users', 'POST', form) }, saving ? t('tenant_saving') : t('tenant_create'))
          )
        ),

        modal === 'tenant' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field(t('tenant_f_tenant_name'), 'name', form, setForm, 'text', true),
          field(t('tenant_f_slug'), 'slug', form, setForm, 'text', true),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, t('tenant_f_plan')),
            React.createElement('select', {
              style: inputStyle(), value: form.plan || 'free',
              onChange: e => setForm(p => ({ ...p, plan: e.target.value }))
            },
              ['free', 'pro', 'enterprise'].map(p => React.createElement('option', { key: p, value: p }, p))
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, t('tenant_cancel')),
            React.createElement('button', { style: btnStyle('accent'), disabled: saving, onClick: () => api('/api/v1/tenants', 'POST', form) }, saving ? t('tenant_saving') : t('tenant_create'))
          )
        ),

        modal === 'members' && React.createElement('div', null,
          React.createElement('div', { style: { marginBottom: 12 } },
            (members[form.project_id] || []).map(m =>
              React.createElement('div', { key: m.user_id, style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 } },
                React.createElement('span', { style: { color: 'var(--text)' } }, m.username),
                React.createElement('div', { style: { display: 'flex', gap: 6 } },
                  React.createElement('span', { style: badgeStyle('blue') }, m.role),
                  React.createElement('button', {
                    style: { ...btnStyle('danger'), fontSize: 11, padding: '2px 6px' },
                    onClick: () => api(`/api/v1/projects/${form.project_id}/members/${m.user_id}`, 'DELETE')
                  }, t('tenant_remove'))
                )
              )
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement('select', {
              style: { ...inputStyle(), flex: 1 },
              value: form.add_user || '',
              onChange: e => setForm(p => ({ ...p, add_user: e.target.value }))
            },
              React.createElement('option', { value: '' }, t('tenant_pick_user')),
              users.map(u => React.createElement('option', { key: u.id, value: u.id }, u.username))
            ),
            React.createElement('select', {
              style: { ...inputStyle(), width: 120 },
              value: form.add_role || 'developer',
              onChange: e => setForm(p => ({ ...p, add_role: e.target.value }))
            },
              PROJECT_MEMBER_ROLE_OPTIONS.map(r => React.createElement('option', { key: r, value: r }, r))
            ),
            React.createElement('button', {
              style: btnStyle('accent'), disabled: !form.add_user || saving,
              onClick: () => api(`/api/v1/projects/${form.project_id}/members`, 'POST', { user_id: form.add_user, role: form.add_role || 'developer' })
            }, t('tenant_add'))
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 16 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, t('tenant_close'))
          )
        ),

        modal === 'clone' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          React.createElement('div', { style: { fontSize: 13, color: 'var(--text3)', marginBottom: 4 } },
            t('tenant_clone_title', { name: form.template_name || '' })),
          field(t('tenant_f_new_name'), 'name', form, setForm, 'text', true),
          field(t('tenant_f_desc'), 'description', form, setForm),
          field(t('tenant_f_clone_path'), 'project_path', form, setForm),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, t('tenant_clone_pick')),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
              [
                ['clone_requirements', t('tenant_cb_reqs')],
                ['clone_tasks', t('tenant_cb_tasks')],
                ['clone_knowledge', t('tenant_clone_kb')],
                ['clone_rules', t('tenant_clone_rules')],
              ].map(([key, label]) =>
                React.createElement('label', { key, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text2)' } },
                  React.createElement('input', {
                    type: 'checkbox', checked: !!form[key],
                    onChange: e => setForm(p => ({ ...p, [key]: e.target.checked }))
                  }), label
                )
              )
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, t('tenant_cancel')),
            React.createElement('button', {
              style: btnStyle('accent'), disabled: saving || !form.name,
              onClick: () => api(`/api/v1/projects/${form.template_id}/clone`, 'POST', {
                name: form.name, description: form.description || '',
                project_path: form.project_path || '',
                clone_requirements: !!form.clone_requirements,
                clone_tasks: !!form.clone_tasks,
                clone_knowledge: !!form.clone_knowledge,
                clone_rules: !!form.clone_rules,
              })
            }, saving ? t('tenant_clone_busy') : t('tenant_clone_go'))
          )
        )
      )
    )
  );
};

function field(label, key, form, setForm, type = 'text', required = false, placeholder = '') {
  return React.createElement('div', { key: String(key) },
    React.createElement('label', { style: labelStyle() }, label + (required ? ' *' : '')),
    React.createElement('input', {
      type, placeholder, required,
      style: inputStyle(),
      value: form[key] || '',
      onChange: e => setForm(p => ({ ...p, [key]: e.target.value }))
    })
  );
}
function labelStyle() { return { display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 4 }; }
function inputStyle() { return { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-input)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }; }
function cardStyle() { return { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }; }
function badgeStyle(color) {
  const c = { blue: '#3b82f6', gray: '#64748b', purple: '#a855f7', green: '#22c55e', red: '#ef4444', yellow: '#f59e0b' };
  return { fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: (c[color] || c.gray) + '22', color: c[color] || c.gray, border: `1px solid ${(c[color] || c.gray)}44` };
}
function btnStyle(v) {
  const s = { padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13 };
  if (v === 'accent') return { ...s, background: 'var(--accent)', color: '#fff' };
  if (v === 'danger') return { ...s, background: 'rgba(239,68,68,.15)', color: '#f87171' };
  return { ...s, background: 'var(--btn-muted-bg)', color: 'var(--btn-muted-fg)' };
}
function thStyle() { return { textAlign: 'left', padding: '6px 12px', color: 'var(--text3)', fontSize: 12, borderBottom: '1px solid var(--border)' }; }
function tdStyle() { return { padding: '8px 12px', color: 'var(--text)', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }; }
