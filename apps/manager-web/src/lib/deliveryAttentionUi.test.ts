import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryInbox } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryInbox";
import { DeliveryProgressSummary } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgress";
import { DeliveryProjectOverview } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProjectOverview";
import {
  useDeliveryInboxQuery,
  useDeliveryInboxNavigation,
} from "./deliveryAttention";
import { request } from "./http";
import { deliveryAttentionTranslations } from "../i18n/delivery-attention";
import { fetchTaskDetail } from "./deliveryQuery";
import { projectSessionKey } from "./projectPortfolio";

const state = vi.hoisted(() => ({
  options: [] as any[],
  result: {} as any,
  hooks: [] as any[],
  next: 0,
  session: "original",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<any>("react")),
  useState: (initial: any) => {
    const index = state.next++;
    if (!(index in state.hooks))
      state.hooks[index] = typeof initial === "function" ? initial() : initial;
    return [
      state.hooks[index],
      (value: any) => {
        state.hooks[index] =
          typeof value === "function" ? value(state.hooks[index]) : value;
      },
    ];
  },
  useRef: (initial: any) => {
    const index = state.next++;
    if (!(index in state.hooks)) state.hooks[index] = { current: initial };
    return state.hooks[index];
  },
  useEffect: () => {},
}));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./deliveryQuery", async () => ({
  ...(await vi.importActual<any>("./deliveryQuery")),
  fetchTaskDetail: vi.fn(),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<any>("./projectPortfolio")),
  projectSessionKey: vi.fn(() => state.session),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      `${key}${values?.page ? ` ${values.page}/${values.total}` : ""}`,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<any>("@tanstack/react-query")),
  useQuery: (options: any) => {
    state.options.push(options);
    return {
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
      ...state.result,
    };
  },
}));
vi.mock("./deliveryQueryHooks", () => ({
  useDeliveryMemberReferences: () => ({ members: [] }),
}));
vi.mock("../components/DeliveryMemberIdentity", () => ({
  useMemberIdentity: () => (_members: unknown[], id: string) => id,
}));

const workspace: any = {
  project_id: "P",
  project: { id: "P" },
  query_generation: 7,
  permissions: {},
  query_state: { status: "ready" },
};
function inboxData() {
  return {
    project_id: "P",
    query_generation: 7,
    scope: "team",
    category: "acceptance",
    as_of: "2026-10-18T00:00:00Z",
    total: 51,
    limit: 20,
    has_more: true,
    next_cursor: "next/+",
    counts: {
      total: 80,
      work: 20,
      approval: 1,
      acceptance: 51,
      blocked: 8,
      overdue: 3,
    },
    items: [
      {
        id: "manual",
        kind: "task",
        resource_id: "T-manual",
        title: "Manual acceptance",
        owner_id: "user:one",
        status: "recorded_completed",
        acceptance_kind: "manual",
        categories: ["acceptance"],
        blocked_reason_count: 9,
        blocked_reasons: ["First blocker"],
        overdue: false,
        due_on: null,
        target: {
          view: "list",
          requirement_id: "R",
          detail: "tasks",
          task_id: "T-manual",
        },
      },
      {
        id: "native",
        kind: "task",
        resource_id: "T-native",
        title: "Execution acceptance",
        owner_id: "user:one",
        status: "awaiting_review",
        acceptance_kind: "execution",
        categories: ["acceptance"],
        blocked_reason_count: 0,
        blocked_reasons: [],
        overdue: false,
        due_on: null,
        target: {
          view: "list",
          requirement_id: "R",
          detail: "tasks",
          task_id: "T-native",
        },
      },
    ],
  };
}
const props = () =>
  ({
    data: inboxData(),
    workspace,
    scope: "team",
    category: "acceptance",
    page: 3,
    cursor: "older",
    loading: false,
    refreshing: false,
    onScope: vi.fn(),
    onCategory: vi.fn(),
    onRefresh: vi.fn(),
    onFirstPage: vi.fn(),
    onNextPage: vi.fn(),
    onOpen: vi.fn(),
  }) as any;
function controls(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(controls);
  if (!isValidElement<any>(node)) return [];
  return [
    ...(node.type === Button || node.type === "button" ? [node] : []),
    ...controls(node.props.children),
  ];
}
beforeEach(() => {
  state.options = [];
  state.result = {};
  state.hooks = [];
  state.next = 0;
  state.session = "original";
  vi.mocked(request).mockReset();
  vi.mocked(fetchTaskDetail).mockReset();
  vi.stubGlobal("location", { hash: "#/dev-flow?view=inbox" });
});

describe("delivery attention interactions", () => {
  it("renders the server window, matching total and distinct acceptance actions, then dispatches exact pagination targets", () => {
    const input = props();
    // Server filtering is authoritative, even if the item has no duplicated client category projection.
    input.data.items[0].categories = [];
    const html = renderToStaticMarkup(createElement(DeliveryInbox, input));
    expect(html).toContain("Manual acceptance");
    expect(html).toContain("Execution acceptance");
    expect(html).toContain("deliveryAttention.manualAcceptance");
    expect(html).toContain("deliveryAttention.executionAcceptance");
    expect(html).toContain("deliveryAttention.pageCount 3/51");
    expect(html).toContain("deliveryAttention.moreBlockers");
    const buttons = controls(DeliveryInbox(input));
    buttons
      .find((node) => node.props.children === "deliveryAttention.nextPage")
      .props.onClick();
    expect(input.onNextPage).toHaveBeenCalledWith("next/+");
    buttons
      .find((node) => node.props.children === "deliveryAttention.firstPage")
      .props.onClick();
    expect(input.onFirstPage).toHaveBeenCalledOnce();
    buttons
      .find(
        (node) =>
          node.props.children === "deliveryAttention.openManualAcceptance",
      )
      .props.onClick();
    expect(input.onOpen).toHaveBeenCalledWith({
      view: "list",
      requirement_id: "R",
      detail: "tasks",
      task_id: "T-manual",
    });
  });
  it("hides failed or stale rows and offers an explicit first-page recovery", () => {
    const input = {
      ...props(),
      error: 'HTTP 409: {"code":"delivery_query_cursor_stale"}',
    };
    const html = renderToStaticMarkup(createElement(DeliveryInbox, input));
    expect(html).toContain("deliveryAttention.changed");
    expect(html).not.toContain("Manual acceptance");
    const node: any = DeliveryInbox(input);
    const alert = (node.props.children as any[]).find(
      (child: any) => child?.props?.title === "deliveryAttention.changed",
    );
    alert.props.action.props.onClick();
    expect(input.onFirstPage).toHaveBeenCalledOnce();
  });
  it("labels external acceptance separately and dispatches the exact report and work-order target unchanged", () => {
    const input = props();
    const target = { view: "list", requirement_id: "R", detail: "tasks", task_id: "T-external", submission_id: "S-external", work_order_id: "W-external" };
    input.data.items = [{ ...input.data.items[1], id: "external", resource_id: "T-external", title: "External report ready for human review", task_id: "T-external", acceptance_kind: "external", target }];
    const html = renderToStaticMarkup(createElement(DeliveryInbox, input));
    expect(html).toContain("deliveryAttention.externalAcceptance"); expect(html).not.toContain("deliveryAttention.executionAcceptance");
    const action = controls(DeliveryInbox(input)).find((node) => node.props.children === "deliveryAttention.openExternalAcceptance");
    expect(action).toBeDefined(); action.props.onClick(); expect(input.onOpen).toHaveBeenCalledWith(target);
  });
  it("translates the external blocker projection and keeps the existing exact W action without implying acceptance", () => {
    const input = props(); input.category = "blocked";
    const target = { view: "list", requirement_id: "R", detail: "tasks", task_id: "T-external", submission_id: null, work_order_id: "W-external" };
    input.data.items = [{ ...input.data.items[1], id: "external", resource_id: "T-external", title: "Claimant reported a blocker", task_id: "T-external", status: "blocked", acceptance_kind: null, categories: ["blocked"], blocked_reason_count: 1, blocked_reasons: ["External work reported a blocker"], target }];
    const html = renderToStaticMarkup(createElement(DeliveryInbox, input));
    expect(html).toContain("deliveryProject.blocker.externalWorkOrder"); expect(html).not.toContain("External work reported a blocker"); expect(html).not.toContain("deliveryAttention.externalAcceptance");
    controls(DeliveryInbox(input)).find((node) => node.props.children === "deliveryProject.open").props.onClick(); expect(input.onOpen).toHaveBeenCalledWith(target);
  });
  it("keeps requirement items usable when no task navigation is pending", () => {
    const input = props();
    input.navigationBusy = "";
    input.data.items = [
      {
        ...input.data.items[0],
        kind: "requirement",
        resource_id: "R",
        task_id: "",
        acceptance_kind: null,
        target: { view: "list", requirement_id: "R", detail: "details" },
      },
    ];
    const button = controls(DeliveryInbox(input)).find(
      (node) => node.props.children === "deliveryProject.open",
    );
    expect(button.props.loading).toBe(false);
    expect(button.props.disabled).toBe(false);
    button.props.onClick();
    expect(input.onOpen).toHaveBeenCalledWith({
      view: "list",
      requirement_id: "R",
      detail: "details",
    });
  });
  it("makes all four overview counts keyboard filter buttons", () => {
    state.result = { data: { items: [], total: 0 } };
    const onInboxCategory = vi.fn();
    const buttons = controls(
      DeliveryProjectOverview({
        data: workspace,
        inbox: inboxData() as any,
        onView: vi.fn(),
        onMilestone: vi.fn(),
        onInboxCategory,
      }),
    );
    const acceptance = buttons.find(
      (node) =>
        node.props["aria-label"] === "deliveryProject.category.acceptance",
    );
    expect(acceptance).toBeDefined();
    acceptance.props.onClick();
    expect(onInboxCategory).toHaveBeenCalledWith("acceptance");
  });
  it("binds inbox fetches to context, UTC day, session, view and window without a second polling timer", async () => {
    const render = (patch = {}) => {
      const captured = useDeliveryInboxQuery({
        projectId: "P",
        sessionId: "S",
        queryGeneration: 7,
        view: "overview",
        scope: "mine",
        category: "all",
        cursor: "",
        utcDay: "2026-10-18",
        enabled: true,
        ...patch,
      });
      return captured;
    };
    // The mocked hook captures the actual production options; QueryObserver executes their queryFn.
    render();
    let options = state.options.at(-1);
    const { QueryClient, QueryObserver } = await vi.importActual<any>(
      "@tanstack/react-query",
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    vi.mocked(request).mockResolvedValue({
      ...inboxData(),
      scope: "mine",
      category: "all",
      limit: 1,
    });
    await observer.refetch();
    const url = new URL(
      vi.mocked(request).mock.calls.at(-1)![0],
      "http://local",
    );
    expect(url.searchParams.get("limit")).toBe("1");
    expect(options.refetchInterval).toBeUndefined();
    const oldKey = options.queryKey;
    for (const patch of [
      { queryGeneration: 8 },
      { sessionId: "S2" },
      { utcDay: "2026-10-19" },
      { view: "inbox", cursor: "next/+" },
    ]) {
      render(patch);
      options = state.options.at(-1);
      expect(options.queryKey).not.toEqual(oldKey);
    }
    state.result = { data: inboxData(), error: new Error("Connection lost") };
    expect(
      render({ view: "inbox", category: "acceptance", scope: "team" }).data,
    ).toBeUndefined();
    unsubscribe();
    client.clear();
  });
  it("cancels an abandoned page and never transfers its late rows to a new session or category", async () => {
    let finish: ((value: unknown) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    vi.mocked(request).mockImplementation((_href, options) => {
      firstSignal ??= options?.signal as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const input = {
      projectId: "P",
      sessionId: "S",
      queryGeneration: 7,
      view: "inbox",
      scope: "team" as const,
      category: "acceptance" as const,
      cursor: "old",
      utcDay: "2026-10-18",
      enabled: true,
    };
    useDeliveryInboxQuery(input);
    const { QueryClient, QueryObserver } = await vi.importActual<any>(
      "@tanstack/react-query",
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const observer = new QueryObserver(client, state.options.at(-1));
    const received: any[] = [];
    const unsubscribe = observer.subscribe((result: any) =>
      received.push(result.data),
    );
    const oldKey = state.options.at(-1).queryKey;
    useDeliveryInboxQuery({
      ...input,
      sessionId: "S2",
      category: "blocked",
      cursor: "",
    });
    const next = state.options.at(-1);
    const oldFinish = finish!;
    observer.setOptions({ ...next, enabled: false });
    expect(firstSignal?.aborted).toBe(true);
    oldFinish(inboxData());
    await Promise.resolve();
    await Promise.resolve();
    expect(client.getQueryData(next.queryKey)).toBeUndefined();
    expect(received.filter(Boolean)).toEqual([]);
    expect(next.queryKey).not.toEqual(oldKey);
    unsubscribe();
    client.clear();
  });
  it("keeps manual, native and external acceptance and pagination recovery translated in all three languages", () => {
    for (const translation of Object.values(deliveryAttentionTranslations)) {
      expect(translation.manualAcceptance).not.toBe(
        translation.executionAcceptance,
      );
      expect(translation.openManualAcceptance).not.toBe(
        translation.openExecutionAcceptance,
      );
      expect(translation.externalAcceptance).toBeTruthy(); expect(translation.externalAcceptance).not.toBe(translation.executionAcceptance);
      expect(translation.openExternalAcceptance).toBeTruthy(); expect(translation.openExternalAcceptance).not.toBe(translation.openExecutionAcceptance);
      expect(translation.pageCount).toContain("{{page}}");
      expect(translation.pageCount).toContain("{{total}}");
      expect(translation.changed).toBeTruthy();
    }
  });
  it("opens a task's current requirement after transfer and leaves deleted tasks in the inbox with a retryable error", async () => {
    const onOpen = vi.fn();
    const input = {
      projectId: "P",
      sessionId: "S",
      view: "inbox",
      scope: "team",
      category: "acceptance",
      cursor: "",
      canNavigate: () => true,
      onOpen,
    };
    const render = () => {
      state.next = 0;
      return useDeliveryInboxNavigation(input);
    };
    const original = {
      view: "list",
      requirement_id: "old-R",
      detail: "tasks",
      task_id: "T-manual",
    };
    vi.mocked(fetchTaskDetail).mockResolvedValue({
      project_id: "P",
      task: { id: "T-manual", req_id: "current-R" },
    } as any);
    await render().open(original);
    expect(onOpen).toHaveBeenCalledWith({
      ...original,
      requirement_id: "current-R",
    });
    onOpen.mockClear();
    vi.mocked(fetchTaskDetail).mockRejectedValue(
      new Error("HTTP 404: task missing"),
    );
    await render().open(original);
    expect(onOpen).not.toHaveBeenCalled();
    expect(render().error).toContain("HTTP 404");
    vi.mocked(fetchTaskDetail).mockResolvedValue({
      project_id: "P",
      task: { id: "T-manual", req_id: "" },
    } as any);
    await render().retry();
    expect(onOpen).toHaveBeenCalledWith({ ...original, requirement_id: "" });
  });
  it("keeps exact external S and W selections when the actual inbox locator refreshes the task's requirement", async () => {
    const onOpen = vi.fn();
    const input = { projectId: "P", sessionId: "S", view: "inbox", scope: "team", category: "acceptance", cursor: "", canNavigate: () => true, onOpen };
    state.next = 0;
    const navigation = useDeliveryInboxNavigation(input);
    const target = { view: "list", requirement_id: "old-R", detail: "tasks", task_id: "T-external", submission_id: "S-external", work_order_id: "W-external" };
    vi.mocked(fetchTaskDetail).mockResolvedValue({ project_id: "P", task: { id: "T-external", req_id: "current-R" } } as any);
    await navigation.open(target);
    expect(onOpen).toHaveBeenCalledWith({ ...target, requirement_id: "current-R" });
  });
  it("rejects late task navigation after session, view, category or page changes and respects the exit guard", async () => {
    const onOpen = vi.fn();
    let canNavigate = true;
    const input = {
      projectId: "P",
      sessionId: "S",
      view: "inbox",
      scope: "team",
      category: "acceptance",
      cursor: "",
      canNavigate: () => canNavigate,
      onOpen,
    };
    const render = (patch = {}) => {
      state.next = 0;
      return useDeliveryInboxNavigation({ ...input, ...patch });
    };
    const target = {
      view: "list",
      requirement_id: "old-R",
      detail: "tasks",
      task_id: "T",
      submission_id: "S-external",
      work_order_id: "W-external",
    };
    for (const patch of [
      { view: "overview" },
      { category: "blocked" },
      { cursor: "next" },
      { sessionId: "other-session" },
      { projectId: "other-project" },
    ]) {
      let finish: ((value: any) => void) | undefined;
      vi.mocked(fetchTaskDetail).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = render().open(target);
      render(patch);
      finish!({ project_id: "P", task: { id: "T", req_id: "current-R" } });
      await pending;
      expect(onOpen).not.toHaveBeenCalled();
    }
    let finish: ((value: any) => void) | undefined;
    vi.mocked(fetchTaskDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = render().open(target);
    state.session = "renewed-account";
    expect(projectSessionKey()).toBe("renewed-account");
    finish!({ project_id: "P", task: { id: "T", req_id: "current-R" } });
    await pending;
    expect(onOpen).not.toHaveBeenCalled();
    canNavigate = false;
    await render().open(target);
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("clears abandoned opening state after leaving and returning without another task click", async () => {
    const onOpen = vi.fn();
    const input = {
      projectId: "P",
      sessionId: "S",
      view: "inbox",
      scope: "team",
      category: "acceptance",
      cursor: "",
      canNavigate: () => true,
      onOpen,
    };
    const render = (patch = {}) => {
      state.next = 0;
      return useDeliveryInboxNavigation({ ...input, ...patch });
    };
    let finish: ((value: any) => void) | undefined;
    vi.mocked(fetchTaskDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = render().open({
      view: "list",
      requirement_id: "R",
      detail: "tasks",
      task_id: "T",
    });
    expect(render().busy).toBe("T");
    render({ category: "blocked" });
    expect(render().busy).toBe("");
    finish!({ project_id: "P", task: { id: "T", req_id: "R" } });
    await pending;
    expect(onOpen).not.toHaveBeenCalled();
    expect(render().busy).toBe("");
  });
  it("does not restore an earlier page's task error or retry after leaving and returning", async () => {
    const input = {
      projectId: "P",
      sessionId: "S",
      view: "inbox",
      scope: "team",
      category: "acceptance",
      cursor: "",
      canNavigate: () => true,
      onOpen: vi.fn(),
    };
    const render = (patch = {}) => {
      state.next = 0;
      return useDeliveryInboxNavigation({ ...input, ...patch });
    };
    vi.mocked(fetchTaskDetail).mockRejectedValue(
      new Error("HTTP 404: task missing"),
    );
    await render().open({
      view: "list",
      requirement_id: "R",
      detail: "tasks",
      task_id: "T",
    });
    const oldRetry = render().retry;
    expect(render().error).toContain("HTTP 404");
    const reads = vi.mocked(fetchTaskDetail).mock.calls.length;
    render({ category: "blocked" });
    expect(render().error).toBeUndefined();
    await render().retry();
    await oldRetry();
    expect(vi.mocked(fetchTaskDetail).mock.calls.length).toBe(reads);
  });
  it("does not let an abandoned request clear a newer task opening indicator", async () => {
    const onOpen = vi.fn();
    const input = {
      projectId: "P",
      sessionId: "S",
      view: "inbox",
      scope: "team",
      category: "acceptance",
      cursor: "",
      canNavigate: () => true,
      onOpen,
    };
    const render = (patch = {}) => {
      state.next = 0;
      return useDeliveryInboxNavigation({ ...input, ...patch });
    };
    const finishes: ((value: any) => void)[] = [];
    vi.mocked(fetchTaskDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const target = {
      view: "list",
      requirement_id: "R",
      detail: "tasks",
      task_id: "T",
    };
    const old = render().open(target);
    render({ category: "blocked" });
    const replacement = render().open({ ...target, task_id: "T-new" });
    finishes[0]({ project_id: "P", task: { id: "T", req_id: "R" } });
    await old;
    expect(render().busy).toBe("T-new");
    finishes[1]({ project_id: "P", task: { id: "T-new", req_id: "R" } });
    await replacement;
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it("reads only the summary at the active generation and never displays stale totals after errors or context changes", async () => {
    const summary = {
      project_id: "P",
      query_generation: 7,
      current: { metrics: { verified_completed: 3, tasks_total: 12345 } },
      coverage: { observed_days: [], missing_days: [], last_observed_at: null },
    };
    state.result = { data: summary };
    const input = {
      projectId: "P",
      sessionId: "S",
      queryGeneration: 7,
      onOpen: vi.fn(),
    };
    expect(
      renderToStaticMarkup(createElement(DeliveryProgressSummary, input)),
    ).toContain("12345");
    const options = state.options.at(-1);
    vi.mocked(request).mockResolvedValue(summary);
    await options.queryFn({ signal: new AbortController().signal });
    expect(vi.mocked(request).mock.calls.at(-1)![0]).toContain(
      "/progress/summary?",
    );
    expect(options.refetchInterval).toBeUndefined();
    for (const patch of [{ queryGeneration: 8 }, { projectId: "other" }])
      expect(
        renderToStaticMarkup(
          createElement(DeliveryProgressSummary, { ...input, ...patch }),
        ),
      ).not.toContain("12345");
    state.result.error = new Error("Connection lost");
    expect(
      renderToStaticMarkup(createElement(DeliveryProgressSummary, input)),
    ).not.toContain("12345");
  });
});
