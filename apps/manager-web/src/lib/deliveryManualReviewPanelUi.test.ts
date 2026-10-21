import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Modal } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryManualReviewPanel,
  ManualReviewFormFields,
  ManualReviewHistory,
  ManualReviewOriginalFacts,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel";
import {
  DeliveryTaskDetail,
  TaskDetailContent,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import { manualReviewCommandStorageKey } from "./deliveryManualReviewCommand";
import { setProjectId, setSession, USER_KEY } from "./authStorage";
import type { TaskReviewCurrentResponse } from "./deliveryTaskReview";
const hooks = vi.hoisted(() => ({
  state: [] as any[],
  next: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  currentError: false,
  historyError: false,
  originalError: false,
  selected: "",
  currentReads: 0,
  historyReads: 0,
  taskState: "pending",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState(initial: unknown) {
    const at = hooks.next++,
      bag = hooks.state;
    if (!(at in bag))
      bag[at] = typeof initial === "function" ? initial() : initial;
    return [
      bag[at],
      (value: any) => {
        bag[at] = typeof value === "function" ? value(bag[at]) : value;
      },
    ];
  },
  useRef(initial: unknown) {
    const at = hooks.next++;
    return (hooks.state[at] ||= { current: initial });
  },
  useMemo(factory: () => unknown, deps: unknown[]) {
    const at = hooks.next++,
      old = hooks.state[at];
    if (!old || deps.some((v, i) => v !== old.deps[i]))
      hooks.state[at] = { deps, value: factory() };
    return hooks.state[at].value;
  },
  useCallback(callback: unknown, deps: unknown[]) {
    const at = hooks.next++,
      old = hooks.state[at];
    if (!old || deps.some((v, i) => v !== old.deps[i]))
      hooks.state[at] = { deps, value: callback };
    return hooks.state[at].value;
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const at = hooks.next++,
      old = hooks.state[at];
    if (!old || deps.some((v, i) => v !== old.deps[i])) {
      hooks.state[at] = { deps };
      hooks.effects.push(() => {
        old?.cleanup?.();
        const cleanup = effect();
        hooks.state[at].cleanup = cleanup;
        if (cleanup) hooks.cleanups.push(cleanup);
      });
    }
  },
  useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) {
    return snapshot();
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
const proof: TaskReviewCurrentResponse = {
  project_id: "P",
  task_id: "T",
  version: 7,
  query_generation: 7,
  as_of: "2026-10-18T00:00:00Z",
  effective_review_id: "review-old",
  current: {
    task: {
      id: "T",
      title: "Original task",
      description: "Original scope",
      req_id: "",
      status: "completed",
      assigned_to: "user",
      priority: "P1",
      estimate: "M",
      blocked_reason: "",
      acceptance_criteria: [],
    },
    owner: { id: "user", name: "User", kind: "human", active: true },
    requirement: null,
    planning: { requirement_criteria_indices: [], depends_on: [] },
    acceptance: {
      criteria: [],
      sources: [],
      available: true,
      requirement_id: null,
      requirement_revision: null,
    },
    basis: "basis-original",
    eligible: true,
    can_review: true,
    can_accept: true,
    reasons: [],
    dependency_blocked: [],
    verified: true,
    dependency_basis: {},
  },
};
const summary = {
  id: "review-old",
  task_id: "T",
  decision: "accept" as const,
  created_at: "2026-10-18T00:00:00Z",
  reviewer: { id: "user", name: "User" },
  task_basis: "basis-original",
  source: "manual" as const,
  invalidated: false,
  invalidated_at: null,
  invalidated_reason: "",
  comment_summary: "Short old comment",
  has_evidence: true,
};
vi.mock("@tanstack/react-query", () => ({
  useQuery(options: any) {
    if (options.queryKey[0] === "delivery-task-detail")
      return {
        data:
          hooks.taskState === "success"
            ? {
                project: { id: "P" },
                task: { id: "T", req_id: "" },
                permissions: { write: true },
              }
            : undefined,
        isPending: hooks.taskState === "pending",
        isError: hooks.taskState === "missing",
        error:
          hooks.taskState === "missing" ? new Error("HTTP 404: deleted") : null,
        refetch: async () => {},
      };
    if (options.queryKey[0] === "delivery-task-review-current")
      return {
        data: proof,
        isError: hooks.currentError,
        isPending: false,
        isFetching: false,
        error: hooks.currentError
          ? new Error("HTTP 409: proof budget exceeded")
          : null,
        refetch: async () => {
          hooks.currentReads++;
          return { data: proof, isError: hooks.currentError };
        },
      };
    hooks.selected = options.enabled ? options.queryKey.at(-1) : "";
    return {
      data: options.enabled
        ? {
            review: {
              ...summary,
              comment: "Original comment",
              evidence_content: "Original evidence",
              evidence_url: "",
              snapshot: proof.current,
            },
          }
        : undefined,
      isError: hooks.originalError,
      isPending: false,
      error: hooks.originalError ? new Error("HTTP 403: denied") : null,
      refetch: async () => {},
    };
  },
  useInfiniteQuery() {
    return {
      data: {
        pages: [
          {
            project_id: "P",
            task_id: "T",
            reviews: [summary],
            total: 1,
            next_cursor: null,
            limit: 20,
          },
        ],
      },
      isError: hooks.historyError,
      isPending: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      error: hooks.historyError ? new Error("HTTP 403: denied") : null,
      refetch: async () => {
        hooks.historyReads++;
      },
    };
  },
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    resetQueries: async () => {
      hooks.historyReads++;
    },
  }),
}));
function find(
  node: ReactNode,
  type: unknown,
  predicate: (p: any) => boolean = () => true,
): any {
  if (Array.isArray(node))
    return node.map((item) => find(item, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(node.props.action, type, predicate) ||
    find(node.props.footer, type, predicate)
  );
}
const onSaved = vi.fn(),
  onPending = vi.fn();
function render(patch: Partial<Parameters<typeof DeliveryManualReviewPanel>[0]> = {}) {
  hooks.next = 0;
  const tree = DeliveryManualReviewPanel({
    projectId: "P",
    sessionId: "session",
    taskId: "T",
    onSaved,
    onUnresolvedChange: onPending,
    ...patch,
  });
  hooks.effects.splice(0).forEach((effect) => effect());
  return tree;
}
const button = (key: string) =>
  find(render(), Button, (p) => p.children === `deliveryManualReview.${key}`)!;
const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
function fill() {
  button("open").onClick();
  find(render(), ManualReviewFormFields).onChange({
    comment: "Original opinion",
    evidenceContent: "Original evidence",
  });
}
function clearHooks() {
  hooks.cleanups.splice(0).forEach((cleanup) => cleanup());
  hooks.state = [];
  hooks.effects = [];
  hooks.next = 0;
}
beforeEach(() => {
  clearHooks();
  hooks.currentError = false;
  hooks.historyError = false;
  hooks.originalError = false;
  hooks.selected = "";
  hooks.currentReads = 0;
  hooks.historyReads = 0;
  onSaved.mockReset();
  onPending.mockReset();
  const local = new Map<string, string>(),
    session = new Map<string, string>();
  const store = (map: Map<string, string>) => ({
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
  vi.stubGlobal("localStorage", store(local));
  vi.stubGlobal("sessionStorage", store(session));
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: { href: "http://localhost/#/tasks/execution?task_id=T" },
      document: new EventTarget(),
      history: { state: null, replaceState() {} },
    }),
  );
  vi.stubGlobal("location", { hash: "#/tasks/execution?task_id=T" });
  vi.stubGlobal("document", { getElementById: () => null });
  setSession("token-A", "P", "tenant-A");
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({ id: "user", tenant_id: "tenant-A" }),
  );
});
afterEach(() => {
  clearHooks();
  vi.unstubAllGlobals();
});
describe("manual review panel boundaries", () => {
  it("checks the task's live fresh-write gate before a captured confirmation callback", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); let allowed = true;
    fill(); const tree = render({ canSubmit: () => allowed }), confirm = find(tree, Modal).onOk;
    allowed = false; confirm(); await tick(); expect(fetcher).not.toHaveBeenCalled();
    expect(find(render(), ManualReviewFormFields).session.comment).toBe("Original opinion");
  });
  it("keeps a confirmed manual ACK visible through local cleanup failure without resubmitting", async () => {
    const sends: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sends.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ project_id: "P", action: "task.manual_review", resource: { kind: "task_review", id: "review-new" },
        applied_version: 8, version: 8, query_generation: 8, replayed: false,
        affected_refs: [{ kind: "task_review", id: "review-new" }, { kind: "task", id: "T" }], result: { task_ids: ["T"] } }) };
    });
    const save = sessionStorage.setItem.bind(sessionStorage); let blocked = true;
    sessionStorage.setItem = (key: string, value: string) => {
      if (blocked && key === manualReviewCommandStorageKey("P", "T") && (!value || JSON.parse(value).phase === "succeeded")) throw new Error("Cleanup unavailable");
      save(key, value);
    };
    fill(); find(render(), Modal).onOk(); await tick();
    let tree = render(); expect(find(tree, Modal).open).toBe(true); expect(find(tree, Modal).closable).toBe(false);
    expect(find(tree, Button, (props) => props["data-action"] === "finish-manual-review")).toBeDefined(); expect(onSaved).not.toHaveBeenCalled();
    blocked = false; find(tree, Button, (props) => props["data-action"] === "finish-manual-review").onClick(); await tick();
    tree = render(); expect(sends).toHaveLength(1); expect(onSaved).toHaveBeenCalledOnce(); expect(find(tree, Modal).open).toBe(false);
  });
  it("retains the navigation lock for a restored manual unknown when execution reports no unresolved request", () => {
    sessionStorage.setItem(
      manualReviewCommandStorageKey("P", "T")!,
      JSON.stringify({
        phase: "unknown",
        original: {
          action: "task.manual_review",
          payload: {
            task_id: "T",
            decision: "accept",
            basis: "basis",
            comment: "Retained",
            evidence_content: "Evidence",
            evidence_url: "",
          },
          intent: { version: 7, key: "original" },
        },
      }),
    );
    let parentState: any[] = [],
      childState: any[] = [];
    const parent = () => {
      hooks.state = parentState;
      hooks.next = 0;
      const tree = DeliveryTaskDetail({
        projectId: "P",
        sessionId: "session",
        taskId: "T",
      });
      hooks.effects.splice(0).forEach((effect) => effect());
      parentState = hooks.state;
      return tree;
    };
    hooks.taskState = "pending";
    let parentTree = parent();
    const props = find(parentTree, DeliveryManualReviewPanel);
    hooks.state = childState;
    hooks.next = 0;
    DeliveryManualReviewPanel(props);
    hooks.effects.splice(0).forEach((effect) => effect());
    childState = hooks.state;
    hooks.taskState = "success";
    parentTree = parent();
    find(parentTree, TaskDetailContent).onUnresolvedChange(false);
    parentTree = parent();
    expect(find(parentTree, DeliveryManualReviewPanel).disabled).toBe(true);
  });
  it("keeps a native execution lock when allowed node navigation rebuilds an idle manual controller", () => {
    let parentState: any[] = [],
      childState: any[] = [];
    const parent = () => {
      hooks.state = parentState;
      hooks.next = 0;
      const tree = DeliveryTaskDetail({
        projectId: "P",
        sessionId: "session",
        taskId: "T",
      });
      hooks.effects.splice(0).forEach((effect) => effect());
      parentState = hooks.state;
      return tree;
    };
    const child = (props: any) => {
      hooks.state = childState;
      hooks.next = 0;
      DeliveryManualReviewPanel(props);
      hooks.effects.splice(0).forEach((effect) => effect());
      childState = hooks.state;
    };
    hooks.taskState = "success";
    let tree = parent();
    child(find(tree, DeliveryManualReviewPanel));
    find(tree, TaskDetailContent).onUnresolvedChange(true);
    tree = parent();
    expect(find(tree, DeliveryManualReviewPanel).disabled).toBe(true);
    location.hash = "#/tasks/execution?task_id=T&execution_node=node-2";
    window.location.href = "http://localhost/" + location.hash;
    window.dispatchEvent(new Event("hashchange"));
    child(find(tree, DeliveryManualReviewPanel));
    tree = parent();
    expect(find(tree, DeliveryManualReviewPanel).disabled).toBe(true);
  });
  it("keeps the same panel position and its draft when parent detail changes from pending to data or deletion", async () => {
    let parentState: any[] = [],
      childState: any[] = [];
    const parent = () => {
      hooks.state = parentState;
      hooks.next = 0;
      const tree = DeliveryTaskDetail({
        projectId: "P",
        sessionId: "session",
        taskId: "T",
      });
      hooks.effects.splice(0).forEach((effect) => effect());
      parentState = hooks.state;
      return tree;
    };
    const child = (props: any) => {
      hooks.state = childState;
      hooks.next = 0;
      const tree = DeliveryManualReviewPanel(props);
      hooks.effects.splice(0).forEach((effect) => effect());
      childState = hooks.state;
      return tree;
    };
    hooks.taskState = "pending";
    let parentTree = parent();
    const entry = (parentTree.props.children as any[]).findIndex(
      (element) => element?.type === DeliveryManualReviewPanel,
    );
    const first = (parentTree.props.children as any[])[entry];
    let panel = child(first.props);
    find(
      panel,
      Button,
      (p) => p.children === "deliveryManualReview.open",
    ).onClick();
    panel = child(first.props);
    find(panel, ManualReviewFormFields).onChange({
      comment: "Keep draft across parent load",
      evidenceContent: "Evidence",
    });
    hooks.taskState = "success";
    parentTree = parent();
    const next = (parentTree.props.children as any[])[entry];
    expect(next.type).toBe(DeliveryManualReviewPanel);
    expect(next.key).toBe(first.key);
    panel = child(next.props);
    expect(find(panel, ManualReviewFormFields).session.comment).toBe(
      "Keep draft across parent load",
    );
    vi.stubGlobal("fetch", async () => {
      throw new Error("lost ACK");
    });
    find(panel, Modal).onOk();
    await tick();
    hooks.taskState = "missing";
    parentTree = parent();
    const deleted = (parentTree.props.children as any[])[entry];
    expect(deleted.type).toBe(DeliveryManualReviewPanel);
    expect(deleted.key).toBe(first.key);
    panel = child(deleted.props);
    expect(find(panel, Modal).open).toBe(true);
    expect(
      find(
        panel,
        Button,
        (p) => p.children === "deliveryManualReview.retryOriginal",
      ).disabled,
    ).toBe(false);
  });
  it("keeps catalogue available when current proof fails and only opens originals explicitly", async () => {
    hooks.currentError = true;
    let tree = render();
    expect(find(tree, ManualReviewHistory).effectiveReviewId).toBeUndefined();
    expect(find(tree, ManualReviewHistory).reviews[0].id).toBe("review-old");
    expect(hooks.selected).toBe("");
    expect(button("open").disabled).toBe(true);
    find(tree, ManualReviewHistory).onOpen("review-old");
    tree = render();
    expect(hooks.selected).toBe("review-old");
    expect(find(tree, ManualReviewOriginalFacts).review.evidence_content).toBe(
      "Original evidence",
    );
    hooks.originalError = true;
    expect(find(render(), ManualReviewOriginalFacts)).toBeUndefined();
    find(
      render(),
      Button,
      (p) => p["aria-label"] === "deliveryManualReview.refreshCurrent",
    ).onClick();
    await tick();
    expect(hooks.currentReads).toBe(1);
    expect(hooks.historyReads).toBe(0);
  });
  it("freezes an unknown draft and restores original replay after refresh even without current proof", async () => {
    const sent: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      if (sent.length === 1) throw new Error("lost ACK");
      return {
        ok: true,
        json: async () => ({
          project_id: "P",
          action: "task.manual_review",
          resource: { kind: "task_review", id: "review-new" },
          applied_version: 8,
          version: 8,
          query_generation: 8,
          replayed: true,
          affected_refs: [
            { kind: "task_review", id: "review-new" },
            { kind: "task", id: "T" },
          ],
          result: { task_ids: ["T"] },
        }),
      };
    });
    fill();
    find(render(), Modal).onOk();
    await tick();
    let tree = render();
    expect(find(tree, Modal).cancelButtonProps.disabled).toBe(true);
    expect(find(tree, ManualReviewFormFields).busy).toBe(true);
    find(tree, ManualReviewFormFields).onChange({
      comment: "Changed after unknown",
    });
    find(render(), Modal).onOk();
    await tick();
    expect(sent).toHaveLength(1);
    clearHooks();
    hooks.currentError = true;
    tree = render();
    expect(find(tree, Modal).open).toBe(true);
    expect(button("retryOriginal").disabled).toBe(false);
    button("retryOriginal").onClick();
    await tick();
    expect(sent[1]).toEqual(sent[0]);
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it.each([403, 409])(
    "requires explicit latest-fact adoption after a definite %i",
    async (status) => {
      const sent: any[] = [];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return {
          ok: false,
          status,
          text: async () => JSON.stringify({ detail: "Refused" }),
        };
      });
      fill();
      find(render(), Modal).onOk();
      await tick();
      expect(find(render(), Modal).okButtonProps.disabled).toBe(true);
      await button("loadLatest").onClick();
      await tick();
      button("adopt").onClick();
      expect(find(render(), ManualReviewFormFields).session.comment).toBe(
        "Original opinion",
      );
      find(render(), Modal).onOk();
      await tick();
      expect(sent).toHaveLength(2);
      expect(sent[1].idempotency_key).not.toBe(sent[0].idempotency_key);
    },
  );
  it("invalidates a stale submit synchronously on project ABA or new login before React remounts", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    fill();
    const stale = find(render(), Modal).onOk;
    setProjectId("other");
    setProjectId("P");
    stale();
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
    clearHooks();
    fill();
    const oldLogin = find(render(), Modal).onOk;
    setSession("token-B", "P", "tenant-B");
    oldLogin();
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not turn a wrong ACK into success or discard its unknown original", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
    fill();
    find(render(), Modal).onOk();
    await tick();
    expect(onSaved).not.toHaveBeenCalled();
    expect(
      find(
        render(),
        Alert,
        (p) => p.title === "deliveryManualReview.unknownRequest",
      ),
    ).toBeDefined();
    expect(find(render(), Modal).open).toBe(true);
  });
});
