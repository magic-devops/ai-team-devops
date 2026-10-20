/** Authored against real editor callbacks; runtime verification is deferred and has not run. */
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryTaskPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskPlanEditor";
import { fetchEditableRequirement, type DeliveryCommandAck, type DeliveryContext } from "./deliveryQuery";
import type { RequirementEditable } from "./deliveryRequirementReads";
import type { DiscussionAdoption } from "./deliveryDiscussions";
import type { TaskPlanPreview } from "./deliveryTaskPlan";
import { request } from "./http";

const h = vi.hoisted(() => ({ hooks: [] as any[], next: 0, session: "original-session", revision: "login-1" }));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.hooks)) h.hooks[index] = typeof initial === "function" ? initial() : initial;
    return [h.hooks[index], (next: any) => {
      h.hooks[index] = typeof next === "function" ? next(h.hooks[index]) : next;
    }];
  },
  useRef: (initial: any) => {
    const index = h.next++;
    if (!(index in h.hooks)) h.hooks[index] = { current: initial };
    return h.hooks[index];
  },
  useEffect: () => {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./authStorage", async () => ({
  ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")),
  getToken: () => h.session,
  getSessionRevision: () => h.revision,
  getWorkspaceScope: () => ({ tenantCode: "tenant-A", businessCode: "business-A", projectId: "P", projectCode: "P" }),
}));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./deliveryQuery", async () => ({
  ...(await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery")),
  fetchEditableRequirement: vi.fn(),
}));

const basis = "a".repeat(64);
const data = {
  project_id: "P", version: 7, query_generation: 3, project: { id: "P", name: "Original project" },
} as unknown as DeliveryContext;
const requirement = {
  id: "R", title: "Original requirement", description: "Fixed original scope", priority: "P1", basis,
  acceptance_criteria: ["Requirement criterion"], tasks_total: 0,
  flow: { revision: 3, owner_id: "user:lead" },
} as unknown as RequirementEditable;
const preview: TaskPlanPreview = {
  id: "preview-original", version: 7, requirement_revision: 3, requirement_basis: basis,
  requirement_snapshot: { id: "R", title: requirement.title, description: requirement.description, acceptance_criteria: requirement.acceptance_criteria },
  source: "template", model: "", provider: "", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 }, warnings: [],
  items: [{ key: "generated-original", title: "Generated original task", description: "Original task body", owner_id: "user:lead", priority: "P1", estimate: "M", acceptance_criteria: ["Own task criterion"], requirement_criteria_indices: [0], depends_on: [], starts_on: null, ends_on: null, blocked_reason: "" }],
};
const ack: DeliveryCommandAck = {
  project_id: "P", action: "tasks.plan", resource: { kind: "task", id: "T-created" }, result: { task_ids: ["T-created"] },
  affected_refs: [{ kind: "task", id: "T-created" }], applied_version: 8, version: 8, query_generation: 4, replayed: true,
};
const source = {
  reference: { thread_id: "D", expected_thread_version: 3, resolution_event_id: "E", message_id: "M", message_revision: 2 },
  thread: { title: "Discussion original task" }, message: { body: "Original discussion criterion" }, field: "acceptance_criteria",
} as DiscussionAdoption;

function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.footer), ...nodes(node.props.action)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<any>(node)) return text(node.props.children);
  return node == null || typeof node === "boolean" ? "" : String(node);
}
function button(tree: ReactNode, label: string): any {
  return nodes(tree).find((node) => typeof node.props.onClick === "function" && text(node.props.children).startsWith(label))?.props;
}
function field(tree: ReactNode, label: string): any {
  return nodes(tree).find((node) => node.props["aria-label"]?.startsWith(label))?.props;
}
const onClose = vi.fn(), onSaved = vi.fn(), onUnresolvedChange = vi.fn();
function renderEditor(initialSource?: DiscussionAdoption) {
  h.next = 0;
  return DeliveryTaskPlanEditor({ data, requirement, requirementVersion: 7, initialSource, onClose, onSaved, onUnresolvedChange });
}
function manual() {
  const tree = renderEditor();
  field(tree, "delivery.titleField").onChange({ target: { value: "Manual original task" } });
  const criteria = nodes(tree).find((node) => Array.isArray(node.props.value) && typeof node.props.onChange === "function" && !node.props["aria-label"] && node.props.value.length === 0);
  expect(criteria, "the actual task-criteria editor callback exists").toBeDefined();
  criteria.props.onChange(["Own original criterion"]);
  field(tree, "delivery.taskPlan.criteria").onChange([0]);
  return renderEditor();
}
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function commandCalls() {
  return vi.mocked(request).mock.calls.filter(([path]) => path === "/api/v1/delivery/commands");
}
function originalBody(index = 0) { return String(commandCalls()[index][1]?.body); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  h.hooks = []; h.next = 0; h.session = "original-session"; h.revision = "login-1";
  vi.clearAllMocks();
  vi.mocked(request).mockReset();
  vi.mocked(fetchEditableRequirement).mockReset();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("actual task-plan editor unknown command recovery", () => {
  it.each([
    ["missing response", null],
    ["empty response", {}],
    ["foreign project", { ...ack, project_id: "Q" }],
    ["foreign action", { ...ack, action: "task.update" }],
    ["wrong resource kind", { ...ack, resource: { kind: "requirement", id: "R" } }],
    ["wrong applied version", { ...ack, applied_version: 9, version: 9 }],
    ["backwards current version", { ...ack, version: 6 }],
    ["invalid generation", { ...ack, query_generation: 0 }],
    ["missing affected refs", { ...ack, affected_refs: [] }],
    ["missing task result", { ...ack, result: null }],
    ["wrong result cardinality", { ...ack, result: { task_ids: ["T-created", "T-other"] } }],
    ["wrong final task identity", { ...ack, result: { task_ids: ["T-other"] } }],
  ])("retains the manual original after an invalid fulfilled ACK: %s", async (_case, response) => {
    const tree = manual();
    vi.mocked(request).mockResolvedValueOnce(response).mockResolvedValueOnce(ack);
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    const original = originalBody();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(true);
    tree.props.onCancel();
    expect(onClose).not.toHaveBeenCalled();
    const locked = renderEditor();
    expect(locked.props.closable).toBe(false);
    button(locked, "deliveryDiscussion.retryOriginal").onClick();
    await settle();
    expect(commandCalls()).toHaveLength(2);
    expect(originalBody(1)).toBe(original);
    expect(onSaved).toHaveBeenCalledWith(ack);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(false);
  });

  it("accepts the real task-plan ACK with a missing query index while requiring a later read", async () => {
    const tree = manual();
    const confirmed = { ...ack, replayed: false, query_generation: null };
    vi.mocked(request).mockResolvedValueOnce(confirmed);
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    expect(onSaved).toHaveBeenCalledWith(confirmed);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(false);
    expect(button(renderEditor(), "deliveryDiscussion.retryOriginal")).toBeUndefined();
  });

  it("locks manual submissions without initialSource and rejects pre-failure save and close callbacks before another render", async () => {
    const tree = manual();
    const oldSave = button(tree, "delivery.taskPlan.create"), oldCancel = button(tree, "delivery.cancel");
    vi.mocked(request).mockRejectedValue(new Error("Network connection lost after submission"));
    oldSave.onClick();
    await settle();
    oldSave.onClick(); oldCancel.onClick(); tree.props.onCancel();
    await settle();
    expect(commandCalls()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(true);
    const unknown = renderEditor();
    expect(button(unknown, "deliveryDiscussion.retryOriginal")).toBeDefined();
    expect(unknown.props.closable).toBe(false);
    expect(unknown.props.keyboard).toBe(false);
  });

  it("replays only the fixed manual request and rejects duplicate or resolved old retry callbacks", async () => {
    const tree = manual(), save = button(tree, "delivery.taskPlan.create"), cancel = button(tree, "delivery.cancel");
    const first = deferred<DeliveryCommandAck>(), replay = deferred<DeliveryCommandAck>();
    vi.mocked(request).mockReturnValueOnce(first.promise).mockReturnValueOnce(replay.promise);
    save.onClick();
    save.onClick(); cancel.onClick(); tree.props.onCancel();
    field(tree, "delivery.titleField").onChange({ target: { value: "Must not replace the pending original" } });
    expect(commandCalls()).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    const submitted = originalBody();
    expect(JSON.parse(submitted)).toMatchObject({ action: "tasks.plan", expected_version: 7, payload: { requirement_id: "R", requirement_revision: 3, requirement_basis: basis, items: [{ title: "Manual original task", acceptance_criteria: ["Own original criterion"] }] } });
    first.reject(new Error("HTTP 503: response unavailable"));
    await settle();
    const retry = button(renderEditor(), "deliveryDiscussion.retryOriginal");
    retry.onClick(); retry.onClick(); save.onClick();
    await settle();
    expect(commandCalls()).toHaveLength(2);
    expect(originalBody(1)).toBe(submitted);
    expect(commandCalls()[1][1]?.headers).toEqual({ "X-Project-Id": "P" });
    replay.resolve(ack);
    await settle();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(ack);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(false);
    retry.onClick();
    await settle();
    expect(commandCalls()).toHaveLength(2);
    expect(button(renderEditor(), "deliveryDiscussion.retryOriginal")).toBeUndefined();
    cancel.onClick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks old generator, restore and editing callbacks while a template command has an unknown result", async () => {
    const manualTree = manual();
    field(manualTree, "delivery.taskPlan.source").onChange("template");
    const generationTree = renderEditor();
    const oldGenerate = button(generationTree, "delivery.taskPlan.generate");
    vi.mocked(request).mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error("HTTP 500: command response lost"));
    oldGenerate.onClick();
    await settle();
    const generated = renderEditor();
    const restore = button(generated, "delivery.taskPlan.restore");
    const regenerate = button(generated, "delivery.taskPlan.regenerate");
    const sourceSelect = field(generated, "delivery.taskPlan.source");
    const title = field(generated, "delivery.titleField");
    button(generated, "delivery.taskPlan.create").onClick();
    await settle();
    const submitted = originalBody();
    oldGenerate.onClick(); regenerate.onClick(); restore.onClick(); sourceSelect.onChange("ai");
    title.onChange({ target: { value: "Replacement task must not enter pending command" } });
    button(generated, "delivery.taskPlan.add").onClick();
    await settle();
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
    expect(originalBody()).toBe(submitted);
    expect(JSON.parse(submitted).payload).toMatchObject({ preview_id: "preview-original", items: [{ title: "Generated original task" }] });
    const unknown = renderEditor();
    expect(field(unknown, "delivery.titleField").value).toBe("Generated original task");
    expect(field(unknown, "delivery.taskPlan.source").value).toBe("template");
    expect(button(unknown, "deliveryDiscussion.retryOriginal")).toBeDefined();
  });

  it("keeps a confirmed acknowledgement resolved if the parent saved callback throws", async () => {
    const tree = manual();
    vi.mocked(request).mockResolvedValueOnce(ack);
    onSaved.mockImplementationOnce(() => { throw new Error("Parent refresh failed after confirmed save"); });
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(false);
    const resolved = renderEditor();
    expect(button(resolved, "deliveryDiscussion.retryOriginal")).toBeUndefined();
    resolved.props.onCancel();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commandCalls()).toHaveLength(1);
  });

  it("blocks stale load-latest and adoption callbacks instead of replacing the original version or key", async () => {
    const tree = manual();
    vi.mocked(request).mockRejectedValueOnce(new Error('HTTP 409: {"detail":{"code":"plan_basis_changed","message":"Plan basis changed"}}'));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    const loadLatest = button(renderEditor(), "delivery.taskPlan.loadLatest");
    vi.mocked(fetchEditableRequirement).mockResolvedValue({ version: 8, query_generation: 4, requirement: { ...requirement, flow: { ...requirement.flow, revision: 4 } } } as any);
    loadLatest.onClick();
    await settle();
    const adopt = button(renderEditor(), "delivery.taskPlan.adopt");
    adopt.onClick();
    const updated = renderEditor();
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown"));
    button(updated, "delivery.taskPlan.create").onClick();
    await settle();
    const submitted = originalBody(1);
    expect(JSON.parse(submitted)).toMatchObject({ expected_version: 8, payload: { requirement_revision: 4 } });
    loadLatest.onClick(); adopt.onClick();
    await settle();
    expect(fetchEditableRequirement).toHaveBeenCalledTimes(1);
    vi.mocked(request).mockResolvedValueOnce({ ...ack, applied_version: 9, version: 9 });
    button(renderEditor(), "deliveryDiscussion.retryOriginal").onClick();
    await settle();
    expect(commandCalls()).toHaveLength(3);
    expect(originalBody(2)).toBe(submitted);
  });

  it.each([403, 409, 422])("retains the unknown original when a later replay receives HTTP %s", async (status) => {
    const tree = manual();
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown"));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    const submitted = originalBody();
    const retry = button(renderEditor(), "deliveryDiscussion.retryOriginal");
    vi.mocked(request).mockRejectedValueOnce(new Error(`HTTP ${status}: replay rejected after the original reply was lost`));
    retry.onClick();
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(true);
    const unresolved = renderEditor();
    expect(button(unresolved, "deliveryDiscussion.retryOriginal")).toBeDefined();
    unresolved.props.onCancel();
    button(tree, "delivery.taskPlan.create").onClick();
    expect(onClose).not.toHaveBeenCalled();
    expect(commandCalls()).toHaveLength(2);
    expect(originalBody(1)).toBe(submitted);
    vi.mocked(request).mockResolvedValueOnce(ack);
    retry.onClick();
    await settle();
    expect(commandCalls()).toHaveLength(3);
    expect(originalBody(2)).toBe(submitted);
    expect(onSaved).toHaveBeenCalledWith(ack);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(false);
  });

  it.each([403, 409, 422])("unlocks a first submission explicitly refused with HTTP %s", async (status) => {
    const tree = manual();
    vi.mocked(request).mockRejectedValueOnce(new Error(`HTTP ${status}: first submission refused`));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(false);
    const refused = renderEditor();
    expect(button(refused, "deliveryDiscussion.retryOriginal")).toBeUndefined();
    refused.props.onCancel();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commandCalls()).toHaveLength(1);
  });

  it.each(["Network retry result unknown", "HTTP 500: retry result unknown", "HTTP 503: retry result unknown"])("keeps the same pending original after another uncertain replay: %s", async (message) => {
    const tree = manual();
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown"));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    const submitted = originalBody();
    vi.mocked(request).mockRejectedValueOnce(new Error(message));
    button(renderEditor(), "deliveryDiscussion.retryOriginal").onClick();
    await settle();
    expect(commandCalls()).toHaveLength(2);
    expect(originalBody(1)).toBe(submitted);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(true);
    const unknown = renderEditor();
    expect(button(unknown, "deliveryDiscussion.retryOriginal")).toBeDefined();
    unknown.props.onCancel();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not rebind an uncertain original to a changed session", async () => {
    const tree = manual();
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown"));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    const submitted = originalBody();
    h.session = "another-session";
    button(renderEditor(), "deliveryDiscussion.retryOriginal").onClick();
    await settle();
    expect(commandCalls()).toHaveLength(1);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(true);
    h.session = "original-session";
    vi.mocked(request).mockResolvedValueOnce(ack);
    button(renderEditor(), "deliveryDiscussion.retryOriginal").onClick();
    await settle();
    expect(commandCalls()).toHaveLength(2);
    expect(originalBody(1)).toBe(submitted);
  });

  it("rejects a retry after a new login reuses the same token and workspace", async () => {
    const tree = manual();
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown"));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    h.revision = "login-2";
    const nextLogin = renderEditor();
    button(nextLogin, "deliveryDiscussion.retryOriginal").onClick();
    nextLogin.props.onCancel();
    await settle();
    expect(commandCalls()).toHaveLength(1);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("resolves a confirmed original acknowledgement without updating the newly logged-in workspace", async () => {
    const tree = manual();
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown"));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    const originalRetry = button(renderEditor(), "deliveryDiscussion.retryOriginal");
    const replay = deferred<DeliveryCommandAck>();
    vi.mocked(request).mockReturnValueOnce(replay.promise);
    originalRetry.onClick();
    h.revision = "login-2";
    replay.resolve(ack);
    await settle();
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(button(renderEditor(), "deliveryDiscussion.retryOriginal")).toBeUndefined();
    originalRetry.onClick();
    await settle();
    expect(commandCalls()).toHaveLength(2);
  });

  it("keeps the captured discussion source with its original command despite old source actions", async () => {
    const tree = renderEditor(source);
    const sourceControl = nodes(tree).find((node) => node.props.source?.value)?.props.source;
    vi.mocked(request).mockRejectedValueOnce(new Error("Network result unknown"));
    button(tree, "delivery.taskPlan.create").onClick();
    await settle();
    sourceControl.remove(); sourceControl.adopt(); await sourceControl.load("P");
    const submitted = originalBody();
    expect(JSON.parse(submitted).source_reference).toEqual(source.reference);
    vi.mocked(request).mockResolvedValueOnce(ack);
    button(renderEditor(source), "deliveryDiscussion.retryOriginal").onClick();
    await settle();
    expect(commandCalls()).toHaveLength(2);
    expect(originalBody(1)).toBe(submitted);
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
  });
});
