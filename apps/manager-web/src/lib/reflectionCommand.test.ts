import { describe, expect, it } from "vitest";
import {
  createReflectionInputController,
  prepareReflectionInputOriginal,
} from "./reflectionCommand";
import { reflectionDigest } from "./reflectionFixtures";

const source = { reflection_id: "R", source_digest: reflectionDigest, attempt_id: "A" };
const original = () => prepareReflectionInputOriginal(7, {
  title: "Reviewed input", rationale: "Reviewed rationale", sources: [source],
}, () => "original-key");
const ack = {
  project_id: "P", action: "reflection.input.create",
  resource: { kind: "reflection_input", id: "I" },
  affected_refs: [{ kind: "reflection_input", id: "I" }],
  result: { status: "prepared", source_count: 1 },
  applied_version: 8, version: 8, query_generation: 3, replayed: true,
};
describe("reflection input durable command", () => {
  it("reconstructs an unknown input and replays the identical original without source reads", async () => {
    let raw = "", success = false;
    const writes: unknown[] = [];
    const options = {
      projectId: "P", scope: "S", currentScope: () => "S",
      load: () => raw, save: (value: string) => { raw = value; },
      send: async (value: unknown) => {
        writes.push(structuredClone(value));
        if (!success) throw new Error("connection lost after commit");
        return ack;
      },
    };
    const first = createReflectionInputController(options), body = original();
    await first.run(body);
    expect(first.snapshot().phase).toBe("unknown");
    body.payload.title = "Do not replace original";
    const restored = createReflectionInputController(options);
    await restored.run(original());
    expect(writes).toHaveLength(1);
    success = true;
    await restored.replay();
    expect(writes[1]).toEqual(writes[0]);
    expect(restored.snapshot().phase).toBe("succeeded");
  });
  it("accepts a nullable query generation on exact original replay while current indexes are unavailable", async () => {
    let succeed = false, raw = "";
    const controller = createReflectionInputController({ projectId: "P", scope: "S", currentScope: () => "S", load: () => raw, save: (value) => { raw = value; }, send: async () => { if (!succeed) throw new Error("lost ACK"); return { ...ack, query_generation: null }; } });
    await controller.run(original());
    expect(controller.snapshot().phase).toBe("unknown");
    succeed = true;
    await controller.replay();
    expect(controller.snapshot().phase).toBe("succeeded");
  });

  it.each(["project", "kind", "action", "refs", "result", "count", "version"])(
    "retains unknown for a mismatched %s acknowledgement", async (kind) => {
      const bad = structuredClone(ack);
      if (kind === "project") bad.project_id = "other";
      if (kind === "kind") bad.resource.kind = "task";
      if (kind === "action") bad.action = "task.update";
      if (kind === "refs") bad.affected_refs = [{ kind: "task", id: "T" }];
      if (kind === "result") bad.result.status = "succeeded";
      if (kind === "count") bad.result.source_count = 2;
      if (kind === "version") bad.applied_version = 9;
      const controller = createReflectionInputController({
        projectId: "P", scope: "S", currentScope: () => "S", load: () => null,
        save: () => {}, send: async () => bad,
      });
      await controller.run(original());
      expect(controller.snapshot().phase).toBe("unknown");
    },
  );

  it("refuses duplicate and invalid sources and preserves Unicode codepoint bounds", () => {
    for (const sources of [[], [source, source], [{ ...source, source_digest: "bad" }], [{ ...source, reflection_id: "R/path" }], Array.from({ length: 33 }, (_, index) => ({ ...source, reflection_id: "R" + index }))]) {
      expect(() => prepareReflectionInputOriginal(7, { title: "Title", rationale: "Reason", sources })).toThrow();
    }
    expect(prepareReflectionInputOriginal(7, { title: "😀".repeat(160), rationale: "Reason", sources: [source] }).payload.title).toBe("😀".repeat(160));
    expect(() => prepareReflectionInputOriginal(7, { title: "😀".repeat(161), rationale: "Reason", sources: [source] })).toThrow();
  });

  it("does not send when the original cannot be retained", async () => {
    let calls = 0;
    const controller = createReflectionInputController({
      projectId: "P", scope: "S", currentScope: () => "S", load: () => null,
      save: () => { throw new Error("storage full"); },
      send: async () => { calls++; return ack; },
    });
    await controller.run(original());
    expect(calls).toBe(0);
    expect(controller.snapshot().error).toBe("retainedOriginalUnavailable");
  });

  it("locks duplicate callbacks synchronously and rejects an old ABA acknowledgement", async () => {
    let resolve!: (value: unknown) => void, calls = 0;
    const controller = createReflectionInputController({
      projectId: "P", scope: "A", currentScope: () => "A", load: () => null, save: () => {},
      send: () => { calls++; return new Promise((done) => { resolve = done; }); },
    });
    const pending = controller.run(original());
    void controller.run(original());
    expect(calls).toBe(1);
    controller.invalidate();
    controller.activate();
    resolve(ack);
    await pending;
    expect(controller.snapshot().phase).toBe("unknown");
  });
});
