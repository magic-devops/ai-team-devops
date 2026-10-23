import { getToken, getWorkspaceScope, USER_KEY } from "./authStorage";
import { createDeliveryCommandController, validDeliveryCommandAck, type DeliveryCommandState } from "./deliveryCommandController";
import { selectedPlanItems, taskPlanProblems, type TaskPlanRow, type TaskPlanPreview, type PlanPreviewRequest } from "./deliveryTaskPlan";
import { taskEditIdentity, validTaskEditSource } from "./taskEditCommand";
import type { DiscussionSourceReference } from "./deliveryDiscussions";
import type { DeliveryCommandAck } from "./delivery";

export const PLAN_RETENTION_EVENT = "sop-task-plan-retention";
export const PLAN_RETENTION_LIMIT = 2 * 1024 * 1024;
const PREFIX = "sop.task-plan.v1:";
export type PlanSnapshot = { id: string; title: string; description: string; acceptance_criteria: string[];
  priority: "P0" | "P1" | "P2" | "P3"; owner_id: string };
export type PlanProvenance = Pick<TaskPlanPreview, "id" | "source" | "model" | "provider" | "usage" | "warnings">;
export type RetainedTaskPlanDraft = {
  version: number; revision: number; basis: string; requirement: PlanSnapshot; rows: TaskPlanRow[];
  generator: "manual" | "template" | "ai"; mode: PlanPreviewRequest["mode"]; max_items: number;
  preview: PlanProvenance | null; preview_request: PlanPreviewRequest | null;
  source_reference: DiscussionSourceReference | null;
};
export type TaskPlanOriginal = { action: "tasks.plan"; payload: {
  requirement_id: string; requirement_revision: number; requirement_basis: string; preview_id?: string;
  items: Omit<TaskPlanRow, "selected">[];
}; intent: { version: number; key: string }; source_reference?: DiscussionSourceReference };
export type PlanPrincipal = { tenant_id: string; user_id: string; business_code: string; project_id: string; requirement_id: string };
type RecordValue = { schema: 1; identity: PlanPrincipal; draft: RetainedTaskPlanDraft | null; command: DeliveryCommandState<TaskPlanOriginal> | null };
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, any>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const text = (v: unknown, max: number, required = false): v is string => typeof v === "string" &&
  Array.from(v).length <= max && !/[\ud800-\udfff]/u.test(v) && (!required || !!v.trim());
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const unique = (v: unknown, max: number, valid: (item: any) => boolean): v is any[] =>
  Array.isArray(v) && v.length <= max && v.every(valid) && new Set(v).size === v.length;
const rowKeys = ["key", "title", "description", "owner_id", "priority", "estimate", "acceptance_criteria",
  "requirement_criteria_indices", "depends_on", "starts_on", "ends_on", "blocked_reason"];
function validRow(v: unknown, draft: boolean): v is TaskPlanRow {
  return record(v) && exact(v, [...rowKeys, ...(draft ? ["selected"] : [])]) && taskEditIdentity(v.key) &&
    (!draft || typeof v.selected === "boolean") && text(v.title, 256, !draft) && text(v.description, 10000) && text(v.owner_id, 100) &&
    ["P0", "P1", "P2", "P3"].includes(v.priority) && ["XS", "S", "M", "L", "XL"].includes(v.estimate) &&
    Array.isArray(v.acceptance_criteria) && v.acceptance_criteria.length <= 80 && v.acceptance_criteria.every((s: unknown) => text(s, 2000, !draft)) &&
    unique(v.requirement_criteria_indices, 80, (i) => integer(i)) && unique(v.depends_on, 40, (id) => taskEditIdentity(id)) &&
    [v.starts_on, v.ends_on].every((date) => date === null || text(date, 10)) && text(v.blocked_reason, 2000);
}
export function validTaskPlanOriginal(v: unknown, requirementId: string): v is TaskPlanOriginal {
  if (!record(v) || !exact(v, ["action", "payload", "intent", ...(Object.hasOwn(v, "source_reference") ? ["source_reference"] : [])]) ||
    v.action !== "tasks.plan" || !record(v.payload) || !record(v.intent) || !exact(v.intent, ["version", "key"]) ||
    !integer(v.intent.version) || !taskEditIdentity(v.intent.key, 100) || v.intent.key.length < 8 ||
    (v.source_reference !== undefined && !validTaskEditSource(v.source_reference))) return false;
  const p = v.payload;
  return exact(p, ["requirement_id", "requirement_revision", "requirement_basis", "items", ...(Object.hasOwn(p, "preview_id") ? ["preview_id"] : [])]) &&
    p.requirement_id === requirementId && taskEditIdentity(requirementId) && integer(p.requirement_revision, 1) && hash(p.requirement_basis) &&
    (p.preview_id === undefined || taskEditIdentity(p.preview_id)) && Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 40 &&
    p.items.every((item: unknown) => validRow(item, false)) && new Set(p.items.map((item: any) => item.key)).size === p.items.length;
}
export function validTaskPlanAck(projectId: string, original: TaskPlanOriginal, value: unknown): value is DeliveryCommandAck {
  if (!validDeliveryCommandAck(projectId, original, value, "task") || !record(value?.result)) return false;
  const ids = value.result.task_ids;
  return unique(ids, 40, (id) => taskEditIdentity(id)) && ids.length === original.payload.items.length && ids.length > 0 &&
    value.resource.id === ids[ids.length - 1] && ids.every((id) => value.affected_refs.some((ref) => ref.kind === "task" && ref.id === id));
}
export function validTaskPlanDraft(v: unknown, requirementId: string): v is RetainedTaskPlanDraft {
  if (!record(v) || !exact(v, ["version", "revision", "basis", "requirement", "rows", "generator", "mode", "max_items", "preview", "preview_request", "source_reference"]) ||
    !integer(v.version) || !integer(v.revision, 1) || !hash(v.basis) || !record(v.requirement) ||
    !exact(v.requirement, ["id", "title", "description", "acceptance_criteria", "priority", "owner_id"])) return false;
  const r = v.requirement;
  if (r.id !== requirementId || !taskEditIdentity(requirementId) || !text(r.title, 256, true) || !text(r.description, 20000) || !text(r.owner_id, 100) ||
    !["P0", "P1", "P2", "P3"].includes(r.priority) || !Array.isArray(r.acceptance_criteria) || r.acceptance_criteria.length > 80 ||
    !r.acceptance_criteria.every((s: unknown) => text(s, 2000, true)) || !Array.isArray(v.rows) || v.rows.length > 40 ||
    !v.rows.every((row: unknown) => validRow(row, true)) || new Set(v.rows.map((row: TaskPlanRow) => row.key)).size !== v.rows.length ||
    !["manual", "template", "ai"].includes(v.generator) || !["fullstack", "frontend", "backend", "testing"].includes(v.mode) ||
    !integer(v.max_items, 1) || v.max_items > 40 || (v.source_reference !== null && !validTaskEditSource(v.source_reference))) return false;
  if (v.preview !== null) {
    const p = v.preview;
    if (!record(p) || !exact(p, ["id", "source", "model", "provider", "usage", "warnings"]) || !taskEditIdentity(p.id) ||
      !["template", "ai"].includes(p.source) || !text(p.model, 256) || !text(p.provider, 256) || !record(p.usage) ||
      !exact(p.usage, ["prompt_tokens", "completion_tokens", "total_tokens", "cost_usd"]) ||
      ![p.usage.prompt_tokens, p.usage.completion_tokens, p.usage.total_tokens].every((n) => integer(n)) ||
      typeof p.usage.cost_usd !== "number" || !Number.isFinite(p.usage.cost_usd) || p.usage.cost_usd < 0 ||
      !Array.isArray(p.warnings) || p.warnings.length > 80 || !p.warnings.every((s: unknown) => text(s, 4000))) return false;
  }
  if (v.preview_request !== null) {
    const p = v.preview_request;
    if (!record(p) || !exact(p, ["requirement_id", "expected_version", "idempotency_key", "generator", "mode", "max_items"]) ||
      p.requirement_id !== requirementId || !integer(p.expected_version) || !taskEditIdentity(p.idempotency_key, 100) || p.idempotency_key.length < 8 ||
      !["template", "ai"].includes(p.generator) || !["fullstack", "frontend", "backend", "testing"].includes(p.mode) || !integer(p.max_items, 1) || p.max_items > 40) return false;
  }
  return true;
}
export function taskPlanPrincipal(projectId: string, requirementId: string): PlanPrincipal | null {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || "null"), scope = getWorkspaceScope();
    if (!getToken() || !taskEditIdentity(user?.id, 128) || !taskEditIdentity(user?.tenant_id, 128) ||
      !taskEditIdentity(projectId) || scope.projectId !== projectId || !taskEditIdentity(requirementId) || !text(scope.businessCode || "", 128)) return null;
    return { tenant_id: user.tenant_id, user_id: user.id, business_code: scope.businessCode || "", project_id: projectId, requirement_id: requirementId };
  } catch { return null; }
}
export const taskPlanStorageKey = (identity: PlanPrincipal) => PREFIX + JSON.stringify(identity);
function decode(raw: string, identity: PlanPrincipal): RecordValue {
  if (raw.length > PLAN_RETENTION_LIMIT || new TextEncoder().encode(raw).length > PLAN_RETENTION_LIMIT) throw new Error("planLocalInvalid");
  const v: unknown = JSON.parse(raw);
  if (!record(v) || !exact(v, ["schema", "identity", "draft", "command"]) || v.schema !== 1 || JSON.stringify(v.identity) !== JSON.stringify(identity) ||
    v.draft !== null && !validTaskPlanDraft(v.draft, identity.requirement_id)) throw new Error("planLocalInvalid");
  if (v.command !== null) {
    const c = v.command;
    if (!record(c) || !Object.keys(c).every((key) => ["phase", "original", "error", "ack"].includes(key)) ||
      !["sending", "unknown", "refused", "succeeded"].includes(c.phase) || !validTaskPlanOriginal(c.original, identity.requirement_id) ||
      c.phase === "succeeded" && !validTaskPlanAck(identity.project_id, c.original, c.ack) ||
      c.phase !== "succeeded" && Object.hasOwn(c, "ack") ||
      c.error !== undefined && typeof c.error !== "string") throw new Error("planLocalInvalid");
  }
  return v as RecordValue;
}
export type PlanLocalStatus = "opening" | "ready" | "saved" | "busy" | "changed" | "invalid" | "unavailable";
type PlanView = { draft: RetainedTaskPlanDraft | null; command: DeliveryCommandState<TaskPlanOriginal>; status: PlanLocalStatus; owned: boolean };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PlanLock = (name: string, work: (available: boolean) => Promise<void>) => Promise<void>;
export const browserPlanLock: PlanLock = async (name, work) => {
  if (typeof navigator === "undefined" || !navigator.locks?.request) throw new Error("planLocalUnavailable");
  await navigator.locks.request(name, { ifAvailable: true }, async (lock) => work(Boolean(lock)));
};
/** The editor owns one browser lock; every draft and command write is synchronous under it. */
export function createTaskPlanRetention(options: { identity: PlanPrincipal | null; storage: StoragePort; lock: PlanLock;
  current: () => boolean; send: (original: TaskPlanOriginal) => Promise<unknown>; onPending?: (pending: boolean) => void }) {
  const identity = options.identity, key = identity ? taskPlanStorageKey(identity) : null;
  let expected: string | null = null, owned = false, closed = false, opening = false, release: (() => void) | undefined;
  let status: PlanLocalStatus = "opening", value: RecordValue | null = null, volatileDraft: RetainedTaskPlanDraft | null = null;
  try {
    if (!identity || !key) throw new Error("unavailable");
    expected = options.storage.getItem(key);
    value = expected !== null ? decode(expected, identity) : { schema: 1, identity, draft: null, command: null };
  } catch { status = expected !== null ? "invalid" : "unavailable"; }
  const listeners = new Set<() => void>();
  const current = () => !closed && owned && options.current();
  const write = () => {
    if (!current() || !key || !value || options.storage.getItem(key) !== expected) throw new Error("retainedOriginalUnavailable");
    const raw = value.draft || value.command ? JSON.stringify(value) : null;
    if (raw && new TextEncoder().encode(raw).length > PLAN_RETENTION_LIMIT) throw new Error("retainedOriginalUnavailable");
    if (raw) options.storage.setItem(key, raw); else options.storage.removeItem(key);
    if (options.storage.getItem(key) !== raw) throw new Error("retainedOriginalUnavailable");
    expected = raw; status = "saved";
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PLAN_RETENTION_EVENT));
  };
  const controller = createDeliveryCommandController<TaskPlanOriginal>({ projectId: identity?.project_id || "", scope: "owned-plan",
    currentScope: () => current() ? "owned-plan" : "", retainSucceededOnRestore: true,
    load: () => { if (!value) throw new Error(status === "invalid" ? "retainedOriginalInvalid" : "retainedOriginalUnavailable"); return value.command ? JSON.stringify(value.command) : null; },
    save: (raw) => {
      if (!value) throw new Error("retainedOriginalUnavailable");
      const previous = value.command; value.command = raw ? JSON.parse(raw) : null;
      try { write(); } catch (error) { value.command = previous; status = "unavailable"; throw error; }
    },
    send: options.send, validateOriginal: (original) => !!identity && validTaskPlanOriginal(original, identity.requirement_id),
    validateAck: (original, ack) => !!identity && validTaskPlanAck(identity.project_id, original, ack),
  });
  let view: PlanView = { draft: value?.draft || null, command: controller.snapshot(), status, owned };
  const emit = () => {
    view = { draft: volatileDraft || value?.draft || null, command: controller.snapshot(), status, owned };
    options.onPending?.(!closed && (view.command.phase === "sending" || status === "unavailable" && owned));
    listeners.forEach((listener) => listener());
  };
  controller.subscribe(emit);
  return {
    key, snapshot: () => view, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, current,
    open() {
      if (closed || opening || !["opening", "busy"].includes(status) || !key) return;
      opening = true; status = "opening"; emit();
      void options.lock(key, async (available) => {
        if (closed) return;
        if (!available) { status = "busy"; emit(); return; }
        owned = true;
        try {
          if (options.storage.getItem(key) !== expected) { status = "changed"; emit(); return; }
          if (!value) { emit(); return; }
          status = expected ? "saved" : "ready"; controller.activate(); emit();
          await new Promise<void>((resolve) => { release = resolve; });
        } finally { owned = false; emit(); }
      }).catch(() => { status = "unavailable"; emit(); }).finally(() => { opening = false; });
    },
    saveDraft(draft: RetainedTaskPlanDraft) {
      if (!value || !identity || !current() || !["idle", "refused"].includes(controller.snapshot().phase)) return false;
      // Keep unsaved input for the editor's lifetime, including transient read-state
      // remounts. The durable original is left intact until a write is confirmed.
      volatileDraft = structuredClone(draft);
      if (!validTaskPlanDraft(draft, identity.requirement_id)) { status = "unavailable"; emit(); return false; }
      const previous = value.draft; value.draft = structuredClone(draft);
      try { write(); volatileDraft = null; emit(); return true; } catch { value.draft = previous; status = "unavailable"; emit(); return false; }
    },
    async run(original: TaskPlanOriginal) {
      const draft = value?.draft;
      if (!draft || !current() || status !== "saved" || original.intent.version !== draft.version || original.payload.requirement_basis !== draft.basis ||
        original.payload.requirement_revision !== draft.revision || JSON.stringify(original.payload.items) !== JSON.stringify(selectedPlanItems(draft.rows)) ||
        JSON.stringify(original.source_reference || null) !== JSON.stringify(draft.source_reference) || (original.payload.preview_id || null) !== (draft.preview?.id || null) ||
        taskPlanProblems(draft.rows, draft.requirement.acceptance_criteria.length,
          draft.rows.flatMap((row) => row.depends_on.filter((id) => !draft.rows.some((item) => item.key === id)))).length) return undefined;
      return controller.run(original);
    },
    replay: () => current() ? controller.replay() : Promise.resolve(undefined),
    editRefused() { if (current() && controller.snapshot().phase === "refused") controller.reset(); },
    retainReceipt() {
      const state = controller.snapshot();
      if (!current() || state.phase !== "succeeded" || !value) return false;
      const previous = value.command; value.command = state;
      try { write(); emit(); return true; } catch { value.command = previous; status = "unavailable"; emit(); return false; }
    },
    discard() {
      if (!current() || !value || !["idle", "refused", "succeeded"].includes(controller.snapshot().phase)) return false;
      controller.reset(); if (controller.snapshot().phase !== "idle") return false;
      const previous = value.draft; value.draft = null;
      try { write(); volatileDraft = null; emit(); return true; } catch { value.draft = previous; status = "unavailable"; emit(); return false; }
    },
    close() { if (closed) return; controller.invalidate(); closed = true; release?.(); emit(); },
  };
}
export type TaskPlanRetention = ReturnType<typeof createTaskPlanRetention>;
export function discoverTaskPlans(projectId: string): { requirementId: string; title: string; phase: string }[] {
  const probe = taskPlanPrincipal(projectId, "__probe__"); if (!probe) return [];
  const result: { requirementId: string; title: string; phase: string }[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index); if (!key?.startsWith(PREFIX)) continue;
    let candidate: unknown; try { candidate = JSON.parse(key.slice(PREFIX.length)); } catch { continue; }
    if (!record(candidate) || candidate.tenant_id !== probe.tenant_id || candidate.user_id !== probe.user_id || candidate.business_code !== probe.business_code ||
      candidate.project_id !== projectId || !taskEditIdentity(candidate.requirement_id)) continue;
    const identity = taskPlanPrincipal(projectId, candidate.requirement_id); if (!identity || taskPlanStorageKey(identity) !== key) continue;
    try { const raw = localStorage.getItem(key); if (raw === null) continue; const value = decode(raw, identity);
      result.push({ requirementId: identity.requirement_id, title: value.draft?.requirement.title || identity.requirement_id, phase: value.command?.phase || "draft" });
    } catch { result.push({ requirementId: candidate.requirement_id, title: candidate.requirement_id, phase: "invalid" }); }
    if (result.length >= 50) break;
  }
  return result.sort((a, b) => a.requirementId.localeCompare(b.requirementId));
}
