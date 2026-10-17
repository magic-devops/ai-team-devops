import { isValidElement, type ReactNode } from "react";
import { Button, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionPlanEditor";
import { openExecutionDraft, previewDeliveryExecution, type DeliveryTargets, type ExecutionPreview, type ExecutionTarget } from "./deliveryExecution";
import { commandDraft } from "./executionCommands";
import type { DeliveryWorkspace } from "./delivery";
import type { TeamRuntimeBindings } from "./deliveryTeamRuntime";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], next: 0, catalogue: undefined as unknown, failed: false }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useState: (initial: unknown) => {
  const index = hooks.next++;
  if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial;
  return [hooks.state[index], (change: unknown) => { hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change; }];
} }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: hooks.catalogue, isError: hooks.failed, isFetching: false, refetch: vi.fn() }), useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./deliveryExecution", async () => ({ ...await vi.importActual<typeof import("./deliveryExecution")>("./deliveryExecution"), previewDeliveryExecution: vi.fn() }));
const member = { id: "agent:one", name: "Executor", kind: "agent" as const, active: true, role: "Developer", tool: "" };
const catalogue: TeamRuntimeBindings = { project_id: "project", version: 7, as_of: "", runtime_configured: true, members: [{ member_id: member.id, generation: 2, binding_basis: "binding-2", status: "current", reasons: [], permissions: { can_bind: false, can_unbind: false }, binding: { workspace_id: "runtime", agent_id: "profile", agent_version: 2, profile_digest: "digest", source: { workspace_name: "Runtime", agent_title: "Profile", provider: "codex" }, bound_by: "user:lead", bound_at: "2026-10-17T00:00:00Z" } }], workspaces: [] };
const target: ExecutionTarget = { id: "device", kind: "device", name: "Device", version: 1, basis: "target-basis", paired: true, online: true, last_seen_at: null, expires_at: null, worker_id: "worker", capability_digest: "digest", runtime_capabilities: ["agent", "command"], providers: [{ id: "codex", executable_present: true, version: null, auth: "unknown" }], policy: { allowed_runtimes: ["agent", "command"], allowed_providers: ["codex"] }, can_execute: true, reason_codes: [] };
const targets: DeliveryTargets = { project_id: "project", as_of: "", runtime_configured: true, can_execute: true, can_configure_policy: false, workspaces: [{ id: "runtime", name: "Runtime", version: 1, agents: [{ id: "profile", version: 2, title: "Profile", provider: "codex" }], local: { ...target, id: "local", kind: "local", paired: null, online: null }, devices: [target] }] };
const data = { project: { id: "project" }, version: 7, tasks: [{ id: "T-one", basis: "task-basis", owner_id: "user:owner" }] } as unknown as DeliveryWorkspace;
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, unknown>) => boolean): Record<string, any> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return find(node.props.children as ReactNode, type, predicate) || find(node.props.footer as ReactNode, type, predicate);
}
function render() {
  hooks.next = 0;
  return ExecutionPlanEditor({ initial: { ...openExecutionDraft(data, "T-one", "intent"), workspaceId: "runtime", agentId: "profile", agentVersion: 2, target, commands: [commandDraft("tests", "python")] }, initialTargets: targets, members: [member], sessionId: "test", canConfigure: false, onClose: vi.fn(), onSaved: vi.fn() });
}
const select = (tree: ReactNode, label: string) => find(tree, Select, (props) => props["aria-label"] === label)!;
const button = (tree: ReactNode, label: string) => find(tree, Button, (props) => props.children === label)!;
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  hooks.state = []; hooks.next = 0; hooks.catalogue = catalogue; hooks.failed = false;
  vi.mocked(previewDeliveryExecution).mockReset().mockImplementation(async (_project, payload) => ({ project_id: "project", version: 7, task_basis: "task-basis", plan_basis: "plan", workspace_id: "runtime", workspace_version: 1, target, agent: targets.workspaces[0].agents[0], nodes: [], test_node_ids: [], snapshot: { task_id: "T-one", title: "Task", description: "", assigned_to: "", dependency_basis: {}, task_acceptance_criteria: [], acceptance_criteria: [], requirement: null, owner: null }, executor_snapshot: payload.executor_member_id ? { member_id: member.id, member_name: member.name, binding_basis: "binding-2", binding_generation: 2, workspace_id: "runtime", workspace_name: "Runtime", agent_id: "profile", agent_version: 2, agent_title: "Profile", profile_digest: "digest", provider: "codex", recorded_at: "2026-10-17T00:00:00Z", recorded_by: "user:lead" } : null } as ExecutionPreview));
});
describe("actual execution editor member controls", () => {
  it("pins the chosen member and profile in the actual preview payload while keeping placement explicit", async () => {
    select(render(), "deliveryTeamRuntime.optional").onChange(member.id);
    const selected = render();
    expect(select(selected, "deliveryRuntime.workspace").disabled).toBe(true);
    expect(select(selected, "deliveryRuntime.agentProfile").disabled).toBe(true);
    expect(select(selected, "deliveryRuntime.target").value).toBeUndefined();
    expect(button(selected, "deliveryRuntime.preview").disabled).toBe(true);
    select(selected, "deliveryRuntime.target").onChange("device:device");
    button(render(), "deliveryRuntime.preview").onClick(); await settle();
    expect(previewDeliveryExecution).toHaveBeenCalledWith("project", expect.objectContaining({ executor_member_id: member.id, executor_binding_basis: "binding-2", agent_id: "profile", agent_version: 2, target_device_id: "device", test_nodes: [expect.objectContaining({ argv: ["python"] })] }));
    expect(data.tasks[0].owner_id).toBe("user:owner");
    expect(button(render(), "deliveryRuntime.save").disabled).toBe(false);
  });
  it("keeps a lost member selection and tests until the user explicitly switches to direct configuration", () => {
    select(render(), "deliveryTeamRuntime.optional").onChange(member.id);
    select(render(), "deliveryRuntime.target").onChange("device:device");
    hooks.catalogue = undefined; hooks.failed = true;
    const failed = render();
    expect(select(failed, "deliveryTeamRuntime.optional").value).toBe(member.id);
    expect(button(failed, "deliveryRuntime.preview").disabled).toBe(true);
    button(failed, "deliveryTeamRuntime.useDirect").onClick();
    const direct = render();
    expect(select(direct, "deliveryTeamRuntime.optional").value).toBe("");
    expect(select(direct, "deliveryRuntime.target").value).toBe("device:device");
    expect(button(direct, "deliveryRuntime.preview").disabled).toBe(false);
  });
  it("clears member association when switching to command mode", () => {
    select(render(), "deliveryTeamRuntime.optional").onChange(member.id);
    select(render(), "deliveryRuntime.mode").onChange("command");
    const current = hooks.state[0] as { executorMemberId: string; executorBindingBasis: string; commands: unknown[] };
    expect(current.executorMemberId).toBe("");
    expect(current.executorBindingBasis).toBe("");
    expect(current.commands).toHaveLength(1);
    expect(select(render(), "deliveryRuntime.target").value).toBeUndefined();
  });
});
