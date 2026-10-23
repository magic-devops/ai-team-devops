/** SOURCE ONLY: these definitions have not been executed. */
import { describe, expect, it, vi } from "vitest";
import { createRuntimeBindingController, validRuntimeBindingOriginal, validRuntimeBindingAck, type RuntimeBindingOriginal } from "./runtimeBindingCommand";
const original = () => ({ action: "member.runtime.bind" as const, payload: { member_id: "member-tool", workspace_id: "W", agent_id: "A", agent_version: 3 }, intent: { version: 8, key: "fixed-binding-key" } });
const ack = (value = original()) => ({ project_id: "P", action: value.action, resource: { kind: "member", id: "member-tool" }, result: null,
  applied_version: value.intent.version + 1, version: 9, query_generation: 3, replayed: false, affected_refs: [{ kind: "member", id: "member-tool" }] });
function setup(raw: string | null = null, sender: (value: RuntimeBindingOriginal) => Promise<unknown> = async () => ack()) {
  const send = vi.fn(sender);
  let scope = "scope", stored = raw;
  const save = vi.fn((next: string) => { stored = next; });
  const create = () => createRuntimeBindingController({ projectId: "P", memberId: "member-tool", scope: "scope", currentScope: () => scope, load: () => stored, save, send });
  return { controller: create(), create, save, send, read: () => stored, leave: () => { scope = "other"; } };
}
describe("fixed runtime binding operation", () => {
  it("accepts bind/unbind originals and rejects ambiguity before retention or sending", () => {
    const value = original(); expect(validRuntimeBindingOriginal(value, "member-tool")).toBe(true);
    expect(validRuntimeBindingOriginal({ ...value, action: "member.runtime.unbind", payload: { member_id: "member-tool" } }, "member-tool")).toBe(true);
    for (const changed of [{ ...value, payload: { ...value.payload, agent_version: true } }, { ...value, payload: { ...value.payload, extra: 1 } },
      { ...value, payload: { ...value.payload, workspace_id: " W" } }, { ...value, intent: { ...value.intent, signature: "extra" } },
      { ...value, intent: { ...value.intent, key: "short" } }, { ...value, action: "member.save" }]) expect(validRuntimeBindingOriginal(changed, "member-tool")).toBe(false);
    expect(validRuntimeBindingOriginal(value, "other-member")).toBe(false);
  });
  it("rejects wrong or incomplete receipts instead of inferring a successful association", () => {
    const value = original(); expect(validRuntimeBindingAck("P", "member-tool", value, ack())).toBe(true);
    for (const changed of [{ ...ack(), project_id: "Q" }, { ...ack(), action: "member.runtime.unbind" }, { ...ack(), applied_version: 10 },
      { ...ack(), resource: { kind: "member", id: "other" } }, { ...ack(), affected_refs: [] }, { ...ack(), result: {} }, { ...ack(), extra: true }])
      expect(validRuntimeBindingAck("P", "member-tool", value, changed)).toBe(false);
  });
  it("retains before send, replays the exact immutable original, and keeps success until applied", async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError("Lost response")).mockResolvedValueOnce(ack());
    const env = setup(null, send), value = original(); await env.controller.run(value);
    expect(env.save.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(env.controller.snapshot().phase).toBe("unknown"); value.payload.agent_version = 4;
    const restored = env.create(); await restored.replay();
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]); expect(send.mock.calls[1][0].payload.agent_version).toBe(3);
    expect(restored.snapshot().phase).toBe("succeeded"); expect(env.create().snapshot().phase).toBe("succeeded");
    restored.reset(); expect(restored.snapshot().phase).toBe("idle");
  });
  it("does not send if the original cannot be persisted", async () => {
    const env = setup(); env.save.mockImplementation(() => { throw new Error("Storage denied"); });
    await env.controller.run(original()); expect(env.send).not.toHaveBeenCalled(); expect(env.controller.snapshot().error).toBe("retainedOriginalUnavailable");
  });
  it("never turns a refusal during an unknown replay into permission to create another request", async () => {
    const env = setup(JSON.stringify({ phase: "unknown", original: original() }), vi.fn().mockRejectedValue(new Error("HTTP 403: revoked")));
    await env.controller.replay(); env.controller.reset(); expect(env.controller.snapshot().phase).toBe("unknown");
    await env.controller.run(original()); expect(env.send).toHaveBeenCalledTimes(1);
  });
  it("keeps invalid receipt outcomes unknown and invalid stored originals blocked", async () => {
    const env = setup(null, vi.fn().mockResolvedValue({ version: 9 })); await env.controller.run(original()); expect(env.controller.snapshot().phase).toBe("unknown");
    const corrupt = setup('{"phase":"unknown","original":{"action":"member.save"}}');
    expect(corrupt.controller.snapshot()).toMatchObject({ phase: "unknown", error: "retainedOriginalInvalid" });
    await corrupt.controller.replay(); expect(corrupt.send).not.toHaveBeenCalled(); expect(corrupt.read()).not.toBe("");
  });
  it("ignores late responses after scope changes and records sending as unknown on unmount", async () => {
    let finish!: (value: unknown) => void;
    const env = setup(null, vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const pending = env.controller.run(original()); env.leave(); env.controller.invalidate(); finish(ack()); await pending;
    expect(env.controller.snapshot().phase).toBe("unknown"); expect(JSON.parse(env.read()!).phase).toBe("unknown");
  });
});
