import { describe, expect, it } from "vitest";
import { createWorkOrderController, validWorkOrderAck, validWorkOrderOriginal, type WorkOrderOriginal } from "./externalWorkOrderCommand";
const hash = "a".repeat(64);
const createOriginal: WorkOrderOriginal = { action: "work_order.create", binding: { task_id: "T", work_order_id: null, request_digest: null, packet_digest: hash, state: null },
  payload: { task_id: "T", task_basis: hash, definition_digest: hash, native_boundary_digest: hash, executor_member_id: "Tool", preview_basis: hash, instructions: "Actual instructions" }, intent: { version: 3, key: "work-original-1" } };
const ack = { project_id: "P", action: "work_order.create", resource: { kind: "work_order", id: "W" }, result: { work_order_id: "W", task_ids: ["T"], request_digest: hash, packet_digest: hash,
  order_revision: 1, state: "queued", submission_id: null }, affected_refs: [{ kind: "work_order", id: "W" }, { kind: "task", id: "T" }], applied_version: 4, version: 4, query_generation: null, replayed: false };

describe("formal work order actual persistent controller", () => {
  it("retains the complete original before HTTP and safely recovers that request after refresh without a fresh GET", async () => {
    let stored = "", attempts = 0;
    const sent: unknown[] = [];
    const options = { projectId: "P", taskId: "T", scope: "actor:P:session", currentScope: () => "actor:P:session", load: () => stored, save: (value: string) => { stored = value; }, send: async (original: WorkOrderOriginal) => {
      expect(JSON.parse(stored).original).toEqual(original); sent.push(original); if (++attempts === 1) throw new Error("network timeout"); return { ...ack, replayed: true };
    } };
    const first = createWorkOrderController(options);
    await first.run(createOriginal);
    expect(first.snapshot().phase).toBe("unknown");
    const restored = createWorkOrderController(options);
    expect(restored.snapshot().phase).toBe("unknown");
    await restored.replay();
    expect(sent).toEqual([createOriginal, createOriginal]);
    expect(restored.snapshot().phase).toBe("succeeded");
    expect(restored.snapshot().ack?.result?.state).toBe("queued");
  });

  it.each(["task", "packet", "result-extra", "resource", "duplicate-ref", "ref-extra"])("keeps a mismatching %s ACK unknown instead of freeing the original", async (fault) => {
    const bad = structuredClone(ack);
    if (fault === "task") bad.result.task_ids = ["Other"];
    if (fault === "packet") bad.result.packet_digest = "b".repeat(64);
    if (fault === "result-extra") Object.assign(bad.result, { run_id: "fabricated" });
    if (fault === "resource") bad.resource.id = "Other";
    if (fault === "duplicate-ref") bad.affected_refs.push(bad.affected_refs[0]);
    if (fault === "ref-extra") Object.assign(bad.affected_refs[0], { run_id: "fabricated" });
    let stored = "";
    const command = createWorkOrderController({ projectId: "P", taskId: "T", scope: "scope", currentScope: () => "scope", load: () => stored, save: (raw) => { stored = raw; }, send: async () => bad });
    await command.run(createOriginal);
    expect(command.snapshot().phase).toBe("unknown");
    expect(command.snapshot().original).toEqual(createOriginal);
  });

  it("does not send when saving the original fails or the actor scope has changed", async () => {
    let sent = 0, scope = "actor-1";
    const command = createWorkOrderController({ projectId: "P", taskId: "T", scope, currentScope: () => scope, load: () => null, save: () => { throw new Error("storage denied"); }, send: async () => { sent++; return ack; } });
    await command.run(createOriginal); expect(sent).toBe(0);
    scope = "actor-2"; await command.run(createOriginal); expect(sent).toBe(0);
  });

  it("keeps explicit unknown percent and requires the exact claimed order revision for progress", () => {
    const original: WorkOrderOriginal = { action: "work_order.progress", binding: { task_id: "T", work_order_id: "W", request_digest: hash, packet_digest: hash, state: "claimed" },
      payload: { id: "W", order_revision: 2, percent: null, status: "running", message: "Actual observed progress" }, intent: { version: 4, key: "progress-original-1" } };
    expect(validWorkOrderOriginal(original, "T")).toBe(true);
    expect(validWorkOrderOriginal({ ...original, payload: { ...original.payload, percent: undefined } }, "T")).toBe(false);
    expect(validWorkOrderOriginal({ ...original, payload: { ...original.payload, status: "success" } }, "T")).toBe(false);
    expect(validWorkOrderOriginal(original, "Other")).toBe(false);
  });

  it("does not validate a reported delivery as accepted or as a fabricated native run", () => {
    expect(validWorkOrderAck("P", "T", createOriginal, ack)).toBe(true);
    expect(validWorkOrderAck("P", "T", createOriginal, { ...ack, result: { ...ack.result, state: "accepted" } })).toBe(false);
    expect(validWorkOrderAck("P", "T", createOriginal, { ...ack, result: { ...ack.result, state: "running" } })).toBe(false);
  });
});
