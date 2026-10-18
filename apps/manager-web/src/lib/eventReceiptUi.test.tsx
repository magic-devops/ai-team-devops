import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Collapse } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventReceiptWorkbench } from "../../subapps/ai-foundation/src/pages/intelligence/events/EventReceiptWorkbench";
import { EventReceiptDetail } from "../../subapps/ai-foundation/src/pages/intelligence/events/EventReceiptDetail";
import { EventProcessingTags } from "../../subapps/ai-foundation/src/pages/intelligence/events/EventReceiptCommon";
import {
  useEventRetryState,
  useEventTargetNavigation,
} from "./eventReceiptState";
import { parseEventRoute } from "./eventReceipts";
import { eventDetailFixture, eventPageFixture } from "./eventReceiptFixtures";
import { request } from "./http";
import { fetchTaskDetail } from "./deliveryQuery";
const state = vi.hoisted(() => ({
  hooks: [] as any[],
  next: 0,
  session: "S",
  options: [] as any[],
  effects: [] as Array<() => void | (() => void)>,
  results: {} as Record<string, any>,
  pending: vi.fn(),
  invalidate: vi.fn(),
  setData: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<any>("react")),
  useState: (initial: any) => {
    const i = state.next++;
    if (!(i in state.hooks))
      state.hooks[i] = typeof initial === "function" ? initial() : initial;
    return [
      state.hooks[i],
      (value: any) =>
        (state.hooks[i] =
          typeof value === "function" ? value(state.hooks[i]) : value),
    ];
  },
  useRef: (initial: any) => {
    const i = state.next++;
    if (!(i in state.hooks)) state.hooks[i] = { current: initial };
    return state.hooks[i];
  },
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
  useCallback: (fn: any) => fn,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      key + (values?.total ? " " + values.page + "/" + values.total : ""),
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
      ...state.results[options.queryKey[0]],
    };
  },
  useQueryClient: () => ({
    invalidateQueries: state.invalidate,
    setQueryData: state.setData,
  }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<any>("./projectPortfolio")),
  projectSessionKey: () => state.session,
}));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./deliveryQuery", async () => ({
  ...(await vi.importActual<any>("./deliveryQuery")),
  fetchTaskDetail: vi.fn(),
}));
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) || null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  };
}
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [
    node,
    ...nodes(node.props.children),
    ...nodes(node.props.action),
    ...nodes(node.props.description),
  ];
}
function renderRetry(identity = "A", detail = eventDetailFixture()) {
  state.next = 0;
  return useEventRetryState("P", "R", detail.event, identity, state.pending);
}
function ack(detail = eventDetailFixture()) {
  return {
    project_id: "P",
    receipt_id: "R",
    event_id: detail.event.event_id,
    digest: detail.event.digest,
    processing: { ...detail.event.processing, revision: 4, state: "processed" },
    attempt_id: "A2",
    replayed: false,
  };
}
beforeEach(() => {
  state.hooks = [];
  state.next = 0;
  state.session = "S";
  state.options = [];
  state.effects = [];
  state.results = {};
  state.pending.mockReset();
  state.invalidate.mockReset();
  state.setData.mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(fetchTaskDetail).mockReset();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  localStorage.setItem(
    "sop-user",
    JSON.stringify({ id: "actual-user", tenant_id: "tenant" }),
  );
  localStorage.setItem("sop-session-revision", "revision");
  vi.stubGlobal("location", { hash: "#/intelligence/events?project_id=P" });
  vi.stubGlobal("history", {
    pushState: (_a: any, _b: any, href: string) => {
      location.hash = href;
    },
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
describe("event recovery and component state", () => {
  it("invalidates a target read on route ABA before React renders either route", async () => {
    const listeners: Array<() => void> = [];
    vi.mocked(window.addEventListener).mockImplementation(
      (type: any, listener: any) => {
        if (type === "hashchange") listeners.push(listener);
      },
    );
    let resolve!: (value: any) => void;
    vi.mocked(fetchTaskDetail).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    const navigate = vi.fn();
    state.next = 0;
    const navigation = useEventTargetNavigation("P", "A", () => true, navigate);
    for (const setup of state.effects) setup();
    const waiting = navigation.open(
      { kind: "task_updated", target_kind: "task", target_id: "T" },
      location.hash,
    );
    location.hash = "#/intelligence/events?project_id=P&event_state=failed";
    for (const listener of listeners) listener();
    location.hash = "#/intelligence/events?project_id=P";
    for (const listener of listeners) listener();
    resolve({ project_id: "P", task: { id: "T", req_id: "current-R" } });
    await waiting;
    expect(navigate).not.toHaveBeenCalled();
  });
  it("discards an explicit latest read on route ABA before React renders", async () => {
    const listeners: Array<() => void> = [];
    vi.mocked(window.addEventListener).mockImplementation(
      (type: any, listener: any) => {
        if (type === "hashchange") listeners.push(listener);
      },
    );
    let resolve!: (value: any) => void;
    vi.mocked(request).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    const recovery = renderRetry();
    for (const setup of state.effects) setup();
    const waiting = recovery.loadLatest();
    location.hash = "#/intelligence/events?project_id=P&event_state=failed";
    for (const listener of listeners) listener();
    location.hash = "#/intelligence/events?project_id=P";
    for (const listener of listeners) listener();
    resolve(eventDetailFixture());
    await waiting;
    expect(renderRetry().latest).toBeNull();
    expect(renderRetry().reading).toBe(false);
  });

  it("accepts first actions after an effect setup-cleanup-setup replay", async () => {
    const replay = () => {
      const effects = [...state.effects];
      for (const effect of effects) {
        const cleanup = effect();
        if (typeof cleanup === "function") cleanup();
        effect();
      }
      state.effects = [];
    };
    const navigate = vi.fn(),
      effect: any = {
        kind: "task_updated",
        target_kind: "task",
        target_id: "T",
      };
    vi.mocked(fetchTaskDetail).mockResolvedValue({
      project_id: "P",
      task: { id: "T", req_id: "current-R" },
    } as any);
    state.next = 0;
    const navigation = useEventTargetNavigation("P", "A", () => true, navigate);
    replay();
    await navigation.open(effect, location.hash);
    expect(navigate).toHaveBeenCalledOnce();
    state.hooks = [];
    state.effects = [];
    state.next = 0;
    const recovery = renderRetry();
    replay();
    recovery.patch("first action");
    vi.mocked(request).mockResolvedValue(ack());
    await recovery.run(false, true);
    expect(request).toHaveBeenCalledOnce();
    expect(
      JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string).reason,
    ).toBe("first action");
  });

  it("keeps stored separate from pending, fact recording and business processing", () => {
    const detail = eventDetailFixture();
    detail.event.processing.state = "pending";
    detail.event.processing.reason_code = "handler_not_configured";
    const html = renderToStaticMarkup(
      createElement(EventProcessingTags, {
        processing: detail.event.processing,
      }),
    );
    expect(html).toContain("eventReceipts.stored");
    expect(html).toContain("eventReceipts.storedOnly");
    expect(html).not.toContain("eventReceipts.processed");
  });
  it("uses the server matching total and exact next-page cursor", () => {
    state.results["event-page"] = { data: eventPageFixture() };
    state.next = 0;
    const tree = EventReceiptWorkbench({ projectId: "P" });
    const pager = nodes(tree).find((node) => node.props.total === 43)!;
    expect(pager.props.more).toBe(true);
    pager.props.onNext();
    expect(parseEventRoute(location.hash)).toMatchObject({
      cursor: "event/+next",
      page: 2,
    });
    expect(state.options[0].queryKey).toContain("P");
    expect(state.options[0].queryKey).toContain("S");
  });
  it("hides cached list and raw detail content when the server denies access", () => {
    state.results["event-page"] = {
      data: eventPageFixture(),
      error: new Error("HTTP 403: forbidden"),
    };
    let html = renderToStaticMarkup(
      createElement(EventReceiptWorkbench, { projectId: "P" }),
    );
    expect(html).not.toContain("untrusted sender description");
    state.hooks = [];
    state.next = 0;
    state.results["event-receipt"] = {
      data: eventDetailFixture(),
      error: new Error("HTTP 403: forbidden"),
    };
    html = renderToStaticMarkup(
      createElement(EventReceiptDetail, {
        projectId: "P",
        receiptId: "R",
        identity: "A",
        route: parseEventRoute(location.hash),
        background: location.hash,
        onRoute: vi.fn(),
        onPending: vi.fn(),
        canNavigate: () => true,
        onNavigate: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    expect(html).not.toContain("cached secret");
    expect(html).not.toContain("actual-user");
    expect(html).toContain("eventReceipts.forbidden");
  });
  it("freezes unknown retries, persists the original key across remount and keeps the close lock", async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error("connection lost"));
    let hook = renderRetry();
    hook.patch("human reason");
    hook = renderRetry();
    await hook.run(false, true);
    hook = renderRetry();
    expect(hook.unknown).toBe(true);
    expect(state.pending).toHaveBeenLastCalledWith(true);
    const original = vi.mocked(request).mock.calls[0][1]!.body;
    state.hooks = [];
    hook = renderRetry();
    expect(hook.unknown).toBe(true);
    hook.patch("replacement reason");
    expect(renderRetry().draft.reason).toBe("human reason");
    vi.mocked(request).mockResolvedValue(ack());
    await hook.run(true, true);
    expect(vi.mocked(request).mock.calls[1][1]!.body).toBe(original);
    expect(renderRetry().unknown).toBe(false);
    expect(state.pending).toHaveBeenLastCalledWith(false);
  });
  it("preserves reason on 409 and requires explicit latest read and adoption", async () => {
    vi.mocked(request).mockRejectedValueOnce(
      new Error(
        'HTTP 409: {"detail":{"code":"event_revision_conflict","message":"changed"}}',
      ),
    );
    let hook = renderRetry();
    hook.patch("keep reason");
    hook = renderRetry();
    await hook.run(false, true);
    hook = renderRetry();
    expect(hook.draft.conflict).toBe(true);
    await hook.run(false, true);
    expect(request).toHaveBeenCalledTimes(1);
    const latest = eventDetailFixture();
    latest.event.processing.revision = 5;
    vi.mocked(request).mockResolvedValueOnce(latest);
    await hook.loadLatest();
    hook = renderRetry();
    expect(hook.draft.basis?.revision).toBe(3);
    expect(hook.latest?.event.processing.revision).toBe(5);
    hook.adopt();
    hook = renderRetry();
    expect(hook.draft.reason).toBe("keep reason");
    expect(hook.draft.basis?.revision).toBe(5);
    vi.mocked(request).mockResolvedValue(ack());
    await hook.run(false, true);
    expect(
      JSON.parse(vi.mocked(request).mock.calls.at(-1)![1]!.body as string),
    ).toMatchObject({ expected_revision: 5, reason: "keep reason" });
  });
  it.each([
    [409, "event_revision_conflict"],
    [403, "event_retry_denied"],
  ])(
    "resolves an unknown original key only after the confirmed %s %s refusal",
    async (status, code) => {
      vi.mocked(request).mockRejectedValueOnce(new Error("connection lost"));
      let hook = renderRetry();
      hook.patch("keep the reviewed reason");
      hook = renderRetry();
      await hook.run(false, true);
      const original = vi.mocked(request).mock.calls[0][1]!.body;
      hook = renderRetry();
      vi.mocked(request).mockRejectedValueOnce(
        new Error(`HTTP ${status}: ${JSON.stringify({ detail: { code } })}`),
      );
      await hook.run(true, true);
      expect(vi.mocked(request).mock.calls[1][1]!.body).toBe(original);
      hook = renderRetry();
      expect(hook.unknown).toBe(false);
      expect(hook.draft).toMatchObject({
        reason: "keep the reviewed reason",
        conflict: true,
        basis: { revision: 3 },
      });
      expect(hook.draft.pending).toBeUndefined();
      expect(state.pending).toHaveBeenLastCalledWith(false);
      state.hooks = [];
      hook = renderRetry();
      expect(hook.unknown).toBe(false);
      expect(hook.draft.conflict).toBe(true);
      await hook.run(false, true);
      expect(request).toHaveBeenCalledTimes(2);
      const latest = eventDetailFixture();
      latest.event.processing.revision = 5;
      vi.mocked(request).mockResolvedValueOnce(latest);
      await hook.loadLatest();
      hook = renderRetry();
      expect(hook.draft.basis?.revision).toBe(3);
      expect(hook.adopt()).toEqual(latest);
      hook = renderRetry();
      expect(hook.draft.reason).toBe("keep the reviewed reason");
      expect(hook.draft.basis?.revision).toBe(5);
    },
  );
  it.each([
    'HTTP 403: {"detail":{"code":"event_configure_required"}}',
    "HTTP 403: forbidden",
    'HTTP 404: {"detail":{"code":"event_not_found"}}',
    'HTTP 409: {"detail":{"code":"event_idempotency_conflict"}}',
    'HTTP 500: {"detail":{"code":"event_retry_denied"}}',
    'HTTP 403: {"detail":{"code":"event_revision_conflict"}}',
    'HTTP 409: {"detail":{"code":"event_retry_denied"}}',
    "connection lost again",
  ])("keeps the original key unknown after %s", async (failure) => {
    vi.mocked(request).mockRejectedValueOnce(new Error("connection lost"));
    let hook = renderRetry();
    hook.patch("original reviewed reason");
    hook = renderRetry();
    await hook.run(false, true);
    const original = vi.mocked(request).mock.calls[0][1]!.body;
    hook = renderRetry();
    vi.mocked(request).mockRejectedValueOnce(new Error(failure));
    await hook.run(true, true);
    expect(vi.mocked(request).mock.calls[1][1]!.body).toBe(original);
    hook = renderRetry();
    expect(hook.unknown).toBe(true);
    expect(hook.draft.pending).toBeDefined();
    hook.patch("must stay frozen");
    expect(renderRetry().draft.reason).toBe("original reviewed reason");
    expect(state.pending).toHaveBeenLastCalledWith(true);
  });
  it("does not resolve an unknown original key from a latest processed GET", async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error("connection lost"));
    let hook = renderRetry();
    hook.patch("original reviewed reason");
    hook = renderRetry();
    await hook.run(false, true);
    hook = renderRetry();
    const latest = eventDetailFixture();
    latest.event.processing.state = "processed";
    latest.event.processing.revision = 5;
    latest.capabilities.retry = false;
    vi.mocked(request).mockResolvedValueOnce(latest);
    await hook.loadLatest();
    hook = renderRetry();
    expect(hook.latest?.event.processing.state).toBe("processed");
    expect(hook.unknown).toBe(true);
    expect(hook.adopt()).toBeUndefined();
    expect(hook.draft.basis?.revision).toBe(3);
    expect(state.pending).toHaveBeenLastCalledWith(true);
  });
  it("explicitly adopts a processed result after a confirmed original-key refusal without enabling retry", async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error("connection lost"));
    let hook = renderRetry();
    hook.patch("preserved reason");
    hook = renderRetry();
    await hook.run(false, true);
    hook = renderRetry();
    vi.mocked(request).mockRejectedValueOnce(
      new Error('HTTP 403: {"detail":{"code":"event_retry_denied"}}'),
    );
    await hook.run(true, true);
    hook = renderRetry();
    const latest = eventDetailFixture();
    latest.event.processing.state = "processed";
    latest.event.processing.revision = 5;
    latest.event.processing.result = {
      kind: "task_updated",
      target_kind: "task",
      target_id: "processed-task",
    };
    latest.capabilities.retry = false;
    vi.mocked(request).mockResolvedValueOnce(latest);
    await hook.loadLatest();
    state.results["event-receipt"] = { data: eventDetailFixture() };
    state.setData.mockImplementation((_key, data) => {
      state.results["event-receipt"] = { data };
    });
    const onRoute = vi.fn();
    const renderDetail = () => {
      state.next = 0;
      return EventReceiptDetail({
        projectId: "P",
        receiptId: "R",
        identity: "A",
        route: parseEventRoute(location.hash),
        background: location.hash,
        onRoute,
        onPending: state.pending,
        canNavigate: () => true,
        onNavigate: vi.fn(),
        onSaved: vi.fn(),
      });
    };
    const retryPanel = (tree: ReactNode) => {
      const panel = nodes(tree).find((node) => node.props.controller)!;
      return panel.type(panel.props);
    };
    let tree = renderDetail();
    const adopt = nodes(retryPanel(tree)).find(
      (node) => node.props.children === "eventReceipts.adoptResult",
    )!;
    expect(adopt).toBeDefined();
    expect(adopt.props.disabled).toBe(false);
    expect(state.results["event-receipt"].data.event.processing.state).toBe(
      "failed",
    );
    adopt.props.onClick();
    expect(onRoute).toHaveBeenCalledWith({ attemptCursor: "", attemptPage: 1 });
    tree = renderDetail();
    const effect = nodes(tree).find((node) => node.props.effect)!;
    expect(effect.props.effect.target_id).toBe("processed-task");
    expect(effect.props.disabled).toBe(false);
    const confirm = nodes(retryPanel(tree)).find(
      (node) => node.props.children === "eventReceipts.confirm",
    )!;
    expect(confirm.props.disabled).toBe(true);
    expect(renderRetry("A", latest).draft.reason).toBe("preserved reason");
    expect(state.pending).toHaveBeenLastCalledWith(false);
  });
  it("rejects late request completions after session switches and filter ABA without replacement", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(request).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    let hook = renderRetry();
    hook.patch("original");
    hook = renderRetry();
    const waiting = hook.run(false, true);
    renderRetry("B");
    hook = renderRetry("A");
    resolve(ack());
    expect(await waiting).toBeUndefined();
    expect(renderRetry().busy).toBe(false);
    expect(renderRetry().unknown).toBe(true);
    state.hooks = [];
    hook = renderRetry();
    vi.mocked(request).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    const retry = hook.run(true, true);
    state.session = "new";
    resolve(ack());
    expect(await retry).toBeUndefined();
  });
  it("discards late task navigation after route ABA and never navigates on a deleted target", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(fetchTaskDetail).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    const navigate = vi.fn(),
      effect: any = {
        kind: "task_updated",
        target_kind: "task",
        target_id: "T",
      };
    const render = (identity = "A") => {
      state.next = 0;
      return useEventTargetNavigation("P", identity, () => true, navigate);
    };
    const waiting = render().open(effect, location.hash);
    render("B");
    render("A");
    resolve({ project_id: "P", task: { id: "T", req_id: "current-R" } });
    await waiting;
    expect(navigate).not.toHaveBeenCalled();
    expect(render().busy).toBe(false);
    vi.mocked(fetchTaskDetail).mockRejectedValueOnce(
      new Error("HTTP 404: gone"),
    );
    await render().open(effect, location.hash);
    expect(navigate).not.toHaveBeenCalled();
    expect(render().error).toBeInstanceOf(Error);
  });
  it("keeps raw JSON collapsed by default and escapes expanded original text", () => {
    const detail = eventDetailFixture();
    detail.event_json = '{"body":"<script>unsafe</script>"}';
    state.results["event-receipt"] = { data: detail };
    const input: any = {
      projectId: "P",
      receiptId: "R",
      identity: "A",
      route: parseEventRoute(location.hash),
      background: location.hash,
      onRoute: vi.fn(),
      onPending: vi.fn(),
      canNavigate: () => true,
      onNavigate: vi.fn(),
      onSaved: vi.fn(),
    };
    const render = () => {
      state.next = 0;
      return EventReceiptDetail(input);
    };
    let tree = render();
    let collapse = nodes(tree).find((node) => node.type === Collapse)!;
    expect(
      collapse.props.items.find((item: any) => item.key === "raw").children,
    ).toBeNull();
    collapse.props.onChange(["raw"]);
    tree = render();
    collapse = nodes(tree).find((node) => node.type === Collapse)!;
    const pre = nodes(
      collapse.props.items.find((item: any) => item.key === "raw").children,
    ).find((node) => node.type === "pre")!;
    const html = renderToStaticMarkup(pre);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("does not start processing when the current server capability denies it", async () => {
    let hook = renderRetry();
    hook.patch("reason");
    hook = renderRetry();
    await hook.run(false, false);
    expect(request).not.toHaveBeenCalled();
  });
});
