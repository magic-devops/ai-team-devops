import { isValidElement, type ReactNode } from "react";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryProgress } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgress";
import { DeliveryProgressSnapshotBrowser } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgressBrowser";
import { DeliveryProgressCommands } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgressCommands";
import { DeliveryRequirementHistory } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementHistory";
import { RequirementImpactFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementChangeEditor";

const h = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  data: {} as Record<string, any>,
  status: 0,
  lastHash: "",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useCallback: (fn: any) => fn,
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
  useQuery: (options: any) => ({
    data: h.data[options.queryKey[0]],
    isPending: false,
    isError: Boolean(h.status),
    error: h.status ? new Error(`HTTP ${h.status}: current read denied`) : null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./deliveryQueryHooks", () => ({
  useDeliveryMemberReferences: () => ({ members: [] }),
}));
vi.mock("../components/DeliveryMemberIdentity", () => ({
  useMemberIdentity: () => (_items: unknown, id: string) => id,
  ProjectOwnerSelect: () => null,
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
const metrics = {
  tasks_total: 1,
  recorded_completed: 0,
  verified_completed: 0,
  awaiting_review: 0,
  remaining: 1,
  requirements_total: 1,
  requirements_accepted: 0,
  requirements_released: 0,
  status_counts: {
    pending: 1,
    in_progress: 0,
    blocked: 0,
    awaiting_review: 0,
    recorded_completed: 0,
    verified_completed: 0,
  },
};
const scope = { kind: "project", id: "", label: "Project P" };
const progress = {
  project_id: "P",
  version: 7,
  query_generation: 7,
  as_of: "2026-10-19T00:00:00Z",
  timezone: "UTC",
  scope,
  range: { starts_on: "2026-10-01", ends_on: "2026-10-19" },
  current: { scope, metrics },
  coverage: {
    observed_days: [],
    missing_days: [],
    future_days: [],
    last_observed_at: null,
  },
  days: [],
  baseline: null,
  ideal: [],
};
const requirement = {
  id: "R",
  basis: "basis",
  title: "Current requirement",
  description: "Current",
  acceptance_criteria: ["A"],
} as any;
beforeEach(() => {
  h.state = [];
  h.refs = [];
  h.next = 0;
  h.refNext = 0;
  h.status = 0;
  h.data = {};
  h.lastHash = "";
  vi.stubGlobal("location", {
    hash: "#/dev-flow?view=progress&project_id=P&return_to=%23%2Fprojects%2Fportfolio&starts_on=2026-10-01&ends_on=2026-10-19&observation_id=O",
    pathname: "/",
    search: "",
  });
  const write = (_state: unknown, _unused: string, href: string) => {
    h.lastHash = href.slice(href.indexOf("#"));
  };
  vi.stubGlobal("history", { pushState: write, replaceState: write });
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
function renderProgress() {
  h.next = 0;
  h.refNext = 0;
  return DeliveryProgress({
    projectId: "P",
    sessionId: "S",
    workspace: {
      project: { id: "P" },
      query_generation: 7,
      permissions: { write: true, approve: true },
    } as any,
    onWorkspace: vi.fn(),
    onOpenTask: vi.fn(),
  });
}
describe("bounded progress route and denied original cache", () => {
  it("shows real current metrics and passes available series to the command controls before a failed read", () => {
    h.data["delivery-progress"] = structuredClone(progress);
    const tree = renderProgress();
    expect(
      find(
        tree,
        "div",
        (props) => props.className === "delivery-progress-metrics",
      ),
    ).toBeDefined();
    expect(find(tree, DeliveryProgressCommands)).toMatchObject({
      unavailable: false,
      data: progress,
    });
    expect(find(tree, DeliveryProgressSnapshotBrowser)).toBeDefined();
  });
  it("keeps exact immutable history available independently of a current chart 503", () => {
    h.status = 503;
    const tree = renderProgress();
    expect(find(tree, DeliveryProgressSnapshotBrowser)).toMatchObject({
      sourceKind: "observation",
      sourceId: "O",
    });
    expect(find(tree, DeliveryProgressCommands)).toMatchObject({
      unavailable: true,
      data: undefined,
    });
  });
  it("preserves the explicit project and validated return path when applying a chart range", () => {
    h.data["delivery-progress"] = structuredClone(progress);
    find(
      renderProgress(),
      Button,
      (props) => props.children === "deliveryProgress.applyRange",
    ).onClick();
    const params = new URLSearchParams(h.lastHash.split("?")[1]);
    expect(params.get("project_id")).toBe("P");
    expect(params.get("return_to")).toBe("#/projects/portfolio");
    expect(params.get("observation_id")).toBeNull();
  });
  for (const status of [403, 404])
    it(`suppresses cached current metrics and prevents freezing after HTTP ${status}`, () => {
      h.data["delivery-progress"] = structuredClone(progress);
      h.status = status;
      const tree = renderProgress();
      expect(
        find(
          tree,
          "div",
          (props) => props.className === "delivery-progress-metrics",
        ),
      ).toBeUndefined();
      if (status === 403)
        expect(find(tree, DeliveryProgressSnapshotBrowser)).toBeUndefined();
      expect(find(tree, DeliveryProgressCommands)).toMatchObject({
        unavailable: true,
        data: undefined,
      });
    });
  for (const status of [403, 404])
    it(`clears cached exact requirement history and current-impact metadata after HTTP ${status}`, () => {
      location.hash =
        "#/dev-flow?view=list&project_id=P&requirement=R&requirement_version=V";
      h.status = status;
      h.data["delivery-requirement-history"] = {
        project_id: "P",
        requirement_id: "R",
        current_basis: "basis",
        current_links: {
          requirement_basis: "basis",
          task_ids: ["PRIVATE-TASK"],
          dependent_task_ids: [],
          execution_ids: [],
          release_candidate_ids: [],
          deployment_ids: [],
        },
        items: [],
        next_cursor: null,
      };
      h.data["delivery-requirement-version"] = {
        project_id: "P",
        requirement_id: "R",
        item: {
          id: "V",
          number: 1,
          at: "2026-10-18T00:00:00Z",
          actor: { name: "U" },
          source: "sql_observed",
          flow_revision: 1,
          definition: {
            id: "R",
            title: "PRIVATE HISTORY",
            description: "Private previous definition",
            acceptance_criteria: ["private criterion"],
          },
        },
      };
      const tree = DeliveryRequirementHistory({
        projectId: "P",
        sessionId: "S",
        requirement,
        onNavigate: vi.fn(),
      });
      expect(
        find(tree, "section", (props) => props["data-version-id"] === "V"),
      ).toBeUndefined();
      expect(find(tree, RequirementImpactFacts)).toBeUndefined();
    });
});
