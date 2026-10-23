import { request } from "./http";
import { prepareDeliveryIntent, type DeliveryIntent } from "./delivery";
import type { ExecutionDraftSession } from "./deliveryExecution";

export type RuntimeBinding = {
  workspace_id: string; agent_id: string; agent_version: number; profile_digest: string;
  source: { workspace_name: string; agent_title: string; provider: string };
  bound_by: string; bound_at: string;
};
export type ExecutorSnapshot = {
  member_id: string; member_name: string; binding_basis: string; binding_generation: number;
  workspace_id: string; workspace_name: string; agent_id: string; agent_version: number;
  agent_title: string; profile_digest: string; provider: string; recorded_at: string; recorded_by: string;
};
export type MemberRuntimeState = {
  member_id: string; member_name: string | null; member_kind: "agent" | "tool" | null;
  binding_basis: string; generation: number; binding: RuntimeBinding | null;
  status: "unbound" | "current" | "stale" | "unavailable";
  reasons: { code: string; message: string }[];
  permissions: { can_bind: boolean; can_unbind: boolean };
};
export type TeamRuntimeBindings = {
  project_id: string; version: number; as_of: string; runtime_configured: boolean;
  workspaces: { id: string; name: string; agents: { id: string; version: number; title: string; provider: string }[] }[];
  members: MemberRuntimeState[];
};
export function fetchTeamRuntimeBindings(projectId: string, signal?: AbortSignal) {
  if (!projectId || projectId !== projectId.trim()) throw new Error("Explicit project required");
  return request<TeamRuntimeBindings>("/api/v1/delivery/team-runtime-bindings", { headers: { "X-Project-Id": projectId }, signal });
}
export type RuntimeBindingDraft = {
  projectId: string; memberId: string; operation: "bind" | "unbind"; intent: DeliveryIntent;
  workspaceId: string; agentId: string; agentVersion: number;
};
export function openRuntimeBindingDraft(data: TeamRuntimeBindings, memberId: string, operation: RuntimeBindingDraft["operation"], key: string): RuntimeBindingDraft {
  const member = data.members.find((row) => row.member_id === memberId);
  if (!member || !member.permissions[operation === "bind" ? "can_bind" : "can_unbind"]) throw new Error("bindingPermission");
  return { projectId: data.project_id, memberId, operation, intent: { version: data.version, key }, workspaceId: member.binding?.workspace_id || "", agentId: member.binding?.agent_id || "", agentVersion: member.binding?.agent_version || 0 };
}
export function changeBindingWorkspace(draft: RuntimeBindingDraft, workspaceId: string): RuntimeBindingDraft {
  return { ...draft, workspaceId, agentId: "", agentVersion: 0 };
}
export function prepareRuntimeBinding(draft: RuntimeBindingDraft, data: TeamRuntimeBindings) {
  if (data.project_id !== draft.projectId) throw new Error("scopeChanged");
  const member = data.members.find((row) => row.member_id === draft.memberId);
  if (!member?.permissions[draft.operation === "bind" ? "can_bind" : "can_unbind"]) throw new Error("bindingPermission");
  if (draft.operation === "bind" && !data.workspaces.some((workspace) => workspace.id === draft.workspaceId && workspace.agents.some((agent) => agent.id === draft.agentId && agent.version === draft.agentVersion))) throw new Error("chooseCurrentProfile");
  const action = draft.operation === "bind" ? "member.runtime.bind" as const : "member.runtime.unbind" as const;
  const payload = draft.operation === "bind" ? { member_id: draft.memberId, workspace_id: draft.workspaceId, agent_id: draft.agentId, agent_version: draft.agentVersion } : { member_id: draft.memberId };
  const intent = prepareDeliveryIntent(draft.intent, action, payload);
  return { action, payload, key: intent.key, version: intent.version, draft: { ...draft, intent } };
}
export function adoptRuntimeBindingDraft(draft: RuntimeBindingDraft, latest: TeamRuntimeBindings, key: string): RuntimeBindingDraft {
  if (draft.projectId !== latest.project_id) throw new Error("scopeChanged");
  openRuntimeBindingDraft(latest, draft.memberId, draft.operation, key);
  return { ...draft, intent: { version: latest.version, key } };
}
export function selectExecutionMember(draft: ExecutionDraftSession, member: MemberRuntimeState): ExecutionDraftSession {
  if (member.status !== "current" || !member.binding || !member.binding_basis) throw new Error("executorUnavailable");
  return { ...draft, mode: "agent", executorMemberId: member.member_id, executorBindingBasis: member.binding_basis, workspaceId: member.binding.workspace_id, agentId: member.binding.agent_id, agentVersion: member.binding.agent_version, target: null, preview: null };
}
export function useDirectExecution(draft: ExecutionDraftSession): ExecutionDraftSession {
  return { ...draft, executorMemberId: "", executorBindingBasis: "", preview: null };
}
