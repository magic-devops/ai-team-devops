import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./deliveryProgress";
import { request } from "./http";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());
describe("independent bounded progress reads", () => {
  it("invalidates an exact current-navigation read across a route A-B-A transition", () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("location", {
      hash: "#/dev-flow?view=progress&observation_id=A",
    });
    vi.stubGlobal("window", {
      addEventListener: (name: string, callback: () => void) =>
        listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    const read = api.beginProgressExactRead();
    location.hash = "#/dev-flow?view=progress&observation_id=B";
    listeners.get("popstate")!();
    location.hash = "#/dev-flow?view=progress&observation_id=A";
    expect(read.current()).toBe(false);
    read.finish();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });
  it("loads a fixed snapshot page independently with default 20 and the original scope", async () => {
    expect(typeof api.fetchProgressSnapshotPage).toBe("function");
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      source_kind: "observation",
      source_id: "O",
      snapshot_basis: "a".repeat(64),
      scope: { kind: "sprint", id: "S", label: "Sprint" },
      collection: "tasks",
      items: [],
      total: 256,
      limit: 20,
      next_cursor: "next",
    });
    await api.fetchProgressSnapshotPage("P", "observation", "O", "tasks", {
      scope: "sprint",
      scopeId: "S",
    });
    expect(vi.mocked(request).mock.calls[0][0]).toBe(
      "/api/v1/delivery/progress/observations/O/tasks?scope=sprint&scope_id=S&limit=20",
    );
  });
  it("does not download whole fixed arrays to open a metadata header", async () => {
    const value = {
      project_id: "P",
      as_of: "2026-10-19T00:00:00Z",
      observation: {
        id: "O",
        scope: { kind: "project", id: "", label: "Project" },
        task_count: 256,
        requirement_count: 1,
        snapshot_basis: "a".repeat(64),
        available: true,
        reasons: [],
      },
    };
    vi.mocked(request).mockResolvedValue(value);
    const result = await api.fetchProgressObservation("P", "O", {
      scope: "project",
      scopeId: "",
    });
    expect(result).toHaveProperty("observation.id", "O");
    expect(result).not.toHaveProperty("current");
    expect(typeof api.fetchProgressSnapshotItem).toBe("function");
  });
  it("binds comparison page reads to the complete summary generation and selected baseline", async () => {
    expect(typeof api.fetchProgressComparisonPage).toBe("function");
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      baseline_id: "B",
      baseline_basis: "b".repeat(64),
      query_generation: 7,
      kind: "changed",
      items: [],
      total: 30,
      limit: 20,
      next_cursor: "next",
    });
    await api.fetchProgressComparisonPage("P", "B", "changed", 7);
    expect(vi.mocked(request).mock.calls[0][0]).toBe(
      "/api/v1/delivery/progress/baselines/B/comparison/items?kind=changed&query_generation=7&limit=20",
    );
  });
});
describe("durable progress originals", () => {
  it("accepts Unicode identifiers by the formal Python codepoint limits", () => {
    const taskId = "😀".repeat(33),
      scopeId = "😀".repeat(51);
    const proof = {
      ...completeProof(),
      task_ids: [taskId],
      scope: { kind: "milestone", id: scopeId, label: "Milestone" },
    };
    expect(
      api.prepareProgressBaseline(proof, form, () => "unicode-original")
        .payload,
    ).toMatchObject({ task_ids: [taskId], scope_id: scopeId });
  });
  it("restores a legitimate Unicode original without declaring the retained request invalid", () => {
    const original = {
      action: "baseline.create" as const,
      payload: {
        title: "Unicode scope",
        note: "",
        starts_on: null,
        ends_on: null,
        scope: "milestone" as const,
        scope_id: "😀".repeat(51),
        task_ids: ["😀".repeat(33)],
        basis: "a".repeat(64),
      },
      intent: { version: 7, key: "unicode-original" },
    };
    const controller = api.createProgressCommandController({
      projectId: "P",
      action: "baseline.create",
      scope: "original",
      currentScope: () => "original",
      load: () => JSON.stringify({ phase: "unknown", original }),
      save: vi.fn(),
      send: vi.fn(),
    });
    expect(controller.snapshot()).toMatchObject({ phase: "unknown", original });
    expect(controller.snapshot().error).toBeUndefined();
  });
  const completeProof = () =>
    ({
      project_id: "P",
      version: 7,
      query_generation: 3,
      scope: { kind: "project", id: "", label: "Project" },
      available: true,
      complete: true,
      basis: "a".repeat(64),
      task_ids: ["T"],
      metrics: { tasks_total: 1 },
      budget: {},
      reasons: [],
    }) as any;
  const form = {
    title: "Frozen scope",
    starts_on: null,
    ends_on: null,
    note: "",
  };
  for (const invalid of [
    "T".repeat(65),
    " padded ",
    "T\u0085bad",
    "T\u0000bad",
  ])
    it(`rejects a noncanonical task identifier ${JSON.stringify(invalid)}`, () => {
      expect(() =>
        api.prepareProgressBaseline(
          { ...completeProof(), task_ids: [invalid] },
          form,
        ),
      ).toThrow();
    });
  for (const invalid of [
    "S".repeat(101),
    " padded ",
    "S\u0085bad",
    "S\u0000bad",
  ])
    it(`rejects a noncanonical scope identifier ${JSON.stringify(invalid)}`, () => {
      expect(() =>
        api.prepareProgressBaseline(
          {
            ...completeProof(),
            scope: { kind: "sprint", id: invalid, label: "Sprint" },
          },
          form,
        ),
      ).toThrow();
    });
  it("rejects duplicate IDs, proof count mismatch, and a note beyond the formal 4000-character limit", () => {
    expect(() =>
      api.prepareProgressBaseline(
        {
          ...completeProof(),
          task_ids: ["T", "T"],
          metrics: { tasks_total: 2 },
        },
        form,
      ),
    ).toThrow();
    expect(() =>
      api.prepareProgressBaseline(
        { ...completeProof(), metrics: { tasks_total: 2 } },
        form,
      ),
    ).toThrow();
    expect(() =>
      api.prepareProgressBaseline(completeProof(), {
        ...form,
        note: "N".repeat(4001),
      }),
    ).toThrow();
  });
  it("clears all child page identities when switching from a second baseline page to another original", () => {
    const source =
      "#/dev-flow?view=progress&project_id=P&baseline_id=B&progress_source=baseline&progress_snapshot_cursor=B-page2&progress_snapshot_page=2&progress_snapshot_item=T&progress_diff_kind=changed&progress_diff_cursor=B-diff2&progress_diff_item=X&progress_catalogue_cursor=c2";
    const route = api.parseProgressRoute(source);
    const target = new URLSearchParams(
      api.progressHash({ ...route, baselineId: "C" }, source).split("?")[1],
    );
    expect(target.get("baseline_id")).toBe("C");
    expect(target.get("project_id")).toBe("P");
    expect(
      [...target.keys()].filter((key) =>
        /cursor|page|item|diff_kind/.test(key),
      ),
    ).toEqual([]);
  });
  it("retains a baseline original across unknown reload and refuses to replace it with an edited draft", async () => {
    expect(typeof api.createProgressCommandController).toBe("function");
    let retained = "";
    const sends: any[] = [];
    const options = {
      projectId: "P",
      action: "baseline.create" as const,
      scope: "original-session/P",
      currentScope: () => "original-session/P",
      load: () => retained,
      save: (value: string) => {
        retained = value;
      },
      send: async (value: any) => {
        sends.push(structuredClone(value));
        throw new Error("network interrupted after possible commit");
      },
    };
    const original = {
      action: "baseline.create" as const,
      payload: {
        title: "Reviewed original",
        scope: "project" as const,
        scope_id: "",
        task_ids: ["T-whole"],
        basis: "a".repeat(64),
        starts_on: null,
        ends_on: null,
        note: "",
      },
      intent: { version: 7, key: "original-key" },
    };
    const first = api.createProgressCommandController(options);
    await first.run(original);
    expect(first.snapshot().phase).toBe("unknown");
    original.payload.title = "Later edit";
    const restored = api.createProgressCommandController(options);
    await restored.run({
      ...original,
      intent: { version: 8, key: "replacement" },
    });
    expect(sends).toHaveLength(1);
    await restored.replay();
    expect(sends[1]).toEqual(sends[0]);
    expect(sends[1].intent.key).toBe("original-key");
  });
  it("accepts a complete empty-scope proof but refuses partial or unavailable proof", () => {
    expect(typeof api.prepareProgressBaseline).toBe("function");
    const proof = {
      project_id: "P",
      version: 7,
      query_generation: 3,
      scope: { kind: "project", id: "", label: "Project" },
      available: true,
      complete: true,
      basis: "a".repeat(64),
      task_ids: [],
      metrics: { tasks_total: 0 },
      budget: {},
      reasons: [],
    } as any;
    const form = {
      title: "Empty legitimate scope",
      starts_on: null,
      ends_on: null,
      note: "",
    };
    expect(
      api.prepareProgressBaseline(proof, form, () => "original").payload
        .task_ids,
    ).toEqual([]);
    expect(() =>
      api.prepareProgressBaseline({ ...proof, complete: false }, form),
    ).toThrow();
    expect(() =>
      api.prepareProgressBaseline(
        { ...proof, available: false, task_ids: null, basis: null },
        form,
      ),
    ).toThrow();
  });
});
