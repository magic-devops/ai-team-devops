import type { LucideIcon } from "lucide-react";

export type Project = {
  id: string;
  name: string;
  description?: string;
  business_id?: string;
  business_name?: string;
  project_path?: string;
  vector_db?: string;
  status?: string;
  is_template?: boolean;
  template_id?: string;
  created_at?: string;
  updated_at?: string;
  counts?: Record<string, number>;
};

export type TabKey = "portfolio" | "business" | "tenants" | "users" | "members" | "onboarding" | "governance" | "templates";

export type ProjectDraft = {
  name: string;
  description: string;
  business_id: string;
  project_path: string;
  vector_db: string;
  status: string;
};

export type ProjectTab = {
  key: TabKey;
  icon: LucideIcon;
};

export const defaultDraft: ProjectDraft = {
  name: "",
  description: "",
  business_id: "",
  project_path: "",
  vector_db: "lance",
  status: "active",
};
