import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryDiscussionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionPanel";
import { DeliveryDiscussionThread } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionThread";
import { DeliverySourceRecords } from "../../subapps/ai-rd-center/src/pages/delivery/DeliverySourceSummary";
import {
  DeliveryDiscussionAdoption,
  loadDiscussionAdoption,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionAdoption";
import { applyDiscussionAdoption } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDiscussionAdoptionSource";
import { discussionObjectHref } from "./deliveryDiscussionNavigation";
import { useDiscussionDraft } from "./deliveryDiscussionDraft";
import {
  discussionSource,
  type DiscussionAdoption,
} from "./deliveryDiscussions";
import {
  fetchDeliveryContext,
  fetchTaskDetail,
  fetchRequirementDetail,
  fetchEditableRequirement,
} from "./deliveryQuery";
import { request } from "./http";
const state = vi.hoisted(() => ({
  hooks: [] as any[],
  next: 0,
  options: [] as any[],
  session: "S",
  results: {} as Record<string, any>,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<any>("react")),
  useState: (initial: any) => {
    const i = state.next++;
    if (!(i in state.hooks))
      state.hooks[i] = typeof initial === "function" ? initial() : initial;
    return [
      state.hooks[i],
      (value: any) => {
        state.hooks[i] =
          typeof value === "function" ? value(state.hooks[i]) : value;
      },
    ];
  },
  useRef: (initial: any) => {
    const i = state.next++;
    if (!(i in state.hooks)) state.hooks[i] = { current: initial };
    return state.hooks[i];
  },
  useEffect: () => {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<any>("./projectPortfolio")),
  projectSessionKey: () => state.session,
}));
vi.mock("./executionExitGuard", () => ({
  useExecutionExitGuard: () => ({ canNavigate: () => true }),
}));
vi.mock("./deliveryQuery", async () => ({
  ...(await vi.importActual<any>("./deliveryQuery")),
  fetchDeliveryContext: vi.fn(),
  fetchTaskDetail: vi.fn(),
  fetchRequirementDetail: vi.fn(),
  fetchEditableRequirement: vi.fn(),
}));
vi.mock("./http", () => ({ request: vi.fn() }));
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) || null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  };
}
const message: any = {
  id: "M",
  thread_id: "D",
  revision: 2,
  state: "active",
  body: "Fixed user conclusion",
  refs: [],
  author: { id: "U", name: "Actual User" },
  created_at: "now",
  can_edit: true,
  can_withdraw: true,
  parent_message_id: null,
};
const thread: any = {
  id: "D",
  title: "Clarify condition",
  state: "resolved",
  version: 3,
  subject: {
    kind: "task",
    id: "T",
    title: "Task",
    current_requirement_id: "old-R",
    missing: false,
  },
  created_by: { id: "U", name: "Actual User" },
  current_resolution: {
    event_id: "E",
    message_id: "M",
    message_revision: 2,
    note: "",
  },
};
function adoption(): DiscussionAdoption {
  return {
    thread: structuredClone(thread),
    message: structuredClone(message),
    reference: discussionSource(thread, message),
    field: "description",
  };
}
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function renderHook(identity = "A") {
  state.next = 0;
  return useDiscussionDraft(
    "P",
    { kind: "task", id: "T" },
    "D",
    "",
    "reply",
    identity,
  );
}
beforeEach(() => {
  state.hooks = [];
  state.next = 0;
  state.options = [];
  state.session = "S";
  state.results = {};
  vi.mocked(request).mockReset();
  vi.mocked(fetchDeliveryContext).mockReset();
  vi.mocked(fetchTaskDetail).mockReset();
  vi.mocked(fetchRequirementDetail).mockReset();
  vi.mocked(fetchEditableRequirement).mockReset();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  vi.stubGlobal("location", { hash: "#/dev-flow?view=discussions" });
});
describe("discussion interactions and fixed business handoff", () => {
  it("opens an exact thread outside the list window without picking another item", () => {
    location.hash =
      "#/dev-flow?view=discussions&discussion_thread=outside&discussion_message=M";
    const tree = DeliveryDiscussionPanel({ projectId: "P", sessionId: "S" });
    expect(tree.type).toBe(DeliveryDiscussionThread);
    expect(tree.props.threadId).toBe("outside");
    expect(tree.props.route.message).toBe("M");
    expect(state.options[0].enabled).toBe(false);
  });
  it("keeps 403 errors visible and does not render cached items as fresh", () => {
    state.results["discussion-page"] = {
      data: { items: [{ ...thread, title: "cached secret" }], total: 1 },
      error: new Error("HTTP 403: forbidden"),
    };
    const tree = DeliveryDiscussionPanel({ projectId: "P", sessionId: "S" });
    expect(
      nodes(tree).some(
        (node) => node.props.error?.message === "HTTP 403: forbidden",
      ),
    ).toBe(true);
    expect(
      nodes(tree).some((node) => node.props.children === "cached secret"),
    ).toBe(false);
  });
  it("hands a fixed conclusion to the existing editor only after the explicit action", () => {
    state.results["discussion-detail"] = {
      data: {
        thread,
        permissions: { write: true },
        capabilities: { reply: true },
      },
    };
    state.results["discussion-messages"] = {
      data: { thread_version: 3, items: [], total: 0, has_more: false },
    };
    state.results["discussion-resolution-message"] = {
      data: { thread_version: 3, message },
    };
    state.results["discussion-links"] = {
      data: { items: [], legacy_sources: [], total: 0 },
    };
    const onAdopt = vi.fn();
    const tree = DeliveryDiscussionThread({
      projectId: "P",
      sessionId: "S",
      threadId: "D",
      route: {
        thread: "D",
        message: "",
        state: "all",
        page: 1,
        cursor: "",
        messageCursor: "",
        messagePage: 1,
      },
      onRoute: vi.fn(),
      onBack: vi.fn(),
      onAdopt,
    });
    expect(onAdopt).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    const button = nodes(tree).find(
      (node) =>
        node.type === Button &&
        node.props.children === "deliveryDiscussion.adoptTask",
    );
    button.props.onClick();
    expect(onAdopt).toHaveBeenCalledWith(
      "task",
      expect.objectContaining({
        reference: discussionSource(thread, message),
        message: expect.objectContaining({
          author: { id: "U", name: "Actual User" },
        }),
      }),
    );
  });
  it("shows immutable source text and actual users with escaped plain text", () => {
    const source = adoption();
    const page: any = {
      items: [
        {
          id: "L",
          relation: "adopted",
          source_changed: true,
          source_snapshot: {
            thread: source.thread,
            message: { ...message, body: "<script>attack</script>" },
          },
          message_revision: 2,
          thread_id: "D",
          message_id: "M",
          target_kind: "task",
          target_id: "T",
          target_title: "Task",
          target_missing: false,
          applied_by: { id: "U2", name: "Reviewer" },
          applied_fields: ["description"],
        },
      ],
      legacy_sources: [],
    };
    const html = renderToStaticMarkup(
      createElement(DeliverySourceRecords, {
        projectId: "P",
        page,
        identity: "A",
      }),
    );
    expect(html).toContain("Actual User");
    expect(html).toContain("Reviewer");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("deliveryDiscussion.changed");
    expect(html).not.toContain("<script>");
  });
  it("keeps original submitted text while a newly typed draft survives success", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(request).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    let hook = renderHook();
    hook.patch({ body: "first" });
    hook = renderHook();
    const waiting = hook.run({
      operation: "reply",
      threadId: "D",
      body: { body: hook.draft.body },
    });
    hook = renderHook();
    hook.patch({ body: "later draft" });
    resolve({
      project_id: "P",
      thread_id: "D",
      thread_version: 4,
      event_id: "E",
      message_id: "new",
      replayed: false,
    });
    await waiting;
    hook = renderHook();
    expect(hook.draft.body).toBe("later draft");
    expect(hook.unknown).toBe(false);
    expect(
      JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string).body,
    ).toBe("first");
  });
  it("retries the fixed original request after an unknown outcome", async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error("network lost"));
    let hook = renderHook();
    hook.patch({ body: "first" });
    hook = renderHook();
    await hook.run({
      operation: "reply",
      threadId: "D",
      body: { body: "first" },
    });
    hook = renderHook();
    expect(hook.unknown).toBe(true);
    const first = vi.mocked(request).mock.calls[0][1]!.body;
    vi.mocked(request).mockResolvedValue({ project_id: "P", thread_id: "D" });
    await hook.run(undefined, true);
    expect(vi.mocked(request).mock.calls[1][1]!.body).toBe(first);
  });
  it("discards late completions after a session switch", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(request).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    let hook = renderHook();
    hook.patch({ body: "keep" });
    hook = renderHook();
    const waiting = hook.run({
      operation: "reply",
      threadId: "D",
      body: { body: "keep" },
    });
    state.session = "other";
    resolve({ project_id: "P", thread_id: "D" });
    expect(await waiting).toBeUndefined();
    hook = renderHook();
    expect(hook.draft.body).toBe("keep");
  });
  it("does not revive busy after A to B to A without a replacement", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(request).mockImplementation(
      () => new Promise((done) => (resolve = done)),
    );
    let hook = renderHook();
    const waiting = hook.run({
      operation: "reply",
      threadId: "D",
      body: { body: "keep" },
    });
    renderHook("B");
    hook = renderHook("A");
    resolve({ project_id: "P", thread_id: "D" });
    expect(await waiting).toBeUndefined();
    hook = renderHook("A");
    expect(hook.busy).toBe(false);
    expect(hook.unknown).toBe(true);
  });
  it("uses the current exact task requirement when planning or opening a moved task", async () => {
    vi.mocked(fetchDeliveryContext).mockResolvedValue({
      project_id: "P",
      permissions: { write: true },
    } as any);
    vi.mocked(fetchTaskDetail).mockResolvedValue({
      project_id: "P",
      task: { id: "T", req_id: "new-R" },
    } as any);
    vi.mocked(fetchEditableRequirement).mockResolvedValue({
      project_id: "P",
      requirement: { id: "new-R" },
    } as any);
    await loadDiscussionAdoption("P", "plan", adoption());
    expect(fetchEditableRequirement).toHaveBeenCalledWith(
      "P",
      "new-R",
      undefined,
    );
    const href = await discussionObjectHref(
      "P",
      { kind: "task", id: "T" },
      "#/dev-flow?view=discussions",
    );
    expect(new URLSearchParams(href.split("?")[1]).get("requirement")).toBe(
      "new-R",
    );
  });
  it("does not fall back to an unrelated requirement when a task is gone", async () => {
    vi.mocked(fetchDeliveryContext).mockResolvedValue({
      project_id: "P",
      permissions: { write: true },
    } as any);
    vi.mocked(fetchTaskDetail).mockRejectedValue(new Error("HTTP 404: gone"));
    await expect(
      loadDiscussionAdoption("P", "plan", adoption()),
    ).rejects.toThrow("404");
    expect(fetchEditableRequirement).not.toHaveBeenCalled();
  });
  it("prefills only the explicitly selected field and keeps the fixed source separate", () => {
    const original = {
      description: "Business draft",
      acceptance_criteria: ["Original criterion"],
    };
    expect(applyDiscussionAdoption(original, adoption())).toEqual({
      description: "Business draft\n\nFixed user conclusion",
      acceptance_criteria: ["Original criterion"],
    });
    expect(
      applyDiscussionAdoption(original, {
        ...adoption(),
        field: "acceptance_criteria",
      }),
    ).toEqual({
      description: "Business draft",
      acceptance_criteria: ["Original criterion", "Fixed user conclusion"],
    });
    expect(original.description).toBe("Business draft");
  });
  it("keeps diagnosis adoption locked after busy ends with an unknown result", () => {
    state.results["discussion-adoption"] = {
      data: {
        context: { permissions: { write: true } },
        issue: { diagnoses: [{ id: "diagnosis", status: "completed" }] },
      },
    };
    const input: any = {
      projectId: "P",
      sessionId: "S",
      action: "diagnosis",
      source: adoption(),
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };
    const render = () => {
      state.next = 0;
      return DeliveryDiscussionAdoption(input);
    };
    let tree = render();
    nodes(tree)
      .find((node) => node.type === Select)!
      .props.onChange("diagnosis");
    tree = render();
    const panel = nodes(tree).find(
      (node) => node.props.diagnosis?.id === "diagnosis",
    )!;
    panel.props.onBusyChange(true);
    panel.props.onUnresolvedChange(true);
    panel.props.onBusyChange(false);
    tree = render();
    expect(tree.props.closable).toBe(false);
    tree.props.onCancel();
    expect(input.onClose).not.toHaveBeenCalled();
  });
});
