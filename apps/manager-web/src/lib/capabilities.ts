import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { getProjectId, getToken } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";

export type CapabilityAction = "read" | "write" | "admin";

export type CapabilitySubmoduleAction = {
  id: CapabilityAction;
  name?: string;
  capability: string;
  roles?: string[];
};

export type CapabilitySubmodule = {
  id?: string;
  name?: string;
  capability: string;
  actions?: CapabilitySubmoduleAction[];
};

export type CapabilityGrant = {
  permission_scope?: "global" | "project";
  project_id?: string | null;
  id?: string;
  name?: string;
  domain?: string;
  domain_name?: string;
  path?: string;
  capability: string;
  parent_capability?: string;
  action_id?: CapabilityAction;
  source?: "module" | "submodule" | "action";
  permission?: Partial<Record<CapabilityAction, string[]>>;
  allowed?: Partial<Record<CapabilityAction, boolean>>;
  visible?: boolean;
  actions?: CapabilitySubmoduleAction[];
  submodules?: CapabilitySubmodule[];
  submodule_count?: number;
  action_count?: number;
  ai?: {
    enabled?: boolean;
    entry?: string;
    surfaces?: string[];
    prompt_context?: Record<string, unknown>;
  };
};

export function capabilityAllowed(
  grant: CapabilityGrant | undefined,
  action: CapabilityAction,
  role = "",
): boolean {
  if (!grant) return false;
  if (typeof grant.allowed?.[action] === "boolean")
    return Boolean(grant.allowed[action]);
  if (grant.permission_scope === "project") return false;
  if (grant.source === "action")
    return Object.values(grant.allowed ?? {}).some(Boolean);
  return (grant.permission?.[action] ?? []).includes(role);
}

/** A missing or failed capability lookup is not evidence of a read-only role. */
export function capabilityReadOnly(
  grant: CapabilityGrant | undefined,
  status: "pending" | "error" | "success",
  role = "",
): boolean {
  if (status !== "success" || !grant) return false;
  if (typeof grant.allowed?.write === "boolean") return !grant.allowed.write;
  if (grant.permission_scope === "project") return false;
  if (Array.isArray(grant.permission?.write))
    return !grant.permission.write.includes(role);
  return false;
}

function actionGrantAllowed(
  action: CapabilitySubmoduleAction,
  role: string,
  parent: CapabilityGrant,
): Partial<Record<CapabilityAction, boolean>> {
  const allowed = parent.allowed?.[action.id];
  return { [action.id]: typeof allowed === "boolean" ? allowed : parent.permission_scope === "project" ? false : (action.roles ?? []).includes(role) };
}

function actionGrantPermission(
  action: CapabilitySubmoduleAction,
): Partial<Record<CapabilityAction, string[]>> {
  return { [action.id]: action.roles ?? [] };
}

export function flattenCapabilityGrants(
  items: CapabilityGrant[],
  role: string,
  projectId = "",
): CapabilityGrant[] {
  const grants: CapabilityGrant[] = [];
  for (const item of items) {
    if (item.permission_scope === "project" && (!projectId || item.project_id !== projectId)) continue;
    grants.push({ ...item, source: item.source ?? "module" });
    for (const action of item.actions ?? []) {
      grants.push({
        id: `${item.id ?? item.capability}.${action.id}`,
        name: action.name,
        domain: item.domain,
        domain_name: item.domain_name,
        path: item.path,
        capability: action.capability,
        parent_capability: item.capability,
        action_id: action.id,
        permission: actionGrantPermission(action),
        allowed: actionGrantAllowed(action, role, item),
        permission_scope: item.permission_scope,
        project_id: item.project_id,
        visible: item.visible,
        source: "action",
      });
    }
    for (const submodule of item.submodules ?? []) {
      grants.push({
        id: `${item.id ?? item.capability}.${submodule.id ?? submodule.capability}`,
        name: submodule.name,
        domain: item.domain,
        domain_name: item.domain_name,
        path: item.path,
        capability: submodule.capability,
        parent_capability: item.capability,
        permission: item.permission,
        allowed: item.allowed,
        permission_scope: item.permission_scope,
        project_id: item.project_id,
        visible: item.visible,
        source: "submodule",
      });
      for (const action of submodule.actions ?? []) {
        grants.push({
          id: `${item.id ?? item.capability}.${submodule.id ?? submodule.capability}.${action.id}`,
          name: action.name,
          domain: item.domain,
          domain_name: item.domain_name,
          path: item.path,
          capability: action.capability,
          parent_capability: submodule.capability,
          action_id: action.id,
          permission: actionGrantPermission(action),
          allowed: actionGrantAllowed(action, role, item),
          permission_scope: item.permission_scope,
          project_id: item.project_id,
          visible: item.visible,
          source: "action",
        });
      }
    }
  }
  return grants;
}

export function useCapabilities() {
  const authed = Boolean(getToken());
  const projectId = getProjectId() || "", session = projectSessionKey();
  const query = useQuery({
    queryKey: ["systemPagesCapabilitiesMe", projectId, session],
    queryFn: api.systemPagesCapabilitiesMe,
    enabled: authed,
    retry: false,
  });
  const data = authed && !query.error && query.status === "success" ? query.data : undefined;
  const rawItems = ((data?.items ?? []) as CapabilityGrant[]).filter((item) => item.permission_scope !== "project" || !!projectId && item.project_id === projectId);
  const role = String(data?.role || "");
  const items = flattenCapabilityGrants(rawItems, role, projectId);
  const get = (capability: string) =>
    items.find((item) => item.capability === capability);
  const can = (capability: string, action: CapabilityAction = "read") =>
    capabilityAllowed(get(capability), action, role);
  return {
    ...query,
    data,
    role,
    rawItems,
    items,
    visibleItems: flattenCapabilityGrants(
      (data?.visible_items ??
        rawItems.filter((item) => item.visible !== false)) as CapabilityGrant[],
      role,
      projectId,
    ),
    summary: data?.summary ?? {},
    get,
    can,
  };
}
