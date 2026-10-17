import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Drawer, Input, Modal, Select, Skeleton } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryActivityFeed,
  DeliveryActivityDetail,
  ActivitySourceLinks,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryActivityFeed";
import {
  DeliveryRequirementChangeEditor,
  RequirementImpactFacts,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementChangeEditor";
import { DeliveryRequirementHistory } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementHistory";
import {
  type DeliveryRequirement,
  type DeliveryDisplayContext,
  type DeliveryCommandAck,
} from "./delivery";
import { fetchRequirementDetail, fetchDeliveryContext } from "./deliveryQuery";
import {
  previewRequirementChange,
  saveRequirementChange,
  type ActivityItem,
  type RequirementChangePreview,
} from "./deliveryCollaboration";

const h = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  data: {} as Record<string, any>,
  pending: false,
  error: false,
  scope: "original",
  writes: [] as string[],
  refetch: vi.fn(),
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
  useRef: (value: any) => {
    const index = h.refNext++;
    return (h.refs[index] ||= { current: value });
  },
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
    isPending: h.pending,
    isError: h.error,
    error: h.error ? new Error("HTTP 503") : null,
    isFetching: false,
    refetch: h.refetch,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./deliveryCollaboration", async () => ({
  ...(await vi.importActual<typeof import("./deliveryCollaboration")>(
    "./deliveryCollaboration",
  )),
  collaborationSessionKey: () => h.scope,
  previewRequirementChange: vi.fn(),
  saveRequirementChange: vi.fn(),
}));
vi.mock("./deliveryQuery", async () => ({
  ...(await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery")),
  fetchRequirementDetail: vi.fn(),
  fetchDeliveryContext: vi.fn(),
}));
const event: ActivityItem = {
  id: "E",
  at: "2026-10-17T10:00:00Z",
  action: "requirement.update",
  actor: { id: "u", name: "Lin" },
  association: "recorded",
  requirement_ids: ["R"],
  target: {
    kind: "requirement",
    id: "R",
    label: "Original",
    available: true,
    reason: null,
  },
  related_targets: [],
  changes: [{ field: "title", before: "Original", after: "Updated" }],
};
const requirement = {
  id: "R",
  basis: "basis",
  title: "Original",
  description: "Original scope",
  priority: "P1",
  acceptance_criteria: ["A"],
  flow: {
    revision: 2,
    owner_id: "",
    due_on: null,
    milestone_id: "",
    blocked_reason: "",
    stage: "development",
  },
} as DeliveryRequirement;
const workspace = {
  project_id: "P",
  query_generation: 3,
  query_state: { status: "ready", schema_version: 1, computed_at: null },
  project: { id: "P" },
  version: 7,
  permissions: { write: true },
  members: [],
  milestones: [],
} as unknown as DeliveryDisplayContext;
const ack: DeliveryCommandAck = { project_id: "P", action: "requirement.update", resource: { kind: "requirement", id: "R" }, result: null, affected_refs: [{ kind: "requirement", id: "R" }], applied_version: 8, version: 8, query_generation: 3, replayed: false };
const preview: RequirementChangePreview = {
  project_id: "P",
  requirement_id: "R",
  version: 7,
  requirement_basis: "basis",
  preview_basis: "fixed-preview",
  allowed: true,
  reasons: [],
  changes: [{ field: "title", before: "Original", after: "Updated" }],
  impact: {
    task_ids: ["T"],
    dependent_task_ids: ["D"],
    execution_ids: [],
    release_candidate_ids: ["C"],
    deployment_ids: [],
    invalidates_current_acceptance: true,
  },
};
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
    find(node.props.footer, type, predicate) ||
    find(node.props.action, type, predicate)
  );
}
function render<T>(component: () => T): T {
  h.next = 0;
  h.refNext = 0;
  return component();
}
const nav = (href: string) => {
  h.writes.push(href);
  location.hash = href;
};
const button = (tree: ReactNode, action: string) =>
  find(tree, Button, (props) => props["data-action"] === action);
const saved = vi.fn(),
  close = vi.fn(),
  unresolved = vi.fn();
beforeEach(() => {
  h.state = [];
  h.refs = [];
  h.next = 0;
  h.refNext = 0;
  h.pending = false;
  h.error = false;
  h.scope = "original";
  h.writes = [];
  h.data = {};
  h.refetch.mockReset();
  saved.mockReset();
  close.mockReset();
  unresolved.mockReset();
  vi.mocked(previewRequirementChange).mockReset();
  vi.mocked(saveRequirementChange).mockReset();
  vi.mocked(fetchRequirementDetail).mockReset();
  vi.mocked(fetchDeliveryContext).mockReset();
  vi.stubGlobal("location", { hash: "#/dev-flow?view=overview&project_id=P" });
});
const feed = () =>
  render(() =>
    DeliveryActivityFeed({
      projectId: "P",
      sessionId: "S",
      requirementId: "R",
      onNavigate: nav,
    }),
  );
const detail = () =>
  render(() =>
    DeliveryActivityDetail({ projectId: "P", sessionId: "S", onNavigate: nav }),
  );
const editor = () =>
  render(() =>
    DeliveryRequirementChangeEditor({
      workspace,
      requirement,
      sessionId: "S",
      onSaved: saved,
      onClose: close,
      onUnresolvedChange: unresolved,
    }),
  );

describe("exact activity navigation", () => {
  it("opens the actual event and moves between cursor pages without discarding the requirement", () => {
    location.hash =
      "#/dev-flow?view=list&project_id=P&requirement=R&detail=activity";
    h.data["delivery-activity"] = {
      project_id: "P",
      scope: "requirement",
      scope_id: "R",
      items: [event],
      next_cursor: "older/20",
    };
    button(feed(), "open-event").onClick();
    expect(
      new URLSearchParams(location.hash.split("?")[1]).get("event_id"),
    ).toBe("E");
    button(feed(), "older-activity").onClick();
    expect(location.hash).toContain("requirement=R");
    expect(
      new URLSearchParams(location.hash.split("?")[1]).get("activity_cursor"),
    ).toBe("older/20");
  });
  it("clears stale cursors when the action filter changes", () => {
    location.hash =
      "#/dev-flow?view=list&project_id=P&requirement=R&activity_scope_id=R&activity_cursor=old";
    find(feed(), Select).onChange("task.update");
    expect(location.hash).toContain("activity_action=task.update");
    expect(location.hash).not.toContain("activity_cursor");
  });
  it("does not show another requirement's cached activity", () => {
    h.data["delivery-activity"] = {
      project_id: "P",
      scope: "requirement",
      scope_id: "Other",
      items: [event],
      next_cursor: null,
    };
    expect(button(feed(), "open-event")).toBeUndefined();
  });
  it("loads and retries the selected event inside its drawer and never substitutes a feed event", () => {
    location.hash += "&event_id=missing";
    h.pending = true;
    expect(find(detail(), Skeleton)).toBeDefined();
    expect(find(detail(), Drawer).open).toBe(true);
    h.pending = false;
    h.error = true;
    button(detail(), "retry-event").onClick();
    expect(h.refetch).toHaveBeenCalledOnce();
    h.error = false;
    h.data["delivery-activity-item"] = { project_id: "P", item: event };
    expect(find(detail(), ActivitySourceLinks)).toBeUndefined();
  });
  it("keeps restricted and deleted sources readable without an invented link", () => {
    const tree = ActivitySourceLinks({
      targets: [
        {
          kind: "execution",
          id: null,
          label: null,
          available: false,
          reason: "forbidden",
        },
        {
          kind: "task",
          id: "deleted",
          label: "Past task",
          available: false,
          reason: "missing",
        },
      ],
      projectId: "P",
      background: location.hash,
      onNavigate: nav,
    });
    expect(button(tree, "open-source")).toBeUndefined();
    expect(find(tree, "span", (p) => p.children === "Past task")).toBeDefined();
  });
});

describe("explicit requirement change preview", () => {
  it("previews displayed definition edits before the fixed confirmation command", async () => {
    vi.mocked(previewRequirementChange).mockResolvedValue(preview);
    vi.mocked(saveRequirementChange).mockResolvedValue(ack);
    find(
      editor(),
      Input,
      (p) => p["aria-label"] === "delivery.titleField",
    ).onChange({ target: { value: "Updated" } });
    expect(button(editor(), "confirm-change")).toBeUndefined();
    await button(editor(), "preview-change").onClick();
    expect(previewRequirementChange).toHaveBeenCalledWith("P", "R", "basis", {
      title: "Updated",
    });
    await button(editor(), "confirm-change").onClick();
    expect(saveRequirementChange).toHaveBeenCalledWith(
      "P",
      expect.objectContaining({ version: 7 }),
      expect.objectContaining({
        id: "R",
        title: "Updated",
        requirement_basis: "basis",
        change_preview_basis: "fixed-preview",
      }),
    );
    expect(saved).toHaveBeenCalledWith(ack);
  });
  it("retains edited text on conflict and requires explicit latest-basis adoption and a new preview", async () => {
    vi.mocked(previewRequirementChange).mockRejectedValueOnce(
      new Error("HTTP 409: requirement_basis_changed"),
    );
    find(
      editor(),
      Input,
      (p) => p["aria-label"] === "delivery.titleField",
    ).onChange({ target: { value: "My edited text" } });
    await button(editor(), "preview-change").onClick();
    expect(
      find(editor(), Input, (p) => p["aria-label"] === "delivery.titleField")
        .value,
    ).toBe("My edited text");
    expect(button(editor(), "preview-change").disabled).toBe(true);
    vi.mocked(fetchDeliveryContext).mockResolvedValue({ ...workspace, version: 8 });
    vi.mocked(fetchRequirementDetail).mockResolvedValue({
      project_id: "P", query_generation: 3,
      version: 8,
      requirement: {
          ...requirement,
          basis: "latest-basis",
          title: "Other user's edit",
          description: "Fresh unedited scope",
        },
    });
    await button(editor(), "read-latest").onClick();
    expect(button(editor(), "preview-change").disabled).toBe(true);
    button(editor(), "adopt-latest").onClick();
    expect(
      find(
        editor(),
        Input.TextArea,
        (p) => p["aria-label"] === "delivery.description",
      ).value,
    ).toBe("Fresh unedited scope");
    vi.mocked(previewRequirementChange).mockResolvedValue({
      ...preview,
      version: 8,
      requirement_basis: "latest-basis",
    });
    await button(editor(), "preview-change").onClick();
    expect(previewRequirementChange).toHaveBeenLastCalledWith(
      "P",
      "R",
      "latest-basis",
      { title: "My edited text" },
    );
  });
  it("blocks close on unknown writes and retries exactly the original key and payload", async () => {
    vi.mocked(saveRequirementChange)
      .mockRejectedValueOnce(new Error("network disconnected"))
      .mockResolvedValueOnce(ack);
    find(editor(), Select, (p) => p["data-field"] === "priority").onChange(
      "P2",
    );
    await button(editor(), "confirm-change").onClick();
    const first = vi.mocked(saveRequirementChange).mock.calls[0];
    expect(find(editor(), Modal).closable).toBe(false);
    find(editor(), Modal).onCancel();
    expect(close).not.toHaveBeenCalled();
    expect(unresolved).toHaveBeenCalledWith(true);
    await button(editor(), "retry-change").onClick();
    expect(vi.mocked(saveRequirementChange).mock.calls[1]).toEqual(first);
    expect(unresolved).toHaveBeenLastCalledWith(false);
  });
  it("does not apply a late preview or write after the identity changes", async () => {
    find(
      editor(),
      Input,
      (p) => p["aria-label"] === "delivery.titleField",
    ).onChange({ target: { value: "Updated" } });
    vi.mocked(previewRequirementChange).mockImplementation(async () => {
      h.scope = "another";
      return preview;
    });
    await button(editor(), "preview-change").onClick();
    expect(button(editor(), "confirm-change")).toBeUndefined();
    expect(find(editor(), Alert)).toBeDefined();
  });
  it("invalidates a displayed preview when the user changes its definition", async () => {
    vi.mocked(previewRequirementChange).mockResolvedValue(preview);
    find(
      editor(),
      Input,
      (p) => p["aria-label"] === "delivery.titleField",
    ).onChange({ target: { value: "Updated" } });
    await button(editor(), "preview-change").onClick();
    expect(button(editor(), "confirm-change")).toBeDefined();
    find(
      editor(),
      Input,
      (p) => p["aria-label"] === "delivery.titleField",
    ).onChange({ target: { value: "Changed again" } });
    expect(button(editor(), "confirm-change")).toBeUndefined();
    expect(button(editor(), "preview-change")).toBeDefined();
  });
});

describe("requirement history identity", () => {
  it("shows actual current links from reader history without inventing historical impact", () => {
    const links = {
      requirement_basis: "basis",
      task_ids: ["T"],
      dependent_task_ids: ["D"],
      execution_ids: [],
      release_candidate_ids: [],
      deployment_ids: [],
      restricted_execution_count: 1,
      restricted_deployment_count: 0,
    };
    h.data["delivery-requirement-history"] = {
      project_id: "P",
      requirement_id: "R",
      current_basis: "basis",
      current_links: links,
      items: [],
      earlier_history_unknown: true,
      next_cursor: null,
    };
    const tree = render(() =>
      DeliveryRequirementHistory({
        projectId: "P",
        sessionId: "S",
        requirement,
        onNavigate: nav,
      }),
    );
    expect(find(tree, RequirementImpactFacts).links).toEqual(links);
    expect(find(tree, RequirementImpactFacts).preview).toBeUndefined();
  });
  it("reads an exact older version instead of displaying the first current-page item", () => {
    location.hash =
      "#/dev-flow?view=list&project_id=P&requirement=R&requirement_version=older";
    h.data["delivery-requirement-history"] = {
      project_id: "P",
      requirement_id: "R",
      current_basis: "basis",
      items: [{ id: "newer" }],
      next_cursor: null,
    };
    const tree = render(() =>
      DeliveryRequirementHistory({
        projectId: "P",
        sessionId: "S",
        requirement,
        onNavigate: nav,
      }),
    );
    expect(
      find(tree, "section", (p) => p["data-version-id"] === "newer"),
    ).toBeUndefined();
    expect(button(tree, "retry-version")).toBeDefined();
  });
});
