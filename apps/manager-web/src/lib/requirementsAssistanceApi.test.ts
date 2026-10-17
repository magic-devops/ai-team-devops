import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { request } from "./http";
import {
  prototypeModes,
  workflowHumanActionBody,
  type WorkflowHumanAction,
} from "./requirementsAssistance";

vi.mock("./http", () => ({ API_BASE: "", request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset().mockResolvedValue({}));

describe("requirement assistance API bodies", () => {
  it("validates every prototype request body against the backend's real input model", async () => {
    for (const mode of prototypeModes)
      await api.previewRequirementPrototype("REQ/1", {
        mode,
        extra_context: "Edited context",
        gen_image: false,
        generator: "rules",
        idempotency_key: `prototype-${mode}`,
      });
    const bodies = vi.mocked(request).mock.calls.map(([path, init]) => {
      expect(path).toBe("/api/v1/requirements/REQ%2F1/prototype");
      expect(init?.method).toBe("POST");
      return JSON.parse(String(init?.body));
    });
    const root = resolve(process.cwd(), "../..");
    const result = execFileSync(
      process.env.SOP_TEST_PYTHON ||
        resolve(
          root,
          process.platform === "win32"
            ? ".venv/Scripts/python.exe"
            : ".venv/bin/python",
        ),
      [
        "-c",
        "import json,sys; from sop_manager.routers.requirements import GeneratePrototypeBody; bodies=json.loads(sys.argv[1]); print(json.dumps([GeneratePrototypeBody.model_validate(body).model_dump() for body in bodies]))",
        JSON.stringify(bodies),
      ],
      {
        cwd: root,
        env: { ...process.env, PYTHONPATH: resolve(root, "apps/manager") },
        encoding: "utf8",
      },
    );
    expect(
      JSON.parse(result.trim().split(/\r?\n/).at(-1)!).map(
        (body: { mode: string }) => body.mode,
      ),
    ).toEqual(["wireframe", "user_journey", "ia"]);
    expect(
      bodies.every(
        (body) => body.gen_image === false && body.generator === "rules",
      ),
    ).toBe(true);
  });
  it("keeps explicit provenance and optimistic version through review and prototype adoption", async () => {
    const receipt = {
      generation_id: "generation",
      requirement_basis: "a".repeat(64),
      expected_version: 8,
      idempotency_key: "adoption-key",
    };
    await api.applyRequirementReview("req", {
      ...receipt,
      acceptance_criteria: ["Edited condition"],
      human_notes: "Reviewed",
    });
    expect(
      JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body)),
    ).toEqual({
      ...receipt,
      acceptance_criteria: ["Edited condition"],
      human_notes: "Reviewed",
    });
    await api.applyRequirementPrototype("req", {
      ...receipt,
      content: "# Edited",
      title: "Design",
    });
    expect(
      JSON.parse(String(vi.mocked(request).mock.calls[1][1]?.body)),
    ).toEqual({ ...receipt, content: "# Edited", title: "Design" });
  });
  it("validates submitted human actions against each real workflow signal handler", async () => {
    const cases: Array<{
      type: string;
      signal: WorkflowHumanAction;
      state: Record<string, unknown>;
      fields?: { task_id?: string; assignee?: string };
    }> = [
      ...(["approve", "request_changes", "reject"] as const).map((signal) => ({
        type: "code_review",
        signal,
        state: { phase: "awaiting_human" },
      })),
      {
        type: "sprint_lifecycle",
        signal: "pause",
        state: { phase: "in_progress", tasks: ["T-1"], completed: [] },
      },
      {
        type: "sprint_lifecycle",
        signal: "resume",
        state: { phase: "paused", tasks: ["T-1"], completed: [] },
      },
      {
        type: "sprint_lifecycle",
        signal: "complete_task",
        state: { phase: "in_progress", tasks: ["T-1"], completed: [] },
        fields: { task_id: "T-1" },
      },
      {
        type: "sprint_lifecycle",
        signal: "complete_review",
        state: { phase: "reviewing", tasks: ["T-1"], completed: ["T-1"] },
      },
      {
        type: "bug_triage",
        signal: "reassign",
        state: { phase: "assigned" },
        fields: { assignee: "Reviewer" },
      },
      { type: "bug_triage", signal: "resolve", state: { phase: "assigned" } },
    ];
    for (const row of cases)
      await api.signalWorkflow(
        `workflow-${row.type}`,
        workflowHumanActionBody(
          row.signal,
          "Reviewed evidence",
          `signal-${row.signal}`,
          row.fields,
        ),
      );
    const submitted = cases.map((row, index) => ({
      ...row,
      ...JSON.parse(String(vi.mocked(request).mock.calls[index][1]?.body)),
    }));
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
        "import json,sys; from sop_manager.routers.workflow import _WORKFLOWS; rows=json.loads(sys.argv[1]); results=[]\nfor row in rows:\n definition=_WORKFLOWS[row['type']]; assert row['signal'] in definition.signals; result=definition.signal_handler(row['state'], row['signal'], {**row['payload'], 'actor_id':'contract-reviewer'}); results.append(result['phase'])\nprint(json.dumps(results))",
        JSON.stringify(submitted),
      ],
      {
        cwd: root,
        env: { ...process.env, PYTHONPATH: resolve(root, "apps/manager") },
        encoding: "utf8",
      },
    );
    expect(JSON.parse(output.trim().split(/\r?\n/).at(-1)!)).toEqual([
      "completed",
      "completed",
      "completed",
      "paused",
      "in_progress",
      "reviewing",
      "completed",
      "assigned",
      "completed",
    ]);
  });
  it("sends selected import edits with the originating generation and stable intent", async () => {
    const body = {
      items: [{ title: "Selected edit" }],
      generation_id: "generation",
      expected_version: 3,
      idempotency_key: "import-key",
    };
    await api.batchCreateRequirements(body);
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      "/api/v1/requirements/batch",
      { method: "POST", body: JSON.stringify(body) },
    );
  });
});
