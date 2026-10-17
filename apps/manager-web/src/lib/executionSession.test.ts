import { describe, expect, it, vi } from "vitest";
import {
  adoptExecutionDraft,
  executionPayload,
  fetchExecutionObservations,
  mergeExecutionEvents,
  openExecutionDraft,
  prepareExecution,
  previewDeliveryExecution,
  type DeliveryTargets,
  type ExecutionTarget,
} from "./deliveryExecution";
import type { DeliveryWorkspace } from "./delivery";
import { request } from "./http";
import { commandDraft } from "./executionCommands";
vi.mock("./http", () => ({ request: vi.fn() }));
const target: ExecutionTarget = {
  id: "device",
  kind: "device",
  name: "Remote worker",
  version: 2,
  basis: "target-fixed",
  paired: true,
  online: true,
  last_seen_at: "2026-10-17T00:00:00Z",
  expires_at: "2026-10-17T00:02:00Z",
  worker_id: "worker",
  capability_digest: "digest",
  runtime_capabilities: ["agent", "command"],
  providers: [
    { id: "codex", executable_present: true, version: null, auth: "unknown" },
  ],
  policy: {
    allowed_runtimes: ["agent", "command"],
    allowed_providers: ["codex"],
  },
  can_execute: true,
  reason_codes: [],
};
const workspace = {
  project: { id: "project" },
  version: 7,
  tasks: [
    {
      id: "T-one",
      basis: "task-fixed",
      execution_gate: { eligible: true, reasons: [] },
    },
  ],
} as unknown as DeliveryWorkspace;
const targets: DeliveryTargets = {
  project_id: "project",
  as_of: "",
  runtime_configured: true,
  can_execute: true,
  can_configure_policy: true,
  workspaces: [
    {
      id: "workspace",
      name: "Workspace",
      version: 2,
      agents: [
        { id: "agent", version: 3, title: "Implementer", provider: "codex" },
      ],
      local: {
        ...target,
        id: "local",
        kind: "local",
        paired: null,
        online: null,
      },
      devices: [target],
    },
  ],
};
const session = () => ({
  ...openExecutionDraft(workspace, "T-one", "fixed-key"),
  workspaceId: "workspace",
  agentId: "agent",
  agentVersion: 3,
  target: structuredClone(target),
  commands: [commandDraft("tests", "python")],
});
describe("dispatch basis and observation transport", () => {
  it("inserts one pure local approval before commands and never counts it as a test", () => {
    const draft = {
      ...session(),
      mode: "command" as const,
      target: structuredClone(targets.workspaces[0].local),
      approvalBeforeRun: true,
    };
    const payload = executionPayload(draft);
    expect(payload.nodes[0]).toMatchObject({
      id: "confirm_before_run",
      kind: "approval",
      argv: [],
      agent_id: "",
      prompt: "",
    });
    expect(payload.nodes[1]).toMatchObject({
      id: "tests",
      kind: "command",
      argv: ["python"],
    });
    expect(payload.test_node_ids).toEqual(["tests"]);
    expect(
      executionPayload(prepareExecution(draft).session).nodes.filter(
        (node) => node.kind === "approval",
      ),
    ).toHaveLength(1);
  });
  it("refuses a local-only approval on a remote target", () => {
    expect(() =>
      executionPayload({
        ...session(),
        mode: "command",
        approvalBeforeRun: true,
      }),
    ).toThrow("target_approval_unsupported");
  });
  it("keeps a confirmation node distinct from a user command with the same preferred ID", () => {
    const payload = executionPayload({
      ...session(),
      mode: "command",
      target: structuredClone(targets.workspaces[0].local),
      commands: [commandDraft("confirm_before_run", "python")],
      approvalBeforeRun: true,
    });
    expect(payload.nodes.map((node) => node.id)).toEqual([
      "confirm_before_run_2",
      "confirm_before_run",
    ]);
    expect(payload.test_node_ids).toEqual(["confirm_before_run"]);
  });
  it("does not adopt a latest task that the server marks ineligible for dispatch", () => {
    expect(() =>
      adoptExecutionDraft(
        session(),
        {
          ...workspace,
          tasks: [
            {
              ...workspace.tasks[0],
              execution_gate: {
                eligible: false,
                reasons: [
                  {
                    code: "task_acceptance_missing",
                    message: "Missing criteria",
                  },
                ],
              },
            },
          ],
        },
        targets,
        "key",
      ),
    ).toThrow();
  });
  it("does not choose a local fallback and preserves exact command identity across retry", () => {
    expect(openExecutionDraft(workspace, "T-one", "key").target).toBeNull();
    expect(() =>
      executionPayload(openExecutionDraft(workspace, "T-one", "key")),
    ).toThrow();
    const prepared = prepareExecution(session());
    expect(prepared.payload).toMatchObject({
      task_basis: "task-fixed",
      target_kind: "device",
      target_basis: "target-fixed",
      target_device_id: "device",
      agent_version: 3,
      nodes: [],
      test_node_ids: [],
    });
    expect(prepared.payload.test_nodes[0].argv).toEqual(["python"]);
    expect(prepareExecution(prepared.session).key).toBe("fixed-key");
    const edited = {
      ...prepared.session,
      commands: [commandDraft("tests", "node")],
    };
    expect(prepareExecution(edited).key).not.toBe("fixed-key");
    expect(prepared.version).toBe(7);
  });
  it("sends pure preview and scoped observation cursors without a write command", async () => {
    const payload = executionPayload(session());
    await previewDeliveryExecution("project", payload);
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/execution-preview",
      {
        method: "POST",
        headers: { "X-Project-Id": "project" },
        body: JSON.stringify(payload),
        signal: undefined,
      },
    );
    await fetchExecutionObservations(
      "project",
      "execution-one",
      "bound/cursor",
    );
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/delivery/executions/execution-one/observations?limit=100&cursor=bound%2Fcursor",
      { headers: { "X-Project-Id": "project" }, signal: undefined },
    );
  });
  it("adopts only an explicitly refreshed compatible target and preserves all draft arguments", () => {
    const draft = session();
    const adopted = adoptExecutionDraft(
      draft,
      {
        ...workspace,
        version: 9,
        tasks: [{ ...workspace.tasks[0], basis: "new-task" }],
      },
      {
        ...targets,
        workspaces: [
          {
            ...targets.workspaces[0],
            devices: [{ ...target, basis: "new-target" }],
          },
        ],
      },
      "new-key",
    );
    expect(adopted).toMatchObject({
      taskBasis: "new-task",
      intent: { version: 9, key: "new-key" },
      target: { basis: "new-target" },
      commands: draft.commands,
      preview: null,
    });
    expect(draft.taskBasis).toBe("task-fixed");
    for (const devices of [
      [],
      [{ ...target, online: false }],
      [{ ...target, paired: false }],
      [{ ...target, can_execute: false }],
    ])
      expect(() =>
        adoptExecutionDraft(
          draft,
          workspace,
          { ...targets, workspaces: [{ ...targets.workspaces[0], devices }] },
          "key",
        ),
      ).toThrow();
    expect(() =>
      adoptExecutionDraft(draft, { ...workspace, tasks: [] }, targets, "key"),
    ).toThrow();
  });
  it("deduplicates reconnect events while preserving original sequence order", () => {
    const event = {
      id: "event1",
      seq: 1,
      at: "",
      type: "run.started",
      node_id: null,
      status: "running",
      message: "started",
      attempt: 1,
      result: null,
    };
    expect(
      mergeExecutionEvents(
        [event],
        [{ ...event }, { ...event, id: "event2", seq: 2 }],
      ),
    ).toHaveLength(2);
    expect(
      mergeExecutionEvents([{ ...event, id: "event2", seq: 2 }], [event])[0].id,
    ).toBe("event1");
  });
  it("does not adopt a generically executable target that lost the chosen agent or test capability", () => {
    for (const candidate of [
      { ...target, runtime_capabilities: ["command"] },
      {
        ...target,
        policy: { allowed_runtimes: ["command"], allowed_providers: [] },
      },
      {
        ...target,
        providers: [{ ...target.providers[0], executable_present: false }],
      },
      {
        ...target,
        policy: { ...target.policy, allowed_providers: ["claude"] },
      },
      { ...target, runtime_capabilities: ["agent"] },
    ])
      expect(() =>
        adoptExecutionDraft(
          session(),
          workspace,
          {
            ...targets,
            workspaces: [
              {
                ...targets.workspaces[0],
                devices: [candidate as ExecutionTarget],
              },
            ],
          },
          "key",
        ),
      ).toThrow();
  });
});
