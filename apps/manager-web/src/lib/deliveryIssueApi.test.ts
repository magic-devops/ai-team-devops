import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  diagnosisFixture,
  issueDetailFixture,
  issueOriginFixture,
} from "./deliveryIssueFixtures";
import {
  prepareDiagnosisGeneration,
  prepareIssueDismissal,
  prepareIssueReview,
} from "./deliveryIssue";

it("validates actual generation, human review and displayed records against the frozen Python DTOs", () => {
  const generation = prepareDiagnosisGeneration(issueDetailFixture, {
    generator: "rules",
    instructions: "Check the actual failure",
    selected_evidence_ids: ["issue:ISS-one", "probe:OP-one:1"],
  });
  const adopt = prepareIssueReview(
    issueDetailFixture,
    diagnosisFixture,
    "adopt",
    {
      ...diagnosisFixture.result!.requirement,
      comment: "Human verified the selected evidence",
    },
  );
  const dismiss = prepareIssueDismissal(
    "P",
    diagnosisFixture,
    7,
    "Abandon the proposal only",
  );
  const root = resolve(process.cwd(), "../..");
  const output = execFileSync(
    process.env.SOP_TEST_PYTHON ||
      resolve(
        root,
        process.platform === "win32"
          ? ".venv/Scripts/python.exe"
          : ".venv/bin/python",
      ),
    [
      "-c",
      "import json,sys; from sop_manager.routers.delivery_issue_contract import IssueDiagnosisGenerate,IssueDiagnosisAdopt,IssueDiagnosisDismiss,IssueDetail,DiagnosisView; from sop_manager.routers.delivery_issue_origin_contract import IssueOrigins,IssueOriginDetail; data=json.loads(sys.argv[1]); models=[IssueDiagnosisGenerate,IssueDiagnosisAdopt,IssueDiagnosisDismiss,IssueDetail,DiagnosisView,IssueOrigins,IssueOriginDetail]; print(json.dumps([model.model_validate(value).model_dump() for model,value in zip(models,data)]))",
      JSON.stringify([
        generation.body,
        adopt.payload,
        dismiss.payload,
        issueDetailFixture,
        diagnosisFixture,
        {
          project_id: "P",
          issue_id: "ISS-one",
          issue_available: true,
          as_of: "2026-10-19T00:00:00Z",
          items: [issueOriginFixture],
          total: 1,
          limit: 20,
          next_cursor: null,
        },
        {
          project_id: "P",
          issue_id: "ISS-one",
          issue_available: false,
          as_of: "2026-10-19T00:00:00Z",
          origin: issueOriginFixture,
        },
      ]),
    ],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: resolve(root, "apps/manager") },
      encoding: "utf8",
    },
  );
  const checked = JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
  expect(checked).toHaveLength(7);
  expect(checked[0].generator).toBe("rules");
  expect(checked[1].diagnosis_id).toBe(diagnosisFixture.id);
  expect(checked[2]).not.toHaveProperty("title");
  expect(checked[5].items[0].evidence.target.origin_id).toBe(
    issueOriginFixture.id,
  );
  expect(checked[6].issue_available).toBe(false);
});
