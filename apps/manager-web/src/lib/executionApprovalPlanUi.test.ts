import { isValidElement, type ReactNode } from "react";
import { Button, Checkbox } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionPlanEditor";
import {
  openExecutionDraft,
  type DeliveryTargets,
  type ExecutionTarget,
} from "./deliveryExecution";
import type { DeliveryTaskData } from "./delivery";
import { commandDraft } from "./executionCommands";
import { request } from "./http";
import { saveDelivery } from "./delivery";
import { createExecutionDispatchController, type ExecutionDispatchCommand } from "./executionDispatchCommand";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (next: any) => {
        hooks.values[index] =
          typeof next === "function" ? next(hooks.values[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: () => {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isError: false }),
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));
vi.mock("./http", () => ({ request: vi.fn() }));
const target: ExecutionTarget = {
  id: "local",
  kind: "local",
  name: "Local",
  version: 1,
  basis: "b".repeat(64),
  paired: null,
  online: null,
  last_seen_at: null,
  expires_at: null,
  worker_id: null,
  capability_digest: "",
  runtime_capabilities: ["command"],
  providers: [],
  policy: { allowed_runtimes: ["command"], allowed_providers: [] },
  can_execute: true,
  reason_codes: [],
};
const data = {
  project: { id: "P" },
  version: 7,
  task: { id: "T", basis: "a".repeat(64) },
} as unknown as DeliveryTaskData;
const targets: DeliveryTargets = {
  project_id: "P",
  as_of: "",
  runtime_configured: true,
  can_execute: true,
  can_configure_policy: false,
  workspaces: [
    {
      id: "W",
      name: "Workspace",
      version: 1,
      agents: [],
      local: target,
      devices: [],
    },
  ],
};
const saved = vi.fn();
let controller: ReturnType<typeof createExecutionDispatchController>;
const command = (): ExecutionDispatchCommand => {
  const state = controller.snapshot();
  return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) };
};
const render = () => {
  hooks.index = 0;
  return ExecutionPlanEditor({
    initial: {
      ...openExecutionDraft(data, "T", "original-intent"),
      mode: "command",
      workspaceId: "W",
      target,
      commands: [commandDraft("tests", "python")],
    },
    initialTargets: targets,
    members: [],
    sessionId: "s",
    canConfigure: false,
    queueCommand: command(),
    onClose: () => {},
    onSaved: saved,
  });
};
function find(
  node: ReactNode,
  type: unknown,
  test: (props: any) => boolean,
): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, type, test)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  return node.type === type && test(node.props)
    ? node.props
    : find(node.props.children, type, test) ||
        find(node.props.footer, type, test);
}
const button = (name: string) =>
  find(
    render(),
    Button,
    (props) => props.children === `deliveryRuntime.${name}`,
  );
beforeEach(() => {
  hooks.values = [];
  saved.mockReset();
  controller = createExecutionDispatchController({ projectId: "P", action: "execution.queue", targetId: "T", scope: "test", currentScope: () => "test", load: () => null, save: () => {}, send: (original) => saveDelivery("P", original.action, original.payload, original.intent.version, original.intent.key) });
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path, init) => {
      const body = JSON.parse(String(init?.body));
      if (path.endsWith("execution-preview"))
        return {
          project_id: "P",
          version: 7,
          task_basis: "a".repeat(64),
          plan_basis: "c".repeat(64),
          workspace_id: "W",
          workspace_version: 1,
          target,
          agent: null,
          executor_snapshot: null,
          nodes: body.nodes.map((node: Record<string, unknown>) => ({ expected_exit_code: 0, timeout_seconds: 60, agent_id: "", prompt: "", ...node })),
          test_node_ids: body.test_node_ids,
          snapshot: {
            task_id: "T",
            title: "Task",
            description: "",
            assigned_to: "",
            dependency_basis: {}, designs: [], design_basis: "a".repeat(64),
            task_acceptance_criteria: [],
            acceptance_criteria: [],
            requirement: null,
            owner: null,
          },
        };
      return { project_id: "P", action: "execution.queue", resource: { kind: "execution", id: "E-created" }, result: null, affected_refs: [{ kind: "execution", id: "E-created" }], applied_version: 8, version: 8, query_generation: 1, replayed: false };
    });
});
describe("local execution approval is a real plan choice", () => {
  it("uses the checkbox in the actual preview and queue callbacks", async () => {
    find(
      render(),
      Checkbox,
      (props) =>
        props.children === "deliveryExecutionRuntime.approvalBeforeRun",
    ).onChange({ target: { checked: true } });
    await button("preview").onClick();
    expect(button("save").disabled).toBe(false);
    await button("save").onClick();
    const preview = JSON.parse(
      String(vi.mocked(request).mock.calls[0][1]?.body),
    );
    const queued = JSON.parse(
      String(vi.mocked(request).mock.calls[1][1]?.body),
    );
    expect(preview.nodes.map((node: any) => node.kind)).toEqual([
      "approval",
      "command",
    ]);
    expect(preview.test_node_ids).toEqual(["tests"]);
    expect(queued.action).toBe("execution.queue");
    expect(queued.payload.nodes).toEqual(preview.nodes);
    expect(queued.payload.test_node_ids).toEqual(["tests"]);
    expect(saved).toHaveBeenCalledOnce();
  });
});
