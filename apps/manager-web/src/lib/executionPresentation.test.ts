import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { runtimeTranslations } from "../i18n/delivery-runtime";
import { teamRuntimeTranslations } from "../i18n/delivery-team-runtime";
import { ExecutionTargetFacts } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionTargetFacts";
import {
  ExecutionStageFacts,
  ExecutionObservationCard,
} from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { ExecutionCommandEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionCommandEditor";
import { commandDraft } from "./executionCommands";
import { qualityFixture } from "./executionQualityFixtures";
import type {
  ExecutionObservations,
  ExecutionTarget,
} from "./deliveryExecution";
import type { DeliveryExecution } from "./delivery";
const renderState = vi.hoisted(() => ({
  next: null as null | { observation: unknown; comment: string; hook: number },
  reviewComment: null as string | null,
}));
// Seed each actual consumer separately instead of relying on the card's old
// global review-hook position. No requests run during SSR.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (renderState.reviewComment !== null && initial === "") {
        const comment = renderState.reviewComment;
        renderState.reviewComment = null;
        return actual.useState(comment);
      }
      const seed = renderState.next;
      if (!seed) return actual.useState(initial);
      const hook = seed.hook++;
      if (hook === 0) return actual.useState(seed.observation);
      return actual.useState(initial);
    },
  };
});
vi.mock("../../subapps/ai-rd-center/src/pages/delivery/ExecutionReviewControl", async () => {
  const actual = await vi.importActual<typeof import("../../subapps/ai-rd-center/src/pages/delivery/ExecutionReviewControl")>("../../subapps/ai-rd-center/src/pages/delivery/ExecutionReviewControl");
  return { ...actual, ExecutionReviewControl: (props: Parameters<typeof actual.ExecutionReviewControl>[0]) => {
    renderState.reviewComment = renderState.next?.comment ?? null;
    try { return actual.ExecutionReviewControl(props); }
    finally { renderState.reviewComment = null; }
  } };
});
let language: keyof typeof runtimeTranslations = "en-US";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(
        ((key.startsWith("deliveryTeamRuntime.") ? teamRuntimeTranslations[language] : runtimeTranslations[language]) as Record<string, unknown>)[
          key.split(".").slice(1).join(".")
        ] ??
          options?.defaultValue ??
          key,
      ).replace(/\{\{(\w+)\}\}/g, (_all, name) =>
        String(options?.[name] ?? ""),
      ),
  }),
}));
const target: ExecutionTarget = {
  id: "worker",
  kind: "device",
  name: "Remote build worker",
  version: 3,
  basis: "basis",
  paired: true,
  online: false,
  last_seen_at: null,
  expires_at: null,
  worker_id: null,
  capability_digest: "",
  runtime_capabilities: ["agent"],
  providers: [
    { id: "codex", executable_present: true, version: null, auth: "unknown" },
  ],
  policy: { allowed_runtimes: ["agent"], allowed_providers: ["codex"] },
  can_execute: false,
  reason_codes: [],
};
const observation = {
  attempt: 1,
  nodes: [
    {
      id: "agent_1",
      title: "Implementation",
      kind: "agent",
      is_test: false,
      status: "passed",
      result: null,
    },
  ],
  tests: {
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    status: "not_configured",
  },
  stale: false,
} as ExecutionObservations;
function renderObservedCard(
  tests: ExecutionObservations["tests"]["status"],
  entryStale = false,
  status = "awaiting_review",
  handoff?: { entryRunId: string; observedRunId: string; rawMarker: boolean; observedMarker: boolean },
) {
  language = "en-US";
  renderState.next = {
    hook: 0,
    comment: "Evidence inspected by a person",
    observation: {
      ...observation,
      project_id: "project",
      execution_id: "execution-one",
      run_id: handoff?.observedRunId ?? "run-one",
      executor_binding_invalidated: handoff?.observedMarker ?? false,
      executor_snapshot: null,
      run_version: 3,
      status,
      observed_at: "2026-10-17T00:00:00Z",
      tests: { ...observation.tests, status: tests },
      quality: qualityFixture({ execution_id: "execution-one", run_id: handoff?.observedRunId ?? "run-one", run_version: 3, attempt: 1 }, tests),
      review_verified: false,
      events: [],
      next_cursor: null,
      more: false,
      permissions: {
        can_start: false,
        can_cancel: false,
        can_review: true,
        can_accept: tests === "passed",
        can_sync: false,
      },
      log_streaming: false,
    },
  };
  const entry = {
    id: "execution-one",
    task_id: "T-one",
    workspace_id: "workspace",
    agent_id: "agent",
    status,
    run_id: handoff?.entryRunId ?? "run-one",
    executor_binding_invalidated: handoff?.rawMarker ?? false,
    run_version: 3,
    progress: 100,
    created_at: "2026-10-17T00:00:00Z",
    stale: entryStale,
    snapshot: {
      title: "Original task",
      task_id: "T-one", description: "", assigned_to: "", task_acceptance_criteria: ["Human checks the result"], requirement: null, owner: null, dependency_basis: {}, designs: [], design_basis: "a".repeat(64),
      acceptance_criteria: ["Human checks the result"],
    },
    results: {},
    test_node_ids: [],
  } as DeliveryExecution;
  const html = renderToStaticMarkup(
    createElement(ExecutionObservationCard, {
      entry,
      projectId: "project",
      active: false,
      sessionId: "session",
      workspaceVersion: 1,
      onSaved: () => {},
      onCommand: async () => {},
    }),
  );
  renderState.next = null;
  return html;
}
function acceptButton(html: string) {
  return (
    html
      .match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
      ?.find((button) => button.includes("Accept delivery")) || ""
  );
}
describe("external execution presentation", () => {
  it("does not present an audit invalidation marker as a pending gate after receipt recovery or sync", () => {
    const warning = teamRuntimeTranslations["en-US"].pendingInvalidated.replaceAll("'", "&#x27;");
    expect(renderObservedCard("pending", false, "planned", { entryRunId: "", observedRunId: "recovered-run", rawMarker: true, observedMarker: false })).not.toContain(warning);
    expect(renderObservedCard("pending", false, "planned", { entryRunId: "synced-run", observedRunId: "synced-run", rawMarker: true, observedMarker: false })).not.toContain(warning);
    expect(renderObservedCard("pending", false, "pending", { entryRunId: "", observedRunId: "", rawMarker: true, observedMarker: true })).toContain(warning);
  });
  it("translates the fixed local target title while preserving a remote device name", () => {
    language = "zh-CN";
    const html = renderToStaticMarkup(
      createElement(ExecutionTargetFacts, {
        target: {
          ...target,
          id: "local",
          kind: "local",
          name: "Local execution",
          paired: null,
          online: null,
        },
      }),
    );
    expect(html).toContain("<strong>本机执行器</strong>");
    expect(html).not.toContain("<strong>Local execution</strong>");
    expect(
      renderToStaticMarkup(createElement(ExecutionTargetFacts, { target })),
    ).toContain("<strong>Remote build worker</strong>");
  });
  it("allows rework but blocks acceptance until explicit tests have passed", () => {
    const html = renderObservedCard("not_configured");
    expect(html).toContain("Tests not configured");
    expect(acceptButton(html)).not.toBe("");
    expect(acceptButton(html)).toContain("disabled");
    expect(acceptButton(renderObservedCard("passed"))).not.toContain("disabled");
    for (const tests of ["pending", "failed"] as const)
      expect(acceptButton(renderObservedCard(tests))).toContain("disabled");
  });
  it("renders a later workspace invalidation over an older accepted observation", () => {
    const html = renderObservedCard("passed", true, "accepted");
    expect(html).not.toContain("Verified delivery");
    expect(html).not.toContain("runtime-execution-card is-accepted");
    expect(html).toContain(
      "Task basis changed. This run is historical evidence only.",
    );
  });
  it("separates a detected executable, device contact and unknown account authentication", () => {
    language = "en-US";
    const html = renderToStaticMarkup(
      createElement(ExecutionTargetFacts, { target }),
    );
    for (const text of [
      "Remote build worker",
      "Unseen or expired",
      "Program detected",
      "Account authentication unknown",
      "Configured permissions",
      "Device report",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Connected");
  });
  it("does not turn completed implementation into passed tests or verified delivery", () => {
    const html = renderToStaticMarkup(
      createElement(ExecutionStageFacts, {
        observation,
        status: "awaiting_review",
      }),
    );
    expect(html).toContain("Implementation");
    expect(html).toContain("Tests not configured");
    expect(html).toContain("Awaiting human review");
    expect(html).not.toContain("Verified delivery");
    const stale = renderToStaticMarkup(
      createElement(ExecutionStageFacts, {
        observation: { ...observation, stale: true },
        status: "accepted",
      }),
    );
    expect(stale).not.toContain("Verified delivery");
    const oldReview = renderToStaticMarkup(createElement(ExecutionStageFacts, {
      observation: { ...observation, quality: qualityFixture({ execution_id: "E", run_id: "R", run_version: 9, attempt: 2 }, "passed"),
        stale: false, review_verified: false }, status: "accepted",
    }));
    expect(oldReview).not.toContain("Verified delivery");
  });
  it("renders explicit command and separate argument fields with a named test toggle", () => {
    const html = renderToStaticMarkup(
      createElement(ExecutionCommandEditor, {
        rows: [
          { ...commandDraft("tests", "python"), arguments: ["-m", "pytest"] },
        ],
        onChange: () => {},
        agent: false,
        disabled: false,
      }),
    );
    for (const text of [
      "Executable 1",
      "Separate arguments 1.1",
      "Separate arguments 1.2",
      "Expected exit code 1",
      "Count as a test node",
      'value="pytest"',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("textarea");
  });
  it("keeps all three languages complete for the four interface states", () => {
    expect(Object.keys(runtimeTranslations["en-US"]).sort()).toEqual(
      Object.keys(runtimeTranslations["zh-CN"]).sort(),
    );
    expect(Object.keys(runtimeTranslations["ja-JP"]).sort()).toEqual(
      Object.keys(runtimeTranslations["zh-CN"]).sort(),
    );
    for (const lang of ["zh-CN", "en-US", "ja-JP"] as const) {
      language = lang;
      expect(
        renderToStaticMarkup(
          createElement(ExecutionStageFacts, { observation, status: "failed" }),
        ),
      ).not.toContain("deliveryRuntime.");
      expect(
        renderToStaticMarkup(createElement(ExecutionTargetFacts, { target })),
      ).not.toContain("deliveryRuntime.");
    }
  });
});
