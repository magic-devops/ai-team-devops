import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Intelligence } from "../../subapps/ai-foundation/src/pages/Intelligence";
import { eventTargetHref } from "./eventReceiptState";
import { eventHash, safeEventReturn } from "./eventReceipts";
import { request } from "./http";
import { reflectionDetailFixture } from "./reflectionFixtures";

vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const background =
  "#/intelligence/reflections?project_id=P&reflection_receipt=R&reflection_category=testing&reflection_page=3";
const eventReturn =
  "#/intelligence/events?project_id=P&event_receipt=R&reflection_return=" +
  encodeURIComponent(background);
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  localStorage.setItem("sop-token", "token");
  localStorage.setItem("sop-current-project-id", "P");
  localStorage.setItem("sop-session-revision", "current-session");
  vi.stubGlobal("location", { hash: background });
});

describe("reflection workspace integration", () => {
  it("renders the canonical reflection workspace through the real Intelligence consumer", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Intelligence, {
          initialTab: "reflections" as never,
          focused: true,
        }),
      ),
    );
    expect(html).toContain("reflections.title");
    expect(html).toContain("reflections.countScope");
    expect(html).not.toContain("page.intelligence.runDistill");
    client.clear();
  });

  it("keeps a validated same-project reflection return in the original event route", () => {
    expect(safeEventReturn(eventReturn, "P")).toBe(eventReturn);
    const href = eventHash("P", { receipt: "R2" }, eventReturn);
    expect(new URLSearchParams(href.split("?")[1]).get("reflection_return"))
      .toBe(background);
    expect(safeEventReturn(eventReturn, "other-project")).toBeNull();
  });

  it("opens a reflection result only after checking its current exact project and original", async () => {
    vi.mocked(request).mockResolvedValue(reflectionDetailFixture());
    const href = await eventTargetHref(
      "P",
      { kind: "reflection_recorded", target_kind: "reflection", target_id: "R" } as never,
      "#/intelligence/events?project_id=P&event_receipt=R",
    );
    expect(href.split("?")[0]).toBe("#/intelligence/reflections");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("reflection_receipt")).toBe("R");
    expect(params.get("event_return")).toBe("#/intelligence/events?project_id=P&event_receipt=R");
    expect(vi.mocked(request).mock.calls[0][0]).toBe("/api/v1/reflections/R");
  });
});
