/** Actual controller definitions, deliberately unrun in the frozen window. */
import { describe, expect, it, vi } from "vitest";
import { createOpsIntakeController, validOpsIntakeOriginal, validOpsIntakeAck, type OpsIntakeOriginal } from "./opsIntakeCommand";
const original: OpsIntakeOriginal = { action: "issue.ops.intake", payload: { source_id: "ops-one", source_digest: "a".repeat(64), title: "Investigate", description: "Confirm actual behavior", severity: "P1" }, intent: { version: 7, key: "ops-stable-original" } };
const ack = { project_id: "P", action: "issue.ops.intake", resource: { kind: "issue", id: "ISSUE-11111111111111111111111111111111" }, result: { issue_id: "ISSUE-11111111111111111111111111111111", source_id: "ops-one", source_digest: "a".repeat(64) }, affected_refs: [{ kind: "issue", id: "ISSUE-11111111111111111111111111111111" }], applied_version: 8, version: 8, query_generation: 1, replayed: false };
describe("fixed operational source intake original", () => {
  it("binds the complete source digest and rejects success for a different issue or source", () => {
    expect(validOpsIntakeOriginal(original)).toBe(true);
    expect(validOpsIntakeOriginal({ ...original, payload: { ...original.payload, source_id: "../other" } })).toBe(false);
    expect(validOpsIntakeAck("P", original, ack)).toBe(true);
    for (const result of [{ ...ack.result, source_id: "other" }, { ...ack.result, source_digest: "b".repeat(64) }, { ...ack.result, issue_id: "ISSUE-other" }]) expect(validOpsIntakeAck("P", original, { ...ack, result })).toBe(false);
  });
  it("persists before sending, replays exact unknown bytes, and retains success until applied", async () => {
    let raw: string | null = null, calls: OpsIntakeOriginal[] = [];
    const send = vi.fn(async (value: OpsIntakeOriginal) => { expect(raw).toContain("sending"); calls.push(structuredClone(value)); if (calls.length === 1) throw new Error("response lost"); return ack; });
    const options = { projectId: "P", scope: "scope", currentScope: () => "scope", load: () => raw, save: (value: string) => { raw = value; }, send };
    const first = createOpsIntakeController(options); await first.run(original);
    expect(first.snapshot().phase).toBe("unknown");
    const reopened = createOpsIntakeController(options); await reopened.replay();
    expect(calls).toEqual([original, original]); expect(reopened.snapshot().phase).toBe("succeeded");
    expect(createOpsIntakeController(options).snapshot().ack).toEqual(ack);
  });
  it("cannot send when durable storage is unavailable or the account scope changed", async () => {
    const send = vi.fn(); let scope = "new";
    const controller = createOpsIntakeController({ projectId: "P", scope: "old", currentScope: () => scope, load: () => null, save: () => { throw new Error("blocked"); }, send });
    await controller.run(original); expect(send).not.toHaveBeenCalled();
    scope = "old"; await controller.run(original); expect(send).not.toHaveBeenCalled();
  });
});
