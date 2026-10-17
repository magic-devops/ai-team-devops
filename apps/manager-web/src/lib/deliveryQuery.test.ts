import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  fetchDeliveryContext,
  fetchDeliveryReferences,
  fetchDeliveryTaskData,
  fetchRequirementPage,
  fetchRequirementDetail,
  fetchTaskDetail,
  fetchTaskPage,
  rebuildDeliveryQuery,
} from "./deliveryQuery";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());

describe("delivery query transport", () => {
  it("sends only declared filters and never forwards unrelated URL keys", async () => {
    vi.mocked(request).mockResolvedValue({ items: [] });
    await fetchRequirementPage("P", {
      q: "a b",
      stage: "testing",
      owner_id: "user:a",
      sort: "due_asc",
      cursor: "opaque/+",
      limit: 20,
      unknown_origkey: "keep-in-url",
    } as any);
    const [href, options] = vi.mocked(request).mock.calls[0];
    const parsed = new URL(String(href), "http://local");
    expect(parsed.pathname).toBe("/api/v1/delivery/requirements");
    expect(parsed.searchParams.get("unknown_origkey")).toBeNull();
    expect(parsed.searchParams.get("owner_id")).toBe("user:a");
    expect(parsed.searchParams.get("cursor")).toBe("opaque/+");
    expect(options?.headers).toEqual({ "X-Project-Id": "P" });
  });
  it("keeps exact task, member selection and current view requests independent of export", async () => {
    vi.mocked(request).mockResolvedValue({ items: [] });
    await fetchTaskDetail("P", "T-501");
    await fetchTaskPage("P", { requirement_id: "R-501", limit: 20 });
    await fetchDeliveryReferences("P", "member", {
      ids: ["user:501"],
      limit: 100,
    });
    await fetchDeliveryContext("P");
    await rebuildDeliveryQuery("P");
    const paths = vi.mocked(request).mock.calls.map(([href]) => String(href));
    expect(paths.some((href) => href.includes("/workspace"))).toBe(false);
    expect(paths[0]).toBe("/api/v1/delivery/tasks/T-501");
    expect(paths[2]).toContain("ids=user%3A501");
    expect(vi.mocked(request).mock.calls[4][1]).not.toHaveProperty("body");
  });
  it.each(["page", "reference", "detail"])(
    "rejects a %s response from a newer generation than the active context",
    async (kind) => {
      vi.mocked(request).mockResolvedValue({
        project_id: "P",
        query_generation: 8,
        items: [],
      });
      const read =
        kind === "page"
          ? fetchRequirementPage("P", {}, undefined, 7)
          : kind === "reference"
            ? fetchDeliveryReferences("P", "member", {}, undefined, 7)
            : fetchRequirementDetail("P", "R-1", undefined, 7);
      await expect(read).rejects.toThrow("delivery_query_cursor_stale");
    },
  );
  it("rejects mixed generations rather than assembling an editable task from different reads", async () => {
    vi.mocked(request).mockImplementation(async (href) => {
      if (String(href).endsWith("/tasks/T-501"))
        return {
          project_id: "P",
          version: 1,
          query_generation: 1,
          planning_basis: "fixed",
          task: {
            id: "T-501",
            req_id: "",
            owner_id: "",
            planning: { depends_on: [] },
          },
          requirement: null,
        } as never;
      if (String(href).endsWith("/context"))
        return {
          project_id: "P",
          version: 2,
          query_generation: 2,
          project: { id: "P" },
          permissions: { write: true },
        } as never;
      return { project_id: "P", query_generation: 1, items: [] } as never;
    });
    await expect(fetchDeliveryTaskData("P", "T-501")).rejects.toThrow(
      "delivery_query_cursor_stale",
    );
  });
});
