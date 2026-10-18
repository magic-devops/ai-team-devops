import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventReceiptReturn } from "../components/EventReceiptReturn";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => vi.unstubAllGlobals());
describe("event return in existing object details", () => {
  it("offers the exact same-project receipt window and disables it while unresolved", () => {
    const back =
      "#/intelligence/events?project_id=P&event_state=failed&event_receipt=R&event_cursor=original";
    vi.stubGlobal("location", {
      hash:
        "#/dev-flow?project_id=P&task=T&event_return=" +
        encodeURIComponent(back),
    });
    const html = renderToStaticMarkup(
      createElement(EventReceiptReturn, { projectId: "P", disabled: true }),
    );
    expect(html).toContain("eventReceipts.back");
    expect(html).toContain("disabled");
    expect(html).not.toContain('href="');
    const available = renderToStaticMarkup(
      createElement(EventReceiptReturn, { projectId: "P" }),
    );
    expect(available).toContain(
      'href="#/intelligence/events?project_id=P&amp;event_state=failed&amp;event_receipt=R&amp;event_cursor=original"',
    );
  });
  it("rejects a foreign project or an arbitrary destination", () => {
    for (const back of [
      "#/intelligence/events?project_id=Q&event_receipt=R",
      "https://example.test/",
    ]) {
      vi.stubGlobal("location", {
        hash: "#/dev-flow?event_return=" + encodeURIComponent(back),
      });
      expect(
        renderToStaticMarkup(
          createElement(EventReceiptReturn, { projectId: "P" }),
        ),
      ).toBe("");
    }
  });
  it("renders safely before a browser location exists", () => {
    vi.stubGlobal("location", undefined);
    expect(
      renderToStaticMarkup(
        createElement(EventReceiptReturn, { projectId: "P" }),
      ),
    ).toBe("");
  });
});
