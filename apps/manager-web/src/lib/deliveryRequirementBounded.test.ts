import { beforeEach, describe, expect, it, vi } from "vitest";
import * as query from "./deliveryQuery";
import { request } from "./http";
vi.mock("./http", () => ({ request: vi.fn() }));
const reads = query as unknown as Record<string, (...args: any[]) => any>;
beforeEach(() => {
  vi.mocked(request).mockReset();
});
describe("bounded requirement reads", () => {
  it.each(["R/part", "R\\part"])(
    "rejects path separators in bounded read resource %s before HTTP",
    (id) => {
      expect(() => query.fetchRequirementDefinition("P", id, 3)).toThrow();
      expect(() =>
        query.fetchRequirementImpactItem("P", "R", "execution", id, 3),
      ).toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("does not load a parent definition in ordinary task detail but explicitly validates it for editing", async () => {
    vi.mocked(request).mockImplementation(async (path) => {
      if (path.includes("/tasks/"))
        return {
          project_id: "P",
          version: 7,
          query_generation: 3,
          planning_basis: "plan",
          task: { id: "T", req_id: "R", planning: { depends_on: [] } },
          requirement: { id: "R", title: "Req" },
        } as never;
      if (path.endsWith("/context"))
        return {
          project_id: "P",
          version: 7,
          query_generation: 3,
          project: { id: "P" },
          permissions: { write: true },
        } as never;
      if (path.includes("/references"))
        return { project_id: "P", query_generation: 3, items: [] } as never;
      if (path.includes("/definition"))
        return {
          project_id: "P",
          requirement_id: "R",
          version: 7,
          query_generation: 3,
          as_of: "now",
          requirement_basis: "a".repeat(64),
          definition: {
            id: "R",
            title: "Req",
            description: "Read explicitly",
            acceptance_criteria: ["Current criterion"],
          },
        } as never;
      return {
        project_id: "P",
        requirement_id: "R",
        version: 7,
        query_generation: 3,
        as_of: "now",
        requirement: { id: "R", title: "Req", basis: "a".repeat(64) },
      } as never;
    });
    const ordinary = await query.fetchDeliveryTaskData("P", "T");
    expect(ordinary.requirement_definition).toBeUndefined();
    expect(
      vi
        .mocked(request)
        .mock.calls.some(([path]) => path.includes("/definition")),
    ).toBe(false);
    const edit = await query.fetchDeliveryTaskEditData("P", "T");
    expect(edit.requirement_definition?.definition.acceptance_criteria).toEqual(
      ["Current criterion"],
    );
    expect(
      vi
        .mocked(request)
        .mock.calls.filter(([path]) => path.includes("/definition")),
    ).toHaveLength(1);
  });
  it.each([
    ["fetchRequirementDefinition", ["P", "R一", 7], "/definition", {}],
    [
      "fetchRequirementRecords",
      ["P", "R一", "reviews", 7, "next/20"],
      "/records",
      { collection: "reviews", cursor: "next/20", limit: "20" },
    ],
    [
      "fetchRequirementRecord",
      ["P", "R一", "reviews", 0, 7],
      "/records/0",
      { collection: "reviews" },
    ],
    ["fetchRequirementImpact", ["P", "R一", 7], "/impact", {}],
    [
      "fetchRequirementImpactPage",
      ["P", "R一", "dependent_task", 7, "next/20"],
      "/impact/items",
      { kind: "dependent_task", cursor: "next/20", limit: "20" },
    ],
    [
      "fetchRequirementImpactItem",
      ["P", "R一", "direct_task", "T😀", 7],
      "/impact/items/T%F0%9F%98%80",
      { kind: "direct_task" },
    ],
  ])(
    "%s explicitly scopes generation without collecting sibling pages",
    async (name, args, suffix, expected) => {
      expect(reads[name]).toBeTypeOf("function");
      await reads[name](...args);
      expect(request).toHaveBeenCalledTimes(1);
      const [path, options] = vi.mocked(request).mock.calls[0];
      const url = new URL(path, "https://local.invalid");
      expect(url.pathname).toBe(
        "/api/v1/delivery/requirements/R%E4%B8%80" + suffix,
      );
      expect(Object.fromEntries(url.searchParams)).toEqual({
        query_generation: "7",
        ...expected,
      });
      expect(options?.headers).toEqual({ "X-Project-Id": "P" });
    },
  );
  it("refuses a definition without an explicit positive generation", () => {
    expect(reads.fetchRequirementDefinition).toBeTypeOf("function");
    expect(() =>
      reads.fetchRequirementDefinition("P", "R", undefined),
    ).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
