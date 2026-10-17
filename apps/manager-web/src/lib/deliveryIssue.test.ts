import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  diagnosisHistoryRequest,
  fetchDeliveryIssue,
  fetchIssueDiagnosis,
  issueEvidenceHref,
  issueHref,
  issueProblem,
  prepareDiagnosisGeneration,
  prepareIssueDismissal,
  prepareIssueReview,
  submitIssueReview,
  type IssueDetail,
} from "./deliveryIssue";
import { diagnosisFixture } from "./deliveryIssueFixtures";

vi.mock("./http", () => ({ request: vi.fn() }));
const basis = "a".repeat(64);
const detail = {
  project_id: "P",
  version: 7,
  issue_basis: basis,
  issue: { id: "ISS-one", title: "Actual failure" },
  requirement_id: null,
  evidence: [
    {
      id: "issue:ISS-one",
      kind: "issue",
      restricted: false,
      missing: false,
      excerpt: "Public issue",
    },
    {
      id: "node:R:one",
      kind: "node",
      restricted: false,
      missing: false,
      excerpt: "redacted log",
      redacted: true,
    },
    {
      id: "execution:private",
      kind: "execution",
      restricted: true,
      missing: false,
    },
  ],
  permissions: { can_generate: true, can_adopt: true, can_dismiss: true },
} as IssueDetail;
beforeEach(() => vi.mocked(request).mockReset());

describe("fixed issue diagnosis intent", () => {
  it("allows server-authorized dismissal after runtime access is lost while still refusing adoption", () => {
    const restricted = {
      ...diagnosisFixture,
      restricted: true,
      current: false,
      status: "generating" as const,
      snapshot: null,
      result: null,
      actions: { can_adopt: false, can_dismiss: true, reasons: [] },
    };
    const comment = "Abandon unreadable pending proposal";
    const direct = prepareIssueDismissal(
      "P",
      restricted,
      7,
      comment,
      undefined,
      () => "original-dismiss-key",
    );
    expect(direct).toMatchObject({
      action: "issue.diagnosis.dismiss",
      expected_version: 7,
      payload: { diagnosis_id: restricted.id, comment },
    });
    const form = { ...diagnosisFixture.result!.requirement, comment };
    expect(prepareIssueReview(detail, restricted, "dismiss", form).action).toBe(
      "issue.diagnosis.dismiss",
    );
    expect(() =>
      prepareIssueReview(
        detail,
        {
          ...restricted,
          status: "succeeded",
          current: true,
          actions: { ...restricted.actions, can_adopt: true },
        },
        "adopt",
        form,
      ),
    ).toThrow();
    expect(() =>
      prepareIssueDismissal(
        "P",
        {
          ...restricted,
          actions: { ...restricted.actions, can_dismiss: false },
        },
        7,
        comment,
      ),
    ).toThrow();
  });
  it("requires explicit evidence including this issue and excludes restricted or invented sources", () => {
    const form = {
      generator: "rules" as const,
      selected_evidence_ids: ["node:R:one", "issue:ISS-one"],
      instructions: " Inspect failed exit ",
    };
    const first = prepareDiagnosisGeneration(
      detail,
      form,
      undefined,
      false,
      () => "request-original",
    );
    expect(first.body).toEqual({
      expected_version: 7,
      issue_basis: basis,
      generator: "rules",
      selected_evidence_ids: ["issue:ISS-one", "node:R:one"],
      instructions: "Inspect failed exit",
      idempotency_key: "request-original",
    });
    expect(first.evidence.map((item) => item.id)).toEqual([
      "issue:ISS-one",
      "node:R:one",
    ]);
    expect(
      prepareDiagnosisGeneration(detail, form, first, false, () => "never-new")
        .body,
    ).toEqual(first.body);
    expect(
      prepareDiagnosisGeneration(
        detail,
        form,
        first,
        true,
        () => "explicit-new",
      ).body.idempotency_key,
    ).toBe("explicit-new");
    for (const selected_evidence_ids of [
      [],
      ["node:R:one"],
      ["issue:ISS-one", "execution:private"],
      ["issue:ISS-one", "fake"],
      ["issue:ISS-one", "issue:ISS-one"],
    ])
      expect(() =>
        prepareDiagnosisGeneration(detail, { ...form, selected_evidence_ids }),
      ).toThrow();
    detail.evidence[1].excerpt = "later result";
    expect(first.evidence[1].excerpt).toBe("redacted log");
  });
  it("binds human edited adoption to the exact successful current proposal and preserves the original command", () => {
    const diagnosis = {
      id: "D-one",
      issue_id: "ISS-one",
      issue_basis: basis,
      current: true,
      restricted: false,
      status: "succeeded",
      actions: { can_adopt: true, can_dismiss: true, reasons: [] },
    } as any;
    const edit = {
      comment: " Human checked ",
      title: "Fix actual failure",
      description: "Edited scope",
      priority: "P1" as const,
      acceptance_criteria: ["Actual test passes"],
    };
    const first = prepareIssueReview(
      detail,
      diagnosis,
      "adopt",
      edit,
      undefined,
      () => "adoption-original",
    );
    expect(first).toMatchObject({
      action: "issue.diagnosis.adopt",
      expected_version: 7,
      idempotency_key: "adoption-original",
      payload: {
        issue_id: "ISS-one",
        diagnosis_id: "D-one",
        issue_basis: basis,
        comment: "Human checked",
        title: edit.title,
      },
    });
    expect(
      prepareIssueReview(
        detail,
        diagnosis,
        "adopt",
        edit,
        first,
        () => "unused",
      ),
    ).toEqual(first);
    expect(() =>
      prepareIssueReview(
        detail,
        { ...diagnosis, issue_basis: "b".repeat(64) },
        "adopt",
        edit,
      ),
    ).toThrow();
    expect(() =>
      prepareIssueReview(
        detail,
        { ...diagnosis, restricted: true },
        "adopt",
        edit,
      ),
    ).toThrow();
    expect(() =>
      prepareIssueReview(detail, diagnosis, "adopt", { ...edit, comment: " " }),
    ).toThrow();
    expect(() =>
      prepareIssueReview(
        detail,
        { ...diagnosis, actions: { can_adopt: false } },
        "adopt",
        edit,
      ),
    ).toThrow();
  });
  it("distinguishes evidence changes, confirmed conflicts and unknown submissions", () => {
    expect(
      issueProblem(
        new Error(
          'HTTP 409: {"detail":{"code":"issue_basis_changed","message":"Source changed"}}',
        ),
      ),
    ).toMatchObject({ conflict: true, stale: true, unknown: false });
    expect(issueProblem(new Error("network disconnected"))).toMatchObject({
      unknown: true,
      conflict: false,
    });
    expect(issueProblem(new Error("HTTP 403: forbidden")).unknown).toBe(false);
  });
});

describe("exact project issue API and recovery", () => {
  it("reads one exact diagnosis independently from a missing business issue", async () => {
    await fetchIssueDiagnosis("P", "ISS-deleted", "d".repeat(64));
    expect(vi.mocked(request).mock.calls[0][0]).toBe(
      `/api/v1/delivery/issues/ISS-deleted/diagnoses/${"d".repeat(64)}`,
    );
    expect(vi.mocked(request).mock.calls[0][1]?.method).toBeUndefined();
  });
  it("pins project identity and the reviewed command without interpreting source text", async () => {
    await fetchDeliveryIssue("P", "ISS &1");
    expect(vi.mocked(request).mock.calls[0]).toEqual([
      "/api/v1/delivery/issues/ISS%20%261",
      {
        signal: undefined,
        headers: {
          "X-Project-Id": "P",
          "X-Project-Code": "P",
          "X-Business-Code": "",
        },
      },
    ]);
    const command = {
      action: "issue.diagnosis.dismiss" as const,
      payload: {
        issue_id: "ISS-one",
        diagnosis_id: "D-one",
        issue_basis: basis,
        comment: "Cancel proposal only",
      },
      expected_version: 7,
      idempotency_key: "dismiss-original",
    };
    await submitIssueReview("P", command);
    expect(
      JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body)),
    ).toEqual(command);
    expect(() => fetchDeliveryIssue("", "ISS-one")).toThrow();
    expect(() => fetchDeliveryIssue("P", "")).toThrow();
  });
  it("recovers the exact original request across history pages using reads only", async () => {
    vi.mocked(request)
      .mockResolvedValueOnce({
        project_id: "P",
        issue_id: "ISS-one",
        items: [{ request_key: "other", id: "other" }],
        next_cursor: "next",
      })
      .mockResolvedValueOnce({
        project_id: "P",
        issue_id: "ISS-one",
        items: [{ request_key: "original", id: "D-original" }],
        next_cursor: null,
      });
    expect(
      await diagnosisHistoryRequest("P", "ISS-one", "original"),
    ).toMatchObject({ id: "D-original" });
    expect(vi.mocked(request).mock.calls).toHaveLength(2);
    expect(
      vi.mocked(request).mock.calls.every(([, init]) => !init?.method),
    ).toBe(true);
    expect(vi.mocked(request).mock.calls[1][0]).toContain("cursor=next");
    vi.mocked(request)
      .mockReset()
      .mockResolvedValue({
        project_id: "other",
        issue_id: "ISS-one",
        items: [{ request_key: "original" }],
      });
    await expect(
      diagnosisHistoryRequest("P", "ISS-one", "original"),
    ).rejects.toThrow();
  });
  it("keeps project and bounded return context on issue, requirement and independent task links", () => {
    const background =
      "#/dev-flow?view=releases&project_id=P&deployment_id=DEP-one";
    const href = issueHref("P", "ISS-one", background, "D-one");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("project_id")).toBe("P");
    expect(params.get("issue")).toBe("ISS-one");
    expect(params.get("diagnosis_id")).toBe("D-one");
    expect(params.get("return_to")).toBe(background);
    const target = issueEvidenceHref(
      "P",
      { project_id: "P", view: "list", detail: "tasks", task_id: "T-alone" },
      href,
    );
    expect(target).toContain("#/tasks/execution?");
    expect(new URLSearchParams(target!.split("?")[1]).get("task_id")).toBe(
      "T-alone",
    );
    expect(
      issueEvidenceHref("P", { project_id: "another", task_id: "T-one" }, href),
    ).toBeNull();
    expect(issueHref("P", "ISS-one", "https://evil.example")).not.toContain(
      "return_to",
    );
    const nodeLink = issueEvidenceHref(
      "P",
      {
        project_id: "P",
        execution_id: "E-one",
        node_id: "tests",
        attempt: 2,
      },
      href,
    );
    const nodeParams = new URLSearchParams(nodeLink!.split("?")[1]);
    expect(nodeParams.get("execution_node")).toBe("tests");
    expect(nodeParams.get("execution_attempt")).toBe("2");
    expect(nodeParams.get("execution_stream")).toBe("stdout");
    expect(nodeParams.get("return_to")).toBe(href);
    expect(
      issueEvidenceHref(
        "P",
        {
          project_id: "P",
          execution_id: "E-one",
          node_id: "tests",
          attempt: 0,
        },
        href,
      ),
    ).toBeNull();
  });
});
