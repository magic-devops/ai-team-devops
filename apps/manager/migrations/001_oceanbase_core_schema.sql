-- Hermes / SOP Manager OceanBase MySQL mode core schema
-- Scope rule: every operational table carries tenant_code, business_code, and
-- project_id when applicable, with composite indexes for scoped reads.

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  plan VARCHAR(32) NOT NULL DEFAULT 'free',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  config JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug),
  UNIQUE KEY uq_tenants_tenant_code (tenant_code)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS businesses (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_scope_code (tenant_code, business_code),
  KEY idx_businesses_tenant_code (tenant_code, business_code),
  KEY idx_businesses_project_id (project_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_id VARCHAR(64) NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL,
  project_code VARCHAR(64) NOT NULL DEFAULT '',
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  project_path VARCHAR(512) NOT NULL DEFAULT '',
  vector_db VARCHAR(32) NOT NULL DEFAULT 'lance',
  vector_db_config JSON NULL,
  is_template TINYINT(1) NOT NULL DEFAULT 0,
  template_id VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_scope_project (tenant_code, business_code, project_id),
  KEY idx_projects_scope_status (tenant_code, business_code, project_id, status),
  KEY idx_projects_template (tenant_code, template_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  username VARCHAR(64) NOT NULL,
  email VARCHAR(128) NOT NULL DEFAULT '',
  password_hash VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'developer',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_username (tenant_code, username),
  KEY idx_users_scope_status (tenant_code, business_code, project_id, status)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS project_members (
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'developer',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (project_id, user_id),
  KEY idx_project_members_scope_role (tenant_code, business_code, project_id, role),
  KEY idx_project_members_user (tenant_code, user_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS requirements (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL,
  title VARCHAR(256) NOT NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  priority VARCHAR(8) NOT NULL DEFAULT 'P1',
  sprint_id VARCHAR(64) NOT NULL DEFAULT '',
  story_points INT NOT NULL DEFAULT 0,
  acceptance_criteria JSON NULL,
  tags JSON NULL,
  human_notes TEXT NULL,
  confidence DOUBLE NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_requirements_scope_status (tenant_code, business_code, project_id, status),
  KEY idx_requirements_scope_priority (tenant_code, business_code, project_id, priority)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL,
  req_id VARCHAR(64) NOT NULL DEFAULT '',
  sprint_id VARCHAR(64) NOT NULL DEFAULT '',
  title VARCHAR(256) NOT NULL,
  description TEXT NULL,
  acceptance_criteria JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  priority VARCHAR(8) NOT NULL DEFAULT 'P1',
  estimate VARCHAR(8) NOT NULL DEFAULT 'M',
  owner_id VARCHAR(100) NOT NULL DEFAULT '',
  actual_hours DOUBLE NOT NULL DEFAULT 0,
  confidence DOUBLE NOT NULL DEFAULT 0,
  human_notes TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_tasks_scope_status (tenant_code, business_code, project_id, status),
  KEY idx_tasks_scope_owner (tenant_code, business_code, project_id, owner_id),
  KEY idx_tasks_scope_sprint (tenant_code, business_code, project_id, sprint_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS issues (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL,
  sprint_id VARCHAR(64) NOT NULL DEFAULT '',
  task_id VARCHAR(64) NOT NULL DEFAULT '',
  title VARCHAR(256) NOT NULL,
  description TEXT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'bug',
  severity VARCHAR(8) NOT NULL DEFAULT 'P2',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  reported_by VARCHAR(64) NOT NULL DEFAULT '',
  resolved_by VARCHAR(64) NOT NULL DEFAULT '',
  resolution TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY idx_issues_scope_status (tenant_code, business_code, project_id, status),
  KEY idx_issues_scope_severity (tenant_code, business_code, project_id, severity),
  KEY idx_issues_scope_task (tenant_code, business_code, project_id, task_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS sprints (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL,
  goal TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  planned_points INT NOT NULL DEFAULT 0,
  velocity DOUBLE NOT NULL DEFAULT 0,
  completion_rate DOUBLE NOT NULL DEFAULT 0,
  retrospective TEXT NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ends_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY idx_sprints_scope_status (tenant_code, business_code, project_id, status),
  KEY idx_sprints_scope_started (tenant_code, business_code, project_id, started_at)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  user_id VARCHAR(64) NOT NULL DEFAULT '',
  username VARCHAR(64) NOT NULL DEFAULT '',
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL DEFAULT '',
  resource_id VARCHAR(64) NOT NULL DEFAULT '',
  method VARCHAR(8) NOT NULL DEFAULT '',
  path VARCHAR(512) NOT NULL DEFAULT '',
  status_code INT NOT NULL DEFAULT 0,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  extra JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_audit_scope_created (tenant_code, business_code, project_id, created_at),
  KEY idx_audit_scope_action (tenant_code, business_code, project_id, action)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS webhook_configs (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  name VARCHAR(128) NOT NULL,
  url VARCHAR(1024) NOT NULL,
  secret VARCHAR(256) NOT NULL DEFAULT '',
  events JSON NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  fail_count INT NOT NULL DEFAULT 0,
  last_fired_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_webhooks_scope_active (tenant_code, business_code, project_id, active),
  KEY idx_webhooks_scope_name (tenant_code, business_code, project_id, name)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS api_keys (
  id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  tenant_code VARCHAR(64) NOT NULL,
  business_code VARCHAR(64) NOT NULL DEFAULT '',
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  user_id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  key_hash VARCHAR(128) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_used_at DATETIME(6) NULL,
  expires_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  KEY idx_api_keys_scope_status (tenant_code, business_code, project_id, status),
  KEY idx_api_keys_user (tenant_code, user_id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
