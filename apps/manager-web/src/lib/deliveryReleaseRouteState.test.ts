import { describe, expect, it } from "vitest";
import {
  parseReleaseRoute,
  releaseHash,
  releaseTargetHref,
  releaseReturnFromHash,
} from "./deliveryReleaseRoute";
import { safeExecutionReturn } from "./executionCommands";

describe("explicit quality scope and exact release navigation", () => {
  it("keeps an empty selection empty and preserves an unknown release ID", () => {
    expect(
      parseReleaseRoute("#/dev-flow?view=releases&release_id=unknown"),
    ).toMatchObject({ releaseId: "unknown", requirementIds: [], taskIds: [] });
    expect(parseReleaseRoute("#/dev-flow?view=quality").requirementIds).toEqual(
      [],
    );
  });
  it("round trips selected entities and filters without changing the project context", () => {
    const route = {
      ...parseReleaseRoute("#/dev-flow?view=quality"),
      query: "Search 日本語",
      kind: "task" as const,
      state: "attention" as const,
      requirementIds: ["R&1"],
      taskIds: ["T-one"],
      releaseId: "REL one",
      qualityCursor: "quality/next+",
      releaseCursor: "release/next+",
      evidenceCursor: "ci/next+",
      legacyCursor: "legacy/next+",
      directory: "evidence" as const,
      qualityId: "R-exact",
      qualityKind: "requirement" as const,
      releaseQuery: "v2",
      evidenceQuery: "run 21",
      legacyQuery: "old",
    };
    const hash = releaseHash(
      route,
      "#/dev-flow?project_id=P&return_to=%23%2Fprojects%2Fportfolio%3Fq%3Dmine",
    );
    expect(parseReleaseRoute(hash)).toEqual(route);
    expect(new URLSearchParams(hash.split("?")[1]).get("project_id")).toBe("P");
    expect(new URLSearchParams(hash.split("?")[1]).get("return_to")).toBe(
      "#/projects/portfolio?q=mine",
    );
  });
  it("links standalone tasks and exact linked entities back to the quality context", () => {
    const background =
      "#/dev-flow?view=quality&project_id=P&quality_state=attention";
    const href = releaseTargetHref(
      {
        view: "list",
        requirement_id: "",
        detail: "tasks",
        task_id: "T-one",
        issue_id: "",
      },
      background,
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href).toContain("#/tasks/execution?");
    expect(params.get("task_id")).toBe("T-one");
    expect(params.get("project_id")).toBe("P");
    expect(params.get("return_to")).toBe(
      releaseHash(parseReleaseRoute(background), background),
    );
  });
  it("restores a valid opaque cursor longer than the generic execution return limit", () => {
    const background = releaseHash(
      {
        ...parseReleaseRoute("#/dev-flow?view=quality"),
        qualityCursor: "x".repeat(4000),
        qualityId: "R-1",
      },
      "#/dev-flow?project_id=P",
    );
    const href = releaseTargetHref(
      {
        view: "list",
        requirement_id: "R-1",
        detail: "details",
        task_id: "",
        issue_id: "",
      },
      background,
    );
    expect(releaseReturnFromHash(href)).toBe(background);
  });
  it("maps backend task targets to the task tab and retains the portfolio return chain", () => {
    const background = releaseHash(
      parseReleaseRoute("#/dev-flow?view=quality&requirement_ids=R-1"),
      "#/dev-flow?project_id=P&return_to=%23%2Fprojects%2Fportfolio%3Fq%3Dmine",
    );
    const href = releaseTargetHref(
      {
        project_id: "P",
        kind: "task",
        view: "tasks",
        detail: "details",
        requirement_id: "R-1",
        task_id: "T-linked",
        issue_id: null,
      },
      background,
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("detail")).toBe("tasks");
    expect(safeExecutionReturn(params.get("return_to") || "")).not.toBeNull();
    expect(releaseReturnFromHash(href)).toBe(background);
    expect(
      releaseReturnFromHash("#/dev-flow?return_to=https%3A%2F%2Fevil.example"),
    ).toBeNull();
  });
});
