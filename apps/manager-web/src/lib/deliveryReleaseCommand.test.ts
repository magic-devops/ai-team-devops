import { describe, expect, it, vi } from "vitest";
import { createReleaseCommandController } from "./deliveryReleaseCommand";
describe("release original write safety", () => {
  it("starts a fresh editor after an acknowledged completed original and deep-freezes retained payloads", async () => {
    let raw: string | null = null;
    const send = vi.fn().mockResolvedValue({
      project_id: "P",
      action: "release.policy.save",
      resource: { id: "P", kind: "release_policy" },
      applied_version: 8,
      version: 8,
      query_generation: null,
      replayed: false,
      affected_refs: [{ kind: "release_policy", id: "P" }],
      result: null,
    });
    const options = {
      projectId: "P",
      scope: "A",
      currentScope: () => "A",
      load: () => raw,
      save: (value: string) => {
        raw = value;
      },
      send,
    };
    const c = createReleaseCommandController(options);
    await c.run({
      action: "release.policy.save",
      payload: { public_keys: ["original"] },
      intent: { version: 7, key: "K" },
    });
    expect(() =>
      (c.snapshot().original!.payload.public_keys as string[]).push("changed"),
    ).toThrow();
    expect(createReleaseCommandController(options).snapshot().phase).toBe(
      "idle",
    );
  });
  it("locks unknown originals and repeats the exact request after a late refusal", async () => {
    let raw: string | null = null;
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost ACK"))
      .mockRejectedValueOnce(new Error("HTTP 403: denied"));
    const c = createReleaseCommandController({
      projectId: "P",
      scope: "A",
      currentScope: () => "A",
      load: () => raw,
      save: (value) => {
        raw = value;
      },
      send,
    });
    const original = {
      action: "release.policy.save" as const,
      payload: { repository: "old", public_keys: ["original"] },
      intent: { version: 7, key: "original-key" },
    };
    await c.run(original);
    expect(c.snapshot().phase).toBe("unknown");
    await c.run({
      ...original,
      payload: { repository: "changed" },
      intent: { version: 8, key: "new" },
    });
    expect(send).toHaveBeenCalledTimes(1);
    await c.replay();
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(c.snapshot().phase).toBe("unknown");
    expect(JSON.parse(raw!).original).toEqual(original);
  });
  it("rejects late scope ABA results and preserves an interrupted original", async () => {
    let raw: string | null = null,
      scope = "A";
    let finish!: (value: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const c = createReleaseCommandController({
      projectId: "P",
      scope,
      currentScope: () => scope,
      load: () => raw,
      save: (value) => {
        raw = value;
      },
      send,
    });
    const pending = c.run({
      action: "release.candidate.review",
      payload: { id: "REL" },
      intent: { version: 7, key: "K" },
    });
    scope = "B";
    c.invalidate();
    scope = "A";
    finish({
      project_id: "P",
      action: "release.candidate.review",
      resource: { id: "REL", kind: "release" },
      applied_version: 8,
      version: 8,
      query_generation: 8,
    });
    await pending;
    expect(c.snapshot().phase).toBe("unknown");
    expect(JSON.parse(raw!).original.intent.key).toBe("K");
  });
  it("refuses a new send without retention and treats unrelated acknowledgements as unknown", async () => {
    const original = {
      action: "release.candidate.review" as const,
      payload: { id: "REL" },
      intent: { version: 7, key: "K" },
    };
    const send = vi.fn().mockResolvedValue({
      project_id: "other",
      action: original.action,
      resource: { id: "REL" },
      version: 8,
      applied_version: 8,
      query_generation: 8,
    });
    const noStorage = createReleaseCommandController({
      projectId: "P",
      scope: "A",
      currentScope: () => "A",
      load: () => null,
      save: () => {
        throw new Error("quota");
      },
      send,
    });
    await noStorage.run(original);
    expect(send).not.toHaveBeenCalled();
    const controller = createReleaseCommandController({
      projectId: "P",
      scope: "A",
      currentScope: () => "A",
      load: () => null,
      save: () => {},
      send,
    });
    await controller.run(original);
    expect(controller.snapshot().phase).toBe("unknown");
  });
  it.each([
    { resource: { kind: "task", id: "P" } },
    { resource: { kind: "release_policy", id: "other" } },
    { applied_version: -3, version: -2, query_generation: -1 },
    { applied_version: 9, version: 9 },
    { version: 7 },
    { query_generation: -1 },
    { query_generation: 0 },
    { replayed: "yes" },
    { affected_refs: null },
    { affected_refs: [] },
    { affected_refs: [{ kind: "release_policy", id: "other" }] },
    {
      affected_refs: [
        { kind: "release_policy", id: "P" },
        { kind: " ", id: "P" },
      ],
    },
    {
      affected_refs: [
        { kind: "release_policy", id: "P" },
        { kind: "task", id: " " },
      ],
    },
  ])(
    "rejects malformed or unrelated original acknowledgements %j",
    async (patch) => {
      const ack = {
        project_id: "P",
        action: "release.policy.save",
        resource: { kind: "release_policy", id: "P" },
        applied_version: 8,
        version: 8,
        query_generation: 8,
        replayed: false,
        affected_refs: [{ kind: "release_policy", id: "P" }],
        result: null,
        ...patch,
      };
      const c = createReleaseCommandController({
        projectId: "P",
        scope: "A",
        currentScope: () => "A",
        load: () => null,
        save: () => {},
        send: async () => ack,
      });
      await c.run({
        action: "release.policy.save",
        payload: { repository: "repo" },
        intent: { version: 7, key: "original" },
      });
      expect(c.snapshot().phase).toBe("unknown");
      expect(c.snapshot().original!.intent.key).toBe("original");
    },
  );
  it.each([42, {}, [], "", " "])(
    "retains a create original when the ACK resource ID is malformed %j",
    async (id) => {
      const c = createReleaseCommandController({
        projectId: "P",
        scope: "A",
        currentScope: () => "A",
        load: () => null,
        save: () => {},
        send: async () => ({
          project_id: "P",
          action: "release.candidate.create",
          resource: { kind: "release_candidate", id },
          applied_version: 8,
          version: 8,
          query_generation: 8,
          replayed: false,
          affected_refs: [{ kind: "release_candidate", id: "new" }],
          result: null,
        }),
      });
      await c.run({
        action: "release.candidate.create",
        payload: { version: "v1" },
        intent: { version: 7, key: "original" },
      });
      expect(c.snapshot().phase).toBe("unknown");
      expect(c.snapshot().original!.intent.key).toBe("original");
    },
  );
});
