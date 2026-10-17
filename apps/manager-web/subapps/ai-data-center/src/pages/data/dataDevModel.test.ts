import { describe, expect, it } from "vitest";
import { buildSchedulePayload, derivePacketStats, toggleTemplateSelection } from "./dataDevModel";

describe("dataDevModel", () => {
  it("toggles template ids without duplicates", () => {
    expect(toggleTemplateSelection([], "tpl-a")).toEqual(["tpl-a"]);
    expect(toggleTemplateSelection(["tpl-a"], "tpl-a")).toEqual([]);
    expect(toggleTemplateSelection(["tpl-a"], "tpl-b")).toEqual(["tpl-a", "tpl-b"]);
    expect(toggleTemplateSelection(["tpl-a", "tpl-b"], "tpl-a")).toEqual(["tpl-b"]);
  });

  it("builds a schedule payload with defaults and selected templates", () => {
    expect(
      buildSchedulePayload({
        selectedIds: ["tpl-a", "tpl-b"],
        dryRun: true,
        maxParallel: 3,
        policy: "quality_first",
        priority: "P1",
        ownerId: "data-agent",
        devTool: "codex",
      }),
    ).toEqual({
      ids: ["tpl-a", "tpl-b"],
      dry_run: true,
      max_parallel: 3,
      policy: "quality_first",
      priority: "P1",
        owner_id: "data-agent",
      dev_tool: "codex",
      event: "manager-web:data-development",
    });
  });

  it("summarizes packet readiness, claims and reports", () => {
    expect(
      derivePacketStats([
        { ready: true, claim: { status: "running" } },
        { ready: false },
        { ready: true, report: { status: "completed" } },
      ]),
    ).toEqual({ ready: 2, blocked: 1, claimed: 1, reported: 1 });
  });
});
