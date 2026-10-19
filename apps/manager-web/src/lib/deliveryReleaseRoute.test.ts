import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Tabs } from "antd";
import { DeliveryWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench";
import {
  DeliveryRequirementRecords,
  RequirementRecordOriginal,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementReads";
import { request } from "./http";
import { parseDeliveryRoute } from "./deliveryProjectInbox";

const h = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  data: {} as Record<string, any>,
  options: [] as any[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useMemo: (fn: any) => fn(),
  useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.state))
      h.state[index] = typeof initial === "function" ? initial() : initial;
    return [
      h.state[index],
      (value: any) => {
        h.state[index] =
          typeof value === "function" ? value(h.state[index]) : value;
      },
    ];
  },
  useRef: (value: any) => (h.refs[h.refNext++] ||= { current: value }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: any) => (Array.isArray(key) ? key[key.length - 1] : key),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("./authStorage", async () => ({
  ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")),
  getProjectId: () => "P",
  getToken: () => "controlled",
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>(
    "./projectPortfolio",
  )),
  projectSessionKey: () => "S",
}));
vi.mock("./http", async () => ({
  ...(await vi.importActual<typeof import("./http")>("./http")),
  request: vi.fn(),
}));
vi.mock("./executionExitGuard", () => ({
  useExecutionExitGuard: () => ({
    pending: false,
    blocked: false,
    canNavigate: () => true,
    setPending: () => false,
  }),
}));
vi.mock("../components/DeliveryMemberIdentity", () => ({
  useMemberIdentity: () => (_members: unknown, id: string) => id,
}));
vi.mock("./deliveryAttention", () => ({
  useDeliveryInboxQuery: () => ({ data: undefined, refetch: vi.fn() }),
  useDeliveryInboxNavigation: () => ({ open: vi.fn(), retry: vi.fn() }),
}));
const basis = "a".repeat(64),
  base = {
    project_id: "P",
    requirement_id: "R",
    version: 7,
    query_generation: 3,
    as_of: "2026-10-19T00:00:00Z",
  };
const requirement = {
  id: "R",
  title: "Release requirement",
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
    stage: "operations",
    revision: 2,
    owner_id: "",
    milestone_id: "",
    due_on: null,
    blocked_reason: "",
    closed: false,
    legacy_completed: false,
    gates: [],
    record_counts: { artifacts: 0, reviews: 0, releases: 1 },
  },
};
const head = { ...base, requirement };
const context = {
  project_id: "P",
  project: { id: "P", name: "Project", status: "active" },
  permissions: { read: true, write: true, approve: true },
  query_state: { status: "ready" },
  version: 7,
  query_generation: 3,
};
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useQueryClient: () => ({
    getQueryData: () => context,
    invalidateQueries: vi.fn(),
  }),
  useQuery: (options: any) => {
    h.options.push(options);
    return {
      data:
        options.queryKey[0] === "delivery-context"
          ? context
          : options.queryKey[0] === "delivery-requirement-detail"
            ? head
            : h.data[options.queryKey[0]] || { items: [] },
      isError: false,
      error: null,
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));
function find(
  node: ReactNode,
  type: unknown,
  predicate: (props: any) => boolean = () => true,
): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(
      node.props.items?.map((item: any) => item.children),
      type,
      predicate,
    )
  );
}
function render<T>(fn: () => T) {
  h.next = 0;
  h.refNext = 0;
  return fn();
}
beforeEach(() => {
  h.state = [];
  h.refs = [];
  h.next = 0;
  h.refNext = 0;
  h.data = {};
  h.options = [];
  vi.mocked(request).mockReset();
  vi.stubGlobal("location", {
    hash: "#/dev-flow?view=list&project_id=P&requirement=R&detail=release&return_to=%23%2Fprojects%2Fportfolio",
    pathname: "/",
    search: "",
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("history", { replaceState: vi.fn(), pushState: vi.fn() });
  vi.stubGlobal("PopStateEvent", class {});
});

describe("quality and release workspace entry points", () => {
  it("restores both canonical workbench views instead of silently opening overview", () => {
    for (const view of ["quality", "releases"])
      expect(
        parseDeliveryRoute(`#/dev-flow?view=${view}&release_id=REL-exact`).view,
      ).toBe(view);
  });
  it("retires manual release writes while keeping the recorded history visible", () => {
    const ui = readFileSync(
      new URL(
        "../../subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const api = readFileSync(new URL("./delivery.ts", import.meta.url), "utf8");
    expect(ui).not.toContain("const releaseEditor");
    expect(ui).not.toContain('commit("release.save"');
    expect(api).not.toContain('| "release.save"');

    expect(ui).toContain("deliveryRelease.historicalManual");
  });
  it("keeps the actual recorded-release tab and navigates to native candidates with project and return context", () => {
    const page = render(() => {
      const outer = DeliveryWorkbench() as any;
      return outer.props.children.type();
    });
    const tab = find(page, Tabs, (props) =>
      props.items.some((item: any) => item.key === "release"),
    ).items.find((item: any) => item.key === "release");
    expect(find(tab.children, DeliveryRequirementRecords)).toMatchObject({
      projectId: "P",
      head,
      collection: "releases",
    });
    expect(JSON.stringify(tab.children)).toContain(
      "deliveryRelease.historicalManual",
    );
    find(
      tab.children,
      Button,
      (props) => props.children === "deliveryRelease.releases",
    ).onClick();
    const destination = vi.mocked(history.replaceState).mock
      .calls[0][2] as string;
    const params = new URLSearchParams(destination.split("?")[1]);
    expect(params.get("view")).toBe("releases");
    expect(params.get("project_id")).toBe("P");
    expect(params.has("requirement")).toBe(false);
    expect(params.get("return_to")).toBe("#/projects/portfolio");
  });
  it("reads a release summary and exact position zero independently before displaying the preserved verification and rollback", async () => {
    const page = {
      ...base,
      requirement_basis: basis,
      collection: "releases",
      items: [
        {
          position: 0,
          revision: 2,
          kind: null,
          stage: null,
          title: "v1.2",
          result: null,
          decision: null,
          actor: null,
          at: base.as_of,
          stale: false,
        },
      ],
      total: 1,
      limit: 20,
      next_cursor: null,
    };
    const original = {
      ...base,
      requirement_basis: basis,
      collection: "releases",
      position: 0,
      record: {
        id: "legacy-release",
        version: "v1.2",
        environment: "production",
        revision: 2,
        at: base.as_of,
        verification: "RECORDED_VERIFICATION",
        rollback_plan: "RECORDED_ROLLBACK",
        artifact_url: "https://example.test/artifact",
      },
    };
    vi.mocked(request)
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(original);
    const records = () =>
      render(() =>
        DeliveryRequirementRecords({
          projectId: "P",
          sessionId: "S",
          head: head as any,
          collection: "releases",
          onNavigate: (href) => {
            location.hash = href;
          },
        }),
      );
    records();
    const signal = new AbortController().signal;
    h.data["delivery-requirement-records"] = await h.options
      .find((options) => options.queryKey[0] === "delivery-requirement-records")
      .queryFn({ signal });
    find(
      records(),
      Button,
      (props) => props["data-action"] === "open-record",
    ).onClick();
    expect(
      new URLSearchParams(location.hash.split("?")[1]).get(
        "requirement_record_position",
      ),
    ).toBe("0");
    records();
    h.data["delivery-requirement-record"] = await h.options
      .filter(
        (options) => options.queryKey[0] === "delivery-requirement-record",
      )
      .at(-1)
      .queryFn({ signal });
    const selected = find(records(), RequirementRecordOriginal);
    expect(selected).toMatchObject({
      collection: "releases",
      position: 0,
      record: original.record,
    });
    expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/delivery/requirements/R/records?query_generation=3&collection=releases&limit=20",
      "/api/v1/delivery/requirements/R/records/0?query_generation=3&collection=releases",
    ]);
    expect(
      vi
        .mocked(request)
        .mock.calls.every(
          ([, options]) =>
            new Headers(options?.headers).get("X-Project-Id") === "P" &&
            options?.signal === signal,
        ),
    ).toBe(true);
    h.state = [];
    h.refs = [];
    h.next = 0;
    h.refNext = 0;
    const html = renderToStaticMarkup(
      createElement(RequirementRecordOriginal, selected),
    );
    const business = html.split("<details>")[0];
    expect(business).toContain("RECORDED_VERIFICATION");
    expect(business).toContain("RECORDED_ROLLBACK");
    expect(business).toContain('href="https://example.test/artifact"');
    expect(
      vi
        .mocked(request)
        .mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(false);
  });
});
