import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventGate, eventTargetHref } from "./eventReceiptState";
import { fetchTaskDetail } from "./deliveryQuery";
vi.mock("./deliveryQuery", () => ({
  fetchTaskDetail: vi.fn(),
  fetchRequirementDetail: vi.fn(),
}));
vi.mock("./deliveryIssue", () => ({ fetchDeliveryIssue: vi.fn() }));
beforeEach(() => {
  vi.mocked(fetchTaskDetail).mockReset();
});
describe("event result identity boundaries", () => {
  it("never revives old tickets after A to B to A without a replacement", () => {
    const gate = createEventGate();
    gate.enter("A");
    const old = gate.start();
    gate.enter("B");
    gate.enter("A");
    expect(gate.current(old)).toBe(false);
    const replacement = gate.start();
    expect(gate.current(replacement)).toBe(true);
    gate.leave();
    expect(gate.current(replacement)).toBe(false);
  });
  it("rereads the current task requirement before opening an event result", async () => {
    vi.mocked(fetchTaskDetail).mockResolvedValue({
      project_id: "P",
      task: { id: "T", req_id: "new-R" },
    } as any);
    const back =
      "#/intelligence/events?project_id=P&event_receipt=R&event_cursor=older&event_page=3";
    const result = await eventTargetHref(
      "P",
      { kind: "task_updated", target_kind: "task", target_id: "T" },
      back,
    );
    const params = new URLSearchParams(result.split("?")[1]);
    expect(params.get("requirement")).toBe("new-R");
    expect(params.get("task")).toBe("T");
    expect(params.get("event_return")).toBe(back);
  });
  it("keeps missing or unsupported targets on the event page", async () => {
    vi.mocked(fetchTaskDetail).mockRejectedValue(new Error("HTTP 404: gone"));
    await expect(
      eventTargetHref(
        "P",
        { kind: "task_updated", target_kind: "task", target_id: "T" },
        "",
      ),
    ).rejects.toThrow("404");
    await expect(
      eventTargetHref(
        "P",
        {
          kind: "asset_materialized",
          target_kind: "asset",
          target_id: "RULES.md",
        },
        "",
      ),
    ).rejects.toThrow("event_target_unavailable");
  });
});
