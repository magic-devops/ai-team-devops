import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { api } from "./api";
import { projectWorkspaceHash } from "./projectPortfolioRoute";

describe("legacy deployment retirement", () => {
  it("keeps configuration exports while removing every former deployment writer", () => {
    expect(api.opsCreateDeploymentPackage).toBeTypeOf("function");
    expect(api.opsProfileBundle).toBeTypeOf("function");
    expect(api.opsPipelines).toBeTypeOf("function");
    for (const helper of [
      "opsPipelineCreate",
      "opsPipelineTrigger",
      "opsPipelineStatus",
      "opsPipelineDelete",
      "opsCreateDeploymentPipeline",
      "opsDeploymentPipelineExecute",
      "opsDeploymentPipelineExecutionCallback",
      "opsCreateDeploymentPackageApproval",
      "opsDeploymentCanaryPolicyAction",
      "opsDeploymentCanaryMetricCollection",
      "opsDeploymentRollbackDrillAction",
      "opsDeploymentRollbackRunbookAction",
      "opsDeploymentExecutionAuditTasks",
    ])
      expect(api).not.toHaveProperty(helper);
  });

  it("carries the current project into the canonical release entry", () => {
    const href = projectWorkspaceHash(
      "project/a & b",
      "#/dev-flow?view=releases",
    );
    expect(href.split("?")[0]).toBe("#/dev-flow");
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("project_id")).toBe("project/a & b");
    expect(params.get("view")).toBe("releases");
  });

  it.each(["zh-CN", "en-US", "ja-JP"])(
    "registers configuration and historical-only explanations in %s",
    (lng) => {
      for (const key of [
        "page.settings.configurationOnlyNotice",
        "page.settings.controlledReleases",
        "page.settings.deployPackageVersionsDesc",
        "page.opsCenter.pipelineHistoryTitle",
        "page.opsCenter.pipelineHistoryFailed",
        "page.opsCenter.pipelineHistoryOnly",
        "page.opsCenter.pipelineHistoryEmpty",
      ]) {
        expect(i18n.exists(key, { lng })).toBe(true);
        expect(i18n.t(key, { lng })).not.toBe(key);
      }
    },
  );
});
