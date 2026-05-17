export type OrgTab = "users" | "businesses" | "projectMembers" | "rolePolicy";

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
  tenant_scope: Record<string, string>;
  user_roles: Array<{ role: string; level: number; scope: string; capabilities: string[]; assignable: boolean }>;
  project_member_roles: Array<{ role: string; level: number; scope: string; capabilities: string[]; assignable: boolean }>;
  governance_controls: Array<{ id: string; title: string; status: string; description: string; next: string }>;
  ai_surfaces: Array<{ id: string; title: string; capability: string; path: string; description: string }>;
};
