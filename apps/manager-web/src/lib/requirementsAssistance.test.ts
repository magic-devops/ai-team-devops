import { describe, expect, it } from "vitest";
import {
  assistanceError,
  assistanceIntent,
  assistanceApplyBody,
  canAdoptAssistanceVersion,
  selectedIntakeItems,
  workflowDecisionBody,
  canDecideWorkflow,
  workflowHumanActions,
} from "./requirementsAssistance";

describe("requirement assistance intent and provenance", () => {
  it("retries the same intent and rotates for edited input or explicit regeneration", () => {
    const first = assistanceIntent(
      undefined,
      "scope",
      "parse",
      { text: "original", generator: "ai" },
      false,
      () => "one",
    );
    expect(
      assistanceIntent(
        first,
        "scope",
        "parse",
        { text: "original", generator: "ai" },
        false,
        () => "two",
      ).key,
    ).toBe("one");
    expect(
      assistanceIntent(
        first,
        "scope",
        "parse",
        { text: "edited", generator: "ai" },
        false,
        () => "two",
      ).key,
    ).toBe("two");
    expect(
      assistanceIntent(
        first,
        "scope",
        "parse",
        { text: "original", generator: "ai" },
        true,
        () => "two",
      ).key,
    ).toBe("two");
    expect(
      assistanceIntent(
        first,
        "other",
        "parse",
        { text: "original", generator: "ai" },
        false,
        () => "two",
      ).key,
    ).toBe("two");
  });
  it("preserves generation identity when adopting a newer workspace version", () => {
    const generation = { id: "G-1", basis: "same", source: "ai" as const };
    expect(canAdoptAssistanceVersion(generation, "same")).toBe(true);
    expect(canAdoptAssistanceVersion(generation, "changed")).toBe(false);
    expect(
      canAdoptAssistanceVersion({ ...generation, stale: true }, "same"),
    ).toBe(false);
    expect(
      assistanceApplyBody(generation, 7, "key", {
        acceptance_criteria: ["Edited"],
      }),
    ).toEqual({
      acceptance_criteria: ["Edited"],
      generation_id: "G-1",
      requirement_basis: "same",
      expected_version: 7,
      idempotency_key: "key",
    });
  });
  it("preserves newline and tag separators in editor state until import", () => {
    const row = {
      key: "one",
      selected: true,
      title: "Requirement",
      acceptance_text: "First\n\nSecond\n",
      tags_text: "one, two, ",
    };
    expect(selectedIntakeItems([row])[0]).toMatchObject({
      acceptance_criteria: ["First", "Second"],
      tags: ["one", "two"],
    });
    expect(selectedIntakeItems([row])[0]).not.toHaveProperty("acceptance_text");
    expect(row.acceptance_text).toBe("First\n\nSecond\n");
  });
  it("imports exactly selected edited drafts and omits view state", () => {
    expect(
      selectedIntakeItems([
        {
          key: "one",
          selected: true,
          title: " Edited ",
          description: " scope ",
          priority: "P0",
          acceptance_criteria: ["Condition"],
          tags: [],
          assigned_agent: "A",
          dev_tool: "codex",
        },
        { key: "two", selected: false, title: "Skip" },
      ]),
    ).toEqual([
      {
        title: "Edited",
        description: "scope",
        priority: "P0",
        acceptance_criteria: ["Condition"],
        tags: [],
        assigned_agent: "A",
        dev_tool: "codex",
      },
    ]);
  });
  it("separates version/basis conflicts from in-flight generation and key mismatch", () => {
    expect(
      assistanceError(
        new Error(
          'HTTP 409: {"detail":{"code":"assistance_in_progress","message":"Still running"}}',
        ),
      ),
    ).toEqual({ message: "Still running", conflict: false, stale: false });
    expect(
      assistanceError(
        new Error(
          'HTTP 409: {"detail":{"code":"requirement_basis_changed","message":"Regenerate"}}',
        ),
      ).stale,
    ).toBe(true);
    expect(
      assistanceError(new Error('HTTP 409: {"detail":"Workspace changed"}'))
        .conflict,
    ).toBe(true);
    expect(
      assistanceError(new Error('HTTP 503: {"detail":"Provider unavailable"}'))
        .message,
    ).toBe("Provider unavailable");
  });
});

describe("workflow human decisions", () => {
  it("requires server approval permission and a waiting state", () => {
    expect(
      canDecideWorkflow({
        type: "code_review",
        status: "awaiting_human",
        permissions: { approve: true },
      }),
    ).toBe(true);
    expect(
      canDecideWorkflow({
        type: "code_review",
        status: "timeout_pending",
        permissions: { approve: true },
      }),
    ).toBe(true);
    expect(
      canDecideWorkflow({
        type: "code_review",
        status: "completed",
        permissions: { approve: true },
      }),
    ).toBe(false);
    expect(
      canDecideWorkflow({
        type: "code_review",
        status: "awaiting_human",
        permissions: { write: true },
      }),
    ).toBe(false);
    expect(
      canDecideWorkflow({
        type: "sprint_lifecycle",
        status: "awaiting_human",
        permissions: { approve: true },
      }),
    ).toBe(false);
    expect(
      canDecideWorkflow({
        type: "bug_triage",
        status: "timeout_pending",
        permissions: { approve: true },
      }),
    ).toBe(false);
  });
  it("offers only actions accepted by the selected workflow and its phase", () => {
    const permissions = { write: true, approve: true };
    expect(
      workflowHumanActions({
        type: "sprint_lifecycle",
        status: "awaiting_human",
        phase: "in_progress",
        permissions,
        result: { tasks: ["T-1"], completed: [] },
      }),
    ).toEqual(["pause", "complete_task"]);
    expect(
      workflowHumanActions({
        type: "sprint_lifecycle",
        status: "awaiting_human",
        phase: "reviewing",
        permissions,
        result: { tasks: ["T-1"], completed: ["T-1"] },
      }),
    ).toEqual(["pause", "complete_review"]);
    expect(
      workflowHumanActions({
        type: "bug_triage",
        status: "awaiting_human",
        phase: "assigned",
        permissions,
      }),
    ).toEqual(["reassign", "resolve"]);
    expect(
      workflowHumanActions({
        type: "bug_triage",
        status: "awaiting_human",
        phase: "assigned",
        permissions: { write: true },
      }),
    ).toEqual(["reassign"]);
    expect(
      workflowHumanActions({
        type: "sprint_lifecycle",
        status: "completed",
        permissions,
      }),
    ).toEqual([]);
  });
  it("offers resume after pausing a timed-out sprint despite the retained pending phase", () => {
    const permissions = { write: true, approve: true };
    const result = {
      tasks: ["T-1"],
      completed: [],
      pending_phase: "in_progress",
    };
    expect(
      workflowHumanActions({
        type: "sprint_lifecycle",
        status: "timeout_pending",
        phase: "timeout_pending",
        permissions,
        result,
      }),
    ).toEqual(["pause", "complete_task"]);
    expect(
      workflowHumanActions({
        type: "sprint_lifecycle",
        status: "awaiting_human",
        phase: "paused",
        permissions,
        result,
      }),
    ).toEqual(["resume"]);
    expect(
      workflowHumanActions({
        type: "sprint_lifecycle",
        status: "awaiting_human",
        phase: "in_progress",
        permissions,
        result,
      }),
    ).toEqual(["pause", "complete_task"]);
  });
  it("sends explicit decision with comment and stable identity, never actor claims", () => {
    expect(
      workflowDecisionBody(
        "request_changes",
        "  Missing test evidence  ",
        "signal-1",
      ),
    ).toEqual({
      signal: "request_changes",
      payload: { comment: "Missing test evidence", signal_id: "signal-1" },
    });
    expect(() => workflowDecisionBody("approve", "  ", "signal-1")).toThrow();
  });
});
