import { isValidElement, type ReactNode } from "react";
import { Button, Checkbox } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionPlanEditor";
import {
  openExecutionDraft,
  type DeliveryTargets,
  type ExecutionTarget,
} from "./deliveryExecution";
import type { DeliveryWorkspace } from "./delivery";
import { commandDraft } from "./executionCommands";
import { request } from "./http";
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
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  basis: "target-basis",
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
  tasks: [{ id: "T", basis: "task-basis" }],
} as unknown as DeliveryWorkspace;
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
const render = () => {
  hooks.index = 0;
  return ExecutionPlanEditor({
    initial: {
      ...openExecutionDraft(data, "T", "original"),
      mode: "command",
      workspaceId: "W",
      target,
      commands: [commandDraft("tests", "python")],
    },
    initialTargets: targets,
    members: [],
    sessionId: "s",
    canConfigure: false,
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
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path, init) => {
      const body = JSON.parse(String(init?.body));
      if (path.endsWith("execution-preview"))
        return {
          project_id: "P",
          version: 7,
          task_basis: "task-basis",
          plan_basis: "plan",
          workspace_id: "W",
          workspace_version: 1,
          target,
          agent: null,
          executor_snapshot: null,
          nodes: body.nodes,
          test_node_ids: body.test_node_ids,
          snapshot: {
            task_id: "T",
            title: "Task",
            task_acceptance_criteria: [],
            acceptance_criteria: [],
            requirement: null,
          },
        };
      return data;
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
