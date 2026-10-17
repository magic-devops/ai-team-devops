import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { request } from "./http";
vi.mock("./http", () => ({ request: vi.fn(), API_BASE: "" }));
beforeEach(() => vi.mocked(request).mockClear());
describe("stable owner API requests", () => {
  it("keeps omission and explicit unassignment distinct for ordinary and bulk task updates", async () => {
    await api.updateTask("T-one", { title: "Keep owner" });
    expect(JSON.parse((vi.mocked(request).mock.calls[0][1] as RequestInit).body as string)).toEqual({ title: "Keep owner" });
    await api.bulkUpdateTasks({ ids: ["T-one"], owner_id: "" });
    expect(JSON.parse((vi.mocked(request).mock.calls[1][1] as RequestInit).body as string)).toEqual({ ids: ["T-one"], owner_id: "" });
  });
  it("sends only explicit member IDs to task creation and requirement decomposition", async () => {
    await api.createTask({ title: "Task", owner_id: "user:one" });
    await api.generateRequirementTasks("REQ-one", { dry_run: true, owner_id: "agent:two" });
    const bodies = vi.mocked(request).mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies.map((body) => body.owner_id)).toEqual(["user:one", "agent:two"]);
    expect(bodies.every((body) => !("assigned_to" in body))).toBe(true);
  });
  it("uses the same identity contract for governance and scheduler task sources", async () => {
    await api.systemPagesBacklogTasks({ dry_run: true, owner_id: "user:one" });
    await api.opsSelfHealTasks({ dry_run: true, owner_id: "agent:two" });
    await api.taskSchedulerPlan({ dry_run: true, owner_pool: ["user:one", "agent:two"] });
    const bodies = vi.mocked(request).mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies[0].owner_id).toBe("user:one");
    expect(bodies[1].owner_id).toBe("agent:two");
    expect(bodies[2].owner_pool).toEqual(["user:one", "agent:two"]);
    expect(bodies.every((body) => !("assigned_to" in body) && !("agent_pool" in body))).toBe(true);
  });
});
