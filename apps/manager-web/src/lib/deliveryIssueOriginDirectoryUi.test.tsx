import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Checkbox, Empty, Skeleton } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueOriginDirectory } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueOrigins";
import {
  fetchIssueOrigins,
  type IssueOrigin,
  type IssueOriginPage,
} from "./deliveryIssue";

const hooks = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  scope: "original",
  error: null as any,
  pending: false,
  data: null as any,
  options: null as any,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useState: (initial: any) => {
    const index = hooks.next++;
    if (!(index in hooks.state))
      hooks.state[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.state[index],
      (value: any) => {
        hooks.state[index] =
          typeof value === "function" ? value(hooks.state[index]) : value;
      },
    ];
  },
  useRef: (value: any) => (hooks.refs[hooks.refNext++] ||= { current: value }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    hooks.options = options;
    return {
      data: hooks.data,
      error: hooks.error,
      isError: Boolean(hooks.error),
      isPending: hooks.pending,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>(
    "./projectPortfolio",
  )),
  projectSessionKey: () => hooks.scope,
}));
vi.mock("./deliveryIssue", async () => ({
  ...(await vi.importActual<typeof import("./deliveryIssue")>(
    "./deliveryIssue",
  )),
  fetchIssueOrigins: vi.fn(),
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
    find(node.props.description, type, predicate)
  );
}
const makeOrigin = (
  id: string,
  operation: IssueOrigin["operation"] = "create",
): IssueOrigin => ({
  id,
  issue_id: "ISS-one",
  receipt_id: `receipt-${id}`,
  attempt_id: `attempt-${id}`,
  operation,
  effect_kind: operation === "delete" ? "record_deleted" : "record_upserted",
  digest: "a".repeat(64),
  basis: "b".repeat(64),
  event_id: `event-${id}`,
  event_type: "sop.sync.push",
  source: "https://untrusted.example/run/guess",
  producer: { id: "actual-user", name: "Actual producer" },
  processed_at: "2026-10-19T00:00:00Z",
  available: true,
  unavailable_reason: null,
  evidence: {
    id: `event:${id}`,
    kind: "event",
    label: `Actual ${operation}`,
    status: "processed",
    summary: "event_business_effect",
    facts: [],
    excerpt: "",
    truncated: false,
    missing: false,
    restricted: false,
    redacted: false,
    target: {
      project_id: "P",
      view: "events",
      detail: "details",
      receipt_id: `receipt-${id}`,
      origin_id: id,
    },
  },
});
const page = (items: IssueOrigin[], next = ""): IssueOriginPage => ({
  project_id: "P",
  issue_id: "ISS-one",
  issue_available: true,
  as_of: "2026-10-19T00:00:00Z",
  items,
  total: 21,
  limit: 20,
  next_cursor: next || null,
});
let selected: string[] = [];
const onUnavailable = vi.fn();
const onSelection = vi.fn((origin: IssueOrigin, checked: boolean) => {
  selected = checked
    ? [...selected, origin.evidence.id]
    : selected.filter((id) => id !== origin.evidence.id);
});
function render(options: { disabled?: boolean; count?: number } = {}) {
  hooks.next = 0;
  hooks.refNext = 0;
  return IssueOriginDirectory({
    projectId: "P",
    issueId: "ISS-one",
    background: location.hash,
    persistRoute: true,
    selectedIds: selected,
    selectionCount: options.count ?? selected.length,
    disabled: options.disabled,
    onSelection,
    onUnavailable,
  });
}
const button = (name: string) =>
  find(
    render(),
    Button,
    (props) => props.children === `deliveryIssue.origins.${name}`,
  );
beforeEach(() => {
  hooks.state = [];
  hooks.refs = [];
  hooks.scope = "original";
  hooks.error = null;
  hooks.pending = false;
  hooks.data = page([makeOrigin("one")], "fixed-page-two");
  selected = [];
  onUnavailable.mockReset();
  onSelection.mockClear();
  vi.mocked(fetchIssueOrigins).mockReset();
  vi.stubGlobal("location", {
    hash: "#/dev-flow?view=issues&issue=ISS-one&project_id=P&return_to=%23%2Fprojects%2Fportfolio",
  });
  vi.stubGlobal("history", { replaceState: vi.fn() });
});
describe("independent tool origin directory callbacks", () => {
  it("retains selection across fixed-window pages and opens an exact receipt with its return route", () => {
    find(render(), Checkbox).onChange({ target: { checked: true } });
    expect(selected).toEqual(["event:one"]);
    button("next").onClick();
    render();
    expect(hooks.options.queryKey).toEqual([
      "delivery-issue-origins",
      "P",
      "original",
      "ISS-one",
      "fixed-page-two",
    ]);
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining("issue_origin_cursor=fixed-page-two"),
    );
    hooks.data = page([makeOrigin("two", "update")]);
    find(render(), Checkbox).onChange({ target: { checked: true } });
    expect(selected).toEqual(["event:one", "event:two"]);
    const link = button("openReceipt").href;
    expect(new URLSearchParams(link.split("?")[1]).get("event_receipt")).toBe(
      "receipt-two",
    );
    expect(new URLSearchParams(link.split("?")[1]).get("issue_return")).toBe(
      location.hash,
    );
    expect(link).not.toContain("untrusted.example");
    expect(find(render(), "a")).toBeUndefined();
  });
  it("cannot select an unavailable origin or exceed 32 selected items including the issue", () => {
    const checkbox = find(render({ count: 32 }), Checkbox);
    expect(checkbox.disabled).toBe(true);
    checkbox.onChange({ target: { checked: true } });
    expect(onSelection).not.toHaveBeenCalled();
    hooks.data.items[0].available = false;
    const unavailable = find(render(), Checkbox);
    expect(unavailable.disabled).toBe(true);
    unavailable.onChange({ target: { checked: true } });
    expect(onSelection).not.toHaveBeenCalled();
    expect(button("openReceipt")).toBeUndefined();
  });
  it("hides stale origins and notifies the draft after a 403 or 404", async () => {
    render();
    for (const status of [403, 404]) {
      vi.mocked(fetchIssueOrigins).mockRejectedValueOnce(
        new Error(`HTTP ${status}: denied`),
      );
      await expect(
        hooks.options.queryFn({ signal: new AbortController().signal }),
      ).rejects.toThrow();
    }
    expect(onUnavailable).toHaveBeenCalledTimes(2);
    hooks.error = new Error("HTTP 403: revoked");
    expect(find(render(), Checkbox)).toBeUndefined();
    expect(button("openReceipt")).toBeUndefined();
    expect(find(render(), Alert)).toBeDefined();
  });
  it("does not publish a late page or act on an old callback after the session changes", async () => {
    render();
    let resolve!: (value: IssueOriginPage) => void;
    vi.mocked(fetchIssueOrigins).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const reading = hooks.options.queryFn({
      signal: new AbortController().signal,
    });
    const oldSelect = find(render(), Checkbox).onChange;
    hooks.scope = "new-session-revision";
    oldSelect({ target: { checked: true } });
    resolve(page([makeOrigin("late")]));
    await expect(reading).rejects.toThrow("scopeChanged");
    expect(onSelection).not.toHaveBeenCalled();
    expect(button("openReceipt")).toBeUndefined();
  });
  it("keeps loading and empty states independent from the problem body", () => {
    hooks.data = null;
    hooks.pending = true;
    expect(find(render(), Skeleton)).toBeDefined();
    hooks.pending = false;
    hooks.data = page([]);
    expect(find(render(), Empty)).toBeDefined();
    expect(button("next").disabled).toBe(true);
  });
});
