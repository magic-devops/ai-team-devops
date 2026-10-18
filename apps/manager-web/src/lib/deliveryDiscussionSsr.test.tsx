import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryObjectCollaboration,
  DeliveryDiscussionPanel,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionPanel";
import { DeliveryDiscussionThread } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionThread";
import { DeliverySourceSummary } from "../../subapps/ai-rd-center/src/pages/delivery/DeliverySourceSummary";
import {
  DiscussionAdoptionSource,
  useDiscussionAdoptionSource,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionAdoptionSource";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
function render<P extends object>(component: ComponentType<P>, props: P) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      {
        client: new QueryClient({
          defaultOptions: { queries: { retry: false } },
        }),
      },
      createElement(component, props),
    ),
  );
}
describe("discussion shared server rendering without browser globals", () => {
  it("keeps the object collaboration section initially collapsed", () => {
    expect(typeof location).toBe("undefined");
    const html = render(DeliveryObjectCollaboration, {
      projectId: "P",
      sessionId: "S",
      subject: { kind: "task", id: "T" },
    });
    expect(html).toContain("deliveryDiscussion.title");
    expect(html).toContain("deliveryDiscussion.sources");
  });
  it("renders project and exact-thread initial loading without location", () => {
    expect(typeof location).toBe("undefined");
    expect(() =>
      render(DeliveryDiscussionPanel, { projectId: "P", sessionId: "S" }),
    ).not.toThrow();
    expect(() =>
      render(DeliveryDiscussionThread, {
        projectId: "P",
        sessionId: "S",
        threadId: "D",
        route: {
          thread: "D",
          message: "",
          state: "all",
          cursor: "",
          page: 1,
          messageCursor: "",
          messagePage: 1,
        },
        onRoute: () => {},
        onBack: () => {},
      }),
    ).not.toThrow();
  });
  it("renders source loading and fixed source navigation without location", () => {
    expect(typeof location).toBe("undefined");
    expect(() =>
      render(DeliverySourceSummary, {
        projectId: "P",
        sessionId: "S",
        target: { kind: "task", id: "T" },
      }),
    ).not.toThrow();
    function Source() {
      const source = useDiscussionAdoptionSource({
        reference: {
          thread_id: "D",
          expected_thread_version: 3,
          resolution_event_id: "E",
          message_id: "M",
          message_revision: 2,
        },
        thread: { id: "D", title: "Fixed" } as any,
        message: {
          id: "M",
          body: "Human conclusion",
          author: { id: "U", name: "Actual User" },
          refs: [],
        } as any,
        field: "description",
      });
      return createElement(DiscussionAdoptionSource, {
        projectId: "P",
        source,
      });
    }
    const html = render(Source, {});
    expect(html).toContain("Human conclusion");
    expect(html).toContain("discussion_thread=D");
  });
});
