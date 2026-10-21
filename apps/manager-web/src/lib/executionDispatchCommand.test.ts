/** Permanent contract definitions. Runtime, type and browser verification are deferred. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExecutionDispatchController,
  executionDispatchRecoveryPending,
  executionDispatchStorageKey,
  executionQueueOriginal as queueOriginal,
  useExecutionDispatchCommand,
  validExecutionQueuePreview,
  type ExecutionDispatchAction,
  type ExecutionDispatchOriginal,
} from "./executionDispatchCommand";
import { openExecutionDraft, prepareExecution, type ExecutionDraftSession, type ExecutionPreview, type ExecutionTarget } from "./deliveryExecution";
import { commandDraft } from "./executionCommands";
import type { DeliveryTaskData } from "./delivery";
import { getSessionRevision, setSession, USER_KEY } from "./authStorage";

const actions: ExecutionDispatchAction[] = ["execution.queue", "execution.sync"];
const taskData = { project: { id: "P" }, version: 7, task: { id: "T", basis: "a".repeat(64) } } as unknown as DeliveryTaskData;
const target: ExecutionTarget = { id: "local", kind: "local", name: "Local", version: 2, basis: "b".repeat(64),
  paired: null, online: null, last_seen_at: null, expires_at: null, worker_id: null, capability_digest: "local-digest",
  runtime_capabilities: ["command"], providers: [], policy: { allowed_runtimes: ["command"], allowed_providers: [] }, can_execute: true, reason_codes: [] };
function draft(): ExecutionDraftSession {
  return { ...openExecutionDraft(taskData, "T", "original-queue-key"), mode: "command", workspaceId: "W", target: structuredClone(target), commands: [commandDraft("tests", "python")] };
}
function preview(prepared = prepareExecution(draft())): ExecutionPreview {
  return { project_id: "P", version: 7, task_basis: "a".repeat(64), plan_basis: "c".repeat(64), executor_snapshot: null,
    test_plan: { schema: "manager.execution-test-plan.v1", node_ids: [...prepared.payload.test_node_ids], command_sha256: {} },
    workspace_id: "W", workspace_version: 1, target: structuredClone(target), agent: null,
    nodes: prepared.payload.nodes.map((node) => ({ ...node, argv: [...node.argv], expected_exit_code: "expected_exit_code" in node ? node.expected_exit_code : 0,
      timeout_seconds: "timeout_seconds" in node ? node.timeout_seconds : 60, agent_id: "", prompt: "" })),
    test_node_ids: [...prepared.payload.test_node_ids],
    snapshot: { task_id: "T", title: "Fixed task", description: "Dispatch the fixed commands", assigned_to: "", task_acceptance_criteria: [],
      acceptance_criteria: [], requirement: null, owner: null, dependency_basis: {}, designs: [], design_basis: "a".repeat(64) } };
}
function preparedQueue() {
  const prepared = prepareExecution(draft()); prepared.session.preview = preview(prepared); return prepared;
}
function preparedAgentQueue() {
  const selected = draft(); selected.mode = "agent"; selected.executorMemberId = "member-agent";
  selected.executorBindingBasis = "d".repeat(64); selected.agentId = "A"; selected.agentVersion = 3;
  selected.target!.runtime_capabilities = ["agent", "command"]; selected.target!.policy.allowed_runtimes = ["agent", "command"];
  selected.target!.policy.allowed_providers = ["codex"]; selected.target!.providers = [{ id: "codex", executable_present: true, version: "1", auth: "unknown" }];
  const prepared = prepareExecution(selected), value = preview(prepared); value.target = structuredClone(selected.target!);
  value.agent = { id: "A", version: 3, title: "Implementation agent", provider: "codex" };
  value.executor_snapshot = { member_id: "member-agent", member_name: "Implementation agent", binding_basis: selected.executorBindingBasis,
    binding_generation: 0, workspace_id: "W", workspace_name: "Workspace", agent_id: "A", agent_version: 3,
    agent_title: "Implementation agent", provider: "codex", profile_digest: "e".repeat(64), recorded_at: "2026-10-20T12:00:00Z", recorded_by: "user-a" };
  value.nodes = [{ id: "agent_1", title: "Implementation", kind: "agent", argv: [], expected_exit_code: 0, timeout_seconds: 60, agent_id: "A", prompt: "Implement the fixed task" },
    ...prepared.payload.test_nodes.map((node) => ({ ...node, argv: [...node.argv], agent_id: "", prompt: "" }))];
  value.test_node_ids = prepared.payload.test_nodes.map((node) => node.id);
  prepared.session.preview = value; return prepared;
}
function original(action: ExecutionDispatchAction = "execution.queue"): ExecutionDispatchOriginal {
  return action === "execution.queue" ? queueOriginal(preparedQueue()) : { action, payload: { id: "E" }, intent: { version: 7, key: "original-sync-key" } };
}
const targetId = (action: ExecutionDispatchAction) => action === "execution.queue" ? "T" : "E";
function ack(value: ExecutionDispatchOriginal, executionId = "E") {
  return { project_id: "P", action: value.action, resource: { kind: "execution", id: executionId }, result: null,
    applied_version: value.intent.version + 1, version: value.intent.version + 1, query_generation: 2, replayed: false,
    affected_refs: [{ kind: "execution", id: executionId }] };
}
function harness(action: ExecutionDispatchAction, send: (value: ExecutionDispatchOriginal) => Promise<unknown>) {
  let raw: string | null = null, scope = "A";
  const options = { projectId: "P", action, targetId: targetId(action), scope: "A", currentScope: () => scope,
    load: () => raw, save: (value: string) => { raw = value; }, send };
  return { options, create: () => createExecutionDispatchController(options), stored: () => raw,
    restore: (value: string | null) => { raw = value; }, changeScope: (value: string) => { scope = value; } };
}
let local: Map<string, string>, retained: Map<string, string>;
beforeEach(() => {
  local = new Map(); retained = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, raw: string) => local.set(key, raw), removeItem: (key: string) => local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => retained.get(key) ?? null, setItem: (key: string, raw: string) => retained.set(key, raw) });
  const location = { hash: "#/dev-flow?task=T", href: "http://localhost/#/dev-flow?task=T" };
  vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-dispatch-token", "P", "tenant-a"); local.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("queue preview binding before durable dispatch", () => {
  it("accepts the actual prepared command preview and constructs a detached credential-free original", () => {
    const prepared = preparedQueue(); expect(validExecutionQueuePreview("P", prepared, prepared.session.preview)).toBe(true);
    const value = queueOriginal(prepared); prepared.payload.nodes[0].argv[0] = "different-program";
    expect(value.payload).toMatchObject({ task_id: "T", task_basis: "a".repeat(64), workspace_id: "W", target_basis: "b".repeat(64),
      nodes: [{ id: "tests", argv: ["python"] }], test_node_ids: ["tests"] });
    expect(value.intent).toMatchObject({ version: 7, key: "original-queue-key" });
    expect(Object.keys(value).sort()).toEqual(["action", "intent", "payload"]);
    expect(JSON.stringify(value)).not.toContain("private-dispatch-token");
  });

  it.each(["project", "version", "task", "task-basis", "workspace", "target-basis", "target-kind", "command", "test-ids", "executor", "missing-designs", "missing-design-basis"])("rejects a preview with mismatched %s evidence", (field) => {
    const prepared = preparedQueue(), value = structuredClone(prepared.session.preview!);
    if (field === "project") value.project_id = "Q";
    if (field === "version") value.version = 8;
    if (field === "task") value.snapshot.task_id = "foreign-task";
    if (field === "task-basis") value.task_basis = "d".repeat(64);
    if (field === "workspace") value.workspace_id = "foreign-workspace";
    if (field === "target-basis") value.target.basis = "d".repeat(64);
    if (field === "target-kind") value.target.kind = "device";
    if (field === "command") value.nodes[0].argv = ["different-program"];
    if (field === "test-ids") value.test_node_ids = [];
    if (field === "executor") value.executor_snapshot = { member_id: "foreign-member" } as unknown as NonNullable<ExecutionPreview["executor_snapshot"]>;
    if (field === "missing-designs") delete (value.snapshot as Partial<ExecutionPreview["snapshot"]>).designs;
    if (field === "missing-design-basis") delete (value.snapshot as Partial<ExecutionPreview["snapshot"]>).design_basis;
    expect(validExecutionQueuePreview("P", prepared, value)).toBe(false);
  });

  it("does not queue without a valid bound preview or after the caller edits the prepared payload", () => {
    const missing = prepareExecution(draft()); expect(() => queueOriginal(missing)).toThrow();
    const prepared = preparedQueue(); prepared.payload.nodes[0].argv = ["different-program"];
    expect(() => queueOriginal(prepared)).toThrow();
  });

  it("accepts the actual nullable owner DTO without inventing a display name or kind", () => {
    const prepared = preparedQueue();
    prepared.session.preview!.snapshot.owner = { id: "former-owner", name: null, kind: null, active: false };
    expect(validExecutionQueuePreview("P", prepared, prepared.session.preview)).toBe(true);
    expect(queueOriginal(prepared).payload.task_id).toBe("T");
  });

  it("accepts an agent executor snapshot with every real display and binding field", () => {
    const prepared = preparedAgentQueue();
    expect(validExecutionQueuePreview("P", prepared, prepared.session.preview)).toBe(true);
    expect(queueOriginal(prepared).payload).toMatchObject({ agent_id: "A", agent_version: 3, executor_member_id: "member-agent",
      executor_binding_basis: "d".repeat(64), nodes: [], test_nodes: [{ id: "tests", argv: ["python"] }] });
  });

  it.each(["requirement-title", "requirement-criteria", "owner-name", "owner-kind"])("rejects non-renderable snapshot %s fields before showing a preview", (field) => {
    const prepared = preparedQueue(), value = structuredClone(prepared.session.preview!);
    value.snapshot.requirement = { id: "REQ", title: "Requirement", description: "Fixed scope", revision: 0, acceptance_criteria: [], criteria_indices: [] };
    value.snapshot.owner = { id: "owner", name: "Owner", kind: "human", active: true };
    if (field === "requirement-title") (value.snapshot.requirement as unknown as Record<string, unknown>).title = { label: "Invalid" };
    if (field === "requirement-criteria") (value.snapshot.requirement as unknown as Record<string, unknown>).acceptance_criteria = [{ label: "Invalid" }];
    if (field === "owner-name") (value.snapshot.owner as unknown as Record<string, unknown>).name = { label: "Invalid" };
    if (field === "owner-kind") (value.snapshot.owner as unknown as Record<string, unknown>).kind = "unknown-kind";
    expect(validExecutionQueuePreview("P", prepared, value)).toBe(false);
  });

  it.each(["member_name", "workspace_name", "agent_title", "provider", "profile_digest", "recorded_at", "recorded_by", "binding_generation"])("rejects malformed executor display/binding field %s", (field) => {
    const prepared = preparedAgentQueue(), value = structuredClone(prepared.session.preview!);
    (value.executor_snapshot as unknown as Record<string, unknown>)[field] = field === "binding_generation" ? -1 : { label: "Invalid" };
    expect(validExecutionQueuePreview("P", prepared, value)).toBe(false);
  });
});

describe("durable queue and sync command contracts", () => {
  it.each(actions)("records %s before send, blocks double clicks, and preserves the original after reload", async (action) => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const value = original(action), h = harness(action, send), first = h.create(), running = first.run(value);
    expect(JSON.parse(h.stored()!)).toMatchObject({ phase: "sending", original: value });
    await first.run(value); await first.replay(); expect(send).toHaveBeenCalledTimes(1);
    expect(h.create().snapshot()).toMatchObject({ phase: "unknown", original: value });
    first.invalidate(); finish(ack(value)); await running; expect(first.snapshot().phase).toBe("unknown");
  });

  it.each(actions)("replays the identical %s original after a lost reply, never adopting caller edits", async (action) => {
    const value = original(action), sent: ExecutionDispatchOriginal[] = [];
    const h = harness(action, async (captured) => { sent.push(structuredClone(captured)); if (sent.length === 1) throw new TypeError("Reply lost after possible dispatch"); return { ...ack(captured), replayed: true }; });
    const first = h.create(); await first.run(value); expect(first.snapshot().phase).toBe("unknown");
    value.intent.key = "replacement-key"; value.payload[action === "execution.queue" ? "workspace_id" : "id"] = "foreign";
    first.reset(); await first.run(value); expect(sent).toHaveLength(1);
    const restored = h.create(); await restored.replay(); expect(sent[1]).toEqual(sent[0]); expect(restored.snapshot().phase).toBe("succeeded");
  });

  it.each([400, 401, 403, 404, 409, 422])("keeps unknown queue unresolved after later HTTP%s", async (status) => {
    const send = vi.fn().mockRejectedValueOnce(new Error("Lost queue response")).mockRejectedValueOnce(new Error(`HTTP ${status}: later refusal`));
    const command = harness("execution.queue", send).create(), value = original();
    await command.run(value); await command.replay(); command.reset(); await command.run(original());
    expect(command.snapshot()).toMatchObject({ phase: "unknown", original: value }); expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it("keeps a sync unknown after a later explicit permission refusal", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("Lost sync response")).mockRejectedValueOnce(new Error("HTTP 403: permission revoked"));
    const command = harness("execution.sync", send).create(), value = original("execution.sync");
    await command.run(value); await command.replay(); command.reset();
    expect(command.snapshot()).toMatchObject({ phase: "unknown", original: value }); expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it.each([400, 401, 403, 404, 409, 422])("retains a first definite HTTP%s refusal for SQL-only queue and observation sync until explicit reset", async (status) => {
    for (const action of actions) {
      const send = vi.fn(async () => { throw new Error(`HTTP ${status}: ${JSON.stringify({ detail: { code: "operation_refused", message: "Review the original operation" } })}`); });
      const h = harness(action, send), command = createExecutionDispatchController(h.options), value = original(action);
      await command.run(value);
      expect(command.snapshot()).toMatchObject({ phase: "refused", original: value });
      await command.run({ ...value, intent: { ...value.intent, key: "replacement-operation-key" } }); expect(send).toHaveBeenCalledTimes(1);
      command.reset(); expect(command.snapshot().phase).toBe("idle");
    }
  });

  it.each(["project", "action", "resource-kind", "resource-id", "ref", "extra-ref", "version", "result"])("rejects a queue ACK with mismatched %s", async (field) => {
    const value = original(), answer: any = ack(value);
    if (field === "project") answer.project_id = "Q";
    if (field === "action") answer.action = "execution.sync";
    if (field === "resource-kind") answer.resource.kind = "task";
    if (field === "resource-id") { answer.resource.id = "T"; answer.affected_refs[0].id = "T"; }
    if (field === "ref") answer.affected_refs[0].id = "foreign";
    if (field === "extra-ref") answer.affected_refs.push({ kind: "execution", id: "foreign" });
    if (field === "version") answer.applied_version++;
    if (field === "result") answer.result = { run_id: "invented-run" };
    const command = harness("execution.queue", async () => answer).create(); await command.run(value);
    expect(command.snapshot()).toMatchObject({ phase: "unknown", original: value });
  });

  it("accepts a genuinely new execution resource for queue but requires the exact resource for sync", async () => {
    const queue = original(), queued = harness("execution.queue", async () => ack(queue, "new-execution")).create();
    await queued.run(queue); expect(queued.snapshot().phase).toBe("succeeded");
    const sync = original("execution.sync"), synchronized = harness("execution.sync", async () => ack(sync, "foreign-execution")).create();
    await synchronized.run(sync); expect(synchronized.snapshot().phase).toBe("unknown");
  });

  it("does not send when retaining an original fails", async () => {
    const send = vi.fn(), h = harness("execution.queue", send);
    const command = createExecutionDispatchController({ ...h.options, save: () => { throw new Error("Storage unavailable"); } });
    await command.run(original()); expect(send).not.toHaveBeenCalled(); expect(command.snapshot()).toMatchObject({ phase: "idle", error: "retainedOriginalUnavailable" });
  });

  it("keeps a confirmed result known when local save/cleanup fail, permitting no replacement POST", async () => {
    const value = original(), send = vi.fn(async () => ack(value)), h = harness("execution.queue", send);
    let unavailable = true;
    const command = createExecutionDispatchController({ ...h.options, save: (raw) => {
      if (unavailable && (!raw || JSON.parse(raw).phase === "succeeded")) throw new Error("Storage quota"); h.options.save(raw);
    } });
    await command.run(value); expect(command.snapshot()).toMatchObject({ phase: "succeeded", ack: ack(value), error: "retainedOriginalUnavailable" });
    command.reset(); await command.run(value); await command.replay(); expect(send).toHaveBeenCalledTimes(1);
    unavailable = false; command.reset(); expect(command.snapshot().phase).toBe("idle"); expect(h.stored()).toBe("");
  });

  it("restores a confirmed receipt as known when clearing that stored receipt fails", async () => {
    const value = original("execution.sync"), send = vi.fn(), h = harness("execution.sync", send);
    h.restore(JSON.stringify({ phase: "succeeded", original: value, ack: ack(value) }));
    const command = createExecutionDispatchController({ ...h.options, save: () => { throw new Error("Cleanup unavailable"); } });
    expect(command.snapshot()).toMatchObject({ phase: "succeeded", original: value, error: "retainedOriginalUnavailable" });
    await command.replay(); await command.run(value); command.reset();
    expect(send).not.toHaveBeenCalled(); expect(command.snapshot().phase).toBe("succeeded");
  });

  it("does not dispatch after a captured scope changes or apply a late reply into that scope", async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const h = harness("execution.sync", send), command = h.create(), value = original("execution.sync");
    h.changeScope("B"); await command.run(value); expect(send).not.toHaveBeenCalled();
    h.changeScope("A"); const pending = command.run(value); h.changeScope("B"); finish(ack(value)); await pending;
    expect(command.snapshot().phase).toBe("sending"); command.invalidate(); expect(command.snapshot().phase).toBe("unknown");
  });

  it("rejects oversized stored originals without replaying or replacing the retained request", async () => {
    const send = vi.fn(), h = harness("execution.queue", send); h.restore("x".repeat(1_500_001));
    const command = h.create(); await command.replay(); await command.run(original());
    expect(command.snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalInvalid" }); expect(send).not.toHaveBeenCalled();
  });

  it("applies the full serialized original budget before sending a new queue request", async () => {
    const value = original(), send = vi.fn(), h = harness("execution.queue", send);
    delete value.intent.signature;
    (value.payload.nodes as Array<{ argv: string[] }>)[0].argv.push("x".repeat(1_500_001));
    const command = h.create(); await command.run(value);
    expect(command.snapshot()).toMatchObject({ phase: "idle", error: "retainedOriginalInvalid" }); expect(send).not.toHaveBeenCalled();
  });

  it("reserves enough retained space to keep a near-budget valid original acknowledged", async () => {
    const value = original(), send = vi.fn(async () => ack(value)), h = harness("execution.queue", send);
    delete value.intent.signature;
    const argv = (value.payload.nodes as Array<{ argv: string[] }>)[0].argv;
    argv.push("x");
    const initialLength = JSON.stringify({ phase: "sending", original: value }).length;
    argv[argv.length - 1] = "x".repeat(1_500_000 - 8192 - initialLength - 31);
    const sendingLength = JSON.stringify({ phase: "sending", original: value }).length;
    expect(sendingLength).toBeGreaterThan(1_500_000 - 8192 - 100);
    expect(sendingLength).toBeLessThanOrEqual(1_500_000 - 8192);
    const command = h.create(); await command.run(value);
    expect(send).toHaveBeenCalledTimes(1);
    expect(command.snapshot()).toMatchObject({ phase: "succeeded", ack: ack(value) });
    expect(h.stored()!.length).toBeLessThanOrEqual(1_500_000);
    expect(JSON.parse(h.stored()!)).toMatchObject({ phase: "succeeded", original: value });
  });

  it("keeps the durable sending original when an oversized error cannot be retained", async () => {
    const value = original(), send = vi.fn(async () => { throw new Error("x".repeat(1_500_001)); });
    const h = harness("execution.queue", send), command = h.create(); await command.run(value);
    expect(command.snapshot()).toMatchObject({ phase: "unknown", original: value, error: "retainedOriginalUnavailable" });
    expect(JSON.parse(h.stored()!)).toEqual({ phase: "sending", original: value });
    const restored = h.create();
    expect(restored.snapshot()).toMatchObject({ phase: "unknown", original: value });
    restored.reset(); await restored.run(original()); expect(send).toHaveBeenCalledTimes(1);
  });

  it("restores a definite observation-sync refusal without converting it into an unknown external dispatch", async () => {
    const value = original("execution.sync"), send = vi.fn(async () => ack(value)), h = harness("execution.sync", send);
    const raw = JSON.stringify({ phase: "refused", original: value, error: "HTTP 422: observation refused" });
    h.restore(raw);
    const key = executionDispatchStorageKey("P", "execution.sync", "E")!; retained.set(key, raw);
    expect(executionDispatchRecoveryPending("P", "execution.sync", "E")).toBe(false);
    expect(retained.get(key)).toBe(raw);
    const restored = h.create(); expect(restored.snapshot()).toMatchObject({ phase: "refused", original: value });
    await restored.replay(); expect(send).not.toHaveBeenCalled();
    restored.reset(); expect(restored.snapshot().phase).toBe("idle");
  });
});

describe("dispatch durable identity, recovery probe and actual hook transport", () => {
  it("isolates user, tenant, login revision, project, action and target without persisting credentials", () => {
    const key = executionDispatchStorageKey("P", "execution.queue", "T")!;
    expect(key).toContain(getSessionRevision()!); expect(key).not.toContain("private-dispatch-token");
    expect(executionDispatchStorageKey("Q", "execution.queue", "T")).not.toBe(key);
    expect(executionDispatchStorageKey("P", "execution.queue", "other-task")).not.toBe(key);
    expect(executionDispatchStorageKey("P", "execution.sync", "T")).not.toBe(key);
    local.set(USER_KEY, JSON.stringify({ id: "user-b", tenant_id: "tenant-a" })); expect(executionDispatchStorageKey("P", "execution.queue", "T")).not.toBe(key);
    local.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-b" })); expect(executionDispatchStorageKey("P", "execution.queue", "T")).not.toBe(key);
    local.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" })); setSession("private-dispatch-token", "P", "tenant-a");
    expect(executionDispatchStorageKey("P", "execution.queue", "T")).not.toBe(key);
  });

  it.each(["sending", "unknown", "idle", "succeeded", "broken"])("conservatively probes %s slots without mutating them", (phase) => {
    const key = executionDispatchStorageKey("P", "execution.queue", "T")!, value = original();
    const raw = phase === "broken" ? "not-json" : JSON.stringify({ phase, original: value, ...(phase === "succeeded" ? { ack: ack(value) } : {}) });
    retained.set(key, raw); expect(executionDispatchRecoveryPending("P", "execution.queue", "T")).toBe(true); expect(retained.get(key)).toBe(raw);
  });

  it("treats only missing/empty and valid first-refused slots as closed, and storage failure conservatively", () => {
    const key = executionDispatchStorageKey("P", "execution.queue", "T")!;
    for (const raw of ["", JSON.stringify({ phase: "refused", original: original() })]) { retained.set(key, raw); expect(executionDispatchRecoveryPending("P", "execution.queue", "T")).toBe(false); }
    retained.delete(key); expect(executionDispatchRecoveryPending("P", "execution.queue", "T")).toBe(false);
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("Read unavailable"); } });
    expect(executionDispatchRecoveryPending("P", "execution.queue", "T")).toBe(true);
  });

  function open(action: ExecutionDispatchAction, onPending?: (pending: boolean) => void) {
    let command!: ReturnType<typeof useExecutionDispatchCommand>;
    function Probe() { command = useExecutionDispatchCommand("P", action, targetId(action), "selected-session", onPending); return null; }
    renderToStaticMarkup(createElement(Probe)); return command;
  }
  it.each(actions)("sends and restores identical canonical %s transport bytes through the actual hook", async (action) => {
    const value = original(action), bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body)); if (bodies.length === 1) throw new TypeError("Reply lost after possible effect");
      return new Response(JSON.stringify({ ...ack(value), replayed: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    await open(action).run(value); expect(executionDispatchRecoveryPending("P", action, targetId(action))).toBe(true);
    const restored = open(action); await restored.replay(); expect(restored.snapshot().phase).toBe("succeeded");
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0])).toEqual({ action, payload: value.payload, expected_version: 7, idempotency_key: value.intent.key });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Project-Id")).toBe("P");
    expect(JSON.stringify([...retained.values()])).not.toContain("private-dispatch-token");
  });

  it("does not send without a safe durable hook identity", async () => {
    local.delete(USER_KEY); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const command = open("execution.queue"); await command.run(original()); await command.replay();
    expect(command.snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalUnavailable" }); expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps succeeded pending synchronously until confirmed local cleanup succeeds", async () => {
    const value = original("execution.sync"), pending = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ack(value)), { status: 200 })));
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => retained.get(key) ?? null, setItem: (key: string, raw: string) => {
      if (!raw || JSON.parse(raw).phase === "succeeded") throw new Error("Storage quota"); retained.set(key, raw);
    } });
    const command = open("execution.sync", pending); await command.run(value);
    expect(command.snapshot().phase).toBe("succeeded"); expect(pending.mock.calls.at(-1)).toEqual([true]);
    command.reset(); await command.replay(); expect(pending.mock.calls.at(-1)).toEqual([true]);
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => retained.get(key) ?? null, setItem: (key: string, raw: string) => retained.set(key, raw) });
    command.reset(); expect(pending.mock.calls.at(-1)).toEqual([false]);
  });

  it("does not let a relogin or changed route reuse the old hook callback", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const command = open("execution.queue");
    setSession("private-dispatch-token", "P", "tenant-a"); await command.run(original()); expect(fetcher).not.toHaveBeenCalled();
    const other = open("execution.sync"); window.location.hash = "#/dev-flow?task=other";
    await other.run(original("execution.sync")); expect(fetcher).not.toHaveBeenCalled();
  });
});

it("carries the selected feedback through actual E preview matching, detached queue original and cold original replay", async () => {
  const reference = { submission_id: "S", submission_digest: "d".repeat(64), decision_id: "D" };
  const prepared = preparedQueue(); prepared.session.feedback_reference = reference; prepared.payload.feedback_reference = reference;
  const value = prepared.session.preview!;
  value.feedback_context = { schema: "manager.delivery-feedback.v1", project_id: "P", task_id: "T", reference,
    submission: { definition: { ...structuredClone(value.snapshot), task_acceptance_criteria: ["Earlier criterion"], acceptance_criteria: ["Earlier criterion"] }, payload: { task_id: "T", task_basis: "a".repeat(64), definition_digest: "a".repeat(64), native_boundary_digest: "a".repeat(64), source: { kind: "tool", name: "Earlier tool", url: "" }, summary: "Earlier report", artifacts: [{ id: "A", title: "Earlier output", content: "Failing path", url: "", sha256: null }], criteria: [{ source: "task", index: 0, text_digest: "a".repeat(64), result: "not_met", evidence_ids: ["A"] }], tests: [] } },
    decision: { decision: "request_changes", review_id: "Review", comment: "Fix this path", reviewer: { id: "U", name: "Reviewer" }, created_at: "2026-10-21T04:00:00Z", issue_id: "I" } };
  value.feedback_context_sha256 = "e".repeat(64); // Structural matcher; actual API verifies the canonical hash before handing this object to the editor.
  expect(validExecutionQueuePreview("P", prepared, value)).toBe(true);
  const retained = queueOriginal(prepared); expect(retained.payload.feedback_reference).toEqual(reference); expect(retained.payload).not.toHaveProperty("feedback_context");
  const missing = { ...value, feedback_context: undefined }; expect(validExecutionQueuePreview("P", prepared, missing)).toBe(false);
  expect(validExecutionQueuePreview("P", prepared, { ...value, feedback_context: { ...value.feedback_context, reference: { ...reference, submission_id: "Other" } } })).toBe(false);
  const sent: unknown[] = [], fixture = harness("execution.queue", async (original) => { sent.push(original); if (sent.length === 1) throw new Error("Lost response"); return ack(original); });
  await fixture.create().run(retained); await fixture.create().replay(); expect(sent).toEqual([retained, retained]);
});
