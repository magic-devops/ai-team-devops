import { isValidElement, type ReactNode } from "react";
import { Button, Checkbox, Input, Radio } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDiagnosisPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueDiagnosis";
import { IssueReviewPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueReview";
import { diagnosisFixture, issueDetailFixture } from "./deliveryIssueFixtures";
import {
  diagnosisHistoryRequest,
  fetchDeliveryIssue,
  fetchIssueDiagnosis,
  generateIssueDiagnosis,
  submitIssueReview,
} from "./deliveryIssue";
const hooks = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  scope: "original",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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
  generateIssueDiagnosis: vi.fn(),
  diagnosisHistoryRequest: vi.fn(),
  fetchDeliveryIssue: vi.fn(),
  fetchIssueDiagnosis: vi.fn(),
  submitIssueReview: vi.fn(),
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
    find(node.props.description, type, predicate) ||
    find(node.props.action, type, predicate)
  );
}
const onGenerated = vi.fn(),
  onSaved = vi.fn(),
  onBusyChange = vi.fn(),
  onUnresolvedChange = vi.fn();
let detail = structuredClone(issueDetailFixture);
function diagnosis() {
  hooks.next = 0;
  hooks.refNext = 0;
  return IssueDiagnosisPanel({
    detail,
    projectId: "P",
    readOnly: false,
    onGenerated,
    onBusyChange,
    onUnresolvedChange,
  });
}
function review(orphan = false, restricted = false) {
  hooks.next = 0;
  hooks.refNext = 0;
  return IssueReviewPanel({
    detail: orphan ? null : detail,
    workspaceVersion: 11,
    diagnosis:
      orphan || restricted
        ? {
            ...structuredClone(diagnosisFixture),
            current: false,
            status: "generating",
            restricted,
            snapshot: restricted ? null : diagnosisFixture.snapshot,
            result: restricted ? null : diagnosisFixture.result,
            actions: { can_adopt: false, can_dismiss: true, reasons: [] },
          }
        : structuredClone(diagnosisFixture),
    projectId: "P",
    background: "#/dev-flow?view=issues&issue=ISS-one&project_id=P",
    readOnly: false,
    onSaved,
    onBusyChange,
    onUnresolvedChange,
  });
}
const button = (render: () => ReactNode, name: string) =>
  find(render(), Button, (props) => props.children === `deliveryIssue.${name}`);
beforeEach(() => {
  hooks.state = [];
  hooks.refs = [];
  hooks.next = 0;
  hooks.refNext = 0;
  hooks.scope = "original";
  detail = structuredClone(issueDetailFixture);
  onGenerated.mockReset();
  onSaved.mockReset();
  onBusyChange.mockReset();
  onUnresolvedChange.mockReset();
  vi.mocked(generateIssueDiagnosis)
    .mockReset()
    .mockResolvedValue(structuredClone(diagnosisFixture));
  vi.mocked(diagnosisHistoryRequest).mockReset();
  vi.mocked(fetchDeliveryIssue).mockReset();
  vi.mocked(fetchIssueDiagnosis)
    .mockReset()
    .mockResolvedValue(structuredClone(diagnosisFixture));
  vi.mocked(submitIssueReview)
    .mockReset()
    .mockImplementation(async (_projectId, command) => ({
      project_id: "P",
      action: command.action,
      resource: { kind: command.action === "issue.diagnosis.adopt" ? "requirement" : "diagnosis", id: command.action === "issue.diagnosis.adopt" ? "REQ-adopted" : diagnosisFixture.id },
      result: command.action === "issue.diagnosis.adopt" ? { requirement_id: "REQ-adopted" } : null,
      affected_refs: [],
      applied_version: command.expected_version + 1,
      version: command.expected_version + 1,
      query_generation: 2,
      replayed: false,
    }));
});

describe("issue diagnosis actual callbacks", () => {
  it("dismisses an unreadable pending proposal using server authority and explicitly rebases after a conflict", async () => {
    const restricted = () => review(false, true);
    expect(button(restricted, "previewAdoption").disabled).toBe(true);
    find(
      restricted(),
      Input.TextArea,
      (props) => props["aria-label"] === "deliveryIssue.comment",
    ).onChange({
      target: {
        value: "Abandon pending diagnosis after runtime access was revoked",
      },
    });
    expect(button(restricted, "previewDismissal").disabled).toBe(false);
    button(restricted, "previewDismissal").onClick();
    vi.mocked(submitIssueReview).mockRejectedValueOnce(
      new Error(
        'HTTP 409: {"detail":{"code":"version_conflict","message":"Changed"}}',
      ),
    );
    await button(restricted, "confirmDismissal").onClick();
    vi.mocked(fetchDeliveryIssue).mockResolvedValueOnce({
      ...detail,
      version: 8,
      diagnoses: [
        {
          ...diagnosisFixture,
          restricted: true,
          current: false,
          status: "generating",
          snapshot: null,
          result: null,
          actions: { can_adopt: false, can_dismiss: true, reasons: [] },
        },
      ],
    });
    vi.mocked(fetchIssueDiagnosis).mockResolvedValueOnce({
      ...diagnosisFixture,
      restricted: true,
      current: false,
      status: "generating",
      snapshot: null,
      result: null,
      actions: { can_adopt: false, can_dismiss: true, reasons: [] },
    });
    await button(restricted, "readLatest").onClick();
    expect(button(restricted, "adoptLatest").disabled).toBe(false);
    button(restricted, "adoptLatest").onClick();
    button(restricted, "previewDismissal").onClick();
    await button(restricted, "confirmDismissal").onClick();
    expect(vi.mocked(submitIssueReview).mock.calls[1][1]).toMatchObject({
      action: "issue.diagnosis.dismiss",
      expected_version: 8,
      payload: {
        comment: "Abandon pending diagnosis after runtime access was revoked",
      },
    });
  });
  it("rebases an exact older proposal beyond the first history page without losing human edits", async () => {
    find(
      review(),
      Input,
      (props) => props["aria-label"] === "deliveryIssue.requirementTitle",
    ).onChange({ target: { value: "Human edited older proposal" } });
    find(
      review(),
      Input.TextArea,
      (props) => props["aria-label"] === "deliveryIssue.comment",
    ).onChange({ target: { value: "Keep the original reviewed evidence" } });
    button(review, "previewAdoption").onClick();
    vi.mocked(submitIssueReview).mockRejectedValueOnce(
      new Error("HTTP 409: Workspace version changed"),
    );
    await button(review, "confirmAdoption").onClick();
    vi.mocked(fetchDeliveryIssue).mockResolvedValueOnce({
      ...detail,
      version: 8,
      diagnoses: [],
    });
    await button(review, "readLatest").onClick();
    expect(fetchIssueDiagnosis).toHaveBeenCalledWith(
      "P",
      "ISS-one",
      diagnosisFixture.id,
    );
    expect(button(review, "adoptLatest").disabled).toBe(false);
    expect(submitIssueReview).toHaveBeenCalledOnce();
    button(review, "adoptLatest").onClick();
    expect(
      find(
        review(),
        Input,
        (props) => props["aria-label"] === "deliveryIssue.requirementTitle",
      ).value,
    ).toBe("Human edited older proposal");
    button(review, "previewAdoption").onClick();
    await button(review, "confirmAdoption").onClick();
    expect(vi.mocked(submitIssueReview).mock.calls[1][1]).toMatchObject({
      expected_version: 8,
      payload: {
        diagnosis_id: diagnosisFixture.id,
        title: "Human edited older proposal",
        comment: "Keep the original reviewed evidence",
      },
    });
  });
  it("can explicitly dismiss a server-authorized orphan proposal without inventing a current issue", async () => {
    const orphan = () => review(true);
    expect(button(orphan, "previewAdoption").disabled).toBe(true);
    find(
      orphan(),
      Input.TextArea,
      (props) => props["aria-label"] === "deliveryIssue.comment",
    ).onChange({
      target: {
        value: "Original issue was deleted; abandon this pending proposal",
      },
    });
    button(orphan, "previewDismissal").onClick();
    await button(orphan, "confirmDismissal").onClick();
    expect(vi.mocked(submitIssueReview).mock.calls[0][1]).toMatchObject({
      action: "issue.diagnosis.dismiss",
      expected_version: 11,
      payload: {
        issue_id: "ISS-one",
        diagnosis_id: diagnosisFixture.id,
        issue_basis: diagnosisFixture.issue_basis,
      },
    });
  });
  it("sends only explicitly selected sanitized evidence with the explicitly chosen generator", async () => {
    expect(button(diagnosis, "generate").disabled).toBe(true);
    find(diagnosis(), Checkbox.Group).onChange([
      "issue:ISS-one",
      "probe:OP-one:1",
    ]);
    find(diagnosis(), Radio.Group).onChange({ target: { value: "rules" } });
    await button(diagnosis, "generate").onClick();
    expect(generateIssueDiagnosis).toHaveBeenCalledOnce();
    expect(vi.mocked(generateIssueDiagnosis).mock.calls[0][2]).toMatchObject({
      generator: "rules",
      selected_evidence_ids: ["issue:ISS-one", "probe:OP-one:1"],
      expected_version: 7,
      issue_basis: detail.issue_basis,
    });
    expect(onGenerated).toHaveBeenCalledOnce();
  });
  it("locks unknown input and recovers by the original request key using only reads", async () => {
    find(diagnosis(), Checkbox.Group).onChange(["issue:ISS-one"]);
    vi.mocked(generateIssueDiagnosis).mockRejectedValueOnce(
      new Error("network interrupted"),
    );
    await button(diagnosis, "generate").onClick();
    const original = vi.mocked(generateIssueDiagnosis).mock.calls[0][2];
    expect(find(diagnosis(), Checkbox.Group).disabled).toBe(true);
    expect(button(diagnosis, "regenerate").disabled).toBe(true);
    vi.mocked(diagnosisHistoryRequest).mockResolvedValueOnce({
      ...diagnosisFixture,
      status: "generating",
      request_key: original.idempotency_key,
    });
    await button(diagnosis, "recoverRequest").onClick();
    expect(diagnosisHistoryRequest).toHaveBeenCalledWith(
      "P",
      "ISS-one",
      original.idempotency_key,
    );
    expect(generateIssueDiagnosis).toHaveBeenCalledOnce();
    expect(onGenerated).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "generating" }),
    );
  });
  it("keeps an unknown original submission locked when a retry loses permission", async () => {
    find(diagnosis(), Checkbox.Group).onChange(["issue:ISS-one"]);
    vi.mocked(generateIssueDiagnosis)
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockRejectedValueOnce(new Error("HTTP 403: permission revoked"));
    await button(diagnosis, "generate").onClick();
    await button(diagnosis, "retryOriginal").onClick();
    expect(find(diagnosis(), Checkbox.Group).disabled).toBe(true);
    expect(onUnresolvedChange).toHaveBeenLastCalledWith(true);
  });
  it("does not publish a late generation response into a changed session", async () => {
    find(diagnosis(), Checkbox.Group).onChange(["issue:ISS-one"]);
    let resolve!: (value: any) => void;
    vi.mocked(generateIssueDiagnosis).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const running = button(diagnosis, "generate").onClick();
    hooks.scope = "another-session";
    resolve(diagnosisFixture);
    await running;
    expect(onGenerated).not.toHaveBeenCalled();
  });
  it("preserves edited requirement and comment on conflict and adopts a new version only explicitly", async () => {
    find(
      review(),
      Input,
      (props) => props["aria-label"] === "deliveryIssue.requirementTitle",
    ).onChange({ target: { value: "Human edited title" } });
    find(
      review(),
      Input.TextArea,
      (props) => props["aria-label"] === "deliveryIssue.comment",
    ).onChange({ target: { value: "Verified actual evidence" } });
    await button(review, "previewAdoption").onClick();
    vi.mocked(submitIssueReview).mockRejectedValueOnce(
      new Error(
        'HTTP 409: {"detail":{"code":"version_conflict","message":"Changed"}}',
      ),
    );
    await button(review, "confirmAdoption").onClick();
    expect(
      find(
        review(),
        Input,
        (props) => props["aria-label"] === "deliveryIssue.requirementTitle",
      ).value,
    ).toBe("Human edited title");
    vi.mocked(fetchDeliveryIssue).mockResolvedValueOnce({
      ...detail,
      version: 8,
      diagnoses: [diagnosisFixture],
    });
    await button(review, "readLatest").onClick();
    expect(submitIssueReview).toHaveBeenCalledOnce();
    button(review, "adoptLatest").onClick();
    await button(review, "previewAdoption").onClick();
    await button(review, "confirmAdoption").onClick();
    expect(vi.mocked(submitIssueReview).mock.calls[1][1]).toMatchObject({
      expected_version: 8,
      payload: {
        title: "Human edited title",
        comment: "Verified actual evidence",
      },
    });
  });
  it("keeps the exact adoption body/key when an unknown response is explicitly retried", async () => {
    find(
      review(),
      Input.TextArea,
      (props) => props["aria-label"] === "deliveryIssue.comment",
    ).onChange({ target: { value: "Reviewed" } });
    button(review, "previewAdoption").onClick();
    vi.mocked(submitIssueReview).mockRejectedValueOnce(
      new Error("network interrupted"),
    );
    await button(review, "confirmAdoption").onClick();
    expect(
      find(
        review(),
        Input,
        (props) => props["aria-label"] === "deliveryIssue.requirementTitle",
      ).disabled,
    ).toBe(true);
    await button(review, "retryOriginal").onClick();
    expect(vi.mocked(submitIssueReview).mock.calls[1][1]).toEqual(
      vi.mocked(submitIssueReview).mock.calls[0][1],
    );
  });
});
