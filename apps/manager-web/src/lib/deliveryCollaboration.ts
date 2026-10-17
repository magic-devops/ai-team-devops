import { request } from "./http";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryCommandAck,
} from "./delivery";
import { getToken, getWorkspaceScope } from "./authStorage";
import { useEffect, useState } from "react";

export type ActivityTarget = {
  kind:
    | "project"
    | "requirement"
    | "task"
    | "execution"
    | "issue"
    | "release_candidate"
    | "deployment";
  id: string | null;
  label: string | null;
  available: boolean;
  reason: string | null;
};
export type FieldChange = { field: string; before: unknown; after: unknown };
export type ActivityItem = {
  id: string;
  at: string;
  action: string;
  actor: { id: string | null; name: string };
  association: "recorded" | "unknown";
  requirement_ids: string[];
  target: ActivityTarget | null;
  related_targets: ActivityTarget[];
  changes: FieldChange[];
};
export type ActivityPage = {
  project_id: string;
  as_of: string;
  scope: "project" | "requirement";
  scope_id: string;
  items: ActivityItem[];
  next_cursor: string | null;
};
export type RequirementDefinition = {
  title: string;
  description: string;
  acceptance_criteria: string[];
};
export type RequirementHistoryItem = {
  id: string;
  number: number;
  basis: string;
  definition: RequirementDefinition & { id: string };
  at: string;
  actor: { id: string | null; name: string };
  source: "delivery_command" | "sql_observed";
  flow_revision: number | null;
};
export type RequirementCurrentLinks = {
  requirement_basis: string;
  task_ids: string[];
  dependent_task_ids: string[];
  execution_ids: string[];
  release_candidate_ids: string[];
  deployment_ids: string[];
  restricted_execution_count: number;
  restricted_deployment_count: number;
};
export type RequirementHistoryPage = {
  project_id: string;
  requirement_id: string;
  current_basis: string | null;
  current_links: RequirementCurrentLinks | null;
  items: RequirementHistoryItem[];
  next_cursor: string | null;
  earlier_history_unknown: boolean;
};
export type RequirementChangePreview = {
  project_id: string;
  requirement_id: string;
  version: number;
  requirement_basis: string;
  preview_basis: string;
  changes: FieldChange[];
  impact: {
    task_ids: string[];
    dependent_task_ids: string[];
    execution_ids: string[];
    release_candidate_ids: string[];
    deployment_ids: string[];
    invalidates_current_acceptance: boolean;
    restricted_execution_count?: number;
    restricted_deployment_count?: number;
  };
  allowed: boolean;
  reasons: { code: string; message: string }[];
};
export type CollaborationRoute = {
  eventId: string;
  versionId: string;
  action: string;
  cursor: string;
  historyCursor: string;
  scopeId: string;
};
const routeKeys: Record<keyof CollaborationRoute, string> = {
  eventId: "event_id",
  versionId: "requirement_version",
  action: "activity_action",
  cursor: "activity_cursor",
  historyCursor: "requirement_history_cursor",
  scopeId: "activity_scope_id",
};
const clean = (value: string | null, max = 2000) =>
  value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "";
export function parseCollaborationRoute(hash: string): CollaborationRoute {
  const params = new URLSearchParams(hash.split("?")[1]);
  return Object.fromEntries(
    Object.entries(routeKeys).map(([key, value]) => [
      key,
      clean(params.get(value)),
    ]),
  ) as CollaborationRoute;
}
export function collaborationHash(
  source: string,
  patch: Partial<CollaborationRoute>,
) {
  const [path, query] = source.split("?");
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch))
    value
      ? params.set(routeKeys[key as keyof CollaborationRoute], value)
      : params.delete(routeKeys[key as keyof CollaborationRoute]);
  return `${path || "#/dev-flow"}${params.size ? `?${params}` : ""}`;
}
export function useCollaborationRoute(onNavigate: (href: string) => void) {
  const [route, setRoute] = useState(() =>
    parseCollaborationRoute(location.hash),
  );
  useEffect(() => {
    const sync = () => setRoute(parseCollaborationRoute(location.hash));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return {
    route,
    change: (patch: Partial<CollaborationRoute>) => {
      const href = collaborationHash(location.hash, patch);
      onNavigate(href);
      setRoute(parseCollaborationRoute(href));
    },
  };
}
export function safeCollaborationReturn(
  hash: string,
  projectId: string,
  depth = 0,
): string | null {
  if (
    !projectId ||
    depth > 2 ||
    hash.length > 6000 ||
    /[\u0000-\u001f\u007f\\]/.test(hash) ||
    !/^#\/(dev-flow|tasks\/execution)(?:\?|$)/.test(hash)
  )
    return null;
  const params = new URLSearchParams(hash.split("?")[1]);
  if (
    params.getAll("project_id").length !== 1 ||
    params.get("project_id") !== projectId
  )
    return null;
  const parent = params.get("collaboration_return");
  if (parent && !safeCollaborationReturn(parent, projectId, depth + 1))
    return null;
  return hash;
}
export function preserveCollaborationRoute(target: string, source: string) {
  const from = new URLSearchParams(source.split("?")[1]),
    to = new URLSearchParams(target.split("?")[1]);
  if (from.get("project_id") !== to.get("project_id")) return target;
  const sameRequirement = from.get("requirement") === to.get("requirement");
  for (const key of [
    "collaboration_return",
    ...(sameRequirement
      ? [
          "activity_action",
          "activity_cursor",
          "activity_scope_id",
          "requirement_version",
          "requirement_history_cursor",
        ]
      : []),
  ])
    if (!to.has(key) && from.has(key)) to.set(key, from.get(key)!);
  return `${target.split("?")[0]}${to.size ? `?${to}` : ""}`;
}
export function collaborationSourceHref(
  target: ActivityTarget,
  projectId: string,
  background: string,
): string | null {
  if (
    !target.available ||
    !target.id ||
    !projectId ||
    /[\u0000-\u001f\u007f]/.test(target.id)
  )
    return null;
  const params = new URLSearchParams({ project_id: projectId });
  switch (target.kind) {
    case "project":
      if (target.id !== projectId) return null;
      params.set("view", "overview");
      break;
    case "requirement":
      params.set("view", "list");
      params.set("requirement", target.id);
      params.set("detail", "details");
      break;
    case "task":
      params.set("view", "timeline");
      params.set("task", target.id);
      break;
    case "execution":
      params.set("view", "overview");
      params.set("execution_id", target.id);
      break;
    case "issue":
      params.set("view", "issues");
      params.set("issue", target.id);
      break;
    case "release_candidate":
      params.set("view", "releases");
      params.set("release_id", target.id);
      break;
    case "deployment":
      params.set("view", "releases");
      params.set("deployment_id", target.id);
      break;
    default:
      return null;
  }
  const safe = safeCollaborationReturn(background, projectId);
  if (safe) params.set("collaboration_return", safe);
  return `#/dev-flow?${params}`;
}
export function collaborationSessionKey() {
  return JSON.stringify([getToken(), getWorkspaceScope()]);
}
function projectHeaders(projectId: string) {
  if (
    !projectId ||
    projectId !== projectId.trim() ||
    /[\u0000-\u001f\u007f]/.test(projectId)
  )
    throw new Error("explicitProject");
  return { "X-Project-Id": projectId };
}
export function fetchDeliveryActivity(
  projectId: string,
  options: {
    requirementId?: string;
    action?: string;
    cursor?: string;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams({
    scope: options.requirementId ? "requirement" : "project",
    limit: "20",
  });
  if (options.requirementId) params.set("scope_id", options.requirementId);
  if (options.action) params.set("action", options.action);
  if (options.cursor) params.set("cursor", options.cursor);
  return request<ActivityPage>(`/api/v1/delivery/activity?${params}`, {
    headers: projectHeaders(projectId),
    signal: options.signal,
  });
}
export function fetchDeliveryActivityItem(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  return request<{ project_id: string; item: ActivityItem }>(
    `/api/v1/delivery/activity/${encodeURIComponent(id)}`,
    { headers: projectHeaders(projectId), signal },
  );
}
export function fetchRequirementHistory(
  projectId: string,
  requirementId: string,
  cursor = "",
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  return request<RequirementHistoryPage>(
    `/api/v1/delivery/requirements/${encodeURIComponent(requirementId)}/history?${params}`,
    { headers: projectHeaders(projectId), signal },
  );
}
export function fetchRequirementHistoryItem(
  projectId: string,
  requirementId: string,
  id: string,
  signal?: AbortSignal,
) {
  return request<{
    project_id: string;
    requirement_id: string;
    item: RequirementHistoryItem;
  }>(
    `/api/v1/delivery/requirements/${encodeURIComponent(requirementId)}/history/${encodeURIComponent(id)}`,
    { headers: projectHeaders(projectId), signal },
  );
}
export function requirementDefinitionChanges(
  before: RequirementDefinition,
  after: RequirementDefinition,
): Partial<RequirementDefinition> {
  return Object.fromEntries(
    (["title", "description", "acceptance_criteria"] as const)
      .filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
      )
      .map((key) => [key, after[key]]),
  );
}
export function previewRequirementChange(
  projectId: string,
  requirementId: string,
  basis: string,
  changes: Partial<RequirementDefinition>,
  signal?: AbortSignal,
) {
  return request<RequirementChangePreview>(
    `/api/v1/delivery/requirements/${encodeURIComponent(requirementId)}/change-preview`,
    {
      method: "POST",
      headers: projectHeaders(projectId),
      body: JSON.stringify({ requirement_basis: basis, changes }),
      signal,
    },
  );
}
export function prepareRequirementChange(
  intent: DeliveryIntent,
  basis: string,
  payload: Record<string, unknown>,
  definitionChanged: boolean,
  previewBasis: string | null,
) {
  if (definitionChanged && !previewBasis) throw new Error("previewRequired");
  const fixed = {
    ...payload,
    requirement_basis: basis,
    ...(definitionChanged ? { change_preview_basis: previewBasis } : {}),
  };
  return {
    intent: prepareDeliveryIntent(intent, "requirement.update", fixed),
    payload: fixed,
  };
}
export function collaborationFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = Number(message.match(/HTTP\s+(\d{3})/)?.[1] || 0);
  return {
    message,
    conflict: status === 409,
    unknown: status === 0 || status >= 500,
  };
}
export function saveRequirementChange(
  projectId: string,
  intent: DeliveryIntent,
  payload: Record<string, unknown>,
) {
  return request<DeliveryCommandAck>("/api/v1/delivery/commands", {
    method: "POST",
    headers: projectHeaders(projectId),
    body: JSON.stringify({
      action: "requirement.update",
      payload,
      expected_version: intent.version,
      idempotency_key: intent.key,
    }),
  });
}
