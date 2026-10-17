import { describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  adoptManualReviewBasis,
  fetchTaskReviews,
  manualReviewError,
  manualReviewProblems,
  manualTaskHref,
  openManualReview,
  prepareManualReview,
  type TaskReviewPage,
} from "./deliveryTaskReview";

vi.mock("./http", () => ({ request: vi.fn() }));

export const reviewPage = (
  basis = "original",
  version = 7,
): TaskReviewPage => ({
  project_id: "project-one",
  task_id: "T-standalone",
  version,
  as_of: "2026-10-17T01:00:00Z",
  current: {
    task: {
      id: "T-standalone",
      title: "Reviewed implementation",
      description: "Original task scope",
      req_id: "",
      status: "completed",
      assigned_to: "user:one",
      priority: "P1",
      estimate: "M",
      blocked_reason: "",
      acceptance_criteria: [],
    },
    basis,
    owner: { id: "user:one", name: "One", kind: "human", active: true },
    requirement: null,
    planning: { requirement_criteria_indices: [], depends_on: [] },
    acceptance: { criteria: [], sources: [], available: true, requirement_id: null, requirement_revision: null },
    eligible: true,
    can_review: true,
    can_accept: true,
    reasons: [],
    dependency_blocked: [],
    verified: false,
    dependency_basis: {},
  },
  reviews: [],
  total: 0,
  next_cursor: null,
  limit: 20,
});

describe("manual delivery review", () => {
  it("links to the exact current task with or without a requirement", () => {
    expect(manualTaskHref({ id: "T-one", req_id: "REQ-one" })).toBe(
      "#/dev-flow?view=list&requirement=REQ-one&detail=tasks&task=T-one",
    );
    expect(manualTaskHref({ id: "T-alone", req_id: "" })).toBe(
      "#/tasks/execution?task_id=T-alone",
    );
  });
  it("reads exact task history in the explicit project and preserves cursor and abort", async () => {
    const signal = new AbortController().signal;
    vi.mocked(request).mockResolvedValueOnce(reviewPage());
    const result = await fetchTaskReviews("project-one", "T-standalone", {
      cursor: "review:older",
      limit: 10,
      signal,
    });
    expect(result.current?.task.id).toBe("T-standalone");
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/tasks/T-standalone/reviews?limit=10&cursor=review%3Aolder",
      { headers: { "X-Project-Id": "project-one" }, signal },
    );
    for (const id of ["../foreign", "a/b", " T-one", "a?scope=other", ""]) {
      await expect(fetchTaskReviews("project-one", id)).rejects.toThrow();
    }
    await expect(fetchTaskReviews("", "T-one")).rejects.toThrow();
    await expect(
      fetchTaskReviews("project-one", "T-one", { limit: 101 }),
    ).rejects.toThrow();
  });

  it("pins the initial task and version across mutable query data and retries", () => {
    const data = reviewPage();
    const opened = openManualReview(data, "same-intent");
    data.version = 99;
    data.current!.basis = "new-basis";
    data.current!.task.title = "Changed scope";
    const drafted = {
      ...opened,
      comment: " Checked ",
      evidenceContent: " Manual test ",
      evidenceUrl: "",
    };
    const first = prepareManualReview(drafted);
    const retried = prepareManualReview(first.session);
    expect(first.command).toEqual({
      action: "task.manual_review",
      expected_version: 7,
      idempotency_key: "same-intent",
      payload: {
        task_id: "T-standalone",
        decision: "accept",
        basis: "original",
        comment: "Checked",
        evidence_content: "Manual test",
        evidence_url: "",
      },
    });
    expect(retried.command).toEqual(first.command);
    expect(first.session.current.task.title).toBe("Reviewed implementation");
    const edited = prepareManualReview({
      ...first.session,
      comment: "New decision",
    });
    expect(edited.command.idempotency_key).not.toBe(
      first.command.idempotency_key,
    );
  });

  it("keeps the written evidence while explicitly adopting new facts and a fresh intent", () => {
    const draft = {
      ...openManualReview(reviewPage(), "old-key"),
      comment: "Keep my review",
      evidenceContent: "Original evidence",
      evidenceUrl: "https://example.test/evidence",
    };
    const latest = reviewPage("latest", 11);
    latest.current!.task.description = "New scope";
    const adopted = adoptManualReviewBasis(draft, latest, "new-key");
    expect(adopted).toMatchObject({
      version: 11,
      comment: "Keep my review",
      evidenceContent: "Original evidence",
      evidenceUrl: "https://example.test/evidence",
      current: { basis: "latest", task: { description: "New scope" } },
    });
    expect(prepareManualReview(adopted).command.idempotency_key).toBe(
      "new-key",
    );
    expect(() =>
      adoptManualReviewBasis(draft, { ...latest, task_id: "other" }, "no"),
    ).toThrow();
    expect(() =>
      adoptManualReviewBasis(draft, { ...latest, current: null }, "no"),
    ).toThrow();
  });

  it("requires a comment and explicit evidence to accept without inventing tests", () => {
    const draft = openManualReview(reviewPage(), "review");
    expect(manualReviewProblems(draft)).toEqual([
      "commentRequired",
      "evidenceRequired",
    ]);
    expect(
      manualReviewProblems({
        ...draft,
        comment: "Explain",
        decision: "request_changes",
      }),
    ).toEqual([]);
    expect(
      manualReviewProblems({
        ...draft,
        comment: "Checked",
        evidenceUrl: "https://example.test/report",
      }),
    ).toEqual([]);
    for (const evidenceUrl of [
      "javascript:alert(1)",
      "https://user:secret@example.test",
      "file:///D:/proof.txt",
      "invalid",
    ]) {
      expect(
        manualReviewProblems({ ...draft, comment: "Checked", evidenceUrl }),
      ).toContain("unsafeUrl");
    }
    expect(
      manualReviewProblems({
        ...draft,
        comment: "Checked",
        evidenceContent: "Actual manual notes",
        current: { ...draft.current, can_accept: false },
      }),
    ).toContain("cannotAccept");
  });

  it("offers explicit conflict recovery only for changed facts or versions", () => {
    const error = (code: string, status = 409) =>
      new Error(
        `HTTP ${status}: ${JSON.stringify({ detail: { code, message: "Visible reason" } })}`,
      );
    expect(manualReviewError(error("task_review_basis_changed"))).toEqual({
      code: "task_review_basis_changed",
      message: "Visible reason",
      conflict: true,
    });
    expect(
      manualReviewError(error("task_review_basis_changed", 422)).conflict,
    ).toBe(false);
    for (const code of [
      "task_dependencies_blocked",
      "manual_review_ineligible",
      "idempotency_key_reused",
    ])
      expect(manualReviewError(error(code)).conflict).toBe(false);
    expect(
      manualReviewError(
        new Error('HTTP 409: {"detail":"Project changed. Reload."}'),
      ).conflict,
    ).toBe(true);
  });
});
