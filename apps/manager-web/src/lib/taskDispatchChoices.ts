import { executionTargetProblems, type DeliveryTargets, type ExecutionTarget, type ExecutionProvider } from "./deliveryExecution";
import type { DeliveryTaskData } from "./delivery";
import type { TeamRuntimeBindings } from "./deliveryTeamRuntime";
import type { WorkOrderCurrent } from "./externalWorkOrders";
import type { FeedbackReference } from "./deliveryFeedbackReference";
import type { SubmissionDetail } from "./deliveryTaskSubmission";

export type DispatchMode = "agent" | "command" | "external";
export type TaskDispatchFacts = { reference?: FeedbackReference; data: DeliveryTaskData; targets?: DeliveryTargets; bindings?: TeamRuntimeBindings; external?: WorkOrderCurrent; feedback?: SubmissionDetail; failures: string[] };
export type DispatchChoice = { key: string; mode: DispatchMode; member: string; label: "member" | "direct" | "command" | "external_empty";
  title: string; tool: string; workspace: string; profile: string; version?: number; targetCount?: number; available: boolean; reasons: { code: string; message: string }[] };
export const dispatchChoiceKey = (mode: DispatchMode, member: string) => JSON.stringify([mode, member]);
const reason = (code: string) => ({ code, message: "" });
const unique = (values: DispatchChoice["reasons"]) => values.filter((row, index) => values.findIndex((other) => other.code === row.code && other.message === row.message) === index);
const places = (workspace: NonNullable<TaskDispatchFacts["targets"]>["workspaces"][number]) => [workspace.local, ...workspace.devices];
const eligible = (target: ExecutionTarget, mode: "agent" | "command", provider?: ExecutionProvider["id"]) => target.can_execute && !executionTargetProblems(target, mode, provider).length;

/** Presentation of real capability facts; formal preview remains authoritative. */
export function dispatchChoices(facts: TaskDispatchFacts): DispatchChoice[] {
  const { data, targets, bindings, external } = facts;
  const common: DispatchChoice["reasons"] = [];
  if (!data.permissions.write) common.push(reason("dispatch_write_required"));
  if (!data.task.execution_gate.eligible) common.push(...(data.task.execution_gate.reasons.length ? data.task.execution_gate.reasons : [reason("dispatch_task_blocked")]));
  if (!external) common.push(reason("dispatch_external_unreadable"));
  else if (external.active_work_order_id) common.push(reason("dispatch_active_order"));
  if (!targets) common.push(reason("dispatch_runtime_unreadable"));
  else if (!targets.runtime_configured) common.push(reason("runtime_not_configured"));
  else if (!targets.can_execute) common.push(reason("dispatch_runtime_unavailable"));
  const make = (mode: DispatchMode, member: string, label: DispatchChoice["label"], values: Partial<DispatchChoice>, reasons: DispatchChoice["reasons"]): DispatchChoice => ({
    key: dispatchChoiceKey(mode, member), mode, member, label, title: "", tool: "", workspace: "", profile: "", ...values, reasons: unique(reasons), available: reasons.length === 0,
  });
  const options: DispatchChoice[] = [];
  for (const row of bindings?.members || []) {
    if (!row.binding && row.member_kind !== "agent" && row.member_kind !== "tool") continue;
    const reasons = [...common], binding = row.binding;
    if (row.status !== "current" || !binding) reasons.push(...(row.reasons?.length ? row.reasons : [reason("executor_unbound")]));
    const workspace = targets?.workspaces.find((item) => item.id === binding?.workspace_id);
    const agent = workspace?.agents.find((item) => item.id === binding?.agent_id && item.version === binding?.agent_version);
    const availableTargets = workspace && agent ? places(workspace).filter((target) => eligible(target, "agent", agent.provider)) : [];
    if (binding && (!workspace || !agent)) reasons.push(reason("dispatch_profile_changed"));
    if (workspace && agent && !availableTargets.length) reasons.push(...places(workspace).flatMap((target) => executionTargetProblems(target, "agent", agent.provider).map(reason)), reason("dispatch_no_targets"));
    options.push(make("agent", row.member_id, "member", { title: row.member_name || row.member_id, workspace: workspace?.name || "", profile: agent?.title || "", tool: agent?.provider || "", version: binding?.agent_version, targetCount: availableTargets.length }, reasons));
  }
  const externalReasons = !external ? [reason("dispatch_external_unreadable")] : external.can_dispatch ? [] : external.reasons.length ? external.reasons : [reason("dispatch_external_unavailable")];
  for (const member of external?.executors || []) {
    const reasons = [...externalReasons];
    if (!data.permissions.write) reasons.push(reason("dispatch_write_required"));
    if (!member.active || !member.available) reasons.push(...(member.reasons?.length ? member.reasons : [reason("dispatch_member_unavailable")]));
    options.push(make("external", member.id, "member", { title: member.name, tool: member.tool }, reasons));
  }
  if (!external?.executors.length) options.push(make("external", "", "external_empty", {}, [...externalReasons, reason("dispatch_no_external_members")]));
  for (const mode of ["agent", "command"] as const) {
    const count = (targets?.workspaces || []).reduce((total, workspace) => total + places(workspace).filter((target) => mode === "command" ? eligible(target, mode) : workspace.agents.some((agent) => eligible(target, mode, agent.provider))).length, 0);
    options.push(make(mode, "", mode === "command" ? "command" : "direct", { targetCount: count }, [...common, ...(count ? [] : [reason("dispatch_no_targets")])]));
  }
  return options.sort((a, b) => Number(b.available) - Number(a.available));
}
