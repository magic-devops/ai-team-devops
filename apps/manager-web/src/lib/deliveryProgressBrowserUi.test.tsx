import { isValidElement, type ReactNode } from "react";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryProgressSnapshotBrowser,
  DeliveryProgressComparisonBrowser,
  ProgressPager,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgressBrowser";
const h = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  data: {} as Record<string, any>,
  pages: {} as Record<string, any>,
  status: 0,
  options: [] as any[],
  scope: "original",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
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
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    h.options.push(options);
    return {
      data:
        options.queryKey[0] === "delivery-progress-snapshot-page"
          ? h.pages[String(options.queryKey.at(-1))]
          : h.data[options.queryKey[0]],
      isError: Boolean(h.status),
      error: h.status ? new Error(`HTTP ${h.status}: denied`) : null,
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("./deliveryQueryHooks", () => ({
  useDeliveryMemberReferences: () => ({ members: [] }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>(
    "./projectPortfolio",
  )),
  projectSessionKey: () => h.scope,
}));
function find(
  node: ReactNode,
  type: unknown,
  predicate: (props: any) => boolean = () => true,
): any {
  if (Array.isArray(node))
    return node.map((item) => find(item, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(node.props.action, type, predicate)
  );
}
function count(node: ReactNode, type: unknown): number {
  if (Array.isArray(node))
    return node.reduce((sum, item) => sum + count(item, type), 0);
  if (!isValidElement<any>(node)) return 0;
  return Number(node.type === type) + count(node.props.children, type);
}
const scope = { kind: "project", id: "", label: "Project P" },
  basis = "a".repeat(64);
const item = (id: string) => ({
  id,
  title: `Historical ${id}`,
  req_id: "R",
  sprint_id: "",
  milestone_id: "",
  owner_id: "U",
  assigned_to: "User",
  estimate: "M",
  starts_on: null,
  ends_on: null,
  basis,
  status: "pending",
  recorded_status: "pending",
});
const page = (items: any[], next: string | null = null) => ({
  project_id: "P",
  source_kind: "observation",
  source_id: "O",
  snapshot_basis: basis,
  scope,
  collection: "tasks",
  items,
  total: 256,
  limit: 20,
  next_cursor: next,
});
const onOpen = vi.fn();
function render() {
  h.next = 0;
  h.refNext = 0;
  h.options = [];
  return DeliveryProgressSnapshotBrowser({
    projectId: "P",
    sessionId: "S",
    sourceKind: "observation",
    sourceId: "O",
    route: {
      startsOn: "2026-10-01",
      endsOn: "2026-10-19",
      scope: "project",
      scopeId: "",
      baselineId: "",
      observationId: "O",
    },
    disabled: false,
    generation: 7,
    onOpenTask: onOpen,
  });
}
beforeEach(() => {
  h.state = [];
  h.refs = [];
  h.scope = "original";
  h.status = 0;
  h.pages = {
    "": page(
      Array.from({ length: 20 }, (_, index) => item(`T-${index}`)),
      "page-two",
    ),
    "page-two": page([item("T-off-page")]),
  };
  h.data = {
    "delivery-progress-source": {
      project_id: "P",
      observation: {
        id: "O",
        observed_at: "2026-10-18T00:00:00Z",
        observed_day: "2026-10-18",
        source: "daily",
        actor: "U",
        source_version: 1,
        snapshot_basis: basis,
        scope,
        task_count: 256,
        requirement_count: 1,
        metrics: null,
        available: true,
        reasons: [],
      },
    },
  };
  vi.stubGlobal("location", {
    hash: "#/dev-flow?view=progress&project_id=P&observation_id=O",
  });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal(
    "PopStateEvent",
    class {
      constructor(public type: string) {}
    },
  );
});
describe("bounded immutable snapshot interaction", () => {
  it("renders only the selected 20-row page of 256 and loads exact item facts only after an explicit click", () => {
    const tree = render();
    expect(count(tree, "article")).toBe(20);
    expect(find(tree, ProgressPager)).toMatchObject({
      total: 256,
      count: 20,
      next: "page-two",
    });
    expect(
      h.options.find(
        (value) => value.queryKey[0] === "delivery-progress-snapshot-item",
      ).enabled,
    ).toBe(false);
    find(tree, ProgressPager).onPage("page-two", 2);
    const next = render();
    expect(count(next, "article")).toBe(1);
    find(
      next,
      Button,
      (props) => props.children === "deliveryProgress.bounded.openOriginalItem",
    ).onClick();
    render();
    expect(
      h.options.find(
        (value) => value.queryKey[0] === "delivery-progress-snapshot-item",
      ),
    ).toMatchObject({
      enabled: true,
      queryKey: [
        "delivery-progress-snapshot-item",
        "P",
        "S",
        "observation",
        "O",
        basis,
        "project",
        "",
        "tasks",
        "T-off-page",
      ],
    });
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining("project_id=P"),
    );
  });
  for (const status of [403, 404])
    it(`suppresses cached historical rows after exact source HTTP ${status}`, () => {
      h.status = status;
      expect(count(render(), "article")).toBe(0);
      expect(find(render(), ProgressPager)).toBeUndefined();
    });
  it("does not execute an old item selection callback after a session revision changes", () => {
    const click = find(
      render(),
      Button,
      (props) => props.children === "deliveryProgress.bounded.openOriginalItem",
    ).onClick;
    h.scope = "new-session-revision";
    click();
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(count(render(), "article")).toBe(0);
  });
  it("uses the comparison summary generation and counts without opening the first category automatically", () => {
    h.next = 0;
    h.refNext = 0;
    h.data = {
      "delivery-progress-comparison": {
        project_id: "P",
        version: 7,
        query_generation: 8,
        baseline_id: "B",
        baseline_basis: basis,
        scope,
        available: true,
        complete: true,
        current_scope_available: true,
        counts: {
          added: 30,
          removed: 2,
          changed: 5,
          incomplete: 1,
          unchanged: 10,
        },
        reasons: [],
        incomplete_plan_fields: [],
        budget: {},
      },
    };
    DeliveryProgressComparisonBrowser({
      projectId: "P",
      sessionId: "S",
      baselineId: "B",
      generation: 8,
      disabled: false,
      onOpenTask: onOpen,
    });
    expect(
      h.options.find(
        (value) => value.queryKey[0] === "delivery-progress-differences",
      ).enabled,
    ).toBe(false);
  });
});
