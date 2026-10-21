import { beforeEach, expect, it, vi } from "vitest";
import { eventTargetHref } from "./eventReceiptState";
import { request } from "./http";
import { fetchTaskDetail } from "./deliveryQuery";

vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./deliveryQuery", () => ({ fetchTaskDetail: vi.fn(), fetchRequirementDetail: vi.fn() }));
vi.mock("./deliveryIssue", () => ({ fetchDeliveryIssue: vi.fn() }));
const effect = { kind: "task_delivery_submitted", target_kind: "task_submission", target_id: "submission-1" } as const;
beforeEach(() => { vi.clearAllMocks(); });

it("opens the precise saved report on its current task and preserves return position", async () => {
  vi.mocked(request).mockResolvedValue({ project_id: "P", task_id: "任务", submission_id: "submission-1" });
  vi.mocked(fetchTaskDetail).mockResolvedValue({ project_id: "P", task: { id: "任务", req_id: "R" } } as any);
  const back = "#/intelligence/events?project_id=P&event_receipt=E&event_page=2";
  const href = await eventTargetHref("P", effect, back);
  const params = new URLSearchParams(href.split("?")[1]);
  expect(params.get("task")).toBe("任务");
  expect(params.get("submission_id")).toBe("submission-1");
  expect(params.get("requirement")).toBe("R");
  expect(params.get("event_return")).toBe(back);
  expect(request).toHaveBeenCalledWith("/api/v1/delivery/delivery-submissions/submission-1/locator", expect.objectContaining({ headers: { "X-Project-Id": "P" } }));
});

it.each([
  { project_id: "other", task_id: "T", submission_id: "submission-1" },
  { project_id: "P", task_id: "T", submission_id: "another" },
  { project_id: "P", task_id: "", submission_id: "submission-1" },
  { project_id: "P", task_id: "T", submission_id: "submission-1", latest: true },
])("does not guess a task from a mismatched locator", async (value) => {
  vi.mocked(request).mockResolvedValue(value);
  await expect(eventTargetHref("P", effect, "")).rejects.toThrow();
  expect(fetchTaskDetail).not.toHaveBeenCalled();
});

it("keeps a missing report or changed task scope on the receipt page", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("HTTP 404: report unavailable"));
  await expect(eventTargetHref("P", effect, "")).rejects.toThrow("404");
  vi.mocked(request).mockResolvedValue({ project_id: "P", task_id: "T", submission_id: "submission-1" });
  vi.mocked(fetchTaskDetail).mockResolvedValue({ project_id: "other", task: { id: "T" } } as any);
  await expect(eventTargetHref("P", effect, "")).rejects.toThrow("event_scope_changed");
});
