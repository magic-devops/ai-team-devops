import { describe, expect, it } from "vitest";
import { executionIssueHref } from "./executionCommands";
import { portfolioTargetHash, type PortfolioTarget } from "./projectPortfolio";

describe("issue evidence entry points", () => {
  it("keeps the explicit execution project and exact return location", () => {
    const background =
      "#/dev-flow?view=list&project_id=project-a&execution_id=EXEC-1";
    const href = executionIssueHref("ISS-1", background, "project-a");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("project_id")).toBe("project-a");
    expect(params.get("issue")).toBe("ISS-1");
    expect(params.get("return_to")).toBe(background);
  });

  it("opens the exact pending diagnosis from an archive blocker", () => {
    const target: PortfolioTarget = {
      project_id: "project-a",
      kind: "issue",
      view: "issues",
      detail: "details",
      requirement_id: null,
      task_id: null,
      issue_id: "ISS-1",
      milestone_id: null,
      execution_id: null,
      diagnosis_id: "a".repeat(64),
    };
    const params = new URLSearchParams(
      portfolioTargetHash(target, "#/projects").split("?")[1],
    );
    expect(params.get("issue")).toBe("ISS-1");
    expect(params.get("diagnosis_id")).toBe("a".repeat(64));
  });
});
