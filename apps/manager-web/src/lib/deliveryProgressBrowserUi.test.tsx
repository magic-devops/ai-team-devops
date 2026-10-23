import { isValidElement, type ReactNode } from "react";
import { Button, Empty } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryProgressSnapshotBrowser,
  DeliveryProgressComparisonBrowser,
  DeliveryProgressBaselineCatalogue,
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
  pageStatus: 0,
  fetching: false,
  effects: [] as Array<() => unknown>,
  refetches: [] as string[],
  options: [] as any[],
  scope: "original",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: (make: () => unknown) => { h.effects.push(make); },
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
    const paged = ["delivery-progress-snapshot-page", "delivery-progress-differences", "delivery-progress-baselines"].includes(options.queryKey[0]);
    const status = h.status || (paged ? h.pageStatus : 0);
    return {
      data:
        paged
          ? h.pages[String(options.queryKey.at(-1))]
          : h.data[options.queryKey[0]],
      isError: Boolean(status),
      error: status ? new Error(`HTTP ${status}: read unavailable`) : null,
      isPending: false,
      isFetching: paged && h.fetching,
      refetch: vi.fn(() => { h.refetches.push(options.queryKey[0]); }),
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
const baseline = (id: string) => ({
  id, title: id, scope, basis, starts_on: null, ends_on: null,
  created_at: "2026-10-18T00:00:00Z", created_by: "U", source_version: 1,
  note: "", task_count: 1, requirement_count: 0, metrics: null, available: true, reasons: [],
});
const onOpen = vi.fn();
function commitEffects<T>(tree: T): T {
  h.effects.splice(0).forEach((make) => make()); return tree;
}
function render(sourceId = "O", sourceKind: "observation" | "baseline" = "observation") {
  h.next = 0;
  h.refNext = 0;
  h.options = [];
  h.effects = [];
  return commitEffects(DeliveryProgressSnapshotBrowser({
    projectId: "P",
    sessionId: "S",
    sourceKind,
    sourceId,
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
  }));
}
function renderCatalogue() {
  h.next = 0; h.refNext = 0; h.options = []; h.effects = [];
  return commitEffects(DeliveryProgressBaselineCatalogue({ projectId: "P", sessionId: "S",
    route: { scope: "project", scopeId: "" } as any, disabled: false, onSelect: vi.fn() }));
}
function renderComparison(generation = 8) {
  h.next = 0; h.refNext = 0; h.options = []; h.effects = [];
  return commitEffects(DeliveryProgressComparisonBrowser({ projectId: "P", sessionId: "S", baselineId: "B", generation,
    disabled: false, onOpenTask: onOpen }));
}
function readProblem(node: ReactNode): any {
  if (Array.isArray(node)) return node.map(readProblem).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (typeof node.type === "function" && node.type.name === "ReadProblem") return node.props;
  return readProblem(node.props.children);
}
const pagerButton = (tree: ReactNode, key: string) => find(ProgressPager(find(tree, ProgressPager)), Button,
  (props) => props.children === `deliveryProgress.bounded.${key}`);
beforeEach(() => {
  h.state = [];
  h.refs = [];
  h.scope = "original";
  h.status = 0;
  h.pageStatus = 0; h.fetching = false; h.effects = []; h.refetches = [];
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
  vi.stubGlobal("history", { replaceState: vi.fn((_state: unknown, _title: string, href: string) => { location.hash = href; }) });
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
afterEach(() => vi.unstubAllGlobals());
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
  it("keeps navigation after an unrelated storage event but still rejects a real identity change", () => {
    const tree = render();
    const listener = vi.mocked(window.addEventListener).mock.calls.find(([event]) => event === "storage")![1] as EventListener;
    listener(new Event("storage")); pagerButton(tree, "next").onClick();
    expect(find(render(), ProgressPager).cursor).toBe("page-two");
    const oldPage = find(render(), ProgressPager).onPage, before = location.hash;
    h.scope = "new-identity"; listener(new Event("storage")); oldPage("", 1);
    expect(location.hash).toBe(before); expect(find(render(), ProgressPager)).toBeUndefined();
  });
  it("returns through an exact successful predecessor and clears the selected detail on page change", () => {
    pagerButton(render(), "next").onClick();
    const second = render(); expect(find(second, ProgressPager).previous).toMatchObject({ cursor: "", page: 1 });
    find(second, Button, (props) => props.children === "deliveryProgress.bounded.openOriginalItem").onClick();
    expect(new URLSearchParams(location.hash.split("?")[1]).get("progress_item")).toBe("T-off-page");
    pagerButton(render(), "previous").onClick(); const first = render();
    expect(find(first, ProgressPager)).toMatchObject({ cursor: "", page: 1 });
    expect(new URLSearchParams(location.hash.split("?")[1]).has("progress_item")).toBe(false);
  });
  it("keeps recovery controls on a failed page and retries that page without secretly going to first", () => {
    pagerButton(render(), "next").onClick(); h.pageStatus = 500;
    const failed = render(), props = find(failed, ProgressPager);
    expect(props.count).toBeNull(); expect(props.previous?.cursor).toBe("");
    const unread = JSON.stringify(ProgressPager(props)); expect(unread).toContain("pageUnread"); expect(unread).not.toContain("pageCount");
    const before = location.hash; readProblem(failed).retry();
    expect(h.refetches).toContain("delivery-progress-snapshot-page"); expect(location.hash).toBe(before);
    pagerButton(failed, "first").onClick(); expect(new URLSearchParams(location.hash.split("?")[1]).has("progress_cursor")).toBe(false);
  });
  it("does not fabricate a previous page for a deep link or carry it into a new snapshot", () => {
    location.hash += "&progress_cursor=page-two&progress_page=Infinity";
    expect(find(render(), ProgressPager)).toMatchObject({ previous: null, page: 1 });
    pagerButton(render(), "first").onClick(); pagerButton(render(), "next").onClick();
    expect(find(render(), ProgressPager).previous?.cursor).toBe("");
    h.data["delivery-progress-source"].observation.snapshot_basis = "b".repeat(64);
    h.pages["page-two"].snapshot_basis = "b".repeat(64);
    expect(find(render(), ProgressPager).previous).toBeNull();
  });
  it("distinguishes an empty page from an empty scope and guards busy navigation callbacks", () => {
    h.pages[""].items = []; expect(find(render(), Empty).description).toBe("deliveryProgress.bounded.emptyPage");
    h.pages[""].total = 0; expect(find(render(), Empty).description).toBe("deliveryProgress.bounded.emptyScope");
    const onPage = vi.fn(), tree = ProgressPager({ total: 4, count: 2, cursor: "two", next: "three", page: 2,
      previous: { cursor: "", page: 1, next: "two" }, busy: true, onPage });
    for (const key of ["first", "previous", "next"]) {
      const button = find(tree, Button, (props) => props.children === `deliveryProgress.bounded.${key}`);
      expect(button.disabled).toBe(true); button.onClick();
    }
    expect(onPage).not.toHaveBeenCalled();
  });
  it("keeps first-page recovery in the baseline catalogue without exposing counts after a failed read", () => {
    location.hash = "#/dev-flow?view=progress&project_id=P&progress_baseline_cursor=bad"; h.pageStatus = 422;
    const tree = renderCatalogue();
    expect(find(tree, ProgressPager).total).toBeNull(); pagerButton(tree, "first").onClick();
    expect(new URLSearchParams(location.hash.split("?")[1]).has("progress_baseline_cursor")).toBe(false);
  });
  it("returns through catalogue links and replaces their history when the first read gets a new cutoff", () => {
    location.hash = "#/dev-flow?view=progress&project_id=P";
    const catalogue = { project_id: "P", as_of: "2026-10-18T00:00:00Z", scope, total: 2, limit: 1 };
    h.pages = {
      "": { ...catalogue, items: [baseline("B1")], next_cursor: "baseline-next" },
      "baseline-next": { ...catalogue, items: [baseline("B2")], next_cursor: null },
    };
    pagerButton(renderCatalogue(), "next").onClick();
    const second = renderCatalogue();
    expect(find(second, ProgressPager).previous).toMatchObject({ cursor: "", next: "baseline-next" });
    pagerButton(second, "previous").onClick();
    const cutoff = "2026-10-19T00:00:00Z";
    h.pages[""] = { ...catalogue, as_of: cutoff, items: [baseline("B3")], next_cursor: "fresh-next" };
    h.pages["fresh-next"] = { ...catalogue, as_of: cutoff, items: [baseline("B2")], next_cursor: null };
    const refreshed = renderCatalogue();
    const retained = h.state.find((value) => value && Array.isArray(value.pages));
    expect(retained).toMatchObject({ epoch: cutoff, pages: [{ cursor: "", next: "fresh-next" }] });
    expect(retained.pages).toHaveLength(1);
    pagerButton(refreshed, "next").onClick();
    expect(find(renderCatalogue(), ProgressPager).previous).toMatchObject({ cursor: "", next: "fresh-next" });
  });
  it("uses the immutable baseline basis for successful page links as well as observation snapshots", () => {
    location.hash = "#/dev-flow?view=progress&project_id=P&baseline_id=B";
    h.data["delivery-progress-source"] = { project_id: "P", baseline: { ...baseline("B"), task_count: 2 } };
    h.pages = {
      "": { ...page([item("T-1")], "baseline-next"), source_kind: "baseline", source_id: "B", total: 2, limit: 1 },
      "baseline-next": { ...page([item("T-2")]), source_kind: "baseline", source_id: "B", total: 2, limit: 1 },
    };
    pagerButton(render("B", "baseline"), "next").onClick();
    const second = render("B", "baseline");
    expect(count(second, "article")).toBe(1);
    expect(find(second, ProgressPager).previous).toMatchObject({ cursor: "", next: "baseline-next" });
  });
  for (const status of [403, 404]) it(`hides remembered pages and cached rows when only the page read is denied with ${status}`, () => {
    render(); h.pageStatus = status;
    const tree = render(); expect(count(tree, "article")).toBe(0); expect(find(tree, ProgressPager)).toBeUndefined();
  });
  it("uses the same predecessor and retry behavior for comparison pages, resetting after the comparison generation changes", () => {
    location.hash = "#/dev-flow?view=progress&project_id=P&baseline_id=B&progress_diff_kind=changed";
    h.data["delivery-progress-comparison"] = { project_id: "P", baseline_id: "B", baseline_basis: basis, query_generation: 8,
      scope, available: true, complete: true, current_scope_available: true, reasons: [],
      counts: { added: 0, removed: 0, changed: 2, incomplete: 0, unchanged: 0 } };
    const difference = { id: "T", title: "Task", before_title: "Before", after_title: "After", fields: ["title"] };
    const result = { project_id: "P", baseline_id: "B", baseline_basis: basis, query_generation: 8, kind: "changed",
      items: [difference], total: 2, next_cursor: "diff-next", limit: 20 };
    h.pages = { "": result, "diff-next": { ...result, next_cursor: null } };
    pagerButton(renderComparison(), "next").onClick();
    expect(find(renderComparison(), ProgressPager).previous?.cursor).toBe("");
    h.pageStatus = 500; const failed = renderComparison(), before = location.hash;
    expect(find(failed, ProgressPager).count).toBeNull(); readProblem(failed).retry();
    expect(h.refetches).toContain("delivery-progress-differences"); expect(location.hash).toBe(before);
    h.pageStatus = 0; h.data["delivery-progress-comparison"].query_generation = 9; h.pages["diff-next"].query_generation = 9;
    expect(find(renderComparison(9), ProgressPager).previous).toBeNull();
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
