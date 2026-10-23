import type { DeliveryCommandAck } from "./delivery";
import { selectedPlanItems } from "./deliveryTaskPlan";
import type { PlanPrincipal, RetainedTaskPlanDraft, TaskPlanOriginal } from "./taskPlanRetention";
export const planPrincipal: PlanPrincipal = { tenant_id: "tenant", user_id: "person", business_code: "business", project_id: "P", requirement_id: "R" };
export function planDraft(): RetainedTaskPlanDraft {
  return { version: 7, revision: 3, basis: "a".repeat(64), requirement: { id: "R", title: "Requirement", description: "Pinned scope",
    acceptance_criteria: ["Criterion"], priority: "P1", owner_id: "user:lead" },
    rows: [{ key: "draft-one", selected: true, title: "Implement", description: "Task scope", owner_id: "user:lead", priority: "P1", estimate: "M",
      acceptance_criteria: ["Verified behavior"], requirement_criteria_indices: [0], depends_on: [], starts_on: null, ends_on: null, blocked_reason: "" }],
    generator: "manual", mode: "fullstack", max_items: 8, preview: null, preview_request: null, source_reference: null };
}
export function planOriginal(draft = planDraft()): TaskPlanOriginal {
  return { action: "tasks.plan", payload: { requirement_id: "R", requirement_revision: draft.revision, requirement_basis: draft.basis,
    ...(draft.preview ? { preview_id: draft.preview.id } : {}), items: selectedPlanItems(draft.rows) },
    intent: { version: draft.version, key: "original-request-key" }, ...(draft.source_reference ? { source_reference: draft.source_reference } : {}) };
}
export const planAck: DeliveryCommandAck = { project_id: "P", action: "tasks.plan", resource: { kind: "task", id: "T-created" },
  result: { task_ids: ["T-created"] }, affected_refs: [{ kind: "task", id: "T-created" }], applied_version: 8, version: 8, query_generation: 4, replayed: true };
export function planStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}
