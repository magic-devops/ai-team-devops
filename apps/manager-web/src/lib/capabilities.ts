import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { getToken } from "./authStorage";

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

export function capabilityAllowed(grant: CapabilityGrant | undefined, action: CapabilityAction, role = ""): boolean {
  if (!grant) return false;
  if (typeof grant.allowed?.[action] === "boolean") return Boolean(grant.allowed[action]);
  if (grant.source === "action") return Object.values(grant.allowed ?? {}).some(Boolean);
  return (grant.permission?.[action] ?? []).includes(role);
}

function actionGrantAllowed(action: CapabilitySubmoduleAction, role: string): Partial<Record<CapabilityAction, boolean>> {
  return { [action.id]: (action.roles ?? []).includes(role) };
}

function actionGrantPermission(action: CapabilitySubmoduleAction): Partial<Record<CapabilityAction, string[]>> {
  return { [action.id]: action.roles ?? [] };
}

export function flattenCapabilityGrants(items: CapabilityGrant[], role: string): CapabilityGrant[] {
  const grants: CapabilityGrant[] = [];
  for (const item of items) {
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
        allowed: actionGrantAllowed(action, role),
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
          allowed: actionGrantAllowed(action, role),
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
  const query = useQuery({
    queryKey: ["systemPagesCapabilitiesMe"],
    queryFn: api.systemPagesCapabilitiesMe,
    enabled: authed,
    retry: false,
  });
  const rawItems = (query.data?.items ?? []) as CapabilityGrant[];
  const role = String(query.data?.role || "");
  const items = flattenCapabilityGrants(rawItems, role);
  const get = (capability: string) => items.find((item) => item.capability === capability);
  const can = (capability: string, action: CapabilityAction = "read") => capabilityAllowed(get(capability), action, role);
  return {
    ...query,
    role,
    rawItems,
    items,
    visibleItems: flattenCapabilityGrants((query.data?.visible_items ?? rawItems.filter((item) => item.visible !== false)) as CapabilityGrant[], role),
    summary: query.data?.summary ?? {},
    get,
    can,
  };
}
