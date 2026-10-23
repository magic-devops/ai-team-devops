/** Real editor/recovery callbacks with retained state. UNRUN: validation deferred by user. */
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryTaskPlanEditor, DeliveryTaskPlanForm } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanEditor";
import { TaskPlanRecoveryModal } from "../../subapps/ai-rd-center/src/pages/delivery/TaskPlanRecoveryModal";
import { fetchDeliveryContext, fetchDeliveryReferences, fetchEditableRequirement, type DeliveryContext } from "./deliveryQuery";
import type { RequirementEditable } from "./deliveryRequirementReads";
import { request } from "./http";
import { createTaskPlanRetention, type TaskPlanRetention } from "./taskPlanRetention";
import { planAck, planDraft, planOriginal, planPrincipal, planStorage } from "./taskPlanRetentionFixtures";
const h = vi.hoisted(() => ({ hooks: [] as any[], next: 0, effects: [] as (() => void)[], session: "login-1", writable: true, retention: null as any }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => { const i = h.next++; if (!(i in h.hooks)) h.hooks[i] = typeof initial === "function" ? initial() : initial;
    return [h.hooks[i], (value: any) => { h.hooks[i] = typeof value === "function" ? value(h.hooks[i]) : value; }]; },
  useRef: (initial: any) => { const i = h.next++; if (!(i in h.hooks)) h.hooks[i] = { current: initial }; return h.hooks[i]; },
  useEffect: (effect: () => void, deps: any[]) => { const i = h.next++, before = h.hooks[i];
    if (!before || !deps || deps.some((value, j) => value !== before[j])) h.effects.push(effect); h.hooks[i] = deps; },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.session }));
vi.mock("./useTaskPlanRetention", () => ({ useTaskPlanRetention: () => h.retention }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./deliveryQuery", async () => ({ ...(await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery")),
  fetchDeliveryContext: vi.fn(), fetchDeliveryReferences: vi.fn(), fetchEditableRequirement: vi.fn() }));
const data = { project_id: "P", version: 7, query_generation: 3, project: { id: "P", name: "Project" }, permissions: { write: true } } as DeliveryContext;
const requirement = { id: "R", title: "Requirement", description: "Pinned scope", priority: "P1", basis: "a".repeat(64),
  acceptance_criteria: ["Criterion"], tasks_total: 0, flow: { revision: 3, owner_id: "user:lead" } } as RequirementEditable;
const onClose = vi.fn(), onSaved = vi.fn(), onPending = vi.fn();
let store: TaskPlanRetention, storage: ReturnType<typeof planStorage>;
function start() {
  const session = h.session;
  store = createTaskPlanRetention({ identity: planPrincipal, storage, lock: async (_key, work) => work(true),
    current: () => session === h.session, onPending, send: (original) => request("/api/v1/delivery/commands", { method: "POST",
      body: JSON.stringify({ action: original.action, payload: original.payload, expected_version: original.intent.version,
        idempotency_key: original.intent.key, ...(original.source_reference ? { source_reference: original.source_reference } : {}) }) }) });
  store.open(); h.retention = { store, view: store.snapshot() };
}
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.footer), ...nodes(node.props.action)];
}
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<any>(node) ? text(node.props.children) : node == null || typeof node === "boolean" ? "" : String(node); }
const button = (tree: ReactNode, label: string) => nodes(tree).find((n) => typeof n.props.onClick === "function" && text(n.props.children).startsWith(label))?.props;
const field = (tree: ReactNode, label: string) => nodes(tree).find((n) => n.props["aria-label"]?.startsWith(label))?.props;
function render() {
  h.next = 0; h.retention = { store, view: store.snapshot() };
  let tree = DeliveryTaskPlanForm({ data, requirement, requirementVersion: 7, onClose, onSaved, onUnresolvedChange: onPending, retention: h.retention, canWriteCurrent: () => h.writable });
  if (tree.type === TaskPlanRecoveryModal) tree = TaskPlanRecoveryModal(tree.props);
  h.effects.splice(0).forEach((effect) => effect()); return tree;
}
function manual() {
  const tree = render(); field(tree, "delivery.titleField").onChange({ target: { value: "Newest title" } });
  nodes(tree).find((n) => Array.isArray(n.props.value) && n.props.value.length === 0 && !n.props["aria-label"] && typeof n.props.onChange === "function").props.onChange(["Own criterion"]);
  field(tree, "delivery.taskPlan.criteria").onChange([0]); return render();
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(request).mockReset(); h.hooks = []; h.effects = []; h.next = 0; h.session = "login-1";
  data.permissions.write = true; h.writable = true; storage = planStorage(); start(); });
afterEach(() => { store.close(); vi.restoreAllMocks(); });
describe("retained task-plan consumers", () => {
  it("connects the public editor to the retained form", () => {
    h.next = 0; const tree = DeliveryTaskPlanEditor({ data, requirement, onClose, onSaved });
    expect(tree.type).toBe(DeliveryTaskPlanForm); expect(tree.props.retention).toBe(h.retention);
  });
  it("saves each edit immediately and restores it in a fresh editor", async () => {
    const tree = manual(); field(tree, "delivery.titleField").onChange({ target: { value: "Immediately retained" } });
    expect(store.snapshot().draft?.rows[0].title).toBe("Immediately retained"); store.close(); await settle(); h.hooks = []; start();
    expect(field(render(), "delivery.titleField").value).toBe("Immediately retained");
    expect(store.snapshot().draft?.rows[0].acceptance_criteria).toEqual(["Own criterion"]); expect(request).not.toHaveBeenCalled();
  });
  it("restores an interrupted preview request and retries the same key before saving its result", async () => {
    field(manual(), "delivery.taskPlan.source").onChange("template"); vi.mocked(request).mockRejectedValueOnce(new Error("Preview response lost"));
    button(render(), "delivery.taskPlan.generate").onClick(); await settle(); const original = vi.mocked(request).mock.calls[0][1]?.body;
    expect(store.snapshot().draft?.preview_request?.idempotency_key).toBe(JSON.parse(String(original)).idempotency_key);
    store.close(); await settle(); h.hooks = []; start();
    const draft = planDraft(), { selected: _, ...item } = draft.rows[0];
    vi.mocked(request).mockResolvedValueOnce({ id: "preview-retained", version: 7, requirement_revision: 3, requirement_basis: draft.basis,
      requirement_snapshot: draft.requirement, items: [{ ...item, key: "generated-suggestion" }], source: "template", model: "", provider: "",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 }, warnings: [] });
    button(render(), "delivery.taskPlan.retryRequest").onClick(); await settle();
    expect(vi.mocked(request).mock.calls[1][1]?.body).toBe(original); expect(store.snapshot().draft?.preview?.id).toBe("preview-retained");
    expect(store.snapshot().draft?.preview_request).toBeNull(); expect(store.snapshot().draft?.rows[0].title).toBe("Implement");
    button(render(), "delivery.taskPlan.add").onClick();
    const dependencies = nodes(render()).filter((node) => node.props.kind === "task" && Array.isArray(node.props.options));
    expect(dependencies.some((node) => node.props.options.some((option: any) => option.value === "generated-suggestion" && option.local === true))).toBe(true);
  });
  it("rejects old edit, create and generator callbacks while the original result remains unknown", async () => {
    const tree = manual(); vi.mocked(request).mockRejectedValueOnce(new Error("Network lost")); button(tree, "delivery.taskPlan.create").onClick(); await settle();
    const original = store.snapshot().command.original; field(tree, "delivery.titleField").onChange({ target: { value: "Rejected replacement" } });
    field(tree, "delivery.taskPlan.source").onChange("ai"); button(tree, "delivery.taskPlan.add").onClick(); button(tree, "delivery.taskPlan.create").onClick(); await settle();
    expect(request).toHaveBeenCalledTimes(1); expect(store.snapshot().command.original).toEqual(original); expect(store.snapshot().draft?.rows).toHaveLength(1);
  });
  it("persists selected owner assignment and submits that draft", async () => {
    const tree = manual(); nodes(tree).find((n) => n.props.label === "delivery.taskPlan.batchOwner").props.onChange("agent:worker");
    button(render(), "delivery.taskPlan.clearSelectedOwners").onClick(); button(render(), "delivery.taskPlan.applyOwner").onClick();
    expect(store.snapshot().draft?.rows[0].owner_id).toBe("agent:worker"); vi.mocked(request).mockResolvedValueOnce(planAck);
    button(render(), "delivery.taskPlan.create").onClick(); await settle();
    expect(JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body)).payload.items).toMatchObject([{ title: "Newest title", owner_id: "agent:worker" }]);
    expect(onSaved).toHaveBeenCalledWith(planAck);
  });
  it.each([null, {}, { ...planAck, project_id: "Q" }, { ...planAck, applied_version: 9 }, { ...planAck, result: null }])
  ("retains an invalid fulfilled acknowledgement as unknown", async (response) => {
    const tree = manual(); vi.mocked(request).mockResolvedValueOnce(response); button(tree, "delivery.taskPlan.create").onClick(); await settle();
    expect(onSaved).not.toHaveBeenCalled(); expect(store.snapshot().command.phase).toBe("unknown");
    expect(button(render(), "deliveryDiscussion.retryOriginal")).toBeDefined(); expect(button(render(), "delivery.taskPlan.discardLocal")).toBeUndefined();
  });
  it("replays the same original after restart and views saved success without creating again", async () => {
    const tree = manual(); vi.mocked(request).mockRejectedValueOnce(new Error("Network lost"));
    button(tree, "delivery.taskPlan.create").onClick(); await settle(); const original = vi.mocked(request).mock.calls[0][1]?.body;
    store.close(); await settle(); h.hooks = []; start(); vi.mocked(request).mockResolvedValueOnce(planAck);
    button(render(), "deliveryDiscussion.retryOriginal").onClick(); await settle();
    expect(vi.mocked(request).mock.calls[1][1]?.body).toBe(original); expect(onSaved).not.toHaveBeenCalled();
    const success = render(); expect(button(success, "deliveryDiscussion.retryOriginal")).toBeUndefined();
    vi.mocked(fetchDeliveryContext).mockResolvedValue({ ...data, version: 8, query_generation: 4 });
    vi.mocked(fetchDeliveryReferences).mockResolvedValue({ items: [{ id: "T-created", data: { id: "T-created", req_id: "R" } }] } as any);
    button(success, "delivery.taskPlan.viewCreated").onClick(); await settle();
    expect(request).toHaveBeenCalledTimes(2); expect(onSaved).toHaveBeenCalledWith(planAck); expect(store.snapshot().command.phase).toBe("succeeded");
  });
  it("keeps success when task reads or parent navigation fail", async () => {
    store.saveDraft(planDraft()); vi.mocked(request).mockResolvedValueOnce(planAck); await store.run(planOriginal());
    vi.mocked(fetchDeliveryContext).mockRejectedValueOnce(new Error("HTTP 403")); button(render(), "delivery.taskPlan.viewCreated").onClick(); await settle();
    expect(onSaved).not.toHaveBeenCalled(); expect(store.snapshot().command.phase).toBe("succeeded");
    vi.mocked(fetchDeliveryContext).mockResolvedValue({ ...data, version: 8 });
    vi.mocked(fetchDeliveryReferences).mockResolvedValue({ items: [{ id: "T-created", data: { id: "T-created", req_id: "R" } }] } as any);
    onSaved.mockImplementationOnce(() => { throw new Error("Parent read failed"); }); button(render(), "delivery.taskPlan.viewCreated").onClick(); await settle();
    expect(store.snapshot().command.phase).toBe("succeeded"); expect(request).toHaveBeenCalledTimes(1);
  });
  it("blocks stale callbacks after permissions or session change", async () => {
    const tree = manual(); data.permissions.write = false; render(); field(tree, "delivery.titleField").onChange({ target: { value: "Rejected" } });
    button(tree, "delivery.taskPlan.create").onClick(); await settle(); expect(request).not.toHaveBeenCalled(); expect(store.snapshot().draft?.rows[0].title).toBe("Newest title");
    data.permissions.write = true; h.session = "login-2"; button(tree, "delivery.taskPlan.create").onClick(); await settle(); expect(request).not.toHaveBeenCalled();
  });
  it("blocks old form edits and creation immediately when the live parent read gate closes", async () => {
    const tree = manual(); h.writable = false;
    field(tree, "delivery.titleField").onChange({ target: { value: "Rejected stale edit" } });
    field(tree, "delivery.taskPlan.source").onChange("ai"); button(tree, "delivery.taskPlan.create").onClick(); await settle();
    expect(request).not.toHaveBeenCalled(); expect(store.snapshot().draft?.rows[0].title).toBe("Newest title"); expect(store.snapshot().draft?.generator).toBe("manual");
  });
  it("requires latest-baseline adoption before creating a stale draft", async () => {
    const draft = planDraft(); draft.version = 6; store.saveDraft(draft); const stale = render(); expect(button(stale, "delivery.taskPlan.create").disabled).toBe(true);
    vi.mocked(fetchEditableRequirement).mockResolvedValue({ project_id: "P", version: 7, query_generation: 3, requirement } as any);
    button(stale, "delivery.taskPlan.loadLatest").onClick(); await settle(); button(render(), "delivery.taskPlan.adopt").onClick();
    expect(store.snapshot().draft?.version).toBe(7); expect(button(render(), "delivery.taskPlan.create").disabled).toBe(false);
  });
  it("blocks creation after save failure and keeps the last durable draft", async () => {
    const tree = manual(), before = storage.getItem(store.key!); storage.setItem = () => { throw new Error("Quota"); };
    field(tree, "delivery.titleField").onChange({ target: { value: "Unsaved edit" } }); button(tree, "delivery.taskPlan.create").onClick(); await settle();
    expect(request).not.toHaveBeenCalled(); expect(storage.getItem(store.key!)).toBe(before); expect(button(render(), "delivery.taskPlan.closeUnsaved")).toBeDefined();
  });
  it("keeps a failed edit through automatic Form remounts and retries only local saving", () => {
    const tree = manual(), setItem = storage.setItem; storage.setItem = () => { throw new Error("Quota"); };
    field(tree, "delivery.titleField").onChange({ target: { value: "Unsaved latest title" } });
    expect(store.snapshot().status).toBe("unavailable"); expect(store.snapshot().draft?.rows[0].title).toBe("Unsaved latest title");
    h.hooks = []; const restored = render(); expect(field(restored, "delivery.titleField").value).toBe("Unsaved latest title");
    expect(button(restored, "delivery.taskPlan.create").disabled).toBe(true); storage.setItem = setItem;
    button(restored, "delivery.taskPlan.retryLocalSave").onClick(); expect(store.snapshot().status).toBe("saved");
    expect(JSON.parse(storage.getItem(store.key!)!).draft.rows[0].title).toBe("Unsaved latest title"); expect(request).not.toHaveBeenCalled();
  });
});
