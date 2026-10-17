import { describe, expect, it } from "vitest";
import {
  parseReleaseRoute,
  releaseHash,
  releaseTargetHref,
  releaseReturnFromHash,
} from "./deliveryReleaseRoute";

describe("deployment identity stays in the canonical release context", () => {
  it("retains unknown deployment and release identities through refresh and entity return", () => {
    const background =
      "#/dev-flow?view=releases&release_id=REL-one&deployment_id=DEP-unknown&project_id=P&return_to=%23%2Fprojects%2Fportfolio";
    const route = parseReleaseRoute(background);
    expect(route).toMatchObject({
      releaseId: "REL-one",
      deploymentId: "DEP-unknown",
    });
    const restored = releaseHash(route, background);
    expect(
      new URLSearchParams(restored.split("?")[1]).get("deployment_id"),
    ).toBe("DEP-unknown");
    const issue = releaseTargetHref(
      {
        project_id: "P",
        kind: "issue",
        view: "issues",
        detail: "details",
        requirement_id: "",
        task_id: "",
        issue_id: "ISS-one",
      },
      restored,
    );
    expect(releaseReturnFromHash(issue)).toBe(restored);
  });
  it("closing deployment preserves the selected candidate and rejects control characters", () => {
    const route = parseReleaseRoute(
      "#/dev-flow?view=releases&release_id=REL-one&deployment_id=DEP-one",
    );
    const closed = releaseHash(
      { ...route, deploymentId: "" },
      "#/dev-flow?project_id=P",
    );
    expect(parseReleaseRoute(closed)).toMatchObject({
      releaseId: "REL-one",
      deploymentId: "",
    });
    expect(
      parseReleaseRoute("#/dev-flow?deployment_id=bad%00id"),
    ).toMatchObject({ deploymentId: "" });
  });
});
