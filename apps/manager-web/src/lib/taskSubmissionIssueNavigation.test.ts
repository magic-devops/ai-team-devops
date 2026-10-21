import { expect, it } from "vitest";
import { issueEvidenceHref } from "./deliveryIssue";

it("opens the exact submission from issue evidence with its original project and return", () => {
  const back = "#/dev-flow?project_id=P&view=issues&issue=I";
  const href = issueEvidenceHref("P", { project_id: "P", view: "tasks", detail: "details", task_id: "T", submission_id: "submission-1", issue_id: "I" }, back);
  expect(href).toContain("#/dev-flow?");
  const params = new URLSearchParams(href!.split("?")[1]);
  expect(params.get("project_id")).toBe("P");
  expect(params.get("task")).toBe("T");
  expect(params.get("submission_id")).toBe("submission-1");
  expect(params.get("return_to")).toBe(back);
});

it("does not navigate across project or guess a task for a submission", () => {
  expect(issueEvidenceHref("P", { project_id: "other", task_id: "T", submission_id: "S" }, "")).toBeNull();
  expect(issueEvidenceHref("P", { project_id: "P", submission_id: "S" }, "")).toBeNull();
  expect(issueEvidenceHref("P", { project_id: "P", task_id: "T", submission_id: "../S" }, "")).toBeNull();
});
