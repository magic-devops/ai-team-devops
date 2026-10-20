import { getProjectId } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { assertDeliveryGeneration, fetchDeliveryContext, fetchDeliveryReferences, type DeliveryContext } from "./deliveryQuery";
import { fetchTeamRuntimeBindings } from "./deliveryTeamRuntime";
import { fetchExecutionRuntime } from "./executionRuntime";
import { safeExecutionReturn } from "./executionCommands";
import { validExecutionHandoff, type ExecutionHandoff } from "./executionHandoff";

export const agentRunsTabs = ["runs", "heartbeat", "profiles", "retry"] as const;
export type AgentRunsTab = typeof agentRunsTabs[number];
export const agentRunStatuses = ["pending_dispatch", "planned", "queued", "running", "retrying", "interrupted", "failed", "cancelled", "awaiting_review", "accepted", "changes_requested", "unknown"] as const;
export const agentActiveStatuses = ["planned", "queued", "running", "retrying", "interrupted"];
export type AgentRunsRoute = { projectId: string; tab: AgentRunsTab; q: string; status: string; cursor: string; inspect: string };
// The bounded reference projection intentionally does not contain agent/member snapshots.
export type CanonicalAgentExecution = {
  id: string; task_id: string; workspace_id: string; status: string; run_id: string;
  run_version: number | null; progress: number | null; created_at: string; stale: boolean;
  issue_id?: string | null; attempt?: number | null;
  handoff_id?: string | null; handoff?: ExecutionHandoff;
};
const clean = (value: string | null, max: number) => value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : "";
const identity = (value: unknown): value is string => typeof value === "string" && Boolean(value) && value.length <= 128 && !/[\s\u0000-\u001f\u007f]/.test(value);
export function parseAgentRunsRoute(hash: string, fallback: AgentRunsTab = "runs"): AgentRunsRoute {
  const [path, query] = hash.split("?");
  const candidate = path.replace("#/ai/agent-ops/", "");
  const params = new URLSearchParams(query);
  return {
    projectId: clean(params.get("project_id"), 128),
    tab: agentRunsTabs.includes(candidate as AgentRunsTab) ? candidate as AgentRunsTab : fallback,
    q: clean(params.get("q"), 200),
    status: agentRunStatuses.includes(params.get("status") as typeof agentRunStatuses[number]) ? params.get("status")! : "",
    cursor: clean(params.get("cursor"), 4000),
    inspect: identity(params.get("inspect")) ? params.get("inspect")! : "",
  };
}
export function agentRunsHash(route: AgentRunsRoute) {
  const params = new URLSearchParams();
  if (route.projectId) params.set("project_id", route.projectId);
  if (route.q) params.set("q", route.q);
  if (route.status) params.set("status", route.status);
  if (route.cursor) params.set("cursor", route.cursor);
  if (route.inspect) params.set("inspect", route.inspect);
  return `#/ai/agent-ops/${route.tab}${params.size ? `?${params}` : ""}`;
}
export function changeAgentRunsRoute(route: AgentRunsRoute, patch: Partial<AgentRunsRoute>): AgentRunsRoute {
  const changedFilter = ["tab", "q", "status", "projectId"].some((key) => key in patch && patch[key as keyof AgentRunsRoute] !== route[key as keyof AgentRunsRoute]);
  return { ...route, ...(changedFilter ? { cursor: "", inspect: "" } : {}), ...patch };
}
function requireIdentity(value: string) { if (!identity(value)) throw new Error("agentResponseInvalid"); return value; }
function withReturn(params: URLSearchParams, background: string) {
  const safe = safeExecutionReturn(background);
  if (safe) params.set("return_to", safe);
  return params;
}
export function canonicalExecutionHref(projectId: string, execution: { id: string; attempt?: number | null }, background = "") {
  const params = new URLSearchParams({ view: "overview", execution_id: requireIdentity(execution.id), project_id: requireIdentity(projectId) });
  if (Number.isSafeInteger(execution.attempt) && execution.attempt! > 0) params.set("execution_attempt", String(execution.attempt));
  return `#/dev-flow?${withReturn(params, background)}`;
}
export function canonicalTaskHref(projectId: string, taskId: string, background = "") {
  return `#/tasks/execution?${withReturn(new URLSearchParams({ task_id: requireIdentity(taskId), project_id: requireIdentity(projectId) }), background)}`;
}
export function canonicalMemberHref(projectId: string, memberId: string, background = "") {
  return `#/dev-flow?${withReturn(new URLSearchParams({ view: "team", team_view: "members", team_member: requireIdentity(memberId), project_id: requireIdentity(projectId) }), background)}`;
}
export function filterAgentRuns(rows: CanonicalAgentExecution[], route: Pick<AgentRunsRoute, "tab" | "q" | "status">) {
  const query = route.q.toLocaleLowerCase();
  return rows.filter((row) =>
    (route.tab !== "heartbeat" || agentActiveStatuses.includes(row.status)) &&
    (route.tab !== "retry" || row.stale || ["failed", "cancelled", "interrupted", "unknown", "changes_requested"].includes(row.status) ||
      Boolean(row.handoff && ["retry_wait", "blocked"].includes(row.handoff.state))) &&
    (!route.status || row.status === route.status) &&
    (!query || [row.id, row.task_id, row.workspace_id, row.run_id].some((value) => value.toLocaleLowerCase().includes(query))),
  );
}
export function agentAccessFailure(error: unknown) {
  return error instanceof Error && (/^HTTP (?:401|403|404)\b/.test(error.message) || ["scopeChanged", "账号或项目已切换，请在当前工作区重新操作"].includes(error.message));
}
function assertScope(projectId: string, scope: string) {
  if (!identity(projectId) || projectId !== getProjectId() || scope !== projectSessionKey()) throw new Error("scopeChanged");
}
async function inScope<T>(projectId: string, scope: string, read: () => Promise<T>) {
  assertScope(projectId, scope);
  const value = await read();
  assertScope(projectId, scope);
  return value;
}
export async function readAgentContext(projectId: string, scope: string, signal?: AbortSignal) {
  const value = await inScope(projectId, scope, () => fetchDeliveryContext(projectId, signal));
  if (
    !value || value.project_id !== projectId || value.project?.id !== projectId ||
    !value.query_state || !["ready", "rebuild_required"].includes(value.query_state.status) ||
    !value.permissions || typeof value.permissions.write !== "boolean" ||
    !Number.isSafeInteger(value.version) || value.version < 0 ||
    !(value.query_generation === null || positive(value.query_generation)) ||
    value.query_state.status === "ready" && value.query_generation === null
  ) throw new Error("agentResponseInvalid");
  return value;
}
export async function readAgentRuns(projectId: string, scope: string, context: DeliveryContext, cursor: string, signal?: AbortSignal) {
  if (context.project_id !== projectId || context.query_state.status !== "ready") throw new Error("agentResponseInvalid");
  const value = await inScope(projectId, scope, () => fetchDeliveryReferences<CanonicalAgentExecution>(projectId, "execution", { limit: 20, sort: "created_desc", cursor }, signal, context.query_generation));
  if (!value) throw new Error("agentResponseInvalid");
  assertDeliveryGeneration(context, value);
  if (
    !Array.isArray(value.items) || value.items.length > 20 || value.limit !== 20 ||
    !Number.isSafeInteger(value.total) || value.total < value.items.length ||
    !(value.next_cursor === null || typeof value.next_cursor === "string" && Boolean(clean(value.next_cursor, 4000)) && value.next_cursor !== cursor)
  ) throw new Error("agentResponseInvalid");
  const ids = new Set<string>();
  for (const row of value.items) {
    const item = row?.data;
    if (
      !row || row.kind !== "execution" || !item || row.id !== item.id || !identity(item.id) || ids.has(item.id) ||
      !identity(item.task_id) || !identity(item.workspace_id) ||
      typeof item.run_id !== "string" || item.run_id !== "" && !identity(item.run_id) ||
      typeof item.status !== "string" || !item.status || typeof item.created_at !== "string" || typeof item.stale !== "boolean" ||
      !(item.run_version == null || Number.isSafeInteger(item.run_version) && item.run_version >= 0) ||
      !(item.progress == null || Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 100) ||
      !(item.attempt == null || positive(item.attempt)) ||
      !(item.handoff_id == null || identity(item.handoff_id)) ||
      item.handoff !== undefined && (!validExecutionHandoff(projectId, item.id, item.task_id, {
        project_id: projectId, execution_id: item.id, task_id: item.task_id, handoff: item.handoff,
      }) || item.handoff.workspace_id !== item.workspace_id || Boolean(item.handoff_id && item.handoff_id !== item.handoff.id))
    ) throw new Error("agentResponseInvalid");
    ids.add(item.id);
  }
  return { ...value, items: value.items.map((row) => row.data) };
}
export async function readAgentBindings(projectId: string, scope: string, signal?: AbortSignal) {
  const value = await inScope(projectId, scope, () => fetchTeamRuntimeBindings(projectId, signal));
  if (
    !value || value.project_id !== projectId || !Array.isArray(value.members) || !Array.isArray(value.workspaces) ||
    value.members.some((member) =>
      !member || !identity(member.member_id) || !["unbound", "current", "stale", "unavailable"].includes(member.status) ||
      !reasons(member.reasons) || !member.permissions || typeof member.permissions.can_bind !== "boolean" || typeof member.permissions.can_unbind !== "boolean" ||
      !(member.binding === null || member.binding && identity(member.binding.workspace_id) && identity(member.binding.agent_id) &&
        positive(member.binding.agent_version) && member.binding.source &&
        [member.binding.source.agent_title, member.binding.source.workspace_name, member.binding.source.provider].every((item) => typeof item === "string")),
    )
  ) throw new Error("agentResponseInvalid");
  return value;
}
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const reasons = (value: unknown) => Array.isArray(value) && value.every((item) => item && typeof item.code === "string" && typeof item.message === "string");
export async function readAgentRuntime(projectId: string, scope: string, executionId: string, signal?: AbortSignal) {
  requireIdentity(executionId);
  const value = await inScope(projectId, scope, () => fetchExecutionRuntime(projectId, executionId, signal));
  if (
    !value || value.project_id !== projectId || value.execution_id !== executionId ||
    typeof value.run_id !== "string" || value.run_id !== "" && !identity(value.run_id) ||
    !Number.isSafeInteger(value.run_version) || value.run_version < 0 || !positive(value.attempt) ||
    typeof value.status !== "string" || typeof value.stale !== "boolean" || typeof value.observed_at !== "string" ||
    typeof value.recovery_requires_review !== "boolean" || !(value.active_node_id === null || identity(value.active_node_id)) ||
    !Array.isArray(value.nodes) || value.nodes.some((node) =>
      !node || !identity(node.id) || typeof node.title !== "string" || !["agent", "command", "approval"].includes(node.kind) ||
      !["pending", "running", "passed", "failed", "skipped"].includes(node.status) ||
      typeof node.is_test !== "boolean" || typeof node.reused_result !== "boolean" ||
      !Array.isArray(node.available_attempts) || !node.available_attempts.every(positive) ||
      !(node.result_attempt === null || positive(node.result_attempt)),
    ) ||
    !value.controls || ["start", "retry", "cancel", "approval", "approval_reject"].some((action) => {
      const control = value.controls[action as keyof typeof value.controls];
      return !control || typeof control.allowed !== "boolean" || !reasons(control.reasons);
    }) ||
    !(value.stop === null || value.stop &&
      (identity(value.stop.id) || value.stop.id === "" && value.stop.state === "not_started" &&
        value.run_id === "" && value.run_version === 0 && value.status === "cancelled" && value.stop.node_id === null) &&
      ["requested", "confirmed", "unknown", "not_started"].includes(value.stop.state) && positive(value.stop.attempt) &&
      typeof value.stop.reason === "string" && typeof value.stop.evidence === "string" &&
      (value.stop.node_id === null || identity(value.stop.node_id)) &&
      [value.stop.requested_at, value.stop.confirmed_at].every((item) => item === null || typeof item === "string")) ||
    !(value.approval === null || value.approval && identity(value.approval.id) &&
      Number.isSafeInteger(value.approval.version) && value.approval.version >= 0 &&
      identity(value.approval.node_id) && positive(value.approval.attempt) &&
      typeof value.approval.status === "string" && typeof value.approval.title === "string")
  ) throw new Error("agentResponseInvalid");
  return value;
}
