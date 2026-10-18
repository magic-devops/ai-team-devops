import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  fetchEventPage,
  fetchEventReceipt,
  fetchEventAttempts,
  retryEventReceipt,
  prepareEventRetry,
  eventHash,
  parseEventRoute,
  safeEventReturn,
} from "./eventReceipts";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => {
  vi.mocked(request).mockReset();
});
const source = {
  id: "R",
  event_id: "original",
  digest: "a".repeat(64),
  processing: { revision: 3 },
} as any;
describe("bounded durable event receipts", () => {
  it("requests a server-filtered window with an explicit project and opaque cursor", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      items: [],
      limit: 20,
    });
    const signal = new AbortController().signal;
    await fetchEventPage(
      "P",
      {
        state: "failed",
        type: "sop.issue.opened",
        producer: "U",
        cursor: "opaque/+",
      },
      signal,
    );
    expect(vi.mocked(request).mock.calls[0]).toEqual([
      "/api/v1/events?state=failed&type=sop.issue.opened&producer_id=U&limit=20&cursor=opaque%2F%2B",
      { headers: { "X-Project-Id": "P" }, signal },
    ]);
  });
  it("rejects cross-project reads and wrong exact receipt identities", async () => {
    vi.mocked(request).mockResolvedValue({ project_id: "other", items: [] });
    await expect(fetchEventPage("P", {})).rejects.toThrow(
      "event_scope_changed",
    );
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      event: { ...source, id: "other" },
    });
    await expect(fetchEventReceipt("P", "R")).rejects.toThrow(
      "event_scope_changed",
    );
  });
  it("reads exact attempts outside the original detail window", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      receipt_id: "R",
      items: [],
    });
    await fetchEventAttempts("P", "R", "next/+");
    expect(vi.mocked(request).mock.calls[0][0]).toBe(
      "/api/v1/events/R/attempts?limit=20&cursor=next%2F%2B",
    );
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      receipt_id: "wrong",
      items: [],
    });
    await expect(fetchEventAttempts("P", "R")).rejects.toThrow(
      "event_scope_changed",
    );
  });
  it("freezes the original reason/revision/key and validates the returned original event and digest", async () => {
    const command = prepareEventRetry(source, "human reason");
    source.processing.revision = 4;
    expect(command.body.expected_revision).toBe(3);
    expect(
      prepareEventRetry(
        { ...source, processing: { revision: 3 } },
        "human reason",
        command,
      ).key,
    ).toBe(command.key);
    expect(prepareEventRetry(source, "human reason", command).key).not.toBe(
      command.key,
    );
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      receipt_id: "R",
      event_id: "original",
      digest: source.digest,
    });
    await retryEventReceipt("P", command);
    expect(
      JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string),
    ).toEqual({
      expected_revision: 3,
      reason: "human reason",
      idempotency_key: command.key,
    });
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      receipt_id: "R",
      event_id: "other",
      digest: source.digest,
    });
    await expect(retryEventReceipt("P", command)).rejects.toThrow(
      "event_scope_changed",
    );
  });
  it("preserves exact receipt selections and resets list/attempt windows only at their own identity boundary", () => {
    const before =
      "#/intelligence/events?project_id=P&event_state=failed&event_cursor=older%2F%2B&event_page=3&event_receipt=R&event_attempt_cursor=a&event_attempt_page=2";
    expect(
      parseEventRoute(eventHash("P", { state: "pending" }, before)),
    ).toMatchObject({
      state: "pending",
      receipt: "R",
      cursor: "",
      page: 1,
      attemptPage: 2,
    });
    expect(
      parseEventRoute(eventHash("P", { receipt: "new" }, before)),
    ).toMatchObject({
      receipt: "new",
      cursor: "older/+",
      page: 3,
      attemptCursor: "",
      attemptPage: 1,
    });
  });
  it("permits only bounded same-project event return routes", () => {
    const allowed =
      "#/intelligence/events?project_id=P&event_receipt=R&event_cursor=older&event_page=3";
    expect(safeEventReturn(allowed, "P")).toBe(allowed);
    for (const value of [
      allowed.replace("project_id=P", "project_id=other"),
      allowed + "&project_id=P",
      allowed + "&redirect=https%3A%2F%2Fevil",
      allowed.replace("#/intelligence/events", "#/other"),
      "https://evil/",
    ])
      expect(safeEventReturn(value, "P")).toBeNull();
  });
});
