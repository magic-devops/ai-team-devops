import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { EventReceiptWorkbench } from "../../subapps/ai-foundation/src/pages/intelligence/events/EventReceiptWorkbench";
import { EventReceiptDetail } from "../../subapps/ai-foundation/src/pages/intelligence/events/EventReceiptDetail";
import { parseEventRoute } from "./eventReceipts";
import { projectSessionKey } from "./projectPortfolio";
import { eventDetailFixture } from "./eventReceiptFixtures";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
function render<P extends object>(
  component: ComponentType<P>,
  props: P,
  client = new QueryClient(),
) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(component, props),
    ),
  );
}
describe("real event receipt SSR without browser globals", () => {
  it("renders the initial list and missing project states without location or storage", () => {
    expect(typeof location).toBe("undefined");
    expect(() =>
      render(EventReceiptWorkbench, { projectId: "P" }),
    ).not.toThrow();
    expect(render(EventReceiptWorkbench, { projectId: "" })).toContain(
      "eventReceipts.noProject",
    );
  });
  it("renders exact detail loading without location or storage", () => {
    expect(typeof location).toBe("undefined");
    const props = {
      projectId: "P",
      receiptId: "R",
      identity: "A",
      route: parseEventRoute(""),
      background: "",
      onRoute: () => {},
      onPending: () => {},
      canNavigate: () => true,
      onNavigate: () => {},
      onSaved: () => {},
    };
    expect(() => render(EventReceiptDetail, props)).not.toThrow();
  });
  it("renders server-authenticated identity and history while keeping raw original text collapsed", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["event-receipt", "P", projectSessionKey(), "R"],
      eventDetailFixture(),
    );
    const props = {
      projectId: "P",
      receiptId: "R",
      identity: "A",
      route: parseEventRoute(""),
      background: "",
      onRoute: () => {},
      onPending: () => {},
      canNavigate: () => true,
      onNavigate: () => {},
      onSaved: () => {},
    };
    const html = render(EventReceiptDetail, props, client);
    expect(html).toContain("actual-user");
    expect(html).toContain("eventReceipts.stored");
    expect(html).toContain("eventReceipts.failed");
    expect(html).not.toContain("cached secret");
  });
  it("shows an adopted processed business result without offering another processing retry", () => {
    expect(typeof location).toBe("undefined");
    const client = new QueryClient();
    const detail = eventDetailFixture();
    detail.event.processing.state = "processed";
    detail.event.processing.revision = 5;
    detail.event.processing.result = {
      kind: "task_updated",
      target_kind: "task",
      target_id: "processed-task",
    };
    detail.capabilities.retry = false;
    client.setQueryData(
      ["event-receipt", "P", projectSessionKey(), "R"],
      detail,
    );
    const html = render(
      EventReceiptDetail,
      {
        projectId: "P",
        receiptId: "R",
        identity: "A",
        route: parseEventRoute(""),
        background: "",
        onRoute: () => {},
        onPending: () => {},
        canNavigate: () => true,
        onNavigate: () => {},
        onSaved: () => {},
      },
      client,
    );
    expect(html).toContain("processed-task");
    expect(html).toContain("eventReceipts.processed");
    expect(html).toContain("eventReceipts.openTarget");
    expect(html).not.toContain("eventReceipts.confirm");
    expect(html).not.toContain("eventReceipts.unknown");
  });
});
