import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { DeliveryRequirementChangeHost } from "@/../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementChangeHost";
import { request } from "@/lib/http";
const h = vi.hoisted(() => ({ buttons: [] as any[], requests: [] as any[] }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: any) => (Array.isArray(key) ? key[0] : key),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/projectPortfolio", async () => ({
  ...(await vi.importActual<any>("@/lib/projectPortfolio")),
  projectSessionKey: () => "S",
}));
vi.mock("@/lib/http", async () => ({
  ...(await vi.importActual<any>("@/lib/http")),
  request: vi.fn(),
  bindSessionRequest: () => request,
}));
vi.mock("antd", async () => {
  const actual = await vi.importActual<any>("antd");
  const block = ({ children, title, description, footer, action }: any) =>
    createElement("section", {}, title, description, children, footer, action);
  const Button = (props: any) => {
    h.buttons.push(props);
    return createElement(
      "button",
      { "data-action": props["data-action"], disabled: props.disabled },
      props.children,
    );
  };
  return {
    ...actual,
    Alert: block,
    Modal: block,
    Drawer: block,
    Skeleton: block,
    Button,
  };
});
const basis = "a".repeat(64),
  stamp = "2026-10-19T00:00:00Z";
const envelope = {
  project_id: "P",
  requirement_id: "R",
  version: 7,
  query_generation: 3,
  as_of: stamp,
};
const head = {
  ...envelope,
  requirement: {
    id: "R",
    title: "Requirement R",
    basis,
    priority: "P1",
    status: "active",
    sprint_id: "",
    tasks_total: 0,
    tasks_done: 0,
    tasks_recorded_done: 0,
    accepted: false,
    deployment_verified: false,
    flow: {
      stage: "development",
      revision: 2,
      owner_id: "",
      due_on: null,
      milestone_id: "",
      blocked_reason: "",
      closed: false,
      legacy_completed: false,
      gates: [],
      record_counts: { artifacts: 1, reviews: 1, releases: 1 },
    },
  },
};
const context = {
  project_id: "P",
  project: { id: "P", name: "Project P", status: "active" },
  permissions: { read: true, write: true, approve: true },
  query_state: { status: "ready" },
  version: 7,
  query_generation: 3,
};
const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30000 } },
  });
function fail(client: QueryClient, key: any[], status: number) {
  client
    .getQueryCache()
    .find({ queryKey: key, exact: true })!
    .setState({
      status: "error",
      error: new Error(`HTTP ${status}: controlled failure`),
    });
}
function render(client: QueryClient, node: ReactNode) {
  h.buttons = [];
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, node),
  );
}
const host = () =>
  createElement(DeliveryRequirementChangeHost, {
    projectId: "P",
    requirementId: "R",
    sessionId: "S",
    onClose: () => {},
    onSaved: () => {},
    onUnresolvedChange: () => {},
  });
beforeEach(() => {
  h.requests = [];
  h.buttons = [];
  const local = new Map([
      ["sop-current-project-id", "P"],
      ["sop-token", "controlled-review-token"],
      ["sop-session-revision", "S"],
      ["sop-user", JSON.stringify({ id: "reader", tenant_id: "tenant" })],
    ]),
    session = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) || null,
    setItem: (key: string, value: string) => local.set(key, value),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => session.get(key) || null,
    setItem: (key: string, value: string) => session.set(key, value),
  });
  vi.stubGlobal("location", {
    hash: "#/dev-flow?project_id=P&requirement=R&requirement_edit=1",
    pathname: "/",
    search: "",
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (url: any) => {
      h.requests.push(url);
      if (String(url).includes("/definition"))
        return {
          ...envelope,
          requirement_basis: basis,
          definition: {
            id: "R",
            title: "R",
            description: "RECOVERED_ORIGINAL",
            acceptance_criteria: ["criterion"],
          },
        };
      if (String(url).includes("/requirements/R")) return head;
      if (String(url).includes("/context")) return context;
      throw new Error("unexpected request " + url);
    });
});
describe("independent real cache requirement read entry probes", () => {
  it("explicit retry recovers an unchanged head whose separate definition failed", async () => {
    const client = makeClient();
    client.setQueryData(
      ["delivery-requirement-edit-context", "P", "S", "R"],
      context,
    );
    client.setQueryData(
      ["delivery-requirement-edit-head", "P", "S", "R", 3],
      head,
    );
    const def = [
      "delivery-requirement-edit-definition",
      "P",
      "S",
      "R",
      basis,
      3,
    ];
    client.setQueryData(def, {
      ...envelope,
      requirement_basis: basis,
      definition: {
        id: "R",
        title: "R",
        description: "original",
        acceptance_criteria: ["criterion"],
      },
    });
    fail(client, def, 503);
    const html = render(client, host());
    expect(html).toContain("deliveryCollaboration.definitionUnavailable");
    h.buttons.find((p) => p["data-action"] === "retry-edit-reads").onClick();
    await vi.waitFor(() =>
      expect(
        h.requests.some((url) => String(url).includes("/definition")),
      ).toBe(true),
    );
    await vi.waitFor(() =>
      expect((client.getQueryData(def) as any).definition.description).toBe(
        "RECOVERED_ORIGINAL",
      ),
    );
    expect(render(client, host())).toContain("RECOVERED_ORIGINAL");
    client.clear();
  });
});
