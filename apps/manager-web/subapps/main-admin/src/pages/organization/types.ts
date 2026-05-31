export type OrgTab = "users" | "businesses" | "projectMembers" | "rolePolicy" | "accessReview";

export type UserRow = {
  id: string;
  username: string;
  email?: string;
  role?: string;
  status?: string;
};

export type BusinessRow = {
  id: string;
  name: string;
  description?: string;
  tenant_code?: string;
  business_code?: string;
  project_count?: number;
};

export type ProjectRow = {
  id: string;
  name: string;
  status?: string;
  business_id?: string;
  business_name?: string;
};

export type ProjectMemberRow = {
  user_id: string;
  username: string;
  email?: string;
  role: string;
};

export type OrganizationPolicy = {
  ok: boolean;
  configurable?: boolean;
  version?: number;
  notes?: string;
  updated_at?: string;
  updated_by?: string;
  user_capability_map?: Record<string, string[]>;
  project_capability_map?: Record<string, string[]>;
  abac_policy?: {
    field_security_rules?: Array<Record<string, any>>;
    row_filter_rules?: Array<Record<string, any>>;
  };
  tenant_scope: Record<string, string>;
  user_roles: Array<{ role: string; level: number; scope: string; capabilities: string[]; assignable: boolean }>;
  project_member_roles: Array<{ role: string; level: number; scope: string; capabilities: string[]; assignable: boolean }>;
  governance_controls: Array<{ id: string; title: string; status: string; description: string; next: string }>;
  ai_surfaces: Array<{ id: string; title: string; capability: string; path: string; description: string }>;
};

export type OrganizationPolicyCheckResult = {
  ok: boolean;
  allowed: boolean;
  decision: "allow" | "deny";
  scope: string;
  role: string;
  capability: string;
  matched_capabilities: string[];
  reason?: string;
  resource?: string;
  action?: string;
  row_decision?: { allowed: boolean; decision: "allow" | "deny"; matched_rules: string[] };
  field_decisions?: Record<string, { decision: string; matched_rules: string[] }>;
  masked_row?: Record<string, unknown>;
  denied_fields?: string[];
};

export type OrganizationPolicyHistoryItem = {
  id: string;
  action: string;
  created_at: string;
  updated_by?: string;
  notes?: string;
  user_roles?: number;
  project_roles?: number;
  decision?: string;
  resource?: string;
  capability?: string;
  field_rules?: number;
  row_rules?: number;
};

export type OrganizationAccessFinding = {
  id: string;
  kind: string;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  project_id?: string;
  project_name?: string;
  owner?: string;
  command?: string;
};

export type OrganizationAccessReview = {
  ok: boolean;
  score: number;
  grade: string;
  summary: {
    users: number;
    active_users: number;
    tenant_admins: number;
    projects: number;
    project_members: number;
    findings: number;
    by_severity: Record<string, number>;
  };
  findings: OrganizationAccessFinding[];
  recommendations: string[];
};
