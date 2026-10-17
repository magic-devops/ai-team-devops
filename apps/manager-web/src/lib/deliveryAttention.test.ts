import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDeliveryInbox } from "./delivery";
import { fetchDeliveryProgressSummary } from "./deliveryProgress";
import { deliveryInboxHash, parseDeliveryRoute } from "./deliveryProjectInbox";
import { request } from "./http";

vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());

describe("bounded delivery attention reads", () => {
  it("requests one server-filtered window and rejects mismatched project or context generations", async () => {
    const signal = new AbortController().signal;
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      query_generation: 7,
      scope: "team",
      category: "acceptance",
      limit: 20,
      items: [],
    });
    await fetchDeliveryInbox(
      "P",
      "team",
      signal,
      { category: "acceptance", limit: 20, cursor: "opaque/+?" },
      7,
    );
    const [href, options] = vi.mocked(request).mock.calls[0];
    const url = new URL(href, "http://local");
    expect(url.pathname).toBe("/api/v1/delivery/inbox");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scope: "team",
      category: "acceptance",
      limit: "20",
      cursor: "opaque/+?",
    });
    expect(options).toEqual({ headers: { "X-Project-Id": "P" }, signal });
    for (const change of [{ project_id: "other" }, { query_generation: 8 }]) {
      vi.mocked(request).mockResolvedValue({
        project_id: "P",
        query_generation: 7,
        ...change,
      });
      await expect(
        fetchDeliveryInbox("P", "team", undefined, {}, 7),
      ).rejects.toThrow("delivery_query_cursor_stale");
    }
  });
  it("requests only the project progress summary with a fixed date range and validates generation", async () => {
    const signal = new AbortController().signal;
    const range = { startsOn: "2026-10-01", endsOn: "2026-10-18" };
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      query_generation: 7,
      timezone: "UTC",
      range: { starts_on: range.startsOn, ends_on: range.endsOn },
    });
    await fetchDeliveryProgressSummary("P", range, signal, 7);
    expect(vi.mocked(request).mock.calls[0]).toEqual([
      "/api/v1/delivery/progress/summary?starts_on=2026-10-01&ends_on=2026-10-18",
      { headers: { "X-Project-Id": "P" }, signal },
    ]);
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      query_generation: 8,
    });
    await expect(
      fetchDeliveryProgressSummary("P", range, signal, 7),
    ).rejects.toThrow("delivery_query_cursor_stale");
  });
  it("preserves inbox windows in deep links and resets them when scope or category changes", () => {
    const source =
      "#/dev-flow?view=inbox&inbox_scope=team&category=blocked&inbox_cursor=older%2F%2B&inbox_page=3&project_id=P";
    const target = { view: "inbox", requirement_id: "", detail: "details" };
    expect(parseDeliveryRoute(source)).toMatchObject({
      inboxCursor: "older/+",
      inboxPage: 3,
    });
    expect(
      parseDeliveryRoute(
        deliveryInboxHash(
          target,
          { inboxCursor: "next/+", inboxPage: 4 },
          source,
        ),
      ),
    ).toMatchObject({
      inboxCursor: "next/+",
      inboxPage: 4,
      inboxScope: "team",
      inboxCategory: "blocked",
    });
    for (const filters of [
      { inboxScope: "mine" as const },
      { inboxCategory: "acceptance" as const },
    ])
      expect(
        parseDeliveryRoute(deliveryInboxHash(target, filters, source)),
      ).toMatchObject({ inboxCursor: "", inboxPage: 1 });
    const detail = deliveryInboxHash(
      { view: "list", requirement_id: "R", detail: "tasks", task_id: "T" },
      {},
      source,
    );
    expect(parseDeliveryRoute(detail)).toMatchObject({
      inboxCursor: "older/+",
      inboxPage: 3,
    });
  });
});
