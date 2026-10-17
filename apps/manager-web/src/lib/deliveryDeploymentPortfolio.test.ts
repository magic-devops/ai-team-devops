import { describe, expect, it } from "vitest";
import { portfolioTargetHash } from "./projectPortfolio";
describe("archive blockers locate the exact managed deployment", () => {
  it("opens deployment without losing project and portfolio return context", () => {
    const href = portfolioTargetHash(
      {
        project_id: "P",
        kind: "deployment",
        view: "releases",
        detail: "details",
        deployment_id: "DEP &1",
        requirement_id: null,
        task_id: null,
        issue_id: null,
        milestone_id: null,
        execution_id: null,
      },
      "#/projects/portfolio?q=mine",
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("view")).toBe("releases");
    expect(params.get("deployment_id")).toBe("DEP &1");
    expect(params.get("project_id")).toBe("P");
    expect(params.get("return_to")).toBe("#/projects/portfolio?q=mine");
  });
});
