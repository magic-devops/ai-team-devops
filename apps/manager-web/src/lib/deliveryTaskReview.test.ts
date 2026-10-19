import { describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  adoptManualReviewBasis,
  fetchTaskReviews,
  fetchTaskReviewCurrent,
  fetchTaskReviewOriginal,
  manualReviewError,
  manualReviewProblems,
  manualTaskHref,
  openManualReview,
  prepareManualReview,
  type TaskReviewCurrentResponse,
} from "./deliveryTaskReview";

vi.mock("./http", () => ({ request: vi.fn() }));

export const reviewPage = (
  basis = "original",
  version = 7,
): TaskReviewCurrentResponse => ({
  project_id: "project-one",
  task_id: "T-standalone",
  version,
  query_generation: 7,
  effective_review_id: null,
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
    acceptance: {
      criteria: [],
      sources: [],
      available: true,
      requirement_id: null,
      requirement_revision: null,
    },
    eligible: true,
    can_review: true,
    can_accept: true,
    reasons: [],
    dependency_blocked: [],
    verified: false,
    dependency_basis: {},
  },
});

describe("manual delivery review", () => {
  it("rejects another project's review response before it can open a write", async () => {
    vi.mocked(request).mockResolvedValueOnce({
      ...reviewPage(),
      project_id: "another-project",
    });
    await expect(
      fetchTaskReviews("project-one", "T-standalone"),
    ).rejects.toThrow("reviewScopeChanged");
  });
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
    vi.mocked(request).mockResolvedValueOnce({
      project_id: "project-one",
      task_id: "T-standalone",
      as_of: "now",
      reviews: [],
      total: 0,
      next_cursor: null,
      limit: 10,
    });
    const result = await fetchTaskReviews("project-one", "T-standalone", {
      cursor: "review:older",
      limit: 10,
      signal,
    });
    expect(result.total).toBe(0);
    expect(result).not.toHaveProperty("current");
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
  it("reads current proof and exact original through independent scope-checked routes", async () => {
    vi.mocked(request).mockResolvedValueOnce(reviewPage());
    expect(
      (await fetchTaskReviewCurrent("project-one", "T-standalone"))
        .query_generation,
    ).toBe(7);
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/tasks/T-standalone/review-current",
      { headers: { "X-Project-Id": "project-one" }, signal: undefined },
    );
    const original = {
      project_id: "project-one",
      task_id: "T-standalone",
      as_of: "now",
      review: {
        id: "review-one",
        task_id: "T-standalone",
        snapshot: { task: { id: "T-standalone" } },
      },
    };
    vi.mocked(request).mockResolvedValueOnce(original);
    expect(
      await fetchTaskReviewOriginal(
        "project-one",
        "T-standalone",
        "review-one",
      ),
    ).toEqual(original);
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/tasks/T-standalone/reviews/review-one",
      { headers: { "X-Project-Id": "project-one" }, signal: undefined },
    );
    vi.mocked(request).mockResolvedValueOnce({
      ...reviewPage(),
      query_generation: 0,
    });
    await expect(
      fetchTaskReviewCurrent("project-one", "T-standalone"),
    ).rejects.toThrow("reviewResponseInvalid");
    vi.mocked(request).mockResolvedValueOnce({
      ...original,
      review: { ...original.review, id: "wrong" },
    });
    await expect(
      fetchTaskReviewOriginal("project-one", "T-standalone", "review-one"),
    ).rejects.toThrow("reviewScopeChanged");
    await expect(
      fetchTaskReviewOriginal("project-one", "T-standalone", "../bad"),
    ).rejects.toThrow();
    await expect(
      fetchTaskReviews("project-one", "T-standalone", {
        cursor: "a".repeat(4001),
      }),
    ).rejects.toThrow();
  });
  it.each([
    { query_generation: null },
    { query_generation: 0 },
    { query_generation: 1.5 },
    { current: null },
  ])("rejects an incomplete current proof: %j", async (patch) => {
    vi.mocked(request).mockResolvedValueOnce({ ...reviewPage(), ...patch });
    await expect(
      fetchTaskReviewCurrent("project-one", "T-standalone"),
    ).rejects.toThrow("reviewResponseInvalid");
  });
  it("accepts 240 Unicode code points in a history summary and rejects 241", async () => {
    const row = {
      id: "review-one",
      task_id: "T-standalone",
      comment_summary: "😀".repeat(240),
      has_evidence: true,
    };
    const page = {
      project_id: "project-one",
      task_id: "T-standalone",
      as_of: "now",
      reviews: [row],
      total: 1,
      next_cursor: null,
      limit: 20,
    };
    vi.mocked(request).mockResolvedValueOnce(page);
    expect(
      (await fetchTaskReviews("project-one", "T-standalone")).reviews[0]
        .comment_summary,
    ).toBe("😀".repeat(240));
    vi.mocked(request).mockResolvedValueOnce({
      ...page,
      reviews: [{ ...row, comment_summary: "😀".repeat(241) }],
    });
    await expect(
      fetchTaskReviews("project-one", "T-standalone"),
    ).rejects.toThrow("reviewResponseInvalid");
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
      adoptManualReviewBasis(
        draft,
        { ...latest, current: null } as unknown as TaskReviewCurrentResponse,
        "no",
      ),
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
