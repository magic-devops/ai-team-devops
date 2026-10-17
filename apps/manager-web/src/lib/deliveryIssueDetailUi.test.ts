import { isValidElement, type ReactNode } from "react";
import { Button, Drawer, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryIssueDetail,
  IssueDetailContent,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueDetail";
import { DeliveryIssueWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueWorkbench";
import { IssueProposalFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueFacts";
import { IssueReviewPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueReview";
import { fetchIssueDiagnosisHistory } from "./deliveryIssue";
import { diagnosisFixture, issueDetailFixture } from "./deliveryIssueFixtures";
import type { DeliveryCommandAck, DeliveryDisplayContext, DeliveryWorkspace } from "./delivery";
const hooks = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  data: null as any,
  exact: null as any,
  error: false,
  outgoing: "",
  scope: "original",
  invalidated: [] as unknown[],
  detailReads: 0,
  exactReads: 0,
  issueRows: [] as DeliveryWorkspace["issues"],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => undefined,
  useState: (initial: any) => {
    const i = hooks.next++;
    if (!(i in hooks.state))
      hooks.state[i] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.state[i],
      (value: any) => {
        hooks.state[i] =
          typeof value === "function" ? value(hooks.state[i]) : value;
      },
    ];
  },
  useRef: (value: any) => {
    const i = hooks.refNext++;
    return (hooks.refs[i] ||= { current: value });
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
    data:
      options.queryKey[0] === "delivery-issues-page"
        ? { items: hooks.issueRows.filter((row) => options.queryKey[6] === "all" || row.source_kinds?.includes(options.queryKey[6])), total: hooks.issueRows.length, next_cursor: null }
        : options.queryKey[0] === "delivery-issue-diagnosis"
        ? hooks.exact
        : hooks.data,
    isPending: false,
    isError: hooks.error,
    isFetching: false,
    refetch: () => {
      if (options.queryKey[0] === "delivery-issue-diagnosis")
        hooks.exactReads += 1;
      else hooks.detailReads += 1;
    },
  }),
  useQueryClient: () => ({
    invalidateQueries: (input: unknown) => {
      hooks.invalidated.push(input);
    },
  }),
}));
vi.mock("./useDrawerIdentity", () => ({
  useDrawerIdentity: (_scope: string, id: string) => ({
    displayId: id || hooks.outgoing,
    afterOpenChange: vi.fn(),
  }),
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
  fetchIssueDiagnosisHistory: vi.fn(),
}));
function find(
  node: ReactNode,
  type: unknown,
  predicate: (props: any) => boolean = () => true,
): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(node.props.description, type, predicate)
  );
}
const resetHooks = () => {
  hooks.next = 0;
  hooks.refNext = 0;
};
const onSaved = vi.fn(),
  onClose = vi.fn(),
  onOpenIssue = vi.fn();
beforeEach(() => {
  hooks.state = [];
  hooks.refs = [];
  hooks.outgoing = "";
  hooks.error = false;
  hooks.exact = null;
  hooks.scope = "original";
  hooks.invalidated = [];
  hooks.detailReads = 0;
  hooks.exactReads = 0;
  hooks.issueRows = [];
  hooks.data = structuredClone(issueDetailFixture);
  resetHooks();
  vi.stubGlobal("location", {
    hash: "#/dev-flow?view=issues&issue=ISS-one&project_id=P",
  });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  onClose.mockReset();
  onOpenIssue.mockReset();
  vi.mocked(fetchIssueDiagnosisHistory).mockReset();
});
const wrapper = (issueId = "ISS-one") => {
  resetHooks();
  return DeliveryIssueDetail({
    projectId: "P",
    sessionId: "session",
    issueId,
    background: location.hash,
    readOnly: false,
    onSaved,
    onClose,
  });
};
const content = (diagnosisId = "") => {
  resetHooks();
  return IssueDetailContent({
    projectId: "P",
    sessionId: "session",
    issueId: "ISS-one",
    initialDiagnosisId: diagnosisId,
    background: location.hash,
    readOnly: false,
    onSaved,
  });
};

describe("exact issue detail and retained identity", () => {
  it("invalidates the exact orphan proposal after dismissal and refreshes its own record explicitly", () => {
    hooks.data = null;
    hooks.exact = {
      ...diagnosisFixture,
      current: false,
      status: "generating",
      actions: { can_adopt: false, can_dismiss: true, reasons: [] },
    };
    find(content(diagnosisFixture.id), IssueReviewPanel).onSaved({
      project_id: "P",
      action: "issue.diagnosis.dismiss",
      resource: { kind: "diagnosis", id: diagnosisFixture.id },
      result: null,
      affected_refs: [],
      applied_version: 8,
      version: 8,
      query_generation: 3,
      replayed: false,
    } as DeliveryCommandAck);
    expect(hooks.invalidated).toContainEqual({
      queryKey: ["delivery-issue-diagnosis", "P", "session", "ISS-one"],
    });
    find(
      content(diagnosisFixture.id),
      Button,
      (props) => props.children === "deliveryIssue.refresh",
    ).onClick();
    expect(hooks.exactReads).toBe(1);
    expect(hooks.detailReads).toBe(2);
  });
  it("retains an exact orphan proposal as historical and offers no invented current issue", () => {
    hooks.data = null;
    hooks.exact = {
      ...diagnosisFixture,
      current: false,
      status: "generating",
      actions: { can_adopt: false, can_dismiss: true, reasons: [] },
    };
    const review = find(content(diagnosisFixture.id), IssueReviewPanel);
    expect(review).toBeDefined();
    expect(review.detail).toBeNull();
    expect(review.diagnosis.id).toBe(diagnosisFixture.id);
  });
  it("keeps the exact chosen proposal in the URL without losing the previous work context", () => {
    hooks.data.diagnoses = [diagnosisFixture];
    find(
      content(),
      Button,
      (props) => props.className === "issue-history-trigger",
    ).onClick();
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining(`diagnosis_id=${diagnosisFixture.id}`),
    );
  });
  it("blocks close, backdrop and Escape during a live or unknown submission", () => {
    find(wrapper(), IssueDetailContent).onBusyChange(true);
    const blocked = find(wrapper(), Drawer);
    expect(blocked.maskClosable).toBe(false);
    expect(blocked.keyboard).toBe(false);
    blocked.onClose();
    expect(onClose).not.toHaveBeenCalled();
    find(wrapper(), IssueDetailContent).onBusyChange(false);
    find(wrapper(), IssueDetailContent).onUnresolvedChange(true);
    find(wrapper(), Drawer).onClose();
    expect(onClose).not.toHaveBeenCalled();
    find(wrapper(), IssueDetailContent).onUnresolvedChange(false);
    find(wrapper(), Drawer).onClose();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("keeps the outgoing issue identity during the close transition", () => {
    hooks.outgoing = "ISS-one";
    expect(find(wrapper(""), IssueDetailContent).issueId).toBe("ISS-one");
  });
  it("never substitutes the first proposal for an unavailable deep link or stale project read", () => {
    hooks.data.diagnoses = [structuredClone(diagnosisFixture)];
    expect(
      find(content("unknown-diagnosis"), IssueProposalFacts),
    ).toBeUndefined();
    expect(
      find(content("unknown-diagnosis"), IssueReviewPanel),
    ).toBeUndefined();
    hooks.data.project_id = "other";
    expect(
      find(content(diagnosisFixture.id), IssueReviewPanel),
    ).toBeUndefined();
  });
  it("finds an explicitly selected historical proposal only after its actual history page loads", async () => {
    hooks.data.next_cursor = "older-page";
    vi.mocked(fetchIssueDiagnosisHistory).mockResolvedValueOnce({
      project_id: "P",
      issue_id: "ISS-one",
      issue_basis: issueDetailFixture.issue_basis,
      items: [diagnosisFixture],
      next_cursor: null,
    });
    expect(
      find(content(diagnosisFixture.id), IssueProposalFacts),
    ).toBeUndefined();
    await find(
      content(diagnosisFixture.id),
      Button,
      (props) => props.children === "deliveryIssue.moreHistory",
    ).onClick();
    expect(
      find(content(diagnosisFixture.id), IssueProposalFacts).diagnosis.id,
    ).toBe(diagnosisFixture.id);
  });
});

describe("actionable issue queue", () => {
  it("filters real source kinds and opens the exact issue instead of a generic task list", () => {
    hooks.issueRows = [
        {
          id: "ISS-one",
          title: "Deployment problem",
          status: "open",
          severity: "P1",
          source_kinds: ["deployment"],
          task_id: "",
        },
        {
          id: "ISS-two",
          title: "Execution problem",
          status: "open",
          severity: "P2",
          source_kinds: ["execution"],
          task_id: "T-two",
        },
      ] as DeliveryWorkspace["issues"];
    const workspace = { project: { id: "P" } } as unknown as DeliveryDisplayContext;
    const render = () => {
      resetHooks();
      return DeliveryIssueWorkbench({
        workspace,
        projectId: "P",
        sessionId: "session",
        issueId: "",
        background: location.hash,
        readOnly: false,
        onSaved,
        onOpenIssue,
        onCloseIssue: onClose,
      });
    };
    find(
      render(),
      Select,
      (props) => props["aria-label"] === "deliveryIssue.sourceFilter",
    ).onChange("execution");
    expect(
      find(render(), Button, (props) => props["data-issue-id"] === "ISS-one"),
    ).toBeUndefined();
    find(
      render(),
      Button,
      (props) => props["data-issue-id"] === "ISS-two",
    ).onClick();
    expect(onOpenIssue).toHaveBeenCalledWith("ISS-two");
  });
});
