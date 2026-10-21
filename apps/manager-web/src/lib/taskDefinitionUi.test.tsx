import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Input, Modal, Select } from "antd";
import { DeliveryTaskDefinitionHost, TaskDefinitionRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDefinitionHost";
import { DeliveryCollaboration } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionAdoption";
import type { DiscussionAdoption } from "./deliveryDiscussions";
import { readTaskDefinitionSource, taskDefinitionRequest } from "./taskDefinitionRoute";
import type { DeliveryTaskData } from "./delivery";
import type { TaskEditCommand } from "./taskEditCommand";
import { fetchDeliveryTaskEditData } from "./deliveryQuery";

const h = vi.hoisted(() => ({ slots: {} as Record<string, any[]>, component: "host", next: 0, effects: [] as Array<() => void>, scope: "scope-a" }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: any) => { const slots = h.slots[h.component] ||= [], index = h.next++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
  useRef: (initial: any) => { const slots = h.slots[h.component] ||= [], index = h.next++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  useCallback: (callback: unknown) => callback, useEffect: (effect: () => void) => { h.effects.push(effect); },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.scope }));
vi.mock("./deliveryQuery", async () => ({ ...await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery"), fetchDeliveryTaskEditData: vi.fn() }));
vi.mock("./deliveryProgress", async () => ({ ...await vi.importActual<typeof import("./deliveryProgress")>("./deliveryProgress"), beginProgressExactRead: () => { const hash = location.hash; return { current: () => h.scope === "scope-a" && location.hash === hash, finish: vi.fn() }; } }));
vi.mock("./taskDefinitionRoute", async () => ({ ...await vi.importActual<typeof import("./taskDefinitionRoute")>("./taskDefinitionRoute"), readTaskDefinitionSource: vi.fn() }));
async function settle() { for (let at = 0; at < 8; at++) await Promise.resolve(); }
function frame<T>(render: () => T, name = "host") { h.component = name; h.next = 0; h.effects = []; return render(); }
function nodes(node: ReactNode): ReactElement<any>[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "action", "footer", "description"].flatMap((key) => nodes(node.props[key]))]; }
function button(tree: ReactNode, label: string) { return nodes(tree).find((node) => node.type === Button && node.props.children === label)!; }
function command(phase: string, original: any = { action: "task.update", payload: { id: "T", task_basis: "a".repeat(64), status: "blocked" }, intent: { version: 7, key: "original-task-key" } }) {
  let state: any = { phase, original, ...(phase === "succeeded" ? { ack: { project_id: "P", resource: { kind: "task", id: "T" } } } : {}) };
  const value = { get state() { return state; }, snapshot: () => state, current: () => h.scope === "scope-a", reset: vi.fn(() => { state = { phase: "idle" }; }),
    replay: vi.fn(async () => { const ack = { project_id: "P", resource: { kind: "task", id: "T" } }; state = { ...state, phase: "succeeded", ack }; return ack; }), run: vi.fn(async (original: any) => { const ack = { project_id: "P", resource: { kind: "task", id: "T" } }; state = { phase: "succeeded", original, ack }; return ack; }), get locked() { return !["idle", "refused"].includes(state.phase); }, get unresolved() { return !["idle", "refused"].includes(state.phase); } };
  return value as unknown as TaskEditCommand;
}
beforeEach(() => { h.slots = {}; h.next = 0; h.effects = []; h.scope = "scope-a"; vi.mocked(fetchDeliveryTaskEditData).mockReset(); vi.mocked(readTaskDefinitionSource).mockReset();
  const location = { hash: "#/dev-flow?view=team&task=T&project_id=P", href: "http://local/#/dev-flow?view=team&task=T&project_id=P" };
  vi.stubGlobal("location", location); vi.stubGlobal("history", { state: null, replaceState: vi.fn((_state: unknown, _title: string, hash: string) => { location.hash = hash; }) });
});
afterEach(() => vi.unstubAllGlobals());
function workspace(criteria = ["B", "A", "A"]): DeliveryTaskData {
  return { project: { id: "P" }, permissions: { write: true }, version: 9, query_generation: 1, planning_basis: "b".repeat(64), members: [], dependencies: [],
    task: { id: "T", title: "Original title", req_id: "R", basis: "a".repeat(64), description: "Original scope", acceptance_criteria: ["Own criterion"], planning: { depends_on: [], requirement_criteria_indices: [0, 2], requirement_snapshot: { id: "R", title: "Requirement", description: "", acceptance_criteria: ["A", "B", "A"] } } },
    requirement: { id: "R", basis: "c".repeat(64), flow: { stage: "development" } }, requirement_definition: { project_id: "P", requirement_id: "R", version: 9, query_generation: 1, requirement_basis: "c".repeat(64), definition: { id: "R", title: "Requirement", description: "", acceptance_criteria: criteria } },
  } as unknown as DeliveryTaskData;
}
function formHost(retained: TaskEditCommand, current = workspace(), saved = vi.fn(), editing = vi.fn()) {
  const read = () => frame(() => DeliveryTaskDefinitionHost({ projectId: "P", taskId: "T", sessionId: "s", command: retained, current, requestEdit: 1, canEdit: true, onSaved: saved, onEditingChange: editing }));
  return { read, saved, editing };
}

describe("task definition independent recovery presenter", () => {
  it("keeps recovery reachable while all current task reads fail", async () => {
    const retained = command("unknown"), saved = vi.fn();
    const tree = frame(() => DeliveryTaskDefinitionHost({ projectId: "P", taskId: "T", sessionId: "s", command: retained, requestEdit: 1, current: undefined, readError: new Error("HTTP 404: task missing"), canEdit: false, isActive: () => false, canSubmit: () => false, onSaved: saved }));
    const recovery = nodes(tree).find((node) => node.type === TaskDefinitionRecovery)!;
    expect(recovery).toBeDefined(); expect(recovery.props.command).toBe(retained); expect(fetchDeliveryTaskEditData).not.toHaveBeenCalled();
    const pane = frame(() => TaskDefinitionRecovery(recovery.props), "recovery"); await button(pane, "Recover same request").props.onClick();
    expect(retained.replay).toHaveBeenCalledTimes(1); expect(retained.reset).toHaveBeenCalledTimes(1); expect(saved).toHaveBeenCalledTimes(1);
  });
  it("closes an invalid private edit target through the actual Host action", () => {
    location.hash += "&task_edit=1&task_edit_task=other&task_source_thread=D";
    const retained = command("idle"), tree = frame(() => DeliveryTaskDefinitionHost({ projectId: "P", taskId: "T", sessionId: "s", command: retained, canEdit: true, onSaved: vi.fn() }));
    button(tree, "Close draft").props.onClick();
    expect(taskDefinitionRequest(location.hash, "P", "T")).toEqual({ open: false, invalid: false });
    expect(new URLSearchParams(location.hash.split("?")[1]).get("task")).toBe("T"); expect(retained.run).not.toHaveBeenCalled();
  });
  it("keeps an invalid-route close callback from changing scope while a write is unknown", () => {
    location.hash += "&task_edit=1&task_edit_task=other";
    const retained = command("unknown"), tree = frame(() => DeliveryTaskDefinitionHost({ projectId: "P", taskId: "T", sessionId: "s", command: retained, canEdit: true, onSaved: vi.fn() }));
    const cancel = button(tree, "Close draft"); expect(cancel.props.disabled).toBe(true); cancel.props.onClick();
    expect(history.replaceState).not.toHaveBeenCalled(); expect(retained.snapshot().phase).toBe("unknown"); expect(retained.reset).not.toHaveBeenCalled();
  });
  it("consumes a cold refused edit when explicitly discarded before current reads recover", () => {
    location.hash += "&task_edit=1&task_edit_task=T";
    const retained = command("refused"), props = { projectId: "P", taskId: "T", sessionId: "s", command: retained, requestEdit: 1, canEdit: false, current: undefined, readError: new Error("HTTP 404: task missing"), onSaved: vi.fn() };
    const tree = frame(() => DeliveryTaskDefinitionHost(props)); h.effects.forEach((effect) => effect());
    const recovery = nodes(tree).find((node) => node.type === TaskDefinitionRecovery)!;
    const pane = frame(() => TaskDefinitionRecovery(recovery.props), "recovery"); button(pane, "Close refused request").props.onClick();
    expect(retained.snapshot().phase).toBe("idle"); expect(taskDefinitionRequest(location.hash, "P", "T").open).toBe(false);
    frame(() => DeliveryTaskDefinitionHost({ ...props, canEdit: true, current: workspace(), readError: undefined })); h.effects.forEach((effect) => effect());
    expect(fetchDeliveryTaskEditData).not.toHaveBeenCalled(); expect(retained.run).not.toHaveBeenCalled();
  });
  it("finishes a confirmed cold receipt without sending another write", async () => {
    const retained = command("succeeded"), saved = vi.fn(), resolved = vi.fn();
    const tree = frame(() => TaskDefinitionRecovery({ projectId: "P", taskId: "T", command: retained, onSaved: saved, onResolved: resolved }));
    await button(tree, "Finish local confirmation").props.onClick();
    expect(retained.replay).not.toHaveBeenCalled(); expect(retained.reset).toHaveBeenCalledTimes(1); expect(resolved).toHaveBeenCalledTimes(1); expect(saved).toHaveBeenCalledTimes(1);
  });
  it("does not replay a corrupt retained record or an old account's operation", () => {
    const corrupt = command("unknown", undefined); (corrupt.snapshot() as any).original = undefined;
    const tree = frame(() => TaskDefinitionRecovery({ projectId: "P", taskId: "T", command: corrupt, onSaved: vi.fn() }));
    expect(button(tree, "Recover same request").props.disabled).toBe(true);
    h.slots = {}; h.scope = "scope-b";
    const old = frame(() => TaskDefinitionRecovery({ projectId: "P", taskId: "T", command: command("unknown"), onSaved: vi.fn() }));
    expect(button(old, "Recover same request").props.disabled).toBe(true);
  });
});


describe("canonical Task definition form", () => {
  for (const [criteria, indexes] of [[["B", "A", "A"], [1, 2]], [["B"], []]] as const) {
    it(`opens and saves the snapshot-linked criteria against ${criteria.join(",")} without reassigning a title-only change`, async () => {
      const data = workspace([...criteria]), retained = command("idle"), host = formHost(retained, data);
      vi.mocked(fetchDeliveryTaskEditData).mockResolvedValue(data);
      host.read(); h.effects.forEach((effect) => effect()); await settle();
      let tree = host.read();
      expect(nodes(tree).find((node) => node.type === Select && node.props["aria-label"] === "Requirement acceptance links")!.props.value).toEqual(indexes.map(String));
      nodes(tree).find((node) => node.type === Input && node.props["aria-label"] === "Task title")!.props.onChange({ target: { value: "Only title changed" } });
      tree = host.read(); nodes(tree).find((node) => node.type === Modal)!.props.onOk(); await settle();
      expect(retained.run).toHaveBeenCalledTimes(1);
      const original = vi.mocked(retained.run).mock.calls[0][0];
      expect(original.payload).toMatchObject({ title: "Only title changed", requirement_criteria_indices: indexes, description: "Original scope", task_basis: "a".repeat(64), planning_basis: "b".repeat(64) });
      expect(host.editing.mock.calls).toEqual([[true], [false]]); expect(host.saved).toHaveBeenCalledTimes(1);
    });
  }
  for (const selection of [{ owner_id: "member-original" }, { status: "blocked" }] as const) {
    it(`keeps a refused ${Object.keys(selection)[0]} choice when explicitly adopting a newer basis`, async () => {
      const original = { action: "task.update", payload: { id: "T", task_basis: "d".repeat(64), ...selection }, intent: { version: 7, key: "old-shortcut-key" } };
      const retained = command("refused", original), host = formHost(retained), data = workspace();
      vi.mocked(fetchDeliveryTaskEditData).mockResolvedValue(data);
      let tree = host.read();
      const recovery = nodes(tree).find((node) => node.type === TaskDefinitionRecovery)!;
      recovery.props.onReadLatest(); await settle(); tree = host.read();
      button(tree, "Use this basis and keep my values").props.onClick(); tree = host.read();
      const summary = nodes(tree).find((node) => typeof node.type === "function" && node.type.name === "TaskDefinitionOriginal")!;
      expect(summary.props.original.payload).toEqual({ id: "T", task_basis: "a".repeat(64), ...selection });
      expect(nodes(tree).find((node) => node.type === Input && node.props["aria-label"] === "Task title")).toBeUndefined();
      nodes(tree).find((node) => node.type === Modal)!.props.onOk(); await settle();
      const adopted = vi.mocked(retained.run).mock.calls[0][0];
      expect(adopted.payload).toEqual({ id: "T", task_basis: "a".repeat(64), ...selection });
      expect(adopted.intent.version).toBe(9); expect(adopted.intent.key).not.toBe(original.intent.key);
    });
  }
  it("keeps a canceled same-edit read explicitly retryable after only a delivery selection changes", async () => {
    location.hash += "&task_edit=1&task_edit_task=T";
    const retained = command("idle"), data = workspace(); let release!: (data: DeliveryTaskData) => void;
    vi.mocked(fetchDeliveryTaskEditData).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValue(data);
    const host = formHost(retained, data); host.read(); h.effects.forEach((effect) => effect());
    location.hash += "&submission_id=S&work_order_id=W"; host.read(); h.effects.forEach((effect) => effect());
    release(data); await settle();
    const tree = host.read(); expect(nodes(tree).find((node) => node.type === Modal)).toBeUndefined();
    button(tree, "Read current definition").props.onClick(); await settle();
    expect(fetchDeliveryTaskEditData).toHaveBeenCalledTimes(2); expect(nodes(host.read()).find((node) => node.type === Modal)).toBeDefined(); expect(retained.run).not.toHaveBeenCalled();
  });
  it("starts the newest same-Task source read after a superseded pending read leaves", async () => {
    const route = (message: string) => `#/dev-flow?project_id=P&view=team&task=T&task_edit=1&task_edit_task=T&task_source_thread=D&task_source_message=${message}&task_source_version=4&task_source_revision=2&task_source_resolution=E&task_source_field=description`;
    const retained = command("idle"), data = workspace(); let release!: (data: DeliveryTaskData) => void;
    vi.mocked(fetchDeliveryTaskEditData).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValue(data);
    const source = { field: "description", message: { id: "B", body: "Newest source B" }, thread: { id: "D", subject: { kind: "task", id: "T" } }, reference: { thread_id: "D", message_id: "B", expected_thread_version: 4, message_revision: 2, resolution_event_id: "E" } } as unknown as DiscussionAdoption;
    vi.mocked(readTaskDefinitionSource).mockResolvedValue(source);
    const read = (requestEdit: number) => frame(() => DeliveryTaskDefinitionHost({ projectId: "P", taskId: "T", sessionId: "s", command: retained, current: data, canEdit: true, requestEdit, onSaved: vi.fn() }));
    location.hash = route("A"); read(1); h.effects.forEach((effect) => effect()); expect(fetchDeliveryTaskEditData).toHaveBeenCalledTimes(1);
    location.hash = route("B"); read(2); h.effects.forEach((effect) => effect()); expect(fetchDeliveryTaskEditData).toHaveBeenCalledTimes(1);
    release(data); await settle(); read(2); h.effects.forEach((effect) => effect()); await settle();
    expect(fetchDeliveryTaskEditData).toHaveBeenCalledTimes(2); expect(readTaskDefinitionSource).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readTaskDefinitionSource).mock.calls[0][2].reference.message_id).toBe("B");
    const tree = read(2), description = nodes(tree).find((node) => node.type === Input.TextArea && node.props["aria-label"] === "Description")!;
    expect(description.props.value).toBe("Original scope\n\nNewest source B"); expect(retained.run).not.toHaveBeenCalled();
  });
  it("releases an acknowledged draft before a refresh callback failure without replaying", async () => {
    const retained = command("idle"), saved = vi.fn(() => { throw new Error("Refresh failed"); }), host = formHost(retained, workspace(), saved);
    vi.mocked(fetchDeliveryTaskEditData).mockResolvedValue(workspace());
    host.read(); h.effects.forEach((effect) => effect()); await settle();
    nodes(host.read()).find((node) => node.type === Modal)!.props.onOk(); await settle();
    expect(host.editing.mock.calls).toEqual([[true], [false]]); expect(retained.snapshot().phase).toBe("idle"); expect(retained.replay).not.toHaveBeenCalled();
    expect(nodes(host.read()).some((node) => node.props.title === "The task was saved. Refreshing its current facts failed; refresh without submitting again.")).toBe(true);
  });
});


describe("discussion Task edit producer", () => {
  it("opens the same exact Task editor with its source and a safe return to the discussion", () => {
    location.hash = "#/dev-flow?project_id=P&view=discussions&discussion_thread=D&discussion_message=M";
    const source = { thread: { id: "D", subject: { kind: "task", id: "T", current_requirement_id: "R", missing: false } }, message: { id: "M", body: "Adopted scope" }, field: "description",
      reference: { thread_id: "D", message_id: "M", expected_thread_version: 4, message_revision: 2, resolution_event_id: "E" } } as unknown as DiscussionAdoption;
    const navigate = vi.fn(), tree = frame(() => DeliveryCollaboration({ projectId: "P", sessionId: "s", onSaved: vi.fn(), onNavigate: navigate }));
    const panel = nodes(tree).find((node) => typeof node.props.onAdopt === "function")!;
    panel.props.onAdopt("task", source);
    const href = navigate.mock.calls[0][0], request = taskDefinitionRequest(href, "P", "T"), params = new URLSearchParams(href.split("?")[1]);
    expect(request).toEqual({ open: true, invalid: false, source: { field: "description", reference: source.reference } });
    expect(params.get("requirement")).toBe("R"); expect(params.get("task")).toBe("T"); expect(params.get("return_to")).toBe(location.hash);
  });
});
