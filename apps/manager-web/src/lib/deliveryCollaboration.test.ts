import { describe, expect, it } from "vitest";
import {
  collaborationHash,
  parseCollaborationRoute,
  safeCollaborationReturn,
  collaborationSourceHref,
  preserveCollaborationRoute,
  requirementDefinitionChanges,
  prepareRequirementChange,
} from "./deliveryCollaboration";
import { parseDeliveryRoute } from "./deliveryProjectInbox";

describe("delivery collaboration navigation", () => {
  it("restores the requirement history tab and retained activity cursor without crossing requirement scope", () => {
    expect(
      parseDeliveryRoute("#/dev-flow?view=list&requirement=R&detail=history")
        .detail,
    ).toBe("history");
    expect(
      preserveCollaborationRoute(
        "#/dev-flow?view=list&project_id=P&requirement=R&detail=history",
        "#/dev-flow?view=list&project_id=P&requirement=R&activity_cursor=old&activity_scope_id=R",
      ),
    ).toContain("activity_cursor=old");
    expect(
      preserveCollaborationRoute(
        "#/dev-flow?view=list&project_id=P&requirement=Other",
        "#/dev-flow?view=list&project_id=P&requirement=R&requirement_version=old",
      ),
    ).not.toContain("requirement_version");
  });
  it("keeps the exact activity page and parent context when an event opens and closes", () => {
    const source =
      "#/dev-flow?view=list&project_id=P&requirement=R&detail=activity&activity_action=task.update&activity_cursor=older%2F50&return_to=%23%2Fprojects%2Fportfolio%3Fq%3Dalpha";
    const opened = collaborationHash(source, { eventId: "event:one" });
    expect(parseCollaborationRoute(opened)).toMatchObject({
      eventId: "event:one",
      action: "task.update",
      cursor: "older/50",
    });
    const closed = collaborationHash(opened, { eventId: "" });
    expect(closed).toBe(source);
  });
  it("rejects external, cross-project and nested unsafe return destinations", () => {
    expect(safeCollaborationReturn("https://other.test/", "P")).toBeNull();
    expect(
      safeCollaborationReturn("#/dev-flow?project_id=Other", "P"),
    ).toBeNull();
    expect(
      safeCollaborationReturn(
        "#/dev-flow?project_id=P&collaboration_return=https%3A%2F%2Fother.test",
        "P",
      ),
    ).toBeNull();
    expect(
      safeCollaborationReturn(
        "#/dev-flow?view=team&project_id=P&schedule_day=2026-10-20",
        "P",
      ),
    ).toContain("schedule_day=2026-10-20");
  });
  it("does not turn a missing or forbidden event source into another record", () => {
    expect(
      collaborationSourceHref(
        {
          available: false,
          reason: "missing",
          label: null,
          kind: "task",
          id: "T",
        },
        "P",
        "#/dev-flow?project_id=P",
      ),
    ).toBeNull();
    expect(
      collaborationSourceHref(
        {
          available: true,
          reason: null,
          label: null,
          kind: "javascript",
          id: "T",
        } as never,
        "P",
        "#/dev-flow?project_id=P",
      ),
    ).toBeNull();
  });
  it("routes a real task from an event with explicit project and safe exact return context", () => {
    const href = collaborationSourceHref(
      {
        available: true,
        reason: null,
        label: "Task",
        kind: "task",
        id: "T/one",
      },
      "P",
      "#/dev-flow?project_id=P&event_id=E&activity_cursor=older",
    );
    expect(href).toContain("task=T%2Fone");
    expect(href).toContain("project_id=P");
    expect(
      new URLSearchParams(href!.split("?")[1]).get("collaboration_return"),
    ).toBe("#/dev-flow?project_id=P&event_id=E&activity_cursor=older");
  });
});

describe("fixed requirement change confirmation", () => {
  const definition = {
    title: "Before",
    description: "Scope",
    acceptance_criteria: ["A", "A"],
  };
  it("keeps order and duplicates and sends only actual definition edits to preview", () => {
    expect(
      requirementDefinitionChanges(definition, {
        ...definition,
        acceptance_criteria: ["A", "B", "A"],
      }),
    ).toEqual({ acceptance_criteria: ["A", "B", "A"] });
    expect(requirementDefinitionChanges(definition, { ...definition })).toEqual(
      {},
    );
  });
  it("refuses changed definition without its displayed preview and preserves retry identity", () => {
    const input = { id: "R", title: "After" };
    expect(() =>
      prepareRequirementChange(
        { version: 4, key: "fixed-key" },
        "fixed-basis",
        input,
        true,
        null,
      ),
    ).toThrow("previewRequired");
    const first = prepareRequirementChange(
      { version: 4, key: "fixed-key" },
      "fixed-basis",
      input,
      true,
      "preview-basis",
    );
    expect(first).toMatchObject({
      intent: { version: 4, key: "fixed-key" },
      payload: {
        id: "R",
        title: "After",
        requirement_basis: "fixed-basis",
        change_preview_basis: "preview-basis",
      },
    });
    expect(
      prepareRequirementChange(
        first.intent,
        "fixed-basis",
        input,
        true,
        "preview-basis",
      ),
    ).toEqual(first);
    expect(
      prepareRequirementChange(
        first.intent,
        "fixed-basis",
        { ...input, title: "Different" },
        true,
        "new-preview",
      ).intent.key,
    ).not.toBe("fixed-key");
  });
});
