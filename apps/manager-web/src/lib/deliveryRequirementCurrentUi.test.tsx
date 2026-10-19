import { DeliveryRequirementChangeHost } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementChangeHost";
import { DeliveryRequirementHistory } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementHistory";
import { DeliveryRequirementDefinition } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementReads";
import { isValidElement, type ReactNode } from "react";
import { Drawer } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench";
import { DeliveryQueryError } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryQueryViews";
const h = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  status: 0,
  cached: true,
  contextStatus: 0,
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
    t: (key: string) => key,
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
  projectSessionKey: () => "original-session",
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
const requirement = {
  id: "R",
  title: "PRIVATE CURRENT REQUIREMENT",
  basis: "basis",
  priority: "P1",
  tasks_total: 0,
  tasks_done: 0,
  flow: {
    owner_id: "U",
    stage: "implementation",
    revision: 1,
    milestone_id: "",
    due_on: null,
    blocked_reason: "",
    closed: false,
    gates: [],
    record_counts: { artifacts: 0, reviews: 0, releases: 0 },
  },
};
const context = {
  project_id: "P",
  project: { id: "P", name: "Project", status: "active" },
  permissions: { read: true, write: true, approve: true },
  query_state: { status: "ready" },
  version: 7,
  query_generation: 1,
};
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useQueryClient: () => ({
    getQueryData: () => context,
    invalidateQueries: vi.fn(),
  }),
  useQuery: (options: any) => ({
    data:
      options.queryKey[0] === "delivery-context"
        ? h.contextStatus
          ? undefined
          : context
        : options.queryKey[0] === "delivery-requirement-detail"
          ? h.cached
            ? { project_id: "P", version: 7, query_generation: 1, requirement }
            : undefined
          : { items: [] },
    isError:
      options.queryKey[0] === "delivery-context"
        ? !!h.contextStatus
        : options.queryKey[0] === "delivery-requirement-detail" &&
          Boolean(h.status),
    error:
      options.queryKey[0] === "delivery-context" && h.contextStatus
        ? new Error(`HTTP ${h.contextStatus}: index unavailable`)
        : options.queryKey[0] === "delivery-requirement-detail" && h.status
          ? new Error(`HTTP ${h.status}: Current requirement unavailable`)
          : null,
    isPending: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
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
    find(
      node.props.items?.map((item: any) => item.children),
      type,
      predicate,
    )
  );
}
function render() {
  h.next = 0;
  h.refNext = 0;
  const page = DeliveryWorkbench() as any;
  return page.props.children.type();
}
beforeEach(() => {
  h.state = [];
  h.refs = [];
  h.status = 0;
  h.cached = true;
  h.contextStatus = 0;
  vi.stubGlobal("location", {
    hash: "#/dev-flow?view=progress&project_id=P&requirement=R&detail=details",
    pathname: "/",
    search: "",
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
describe("actual current-requirement drawer after historical navigation", () => {
  it("keeps route recovery and exact history hosts mounted outside failed current index reads", () => {
    h.contextStatus = 503;
    h.status = 404;
    h.cached = false;
    location.hash =
      "#/dev-flow?view=list&project_id=P&requirement=R&detail=history&requirement_version=OLD&requirement_edit=1";
    const page = render();
    expect(find(page, DeliveryRequirementChangeHost)).toMatchObject({
      projectId: "P",
      requirementId: "R",
    });
    expect(find(page, DeliveryRequirementHistory)).toMatchObject({
      requirementId: "R",
    });
  });
  for (const status of [403, 404])
    for (const cached of [true, false])
      it(`clears the retained current body after HTTP ${status} with query cache ${cached}`, () => {
        const first = render();
        expect(
          find(
            first,
            Drawer,
            (props) => props.className === "delivery-inspector" && props.open,
          ).title,
        ).toBe(requirement.title);
        expect(find(first, DeliveryRequirementDefinition)).toBeDefined();
        h.status = status;
        h.cached = cached;
        const failed = render();
        expect(find(failed, DeliveryQueryError)).toBeDefined();
        expect(
          find(
            failed,
            Drawer,
            (props) => props.className === "delivery-inspector" && props.open,
          ).title,
        ).toBeUndefined();
        expect(find(failed, DeliveryRequirementDefinition)).toBeUndefined();
        expect(JSON.stringify(failed)).not.toContain(requirement.title);
      });
});
