import { describe, expect, it } from "vitest";
import {
  createRequirementCommandController,
  prepareRequirementOriginal,
} from "./deliveryRequirementCommand";
const basis = "a".repeat(64),
  proofBasis = "b".repeat(64);
const original = () =>
  prepareRequirementOriginal(
    { version: 7, key: "original-key" },
    "R",
    basis,
    { priority: "P2" },
    false,
    null,
  );
const ack = {
  project_id: "P",
  action: "requirement.update",
  resource: { kind: "requirement", id: "R" },
  affected_refs: [{ kind: "requirement", id: "R" }],
  result: null,
  applied_version: 8,
  version: 8,
  query_generation: 3,
  replayed: true,
};
describe("durable requirement command", () => {
  it.each(["R/part", "R\\part"])(
    "rejects resource path separators in %s before preparing an original",
    (id) => {
      expect(() =>
        prepareRequirementOriginal(
          { version: 7, key: "k" },
          id,
          basis,
          { priority: "P2" },
          false,
          null,
        ),
      ).toThrow();
    },
  );
  it("restores a lost acknowledgement and replays the identical body, key and version", async () => {
    let raw = "";
    const writes: any[] = [];
    let response: unknown;
    const options = {
      projectId: "P",
      requirementId: "R",
      scope: "S",
      currentScope: () => "S",
      load: () => raw,
      save: (value: string) => {
        raw = value;
      },
      send: async (value: any) => {
        writes.push(structuredClone(value));
        if (!response) throw new Error("network lost after commit");
        return response;
      },
    };
    const first = createRequirementCommandController(options),
      command = original();
    await first.run(command);
    expect(first.snapshot().phase).toBe("unknown");
    command.payload.priority = "P0";
    const restored = createRequirementCommandController(options);
    expect(restored.snapshot().phase).toBe("unknown");
    await restored.run(original());
    expect(writes).toHaveLength(1);
    response = ack;
    await restored.replay();
    expect(writes[1]).toEqual(writes[0]);
    expect(restored.snapshot().phase).toBe("succeeded");
  });
  it("rejects incomplete or mismatched preview proof and preserves metadata-only writes", () => {
    expect(original().payload).toEqual({
      id: "R",
      priority: "P2",
      requirement_basis: basis,
    });
    const proof = {
      project_id: "P",
      requirement_id: "R",
      version: 7,
      query_generation: 3,
      requirement_basis: basis,
      preview_basis: proofBasis,
      available: true,
      complete: true,
      allowed: true,
    } as any;
    expect(
      prepareRequirementOriginal(
        { version: 7, key: "k" },
        "R",
        basis,
        { title: "new" },
        true,
        proof,
        "P",
      ).payload.change_preview_basis,
    ).toBe(proofBasis);
    for (const patch of [
      { complete: false },
      { available: false },
      { allowed: false },
      { requirement_id: "other" },
      { requirement_basis: proofBasis },
      { version: 8 },
      { preview_basis: null },
    ])
      expect(() =>
        prepareRequirementOriginal(
          { version: 7, key: "k" },
          "R",
          basis,
          { title: "new" },
          true,
          { ...proof, ...patch },
          "P",
        ),
      ).toThrow();
  });
  it.each(["target", "action", "project", "version", "refs"])(
    "keeps a mismatched %s acknowledgement unknown",
    async (kind) => {
      const bad = structuredClone(ack);
      if (kind === "target") bad.resource.id = "other";
      if (kind === "action") bad.action = "task.update";
      if (kind === "project") bad.project_id = "other";
      if (kind === "version") bad.applied_version = 9;
      if (kind === "refs") bad.affected_refs = [];
      const controller = createRequirementCommandController({
        projectId: "P",
        requirementId: "R",
        scope: "S",
        currentScope: () => "S",
        load: () => null,
        save: () => {},
        send: async () => bad,
      });
      await controller.run(original());
      expect(controller.snapshot().phase).toBe("unknown");
    },
  );
  it("synchronously locks duplicate callbacks and ignores session A-B-A late acknowledgements", async () => {
    let scope = "A",
      resolve!: (v: unknown) => void,
      count = 0;
    const controller = createRequirementCommandController({
      projectId: "P",
      requirementId: "R",
      scope: "A",
      currentScope: () => scope,
      load: () => null,
      save: () => {},
      send: () => {
        count++;
        return new Promise((r) => {
          resolve = r;
        });
      },
    });
    const one = controller.run(original());
    void controller.run(original());
    expect(count).toBe(1);
    scope = "B";
    controller.invalidate();
    scope = "A";
    resolve(ack);
    await one;
    expect(controller.snapshot().phase).toBe("unknown");
  });
});
