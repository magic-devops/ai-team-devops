import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createProjectEditorController, projectEditorRecoverySlots, projectEditorStorageKey, useProjectEditorCommand, type ProjectEditorAction, type ProjectEditorOriginal } from "./projectEditorCommand";
import { getProjectId, getSessionRevision, setSession, setWorkspaceScope, USER_KEY } from "./authStorage";

const basis = "a".repeat(64);
const lifecycle = (): ProjectEditorOriginal => ({ action: "project.lifecycle", payload: { target_status: "archived", reason: "Project finished", preview_basis: basis }, intent: { version: 7, key: "original-lifecycle-key" } });
const metadata = (): ProjectEditorOriginal => ({ action: "project.update", payload: { name: "Original project", description: "Original description", business_id: null, project_path: "D:/project", vector_db: "lance", is_template: false }, intent: { version: 7, key: "original-metadata-key" } });
function ack(original: ProjectEditorOriginal) {
  return {
    project_id: "P", action: original.action, resource: { kind: "project", id: "P" },
    applied_version: 8, version: 9, query_generation: null, replayed: false,
    affected_refs: [{ kind: "project", id: "P" }],
    result: original.action === "project.update" ? null : {
      from_status: "active", target_status: original.payload.target_status, reason: original.payload.reason,
      archive: original.payload.target_status === "archived" ? {
        id: "archive-original", at: "2026-10-20T10:00:00Z", actor_id: "user-a", actor_name: "Admin",
        reason: original.payload.reason, preview_basis: original.payload.preview_basis,
        facts: { as_of: "2026-10-20T09:59:00Z", basis: "original-facts", metrics: { tasks_total: 1 }, risk_counts: { total_items: 0 }, unclosed_intents_total: 0 },
      } : null,
    },
  };
}
function harness(action: ProjectEditorAction, send: (original: ProjectEditorOriginal) => Promise<unknown>) {
  let raw: string | null = null, scope = "A";
  const options = { projectId: "P", action, scope: "A", currentScope: () => scope, load: () => raw, save: (value: string) => { raw = value; }, send };
  return { options, create: () => createProjectEditorController(options), stored: () => raw, restore: (value: string | null) => { raw = value; }, changeScope: (value: string) => { scope = value; } };
}

let localValues: Map<string, string>, retained: Map<string, string>;
beforeEach(() => {
  localValues = new Map(); retained = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => localValues.get(key) ?? null, setItem: (key: string, value: string) => localValues.set(key, value), removeItem: (key: string) => localValues.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => retained.get(key) ?? null, setItem: (key: string, value: string) => retained.set(key, value) });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { hash: "#/projects/portfolio?project_id=P" } }));
  setSession("private-token-a", "P", "tenant-a");
  localValues.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("project editor immutable command recovery", () => {
  it.each(["project.lifecycle", "project.update"] as ProjectEditorAction[])("retains and replays the original %s after a lost reply and reload", async (action) => {
    const original = action === "project.lifecycle" ? lifecycle() : metadata();
    const sent: ProjectEditorOriginal[] = [];
    const h = harness(action, async (value) => {
      sent.push(structuredClone(value));
      if (sent.length === 1) throw new TypeError("lost reply after commit");
      return { ...ack(value), replayed: true };
    });
    const first = h.create(); await first.run(original);
    expect(first.snapshot()).toMatchObject({ phase: "unknown", original });
    first.reset();
    await first.run({ ...original, intent: { version: 8, key: "changed-original-key" } });
    expect(sent).toHaveLength(1);
    original.payload[action === "project.lifecycle" ? "reason" : "name"] = "Changed caller draft";
    const restored = h.create();
    expect(restored.snapshot().phase).toBe("unknown");
    await restored.replay();
    expect(sent[1]).toEqual(sent[0]);
    expect(restored.snapshot().phase).toBe("succeeded");
    expect(h.create().snapshot().phase).toBe("idle");
  });

  it("records sending before dispatch and restores it as unknown without inventing a new request", async () => {
    let finish!: (value: unknown) => void;
    const original = lifecycle(), h = harness("project.lifecycle", () => new Promise((resolve) => { finish = resolve; }));
    const first = h.create(), pending = first.run(original);
    expect(JSON.parse(h.stored()!).phase).toBe("sending");
    const restored = h.create();
    expect(restored.snapshot()).toMatchObject({ phase: "unknown", original });
    first.invalidate(); finish(ack(original)); await pending;
    expect(first.snapshot().phase).toBe("unknown");
  });

  it.each([403, 409])("keeps an explicit HTTP %i refusal until adoption resets the old original", async (status) => {
    const original = metadata(), h = harness("project.update", async () => { throw new Error(`HTTP ${status}: review current project`); });
    const c = h.create(); await c.run(original);
    expect(c.snapshot()).toMatchObject({ phase: "refused", original });
    expect(h.create().snapshot()).toMatchObject({ phase: "refused", original });
    c.reset(); expect(c.snapshot().phase).toBe("idle");
  });

  it("keeps an uncertain replay uncertain even if the second reply is a definite refusal", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("lost reply")).mockRejectedValueOnce(new Error("HTTP 409: changed"));
    const c = harness("project.lifecycle", send).create(), original = lifecycle();
    await c.run(original); await c.replay();
    expect(c.snapshot()).toMatchObject({ phase: "unknown", original });
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it("does not dispatch if the original cannot be retained", async () => {
    const send = vi.fn(async (original: ProjectEditorOriginal) => ack(original)), h = harness("project.lifecycle", send);
    const c = createProjectEditorController({ ...h.options, save: () => { throw new Error("storage quota"); } });
    await c.run(lifecycle());
    expect(send).not.toHaveBeenCalled();
    expect(c.snapshot()).toMatchObject({ phase: "idle", error: "retainedOriginalUnavailable" });
  });

  it("retains a confirmed ACK in memory when storing success fails, and finishes only after the small clear write succeeds", async () => {
    const original = metadata(), key = projectEditorStorageKey("P", "project.update")!;
    let refuseClear = true;
    const send = vi.fn(async () => ack(original));
    const options = {
      projectId: "P", action: "project.update" as const, scope: "A", currentScope: () => "A",
      load: () => retained.get(key) ?? null,
      save: (value: string) => {
        if (value && JSON.parse(value).phase === "succeeded") throw new Error("success receipt exceeds remaining storage quota");
        if (!value && refuseClear) throw new Error("storage clear unavailable");
        retained.set(key, value);
      },
      send,
    };
    const c = createProjectEditorController(options), received = await c.run(original);
    expect(received).toEqual(ack(original));
    expect(c.snapshot()).toMatchObject({ phase: "succeeded", original, ack: ack(original), error: "retainedOriginalUnavailable" });
    expect(JSON.parse(retained.get(key)!).phase).toBe("sending");
    expect(projectEditorRecoverySlots("P")).toEqual(["project.update"]);
    expect(createProjectEditorController(options).snapshot()).toMatchObject({ phase: "unknown", original });
    await c.replay(); await c.run({ ...original, intent: { version: 8, key: "another-original-key" } });
    expect(send).toHaveBeenCalledTimes(1);
    c.reset();
    expect(c.snapshot()).toMatchObject({ phase: "succeeded", error: "retainedOriginalUnavailable" });
    expect(projectEditorRecoverySlots("P")).toEqual(["project.update"]);
    refuseClear = false; c.reset();
    expect(c.snapshot()).toEqual({ phase: "idle" });
    expect(retained.get(key)).toBe("");
    expect(projectEditorRecoverySlots("P")).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a validated restored success known when clearing it fails and finishes by reset without any POST", async () => {
    const original = lifecycle(), response = ack(original), key = projectEditorStorageKey("P", "project.lifecycle")!;
    retained.set(key, JSON.stringify({ phase: "succeeded", original, ack: response }));
    let refuseClear = true;
    const send = vi.fn();
    const c = createProjectEditorController({
      projectId: "P", action: "project.lifecycle", scope: "A", currentScope: () => "A",
      load: () => retained.get(key) ?? null,
      save: (value) => {
        if (refuseClear) throw new Error("storage clear unavailable");
        retained.set(key, value);
      },
      send,
    });
    expect(c.snapshot()).toMatchObject({ phase: "succeeded", original, ack: response, error: "retainedOriginalUnavailable" });
    expect(JSON.parse(retained.get(key)!).phase).toBe("succeeded");
    await c.replay(); await c.run(original);
    c.reset();
    expect(c.snapshot()).toMatchObject({ phase: "succeeded", ack: response, error: "retainedOriginalUnavailable" });
    expect(send).not.toHaveBeenCalled();
    refuseClear = false; c.reset();
    expect(c.snapshot()).toEqual({ phase: "idle" });
    expect(retained.get(key)).toBe("");
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["not-json", JSON.stringify({ phase: "unknown" }), JSON.stringify({ phase: "unknown", original: { ...metadata(), payload: { ...metadata().payload, vector_db_config: { token: "forbidden" } } } })])("fails closed for a corrupted retained original %s", async (raw) => {
    const send = vi.fn(), h = harness("project.update", send); h.restore(raw);
    const c = h.create();
    expect(c.snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalInvalid" });
    await c.replay(); await c.run(metadata());
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed when retained storage cannot be read", async () => {
    const send = vi.fn(), h = harness("project.update", send);
    const c = createProjectEditorController({ ...h.options, load: () => { throw new Error("storage disabled"); } });
    expect(c.snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalInvalid" });
    await c.run(metadata()); await c.replay(); expect(send).not.toHaveBeenCalled();
  });

  it("keeps a maximum multiline metadata description recoverable when its signature expands JSON escaping", async () => {
    const original = metadata(); original.payload.description = "\n".repeat(20000);
    original.intent.signature = JSON.stringify([original.action, original.payload]);
    const h = harness("project.update", async () => { throw new Error("lost reply"); });
    await h.create().run(original);
    expect(h.stored()!.length).toBeGreaterThan(100000);
    expect(h.create().snapshot()).toMatchObject({ phase: "unknown", original });
  });

  it("ignores a late ACK after scope invalidation and blocks a retained callback after an ABA switch", async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => { finish = resolve; })), h = harness("project.lifecycle", send);
    const c = h.create(), original = lifecycle(), pending = c.run(original);
    h.changeScope("B"); c.invalidate(); h.changeScope("A"); finish(ack(original)); await pending;
    expect(c.snapshot().phase).toBe("unknown"); await c.replay();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    {}, { project_id: "Q" }, { action: "project.update" }, { resource: { kind: "task", id: "P" } },
    { resource: { kind: "project", id: "Q" } }, { applied_version: 9 }, { version: 7 }, { query_generation: 0 },
    { affected_refs: [] }, { replayed: "yes" }, { result: null },
  ])("does not accept a wrong project/action/version/receipt shape: %j", async (patch) => {
    const original = lifecycle();
    const value = Object.keys(patch).length ? { ...ack(original), ...patch } : {};
    const c = harness("project.lifecycle", async () => value).create(); await c.run(original);
    expect(c.snapshot()).toMatchObject({ phase: "unknown", original });
  });

  it.each([
    { from_status: "unknown" }, { from_status: "archived" }, { target_status: "paused" }, { reason: "Another reason" },
    { archive: null }, { archive: { id: "archive-missing-original" } },
  ])("validates the real lifecycle result against the captured target and reason: %j", async (patch) => {
    const original = lifecycle(), response = ack(original);
    const c = harness("project.lifecycle", async () => ({ ...response, result: { ...response.result, ...patch } })).create();
    await c.run(original); expect(c.snapshot().phase).toBe("unknown");
  });

  it.each(["reason", "preview_basis"])("rejects an archive whose %s belongs to another original", async (field) => {
    const original = lifecycle(), response = ack(original), result = response.result!;
    const c = harness("project.lifecycle", async () => ({ ...response, result: { ...result, archive: { ...result.archive, [field]: "other" } } })).create();
    await c.run(original); expect(c.snapshot().phase).toBe("unknown");
  });

  it("accepts a real non-archive transition with archive=null, rather than requiring a fabricated archive", async () => {
    const original = lifecycle(); original.payload.target_status = "paused";
    const c = harness("project.lifecycle", async () => ack(original)).create(); await c.run(original);
    expect(c.snapshot().phase).toBe("succeeded");
  });

  it("accepts metadata's actual null result and rejects an invented metadata result object", async () => {
    const original = metadata();
    const valid = harness("project.update", async () => ack(original)).create(); await valid.run(original);
    expect(valid.snapshot().phase).toBe("succeeded");
    const forged = harness("project.update", async () => ({ ...ack(original), result: { name: original.payload.name } })).create();
    await forged.run(original); expect(forged.snapshot().phase).toBe("unknown");
  });

  it("keeps an oversized ACK out of durable storage while retaining its original for recovery", async () => {
    const original = lifecycle(), response = ack(original), result = response.result!;
    const h = harness("project.lifecycle", async () => ({ ...response, result: { ...result, archive: { ...result.archive, facts: { ...result.archive!.facts, metrics: { padding: "x".repeat(400000) } } } } }));
    await h.create().run(original);
    expect(h.create().snapshot()).toMatchObject({ phase: "unknown", original });
    expect(h.stored()!.length).toBeLessThan(400000);
  });

  it.each([
    { name: "" }, { description: "x".repeat(20001) }, { business_id: "" }, { project_path: "x".repeat(513) },
    { vector_db: "unknown" }, { is_template: "false" }, { goal: "outside this editor" }, { vector_db_config: { token: "private" } },
  ])("rejects invalid or out-of-editor metadata before dispatch: %j", async (patch) => {
    const send = vi.fn(), c = harness("project.update", send).create();
    await c.run({ ...metadata(), payload: { ...metadata().payload, ...patch } });
    expect(send).not.toHaveBeenCalled(); expect(c.snapshot().phase).toBe("idle");
  });

  it.each([
    { target_status: "other" }, { reason: " " }, { reason: " original with surrounding spaces " },
    { preview_basis: "not-a-basis" }, { extra: "unexpected" },
  ])("rejects a malformed lifecycle payload: %j", async (patch) => {
    const send = vi.fn(), c = harness("project.lifecycle", send).create();
    await c.run({ ...lifecycle(), payload: { ...lifecycle().payload, ...patch } }); expect(send).not.toHaveBeenCalled();
  });

  it("does not restore a different action or a signature that no longer describes its original payload", async () => {
    const send = vi.fn(), h = harness("project.lifecycle", send);
    h.restore(JSON.stringify({ phase: "unknown", original: metadata() }));
    expect(h.create().snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalInvalid" });
    const original = lifecycle(); original.intent.signature = JSON.stringify([original.action, { ...original.payload, reason: "old reason" }]);
    const c = harness("project.lifecycle", send).create(); await c.run(original); expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { version: -1 }, { version: 1.5 }, { version: Number.MAX_SAFE_INTEGER + 1 },
    { key: "short" }, { key: "x".repeat(101) }, { key: "key-with\ncontrol" }, { key: " surrounding-key " },
  ])("rejects an invalid original version or idempotency identity: %j", async (patch) => {
    const send = vi.fn(), c = harness("project.update", send).create();
    await c.run({ ...metadata(), intent: { ...metadata().intent, ...patch } }); expect(send).not.toHaveBeenCalled();
  });
});

describe("project editor storage identity and host recovery probe", () => {
  it("separates user, tenant, login revision, project and action without storing the token in the key", () => {
    const key = projectEditorStorageKey("P", "project.lifecycle")!;
    expect(key.startsWith("sop.project-command.v1:")).toBe(true);
    expect(key).toContain(getSessionRevision()!); expect(key).not.toContain("private-token-a");
    expect(projectEditorStorageKey("Q", "project.lifecycle")).not.toBe(key);
    expect(projectEditorStorageKey("P", "project.update")).not.toBe(key);
    localValues.set(USER_KEY, JSON.stringify({ id: "user-b", tenant_id: "tenant-a" }));
    expect(projectEditorStorageKey("P", "project.lifecycle")).not.toBe(key);
    localValues.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-b" }));
    expect(projectEditorStorageKey("P", "project.lifecycle")).not.toBe(key);
    localValues.set(USER_KEY, JSON.stringify({ id: "user-a", tenant_id: "tenant-a" }));
    setSession("private-token-a", "P", "tenant-a");
    expect(projectEditorStorageKey("P", "project.lifecycle")).not.toBe(key);
  });

  it("does not invent an existing original if identity is missing", () => {
    localValues.delete(USER_KEY);
    expect(projectEditorStorageKey("P", "project.lifecycle")).toBeNull();
    expect(projectEditorRecoverySlots("P")).toEqual([]);
  });

  it.each(["sending", "unknown"])("probes both action slots synchronously for %s originals", (phase) => {
    retained.set(projectEditorStorageKey("P", "project.lifecycle")!, JSON.stringify({ phase, original: lifecycle() }));
    retained.set(projectEditorStorageKey("P", "project.update")!, JSON.stringify({ phase, original: metadata() }));
    expect(projectEditorRecoverySlots("P")).toEqual(["project.lifecycle", "project.update"]);
  });

  it.each([null, "", JSON.stringify({ phase: "refused", original: lifecycle() }), JSON.stringify({ phase: "succeeded", original: lifecycle(), ack: ack(lifecycle()) })])("does not mark a fresh or valid closed slot as pending: %s", (raw) => {
    if (raw !== null) retained.set(projectEditorStorageKey("P", "project.lifecycle")!, raw);
    expect(projectEditorRecoverySlots("P")).toEqual([]);
  });

  it.each(["not-json", JSON.stringify({ phase: "idle" }), JSON.stringify({ phase: "idle", original: lifecycle() }), JSON.stringify({ phase: "future" }), JSON.stringify({ phase: "refused" }), JSON.stringify({ phase: "succeeded", original: lifecycle(), ack: {} })])("treats a corrupt or unknown stored shape as pending: %s", (raw) => {
    retained.set(projectEditorStorageKey("P", "project.lifecycle")!, raw);
    expect(projectEditorRecoverySlots("P")).toEqual(["project.lifecycle"]);
  });

  it("conservatively reports existing identities when storage reading throws and never mutates a slot", () => {
    const setItem = vi.fn(); vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("unavailable"); }, setItem });
    expect(projectEditorRecoverySlots("P")).toEqual(["project.lifecycle", "project.update"]);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("actual project editor hook storage and command transport", () => {
  function open(action: ProjectEditorAction) {
    let command!: ReturnType<typeof useProjectEditorCommand>;
    function Probe() { command = useProjectEditorCommand("P", action); return null; }
    renderToStaticMarkup(createElement(Probe));
    return command;
  }

  it("fails closed before dispatch when a real hook has no safe storage identity", async () => {
    localValues.delete(USER_KEY);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const command = open("project.update");
    expect(command.snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalUnavailable" });
    await command.run(metadata()); await command.replay(); expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the exact canonical metadata body and original project through submitProjectCommand", async () => {
    const original = metadata();
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(ack(original)), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const command = open("project.update"); await command.run(original);
    expect(command.snapshot().phase).toBe("succeeded");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("/api/v1/delivery/commands");
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-Project-Id")).toBe("P");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-token-a");
    expect(JSON.parse(String(init?.body))).toEqual({ action: original.action, payload: original.payload, expected_version: 7, idempotency_key: original.intent.key });
  });

  it.each(["Q", null])("manages portfolio target P while preserving the explicitly selected workspace %s", async (workspace) => {
    setWorkspaceScope({ projectId: workspace, projectCode: workspace, businessCode: null });
    const original = metadata();
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(
      url.endsWith("/api/v1/auth/me")
        ? { user_id: "user-a", tenant_id: "tenant-a", tenant_code: "tenant-a", default_project_id: "Q", default_project_code: "Q" }
        : ack(original),
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const command = open("project.update"), received = await command.run(original);
    expect(received).toMatchObject({ project_id: "P", resource: { kind: "project", id: "P" } });
    expect(command.snapshot().phase).toBe("succeeded");
    const writes = fetcher.mock.calls.filter(([url]) => url.endsWith("/api/v1/delivery/commands"));
    expect(writes).toHaveLength(1);
    expect(writes[0][1]?.method).toBe("POST");
    expect(new Headers(writes[0][1]?.headers).get("X-Project-Id")).toBe("P");
    expect(new Headers(writes[0][1]?.headers).get("Authorization")).toBe("Bearer private-token-a");
    expect(getProjectId()).toBe(workspace);
    expect(projectEditorStorageKey("P", "project.update")).not.toBe(projectEditorStorageKey("Q", "project.update"));
  });

  it("restores a real hook after a lost response and replays identical transport bytes", async () => {
    const original = lifecycle(), bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) throw new TypeError("lost response after commit");
      return new Response(JSON.stringify({ ...ack(original), replayed: true }), { status: 200 });
    }));
    const first = open("project.lifecycle"); await first.run(original);
    expect(first.snapshot().phase).toBe("unknown");
    expect(projectEditorRecoverySlots("P")).toEqual(["project.lifecycle"]);
    const restored = open("project.lifecycle"); await restored.replay();
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    expect(restored.snapshot().phase).toBe("succeeded");
    expect(projectEditorRecoverySlots("P")).toEqual([]);
  });

  it("does not let an old hook callback submit after the account and selected project change", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const originalEditor = open("project.update");
    setSession("private-token-b", "Q", "tenant-b");
    await originalEditor.run(metadata());
    expect(fetcher).not.toHaveBeenCalled();
    expect(originalEditor.snapshot().phase).toBe("idle");
  });
});
