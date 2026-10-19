import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  fetchDeliveryActivity,
  fetchDeliveryActivityItem,
  fetchRequirementHistory,
  fetchRequirementHistoryItem,
  previewRequirementChange,
  saveRequirementChange,
} from "./deliveryCollaboration";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());
describe("scoped collaboration HTTP boundary", () => {
  it("filters requirement activity before pagination and sends its actual cancellation signal", async () => {
    const signal = new AbortController().signal;
    await fetchDeliveryActivity("P", {
      requirementId: "R/1",
      action: "task.update",
      cursor: "opaque/page",
      signal,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/delivery/activity?scope=requirement&limit=20&scope_id=R%2F1&action=task.update&cursor=opaque%2Fpage",
      { headers: { "X-Project-Id": "P" }, signal },
    );
  });
  it("reads project activity without an invented requirement scope", async () => {
    await fetchDeliveryActivity("P");
    expect(request).toHaveBeenCalledWith(
      "/api/v1/delivery/activity?scope=project&limit=20",
      { headers: { "X-Project-Id": "P" }, signal: undefined },
    );
  });
  it("uses exact encoded reads for older events and requirement versions", async () => {
    await fetchDeliveryActivityItem("P", "event/50");
    await fetchRequirementHistoryItem("P", "R/1", "version/30");
    expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/delivery/activity/event%2F50",
      "/api/v1/delivery/requirements/R%2F1/history/version%2F30",
    ]);
  });
  it("reads metadata history without a current impact or write preview", async () => {
    await fetchRequirementHistory("P", "R", "older");
    expect(request).toHaveBeenCalledWith(
      "/api/v1/delivery/requirements/R/history?limit=20&cursor=older",
      { headers: { "X-Project-Id": "P" }, signal: undefined },
    );
  });
  it("pins the explicit requirement basis in preview and both bases in confirmation", async () => {
    await previewRequirementChange("P", "R", "basis", { title: "Updated" });
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/requirements/R/change-preview",
      {
        method: "POST",
        headers: { "X-Project-Id": "P" },
        signal: undefined,
        body: '{"requirement_basis":"basis","changes":{"title":"Updated"}}',
      },
    );
    await saveRequirementChange(
      "P",
      { version: 7, key: "original" },
      {
        id: "R",
        title: "Updated",
        requirement_basis: "basis",
        change_preview_basis: "preview",
      },
    );
    expect(request).toHaveBeenLastCalledWith("/api/v1/delivery/commands", {
      method: "POST",
      headers: { "X-Project-Id": "P" },
      body: '{"action":"requirement.update","payload":{"id":"R","title":"Updated","requirement_basis":"basis","change_preview_basis":"preview"},"expected_version":7,"idempotency_key":"original"}',
    });
  });
  it("rejects a missing explicit project before any request", () => {
    expect(() => fetchDeliveryActivity("")).toThrow("explicitProject");
    expect(request).not.toHaveBeenCalled();
  });
});
