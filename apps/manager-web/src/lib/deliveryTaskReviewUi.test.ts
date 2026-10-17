import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ManualReviewFacts,
  ManualReviewHistory,
  ManualReviewFormFields,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel";
import { manualReviewTranslations } from "../i18n/delivery-manual-review";
import { TasksWorkbenchHeader } from "../../subapps/ai-rd-center/src/pages/delivery/TasksWorkbenchHeader";
import {
  openManualReview,
  type ManualTaskReview,
  type TaskReviewPage,
} from "./deliveryTaskReview";

let language: keyof typeof manualReviewTranslations = "en-US";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(
        key
          .split(".")
          .slice(1)
          .reduce<unknown>(
            (object, part) =>
              object && typeof object === "object"
                ? (object as Record<string, unknown>)[part]
                : undefined,
            manualReviewTranslations[language],
          ) ??
          options?.defaultValue ??
          key,
      ).replace(/\{\{(\w+)\}\}/g, (_all, name) =>
        String(options?.[name] ?? ""),
      ),
    i18n: {
      get language() {
        return language;
      },
    },
  }),
}));
const current: NonNullable<TaskReviewPage["current"]> = {
  task: {
    id: "T-one",
    title: "Current task",
    description: "Current implementation",
    req_id: "",
    status: "completed",
    assigned_to: "user:lead",
    priority: "P1",
    estimate: "M",
    blocked_reason: "",
  },
  owner: { id: "user:lead", name: "Lead", kind: "human", active: true },
  requirement: null,
  planning: { acceptance_criteria: [], depends_on: ["T-before"] },
  basis: "basis-one",
  eligible: true,
  can_review: true,
  can_accept: true,
  reasons: [],
  dependency_blocked: [],
  verified: false,
  dependency_basis: {},
};
const historical: ManualTaskReview = {
  id: "review-old",
  task_id: "T-one",
  decision: "accept",
  created_at: "2026-10-17T01:00:00Z",
  reviewer: { id: "old-lead", name: "Previous lead" },
  task_basis: "old-basis",
  snapshot: {
    task: { ...current.task, title: "Original reviewed title" },
    owner: current.owner,
    requirement: null,
    planning: current.planning,
    dependency_basis: {},
  },
  comment: "Original review opinion",
  evidence_content: "Registered manual checks",
  evidence_url: "https://example.test/manual-proof",
  source: "manual",
  invalidated: true,
  invalidated_at: "2026-10-17T02:00:00Z",
  invalidated_reason: "task_review_basis_changed",
  valid: false,
};
describe("manual delivery review presentation", () => {
  it("labels raw task totals as recorded completion in all three languages", () => {
    for (const [lang, completed, rate] of [
      ["zh-CN", "登记完成", "登记完成率"],
      ["en-US", "Recorded complete", "Recorded completion rate"],
      ["ja-JP", "完了記録", "完了記録率"],
    ] as const) {
      language = lang;
      const cache = new QueryClient();
      cache.setQueryData(["tasksSummary"], {
        summary: { total: 17, completed: 5, completion_rate: 29.4 },
      });
      cache.setQueryData(["tasksCharts"], {});
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: cache },
          createElement(TasksWorkbenchHeader, { onRefresh: () => {} }),
        ),
      );
      expect(html).toContain(completed);
      expect(html).toContain(rate);
      expect(html).toContain("29.4");
    }
  });
  it("shows recorded completion without claiming verified and keeps standalone requirements absent", () => {
    language = "en-US";
    const html = renderToStaticMarkup(
      createElement(ManualReviewFacts, { current }),
    );
    expect(html).toContain("Recorded complete · awaiting verification");
    expect(html).toContain("Standalone task");
    expect(html).toContain("Current implementation");
    expect(html).not.toContain("Verified delivery</");
  });
  it("explains native execution, permission and deleted-task restrictions explicitly", () => {
    language = "en-US";
    const html = renderToStaticMarkup(
      createElement(ManualReviewFacts, {
        current: {
          ...current,
          can_review: false,
          reasons: [
            { code: "manual_review_execution_managed", message: "fallback" },
            { code: "manual_review_permission_required", message: "fallback" },
          ],
        },
      }),
    );
    expect(html).toContain("Review the associated execution");
    expect(html).toContain("Project review permission required");
    const missing = renderToStaticMarkup(
      createElement(ManualReviewFacts, { current: null }),
    );
    expect(missing).toContain("Task unavailable · history is read-only");
  });
  it("preserves original evidence, reviewer and task snapshot while marking stale approval", () => {
    language = "en-US";
    const html = renderToStaticMarkup(
      createElement(ManualReviewHistory, { reviews: [historical] }),
    );
    for (const text of [
      "No longer valid",
      "Previous lead",
      "Original reviewed title",
      "Registered manual checks",
      "Manually registered evidence",
      "Task or acceptance basis changed",
    ])
      expect(html).toContain(text);
    expect(html).toContain('href="https://example.test/manual-proof"');
    const unsafe = renderToStaticMarkup(
      createElement(ManualReviewHistory, {
        reviews: [{ ...historical, evidence_url: "javascript:alert(1)" }],
      }),
    );
    expect(unsafe).not.toContain('href="javascript:');
    const rejected = renderToStaticMarkup(
      createElement(ManualReviewHistory, {
        reviews: [
          {
            ...historical,
            decision: "request_changes",
            invalidated: false,
            invalidated_reason: "",
          },
        ],
      }),
    );
    expect(rejected).toContain("Changes requested");
  });
  it("renders editable retained fields with fixed basis and explicit evidence requirements", () => {
    language = "en-US";
    const session = {
      ...openManualReview(
        {
          project_id: "project",
          task_id: "T-one",
          version: 9,
          current,
        } as TaskReviewPage,
        "intent",
      ),
      comment: "Keep my opinion",
      evidenceContent: "Keep my evidence",
    };
    const html = renderToStaticMarkup(
      createElement(ManualReviewFormFields, {
        session,
        busy: false,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Keep my opinion");
    expect(html).toContain("Keep my evidence");
    expect(html).toContain("9");
    expect(html).toContain("basis-one");
    expect(html).toContain("Approval requires a comment and manual evidence");
    expect(html).toContain('id="manual-review-T-one-comment"');
  });
  it("supports all three languages with equivalent meaningful restrictions and evidence labels", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value)
            .flatMap(([key, item]) => keys(item, `${prefix}.${key}`))
            .sort()
        : [prefix];
    expect(keys(manualReviewTranslations["en-US"])).toEqual(
      keys(manualReviewTranslations["zh-CN"]),
    );
    expect(keys(manualReviewTranslations["ja-JP"])).toEqual(
      keys(manualReviewTranslations["zh-CN"]),
    );
    for (const lang of Object.keys(
      manualReviewTranslations,
    ) as (keyof typeof manualReviewTranslations)[]) {
      language = lang;
      const html = renderToStaticMarkup(
        createElement(ManualReviewHistory, { reviews: [historical] }),
      );
      expect(html).not.toContain("deliveryManualReview.");
      expect(html).toContain("Original reviewed title");
      expect(html).toContain("Previous lead");
    }
  });
});
