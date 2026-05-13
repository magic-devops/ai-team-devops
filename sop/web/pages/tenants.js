// 租户 & 项目管理页面 (SaaS 多租户 + 单项目模式)
window.i18nExtend && window.i18nExtend({
  zh: { page_tenants: '组织管理', tenant_projects: '项目管理', tenant_templates: '项目模板', tenant_businesses: '业务线', tenant_users: '用户管理', tenant_tenants: '租户管理', tenant_clone: '从此模板克隆', tenant_set_tpl: '设为模板', tenant_unset_tpl: '取消模板', tenant_clone_reqs: '需求列表（状态重置为 pending）', tenant_clone_tasks: '任务模板', tenant_clone_kb: '知识库（向量数据）', tenant_clone_rules: '规则库', tenant_no_tpl: '暂无模板，在「项目管理」中将项目设为模板' },
  en: { page_tenants: 'Organization', tenant_projects: 'Projects', tenant_templates: 'Templates', tenant_businesses: 'Business Lines', tenant_users: 'Users', tenant_tenants: 'Tenants', tenant_clone: 'Clone from Template', tenant_set_tpl: 'Set as Template', tenant_unset_tpl: 'Unset Template', tenant_clone_reqs: 'Requirements (reset to pending)', tenant_clone_tasks: 'Task templates', tenant_clone_kb: 'Knowledge base (vectors)', tenant_clone_rules: 'Rules', tenant_no_tpl: 'No templates yet. Mark a project as template first.' },
});
const TENANT_CREATE_USER_ROLES = ['tenant_admin', 'project_admin', 'developer', 'devops', 'product_manager', 'analyst', 'viewer'];
const PROJECT_MEMBER_ROLE_OPTIONS = ['project_admin', 'developer', 'devops', 'product_manager', 'analyst', 'viewer'];
const TenantsPage = () => {
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
    fetch('/api/projects', { headers: authHeaders() }).then(r => r.json()).then(setProjects).catch(() => {});
    fetch('/api/projects/templates', { headers: authHeaders() }).then(r => r.json()).then(setTemplates).catch(() => {});
    fetch('/api/businesses', { headers: authHeaders() }).then(r => r.json()).then(setBusinesses).catch(() => {});
    fetch('/api/auth/users', { headers: authHeaders() }).then(r => r.json()).then(setUsers).catch(() => {});
    if (mode === 'saas') {
      fetch('/api/tenants', { headers: authHeaders() }).then(r => r.json()).then(setTenants).catch(() => {});
    }
  };

  React.useEffect(() => { load(); }, []);

  const loadMembers = (pid) => {
    fetch(`/api/projects/${pid}/members`, { headers: authHeaders() })
      .then(r => r.json()).then(d => setMembers(p => ({ ...p, [pid]: d }))).catch(() => {});
  };

  const api = async (url, method, body) => {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(url, {
        method, headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || '操作失败');
      setMsg({ ok: true, text: '操作成功' });
      load(); setModal(null); setForm({});
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setSaving(false);
  };

  const tabs = [
    { id: 'projects', label: '项目管理' },
    { id: 'templates', label: '项目模板' },
    { id: 'businesses', label: '业务线' },
    { id: 'users', label: '用户管理' },
    ...(mode === 'saas' ? [{ id: 'tenants', label: '租户管理' }] : []),
  ];

  return React.createElement('div', { style: { padding: '24px 32px' } },
    React.createElement('h2', { style: { color: 'var(--text)', fontSize: 20, marginBottom: 4 } }, '组织管理'),
    React.createElement('div', { style: { fontSize: 13, color: 'var(--text3)', marginBottom: 20 } },
      `当前模式: ${mode === 'saas' ? '多租户 SaaS' : '单项目'}`),

    msg && React.createElement('div', {
      style: {
        padding: '8px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13,
        background: msg.ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)',
        color: msg.ok ? '#4ade80' : '#f87171'
      }
    }, msg.text),

    // Tab 导航
    React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 } },
      tabs.map(t => React.createElement('button', {
        key: t.id,
        onClick: () => setTab(t.id),
        style: {
          padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, borderRadius: '6px 6px 0 0',
          background: tab === t.id ? 'var(--accent)' : 'transparent',
          color: tab === t.id ? '#fff' : 'var(--text2)',
          borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
        }
      }, t.label))
    ),

    // 项目管理
    tab === 'projects' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', {
          style: btnStyle('accent'),
          onClick: () => { setModal('project'); setForm({ vector_db: 'lance', vector_db_config: {} }); }
        }, '+ 新建项目')
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
              p.is_template && React.createElement('span', { style: badgeStyle('yellow') }, '模板'),
              React.createElement('button', {
                style: { ...btnStyle('muted'), fontSize: 12 },
                onClick: () => { loadMembers(p.id); setModal('members'); setForm({ project_id: p.id }); }
              }, '成员'),
              React.createElement('button', {
                style: { ...btnStyle('muted'), fontSize: 12 },
                onClick: () => api(`/api/projects/${p.id}/set-template`, 'PATCH', { is_template: !p.is_template })
              }, p.is_template ? '取消模板' : '设为模板'),
              React.createElement('button', {
                style: { ...btnStyle('danger'), fontSize: 12 },
                onClick: () => { if (confirm(`删除项目 ${p.name}？`)) api(`/api/projects/${p.id}`, 'DELETE'); }
              }, '删除'),
            )
          )
        ))
      )
    ),

    // 项目模板
    tab === 'templates' && React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 13, color: 'var(--text3)', marginBottom: 14 } },
        '将项目标记为模板后，可在此处克隆为新项目，复用需求、知识库、规则等。'
      ),
      templates.length === 0
        ? React.createElement('div', { style: { color: 'var(--text3)', padding: '32px 0', textAlign: 'center' } }, '暂无模板，在「项目管理」中将项目设为模板')
        : React.createElement('div', { style: { display: 'grid', gap: 12 } },
          templates.map(tpl => React.createElement('div', { key: tpl.id, style: cardStyle() },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
              React.createElement('div', null,
                React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)', fontSize: 15 } }, tpl.name),
                React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)', marginTop: 2 } }, tpl.id),
                tpl.description && React.createElement('div', { style: { fontSize: 13, color: 'var(--text2)', marginTop: 4 } }, tpl.description),
                React.createElement('div', { style: { display: 'flex', gap: 12, marginTop: 6, fontSize: 12, color: 'var(--text3)' } },
                  React.createElement('span', null, `需求: ${tpl.req_count}`),
                  React.createElement('span', null, `任务: ${tpl.task_count}`),
                  React.createElement('span', { style: badgeStyle(tpl.vector_db === 'milvus' ? 'purple' : 'green') }, tpl.vector_db),
                )
              ),
              React.createElement('button', {
                style: btnStyle('accent'),
                onClick: () => { setModal('clone'); setForm({ template_id: tpl.id, template_name: tpl.name, vector_db: tpl.vector_db, clone_requirements: true, clone_knowledge: true, clone_rules: true, clone_tasks: false }); }
              }, '从此模板克隆')
            )
          ))
        )
    ),

    // 业务线
    tab === 'businesses' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', { style: btnStyle('accent'), onClick: () => { setModal('business'); setForm({}); } }, '+ 新建业务线')
      ),
      React.createElement('div', { style: { display: 'grid', gap: 8 } },
        businesses.map(b => React.createElement('div', { key: b.id, style: { ...cardStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)' } }, b.name),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)' } }, `${b.project_count || 0} 个项目`),
          ),
          React.createElement('button', {
            style: { ...btnStyle('danger'), fontSize: 12 },
            onClick: () => { if (confirm(`删除业务线 ${b.name}？`)) api(`/api/businesses/${b.id}`, 'DELETE'); }
          }, '删除')
        ))
      )
    ),

    // 用户管理
    tab === 'users' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', { style: btnStyle('accent'), onClick: () => { setModal('user'); setForm({ role: 'developer' }); } }, '+ 新建用户')
      ),
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
        React.createElement('thead', null,
          React.createElement('tr', null, ['用户名', '邮箱', '角色', '状态', '操作'].map(h =>
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
                onClick: () => { if (confirm(`删除用户 ${u.username}？`)) api(`/api/auth/users/${u.id}`, 'DELETE'); }
              }, '删除')
            )
          ))
        )
      )
    ),

    // 租户管理 (saas only)
    tab === 'tenants' && React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 } },
        React.createElement('button', { style: btnStyle('accent'), onClick: () => { setModal('tenant'); setForm({ plan: 'free' }); } }, '+ 新建租户')
      ),
      React.createElement('div', { style: { display: 'grid', gap: 8 } },
        tenants.map(t => React.createElement('div', { key: t.id, style: { ...cardStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, color: 'var(--text)' } }, t.name),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--text3)' } }, `slug: ${t.slug}`),
          ),
          React.createElement('div', { style: { display: 'flex', gap: 6 } },
            React.createElement('span', { style: badgeStyle('blue') }, t.plan),
            React.createElement('span', { style: badgeStyle(t.status === 'active' ? 'green' : 'gray') }, t.status),
            React.createElement('button', {
              style: { ...btnStyle('danger'), fontSize: 12 },
              onClick: () => { if (confirm(`删除租户 ${t.name}？`)) api(`/api/tenants/${t.id}`, 'DELETE'); }
            }, '删除')
          )
        ))
      )
    ),

    // 模态框
    modal && React.createElement('div', {
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      onClick: e => { if (e.target === e.currentTarget) setModal(null); }
    },
      React.createElement('div', { style: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, minWidth: 380, maxWidth: 520 } },
        React.createElement('h3', { style: { color: 'var(--text)', marginBottom: 20, fontSize: 16 } }, {
          project: '新建项目', business: '新建业务线', user: '新建用户',
          tenant: '新建租户', members: '项目成员管理'
        }[modal]),

        modal === 'project' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field('项目名称', 'name', form, setForm, 'text', true),
          field('描述', 'description', form, setForm),
          field('本地路径', 'project_path', form, setForm, 'text', false, '可选，单项目模式下的项目根路径'),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, '向量数据库'),
            React.createElement('select', {
              style: inputStyle(),
              value: form.vector_db || 'lance',
              onChange: e => setForm(p => ({ ...p, vector_db: e.target.value }))
            },
              React.createElement('option', { value: 'lance' }, 'LanceDB（本地）'),
              React.createElement('option', { value: 'milvus' }, 'Milvus（分布式）'),
            )
          ),
          form.vector_db === 'milvus' && field('Milvus URI', 'milvus_uri', form, setForm, 'text', false, 'http://localhost:19530'),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, '取消'),
            React.createElement('button', {
              style: btnStyle('accent'), disabled: saving,
              onClick: () => {
                const body = { ...form };
                if (body.milvus_uri) { body.vector_db_config = { uri: body.milvus_uri }; delete body.milvus_uri; }
                api('/api/projects', 'POST', body);
              }
            }, saving ? '保存中...' : '创建')
          )
        ),

        modal === 'business' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field('业务线名称', 'name', form, setForm, 'text', true),
          field('描述', 'description', form, setForm),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, '取消'),
            React.createElement('button', { style: btnStyle('accent'), disabled: saving, onClick: () => api('/api/businesses', 'POST', form) }, saving ? '保存中...' : '创建')
          )
        ),

        modal === 'user' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field('用户名', 'username', form, setForm, 'text', true),
          field('密码', 'password', form, setForm, 'password', true),
          field('邮箱', 'email', form, setForm, 'email'),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, '角色'),
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
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, '取消'),
            React.createElement('button', { style: btnStyle('accent'), disabled: saving, onClick: () => api('/api/auth/users', 'POST', form) }, saving ? '保存中...' : '创建')
          )
        ),

        modal === 'tenant' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          field('租户名称', 'name', form, setForm, 'text', true),
          field('Slug（唯一标识）', 'slug', form, setForm, 'text', true),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, '套餐'),
            React.createElement('select', {
              style: inputStyle(), value: form.plan || 'free',
              onChange: e => setForm(p => ({ ...p, plan: e.target.value }))
            },
              ['free', 'pro', 'enterprise'].map(p => React.createElement('option', { key: p, value: p }, p))
            )
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, '取消'),
            React.createElement('button', { style: btnStyle('accent'), disabled: saving, onClick: () => api('/api/tenants', 'POST', form) }, saving ? '保存中...' : '创建')
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
                    onClick: () => api(`/api/projects/${form.project_id}/members/${m.user_id}`, 'DELETE')
                  }, '移除')
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
              React.createElement('option', { value: '' }, '选择用户...'),
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
              onClick: () => api(`/api/projects/${form.project_id}/members`, 'POST', { user_id: form.add_user, role: form.add_role || 'developer' })
            }, '添加')
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 16 } },
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, '关闭')
          )
        ),

        modal === 'clone' && React.createElement('div', { style: { display: 'grid', gap: 12 } },
          React.createElement('div', { style: { fontSize: 13, color: 'var(--text3)', marginBottom: 4 } },
            `从模板「${form.template_name}」克隆新项目`),
          field('新项目名称', 'name', form, setForm, 'text', true),
          field('描述', 'description', form, setForm),
          field('本地路径（可选）', 'project_path', form, setForm),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle() }, '克隆内容'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
              [
                ['clone_requirements', '需求列表（状态重置为 pending）'],
                ['clone_tasks', '任务模板（状态重置为 pending）'],
                ['clone_knowledge', '知识库（向量数据）'],
                ['clone_rules', '规则库'],
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
            React.createElement('button', { style: btnStyle('muted'), onClick: () => setModal(null) }, '取消'),
            React.createElement('button', {
              style: btnStyle('accent'), disabled: saving || !form.name,
              onClick: () => api(`/api/projects/${form.template_id}/clone`, 'POST', {
                name: form.name, description: form.description || '',
                project_path: form.project_path || '',
                clone_requirements: !!form.clone_requirements,
                clone_tasks: !!form.clone_tasks,
                clone_knowledge: !!form.clone_knowledge,
                clone_rules: !!form.clone_rules,
              })
            }, saving ? '克隆中...' : '开始克隆')
          )
        )
      )
    )
  );
};

function field(label, key, form, setForm, type = 'text', required = false, placeholder = '') {
  return React.createElement('div', { key },
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
