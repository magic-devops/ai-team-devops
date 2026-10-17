import { describe, expect, it } from "vitest";
import { parseProjectsDeliveryHash } from "../../subapps/main-admin/src/pages/projects/deliveryKitNav";
import { portfolioHash, safePortfolioReturn, projectWorkspaceHash, portfolioReturnFromHash } from "./projectPortfolioRoute";
import { portfolioTargetHash } from "./projectPortfolio";
import { portfolioDetail } from "./projectPortfolioFixtures";

describe("portfolio inspection is a route, not the active workspace", () => {
  it("retains exact project and portfolio filters without selecting a fallback", () => {
    const route = parseProjectsDeliveryHash("#/projects/portfolio?project_id=project%3Aunknown&q=release&business_id=product&status=archived&status=active&risk=blocked&risk=open_issues&cursor=project-20");
    expect(route).toMatchObject({ portfolio: { projectId: "project:unknown", query: "release", businessId: "product", statuses: ["active", "archived"], risks: ["blocked", "open_issues"], cursor: "project-20" } });
  });
  it("keeps an orphan execution target precise instead of falling back to a task or project list", () => {
    const href = portfolioTargetHash({ ...portfolioDetail.primary_target, kind: "execution", execution_id: "E-orphan", task_id: "removed-task", view: "list" }, "#/projects/portfolio?project_id=P");
    expect(href.startsWith("#/dev-flow?")).toBe(true);
    expect(new URLSearchParams(href.split("?")[1]).get("execution_id")).toBe("E-orphan");
  });
  it("normalizes only the portfolio return surface and preserves exact filter context", () => {
    const background = "#/projects/portfolio?project_id=P&q=release&status=archived&risk=blocked&return_to=https%3A%2F%2Fevil.test";
    expect(safePortfolioReturn(background)).toBe("#/projects/portfolio?q=release&status=archived&risk=blocked&project_id=P");
    expect(safePortfolioReturn("#/projects/portfolio-fake?project_id=P")).toBeNull();
    expect(safePortfolioReturn("https://evil.test/#/projects/portfolio")).toBeNull();
    const target = projectWorkspaceHash("P", "#/tasks/execution?task_id=T", background);
    expect(new URLSearchParams(target.split("?")[1]).get("project_id")).toBe("P");
    expect(portfolioReturnFromHash(target)).toBe(safePortfolioReturn(background));
    expect(portfolioHash({ projectId: "unknown" })).toContain("project_id=unknown");
  });
});
