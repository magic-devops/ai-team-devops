import { describe, expect, it, vi } from "vitest";
import {
  createManualReviewCommandController,
  type ManualReviewOriginal,
} from "./deliveryManualReviewCommand";
const original: ManualReviewOriginal = {
  action: "task.manual_review",
  payload: {
    task_id: "T",
    decision: "accept",
    basis: "original-basis",
    comment: "Original opinion",
    evidence_content: "Original evidence",
    evidence_url: "",
  },
  intent: { version: 7, key: "original-key" },
};
const ack = {
  project_id: "P",
  action: "task.manual_review",
  resource: { kind: "task_review", id: "review-one" },
  applied_version: 8,
  version: 9,
  query_generation: 9,
  replayed: false,
  affected_refs: [
    { kind: "task_review", id: "review-one" },
    { kind: "task", id: "T" },
  ],
  result: { task_ids: ["T"] },
};
function harness(send: (original: ManualReviewOriginal) => Promise<unknown>) {
  let raw: string | null = null,
    scope = "A";
  const options = {
    projectId: "P",
    taskId: "T",
    scope: "A",
    currentScope: () => scope,
    load: () => raw,
    save: (value: string) => {
      raw = value;
    },
    send,
  };
  return {
    options,
    create: () => createManualReviewCommandController(options),
    stored: () => raw,
    changeScope: (value: string) => {
      scope = value;
    },
  };
}
describe("manual review durable original", () => {
  it("rejects an ACK that omits the original task reference", async () => {
    const c = harness(async () => ({
      ...ack,
      affected_refs: [ack.resource],
    })).create();
    await c.run(original);
    expect(c.snapshot().phase).toBe("unknown");
  });
  it("restores an unknown original after refresh and only replays the exact payload, basis, version and key", async () => {
    const sent: ManualReviewOriginal[] = [];
    const h = harness(async (value) => {
      sent.push(value);
      if (sent.length === 1) throw new Error("lost ACK");
      return { ...ack, replayed: true };
    });
    const first = h.create();
    await first.run(original);
    expect(first.snapshot().phase).toBe("unknown");
    first.reset();
    await first.run({
      ...original,
      payload: { ...original.payload, comment: "New draft" },
      intent: { version: 8, key: "new" },
    });
    expect(sent).toHaveLength(1);
    const restored = h.create();
    expect(restored.snapshot().phase).toBe("unknown");
    await restored.replay();
    expect(sent[1]).toEqual(original);
    expect(restored.snapshot().phase).toBe("succeeded");
    expect(h.create().snapshot().phase).toBe("idle");
  });
  it.each([403, 409])(
    "retains definite %i refusals until explicit adoption resets the original",
    async (status) => {
      const h = harness(async () => {
        throw new Error(`HTTP ${status}: denied`);
      });
      const c = h.create();
      await c.run(original);
      expect(c.snapshot()).toMatchObject({ phase: "refused", original });
      expect(h.create().snapshot()).toMatchObject({
        phase: "refused",
        original,
      });
      c.reset();
      expect(c.snapshot().phase).toBe("idle");
    },
  );
  it("blocks old sends and late ACKs after a session or project ABA invalidation", async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const h = harness(send),
      c = h.create();
    const pending = c.run(original);
    h.changeScope("B");
    c.invalidate();
    h.changeScope("A");
    finish(ack);
    await pending;
    expect(c.snapshot().phase).toBe("unknown");
    await c.replay();
    expect(send).toHaveBeenCalledTimes(1);
    const closed = h.create();
    closed.invalidate();
    await closed.run(original);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { ...ack, project_id: "other" },
    { ...ack, resource: { kind: "task", id: "T" } },
    { ...ack, action: "task.update" },
    { ...ack, applied_version: 9 },
    { ...ack, version: 7 },
    { ...ack, query_generation: 0 },
    { ...ack, query_generation: null },
    { ...ack, affected_refs: [] },
    { ...ack, result: [] },
    { ...ack, result: null },
    { ...ack, result: { task_ids: ["other"] } },
    { ...ack, affected_refs: [ack.resource, { kind: "task", id: "other" }] },
    { ...ack, replayed: "yes" },
  ])("keeps malformed acknowledgements unknown: %j", async (value) => {
    const c = harness(async () => value).create();
    await c.run(original);
    expect(c.snapshot()).toMatchObject({ phase: "unknown", original });
  });
  it("does not send when retention fails or a restored payload names another task", async () => {
    const send = vi.fn(async () => ack),
      h = harness(send);
    const noStorage = createManualReviewCommandController({
      ...h.options,
      save: () => {
        throw new Error("quota");
      },
    });
    await noStorage.run(original);
    expect(send).not.toHaveBeenCalled();
    const corrupted = createManualReviewCommandController({
      ...h.options,
      load: () =>
        JSON.stringify({
          phase: "unknown",
          original: {
            ...original,
            payload: { ...original.payload, task_id: "other" },
          },
        }),
    });
    expect(corrupted.snapshot()).toMatchObject({
      phase: "unknown",
      error: "retainedOriginalInvalid",
    });
    await corrupted.replay();
    expect(send).not.toHaveBeenCalled();
  });
});
