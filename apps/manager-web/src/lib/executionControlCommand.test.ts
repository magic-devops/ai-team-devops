/** Contract definitions only. Execution, type and browser verification are deferred. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExecutionControlController,
  executionControlOriginal,
  executionControlRecoveryPending,
  executionControlStorageKey,
  useExecutionControlCommand,
  validExecutionControlAck,
  type ExecutionControlOriginal,
} from "./executionControlCommand";
import { prepareExecutionControl, type ExecutionControlAction, type ExecutionControlPreview } from "./executionRuntime";
import { getSessionRevision, setSession, setWorkspaceScope, USER_KEY } from "./authStorage";

const variants: Array<[ExecutionControlAction, "approve" | "reject" | undefined]> = [
  ["execution.start", undefined], ["execution.retry", undefined], ["execution.cancel", undefined],
  ["execution.approval", "approve"], ["execution.approval", "reject"],
];
function preview(action: ExecutionControlAction = "execution.cancel", decision?: "approve" | "reject"): ExecutionControlPreview {
  return {
    project_id: "P", execution_id: "E", action, version: 7, allowed: true, reasons: [],
    payload: { id: "E", run_id: "R", run_version: 9, attempt: 2, control_basis: "a".repeat(64), reason: "Operate the fixed attempt",
      ...(action === "execution.approval" ? { approval_id: "AP", approval_version: 4, decision: decision || "approve" } : {}) },
  };
}
function original(action: ExecutionControlAction = "execution.cancel", decision?: "approve" | "reject") {
  return executionControlOriginal(prepareExecutionControl("P", "E", preview(action, decision), "original-control-key"), "W");
}
function ack(value: ExecutionControlOriginal) {
  const launches = value.action === "execution.start" || value.action === "execution.retry" || value.action === "execution.approval" && value.payload.decision === "approve";
  return {
    project_id: "P", action: value.action, resource: { kind: "execution", id: "E" },
    applied_version: value.intent.version + 1, version: value.intent.version + 1,
    query_generation: 2, replayed: false, affected_refs: [{ kind: "execution", id: "E" }],
    result: { run_id: "R", run_version: 10, replayed_runtime: false,
      ...(launches ? { start_run: { workspace_id: "W", run_id: "R", attempt: Number(value.payload.attempt) + (value.action === "execution.retry" ? 1 : 0), resume: null } } : {}) },
  };
}
function harness(send: (value: ExecutionControlOriginal) => Promise<unknown>) {
  let raw: string | null = null, scope = "A";
  const options = { projectId: "P", executionId: "E", scope: "A", currentScope: () => scope,
    load: () => raw, save: (value: string) => { raw = value; }, send };
  return { options, create: () => createExecutionControlController(options), stored: () => raw,
    restore: (value: string | null) => { raw = value; }, changeScope: (value: string) => { scope = value; } };
}
let localValues: Map<string, string>, retained: Map<string, string>;
beforeEach(() => {
  localValues = new Map(); retained = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => localValues.get(key) ?? null, setItem: (key: string, value: string) => localValues.set(key, value), removeItem: (key: string) => localValues.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => retained.get(key) ?? null, setItem: (key: string, value: string) => retained.set(key, value) });
  const location = { hash: "#/dev-flow?execution_id=E", href: "http://localhost/#/dev-flow?execution_id=E" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("private-token-a", "P", "tenant-a");
  localValues.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("execution control durable original and strict acknowledgement", () => {
  it.each(variants)("restores the exact %s/%s command after a lost reply", async (action, decision) => {
    const value = original(action, decision), sent: ExecutionControlOriginal[] = [];
    const h = harness(async (captured) => {
      sent.push(structuredClone(captured));
      if (sent.length === 1) throw new TypeError("Reply lost after possible effect");
      return { ...ack(captured), replayed: true };
    });
    const first = h.create(); await first.run(value);
    expect(first.snapshot()).toMatchObject({ phase: "unknown", original: value });
    value.payload.reason = "A different operation"; value.intent.key = "replacement-control-key";
    first.reset(); await first.run(value); expect(sent).toHaveLength(1);
    const restored = h.create(); await restored.replay();
    expect(sent[1]).toEqual(sent[0]); expect(restored.snapshot().phase).toBe("succeeded");
    expect(h.create().snapshot().phase).toBe("idle");
  });

  it("retains sending before transport and restores it as unknown while blocking duplicates", async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const value = original(), h = harness(send), first = h.create();
    const running = first.run(value); await first.run(original("execution.retry"));
    expect(JSON.parse(h.stored()!)).toMatchObject({ phase: "sending", original: value });
    expect(send).toHaveBeenCalledTimes(1);
    expect(h.create().snapshot()).toMatchObject({ phase: "unknown", original: value });
    first.invalidate(); finish(ack(value)); await running;
    expect(first.snapshot().phase).toBe("unknown");
  });

  it("does not send if retaining the original fails", async () => {
    const send = vi.fn(), h = harness(send);
    const command = createExecutionControlController({ ...h.options, save: () => { throw new Error("Storage quota"); } });
    await command.run(original()); expect(send).not.toHaveBeenCalled();
    expect(command.snapshot().error).toBe("retainedOriginalUnavailable");
  });

  it.each([400, 401, 403, 404, 409, 422])("retains unknown after a later HTTP %s refusal", async (status) => {
    const send = vi.fn().mockRejectedValueOnce(new Error("Lost response")).mockRejectedValueOnce(new Error(`HTTP ${status}: later refusal`));
    const command = harness(send).create(), value = original();
    await command.run(value); await command.replay(); command.reset(); await command.run(original("execution.retry"));
    expect(command.snapshot()).toMatchObject({ phase: "unknown", original: value });
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it("allows only explicit adoption to reset a first definite refusal", async () => {
    const command = harness(async () => { throw new Error('HTTP 409: {"detail":{"code":"execution_control_stale","message":"Review a new fixed preview"}}'); }).create();
    const value = original(); await command.run(value);
    expect(command.snapshot()).toMatchObject({ phase: "refused", original: value });
    command.reset(); expect(command.snapshot().phase).toBe("idle");
  });

  it("rejects an old controller before and after a change of session scope", async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const h = harness(send), command = h.create();
    h.changeScope("B"); await command.run(original()); expect(send).not.toHaveBeenCalled();
    h.changeScope("A"); const running = command.run(original());
    h.changeScope("B"); finish(ack(original())); await running;
    expect(command.snapshot().phase).toBe("sending");
    command.invalidate(); expect(command.snapshot().phase).toBe("unknown");
  });

  it.each([
    "project", "action", "resource", "refs", "refs-extra", "refs-duplicate", "version", "result-null", "run", "run-version", "replayed-runtime", "workspace", "attempt", "start-run",
  ])("does not acknowledge mismatched %s evidence", async (field) => {
    const value = original("execution.retry"), answer: any = ack(value);
    if (field === "project") answer.project_id = "Q";
    if (field === "action") answer.action = "execution.cancel";
    if (field === "resource") answer.resource.id = "foreign-execution";
    if (field === "refs") answer.affected_refs = [];
    if (field === "refs-extra") answer.affected_refs.push({ kind: "execution", id: "foreign" });
    if (field === "refs-duplicate") answer.affected_refs.push({ kind: "execution", id: "E" });
    if (field === "version") answer.applied_version++;
    if (field === "result-null") answer.result = null;
    if (field === "run") answer.result.run_id = "foreign-run";
    if (field === "run-version") answer.result.run_version = 8;
    if (field === "replayed-runtime") answer.result.replayed_runtime = "yes";
    if (field === "workspace") answer.result.start_run.workspace_id = "foreign-workspace";
    if (field === "attempt") answer.result.start_run.attempt = 2;
    if (field === "start-run") delete answer.result.start_run;
    expect(validExecutionControlAck("P", "E", value, answer)).toBe(false);
    const command = harness(async () => answer).create(); await command.run(value);
    expect(command.snapshot()).toMatchObject({ phase: "unknown", original: value });
  });

  it("accepts only the fixed approval resume identity and its next version", () => {
    const value = original("execution.approval", "approve"), answer: any = ack(value);
    answer.result.start_run.resume = { approval_id: "AP", approval_version: 5 };
    expect(validExecutionControlAck("P", "E", value, answer)).toBe(true);
    for (const resume of [{ approval_id: "foreign", approval_version: 5 }, { approval_id: "AP", approval_version: 4 }, { approval_id: "AP", approval_version: 6 }]) {
      expect(validExecutionControlAck("P", "E", value, { ...answer, result: { ...answer.result, start_run: { ...answer.result.start_run, resume } } })).toBe(false);
    }
  });

  it("accepts a genuine not-started cancellation without inventing a run or attempt in its result", () => {
    const fixed = preview(); fixed.payload.run_id = ""; fixed.payload.run_version = 0;
    const value = executionControlOriginal(prepareExecutionControl("P", "E", fixed, "not-started-control-key"), "W");
    const answer = { ...ack(value), result: { run_id: "", run_version: 0, replayed_runtime: false } };
    expect(validExecutionControlAck("P", "E", value, answer)).toBe(true);
  });

  it("retains a known ACK through local persistence and cleanup failures, and never replays its effect", async () => {
    const value = original(), send = vi.fn(async () => ack(value)), h = harness(send);
    let unavailable = true;
    const command = createExecutionControlController({ ...h.options, save: (raw) => {
      if (unavailable && (!raw || JSON.parse(raw).phase === "succeeded")) throw new Error("Storage unavailable");
      h.options.save(raw);
    } });
    await command.run(value); expect(command.snapshot()).toMatchObject({ phase: "succeeded", ack: ack(value), error: "retainedOriginalUnavailable" });
    command.reset(); await command.replay(); await command.run(value);
    expect(send).toHaveBeenCalledTimes(1); expect(command.snapshot().phase).toBe("succeeded");
    unavailable = false; command.reset(); expect(command.snapshot().phase).toBe("idle"); expect(h.stored()).toBe("");
  });

  it("keeps a validated restored receipt known if clearing storage fails", () => {
    const value = original(), h = harness(vi.fn());
    h.restore(JSON.stringify({ phase: "succeeded", original: value, ack: ack(value) }));
    const command = createExecutionControlController({ ...h.options, save: () => { throw new Error("Cleanup unavailable"); } });
    expect(command.snapshot()).toMatchObject({ phase: "succeeded", original: value, error: "retainedOriginalUnavailable" });
  });

  it("constructs a detached credential-free original with the fixed workspace", () => {
    const prepared = prepareExecutionControl("P", "E", preview(), "original-control-key");
    const value = executionControlOriginal(prepared, "W");
    prepared.payload.reason = "New caller draft";
    expect(value.payload.reason).toBe("Operate the fixed attempt");
    expect(value.workspaceId).toBe("W"); expect(value).not.toHaveProperty("scope");
    expect(JSON.stringify(value)).not.toContain("private-token-a");
  });

  it.each(["execution", "basis", "run-pair", "attempt", "approval", "workspace", "version", "key"])("rejects malformed %s originals before dispatch", async (field) => {
    const value: any = original();
    if (field === "execution") value.payload.id = "foreign";
    if (field === "basis") value.payload.control_basis = "not-a-proof";
    if (field === "run-pair") value.payload.run_version = 0;
    if (field === "attempt") value.payload.attempt = 0;
    if (field === "approval") value.payload.approval_id = "AP";
    if (field === "workspace") value.workspaceId = "";
    if (field === "version") value.intent.version = -1;
    if (field === "key") value.intent.key = "short";
    const send = vi.fn(), command = harness(send).create(); await command.run(value);
    expect(send).not.toHaveBeenCalled(); expect(command.snapshot().error).toBe("retainedOriginalInvalid");
  });
});

describe("execution control storage identity and actual hook", () => {
  it("separates user, tenant, login revision, project and execution without persisting credentials", () => {
    const key = executionControlStorageKey("P", "E")!;
    expect(key).toContain(getSessionRevision()!); expect(key).not.toContain("private-token-a");
    expect(executionControlStorageKey("Q", "E")).not.toBe(key); expect(executionControlStorageKey("P", "F")).not.toBe(key);
    localValues.set(USER_KEY, JSON.stringify({ id: "user-b", tenant_id: "tenant-a" })); expect(executionControlStorageKey("P", "E")).not.toBe(key);
    localValues.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-b" })); expect(executionControlStorageKey("P", "E")).not.toBe(key);
    localValues.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" })); setSession("private-token-a", "P", "tenant-a");
    expect(executionControlStorageKey("P", "E")).not.toBe(key);
  });

  it.each(["sending", "unknown", "broken-json", "idle", "mismatched-ack"])("probes %s without mutating the retained slot", (phase) => {
    const value = original(), raw = phase === "broken-json" ? "not-json" : JSON.stringify({ phase: phase === "mismatched-ack" ? "succeeded" : phase, original: value, ack: {} });
    retained.set(executionControlStorageKey("P", "E")!, raw);
    expect(executionControlRecoveryPending("P", "E")).toBe(true);
    expect(retained.get(executionControlStorageKey("P", "E")!)).toBe(raw);
  });

  it("treats fresh and valid refused slots as closed, and unavailable storage conservatively", () => {
    const key = executionControlStorageKey("P", "E")!, value = original();
    expect(executionControlRecoveryPending("P", "E")).toBe(false);
    for (const raw of ["", JSON.stringify({ phase: "refused", original: value })]) {
      retained.set(key, raw); expect(executionControlRecoveryPending("P", "E")).toBe(false);
    }
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("Read denied"); } });
    expect(executionControlRecoveryPending("P", "E")).toBe(true);
  });

  function open() {
    let command!: ReturnType<typeof useExecutionControlCommand>;
    function Probe() { command = useExecutionControlCommand("P", "E", "selected-session"); return null; }
    renderToStaticMarkup(createElement(Probe)); return command;
  }
  it("keeps a confirmed stored receipt discoverable until actual hook cleanup without sending", () => {
    const value = original(), key = executionControlStorageKey("P", "E")!;
    const raw = JSON.stringify({ phase: "succeeded", original: value, ack: ack(value) });
    retained.set(key, raw); expect(executionControlRecoveryPending("P", "E")).toBe(true);
    expect(retained.get(key)).toBe(raw);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(open().snapshot().phase).toBe("idle");
    expect(executionControlRecoveryPending("P", "E")).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed when the actual hook has no safe durable identity", async () => {
    localValues.delete(USER_KEY); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const command = open(); await command.run(original()); await command.replay();
    expect(command.snapshot().phase).toBe("unknown"); expect(fetcher).not.toHaveBeenCalled();
  });

  it("restores the actual hook and sends identical canonical transport bytes after a lost reply", async () => {
    const value = original("execution.retry"), bodies: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) throw new TypeError("Lost reply");
      return new Response(JSON.stringify({ ...ack(value), replayed: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    const first = open(); await first.run(value); expect(first.snapshot().phase).toBe("unknown");
    expect(executionControlRecoveryPending("P", "E")).toBe(true);
    const restored = open(); await restored.replay();
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0])).toEqual({ action: value.action, payload: value.payload, expected_version: 7, idempotency_key: value.intent.key });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Project-Id")).toBe("P");
    expect(restored.snapshot().phase).toBe("succeeded");
    expect(JSON.stringify([...retained.values()])).not.toContain("private-token-a");
  });

  it("does not replay an old actual hook after the same token is logged in again", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const command = open(); setSession("private-token-a", "P", "tenant-a");
    await command.run(original()); expect(fetcher).not.toHaveBeenCalled();
    setWorkspaceScope({ projectId: "Q", projectCode: "Q" });
    await command.replay(); expect(fetcher).not.toHaveBeenCalled();
  });
});
