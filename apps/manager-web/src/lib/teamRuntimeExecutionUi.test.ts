import { isValidElement, type ReactNode } from "react";
import { Button, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionPlanEditor } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionPlanEditor";
import { openExecutionDraft, previewDeliveryExecution, type DeliveryTargets, type ExecutionPreview, type ExecutionTarget } from "./deliveryExecution";
import { commandDraft } from "./executionCommands";
import type { DeliveryTaskData } from "./delivery";
import type { TeamRuntimeBindings } from "./deliveryTeamRuntime";
import { createExecutionDispatchController, type ExecutionDispatchCommand } from "./executionDispatchCommand";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], next: 0, catalogue: undefined as unknown, failed: false }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useState: (initial: unknown) => {
  const index = hooks.next++;
  if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial;
  return [hooks.state[index], (change: unknown) => { hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change; }];
}, useRef: (initial: unknown) => {
  const index = hooks.next++;
  if (!(index in hooks.state)) hooks.state[index] = { current: initial };
  return hooks.state[index];
}, useEffect: () => {} }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: hooks.catalogue, isError: hooks.failed, isFetching: false, refetch: vi.fn() }), useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("./deliveryExecution", async () => ({ ...await vi.importActual<typeof import("./deliveryExecution")>("./deliveryExecution"), previewDeliveryExecution: vi.fn() }));
const member = { id: "agent:one", name: "Executor", kind: "agent" as const, active: true, role: "Developer", tool: "" };
let controller: ReturnType<typeof createExecutionDispatchController>;
const command = (): ExecutionDispatchCommand => { const state = controller.snapshot(); return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) }; };
const catalogue: TeamRuntimeBindings = { project_id: "project", version: 7, as_of: "", runtime_configured: true, members: [{ member_id: member.id, member_name: member.name, member_kind: member.kind, generation: 2, binding_basis: "d".repeat(64), status: "current", reasons: [], permissions: { can_bind: false, can_unbind: false }, binding: { workspace_id: "runtime", agent_id: "profile", agent_version: 2, profile_digest: "e".repeat(64), source: { workspace_name: "Runtime", agent_title: "Profile", provider: "codex" }, bound_by: "user:lead", bound_at: "2026-10-17T00:00:00Z" } }], workspaces: [] };
const target: ExecutionTarget = { id: "device", kind: "device", name: "Device", version: 1, basis: "b".repeat(64), paired: true, online: true, last_seen_at: null, expires_at: null, worker_id: "worker", capability_digest: "digest", runtime_capabilities: ["agent", "command"], providers: [{ id: "codex", executable_present: true, version: null, auth: "unknown" }], policy: { allowed_runtimes: ["agent", "command"], allowed_providers: ["codex"] }, can_execute: true, reason_codes: [] };
const targets: DeliveryTargets = { project_id: "project", as_of: "", runtime_configured: true, can_execute: true, can_configure_policy: false, workspaces: [{ id: "runtime", name: "Runtime", version: 1, agents: [{ id: "profile", version: 2, title: "Profile", provider: "codex" }], local: { ...target, id: "local", kind: "local", paired: null, online: null }, devices: [target] }] };
const data = { project: { id: "project" }, version: 7, task: { id: "T-one", basis: "a".repeat(64), owner_id: "user:owner" } } as unknown as DeliveryTaskData;
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, unknown>) => boolean): Record<string, any> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return find(node.props.children as ReactNode, type, predicate) || find(node.props.footer as ReactNode, type, predicate);
}
function render() {
  hooks.next = 0;
  return ExecutionPlanEditor({ initial: { ...openExecutionDraft(data, "T-one", "original-intent"), workspaceId: "runtime", agentId: "profile", agentVersion: 2, target, commands: [commandDraft("tests", "python")] }, initialTargets: targets, members: [member], sessionId: "test", canConfigure: false, queueCommand: command(), onClose: vi.fn(), onSaved: vi.fn() });
}
const select = (tree: ReactNode, label: string) => find(tree, Select, (props) => props["aria-label"] === label)!;
const button = (tree: ReactNode, label: string) => find(tree, Button, (props) => props.children === label)!;
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  hooks.state = []; hooks.next = 0; hooks.catalogue = catalogue; hooks.failed = false;
  controller = createExecutionDispatchController({ projectId: "project", action: "execution.queue", targetId: "T-one", scope: "test", currentScope: () => "test", load: () => null, save: () => {}, send: vi.fn() });
  vi.mocked(previewDeliveryExecution).mockReset().mockImplementation(async (_project, payload) => ({ project_id: "project", version: 7, task_basis: "a".repeat(64), plan_basis: "c".repeat(64), workspace_id: "runtime", workspace_version: 1, target, agent: targets.workspaces[0].agents[0], nodes: [{ id: "agent_1", title: "Profile", kind: "agent", argv: [], expected_exit_code: 0, timeout_seconds: 60, agent_id: "profile", prompt: "Actual task envelope" }, ...payload.test_nodes.map((node) => ({ ...node, agent_id: "", prompt: "" }))], test_node_ids: payload.test_nodes.map((node) => node.id), snapshot: { task_id: "T-one", title: "Task", description: "", assigned_to: "", dependency_basis: {}, designs: [], design_basis: "a".repeat(64), task_acceptance_criteria: [], acceptance_criteria: [], requirement: null, owner: null }, executor_snapshot: payload.executor_member_id ? { member_id: member.id, member_name: member.name, binding_basis: "d".repeat(64), binding_generation: 2, workspace_id: "runtime", workspace_name: "Runtime", agent_id: "profile", agent_version: 2, agent_title: "Profile", profile_digest: "e".repeat(64), provider: "codex", recorded_at: "2026-10-17T00:00:00Z", recorded_by: "user:lead" } : null } as ExecutionPreview));
});
describe("actual execution editor member controls", () => {
  it("uses the runtime directory's tool identity even when task references contain a different label", () => {
    hooks.catalogue = { ...catalogue, members: [{ ...catalogue.members[0], member_name: "Actual tool name", member_kind: "tool" }] };
    const options = select(render(), "deliveryTeamRuntime.optional").options;
    expect(options.find((option: any) => option.value === member.id).label).toContain("Actual tool name");
  });
  it("pins the chosen member and profile in the actual preview payload while keeping placement explicit", async () => {
    select(render(), "deliveryTeamRuntime.optional").onChange(member.id);
    const selected = render();
    expect(select(selected, "deliveryRuntime.workspace").disabled).toBe(true);
    expect(select(selected, "deliveryRuntime.agentProfile").disabled).toBe(true);
    expect(select(selected, "deliveryRuntime.target").value).toBeUndefined();
    expect(button(selected, "deliveryRuntime.preview").disabled).toBe(true);
    select(selected, "deliveryRuntime.target").onChange("device:device");
    button(render(), "deliveryRuntime.preview").onClick(); await settle();
    expect(previewDeliveryExecution).toHaveBeenCalledWith("project", expect.objectContaining({ executor_member_id: member.id, executor_binding_basis: "d".repeat(64), agent_id: "profile", agent_version: 2, target_device_id: "device", test_nodes: [expect.objectContaining({ argv: ["python"] })] }));
    expect(data.task.owner_id).toBe("user:owner");
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
