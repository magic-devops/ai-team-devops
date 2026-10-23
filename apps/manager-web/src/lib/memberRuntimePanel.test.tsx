/** SOURCE ONLY. Definitions for the actual panel boundary; not executed. */
import { isValidElement, type ReactNode } from "react";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryMemberRuntime, DeliveryMemberRuntimeOwner } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryMemberRuntime";
import { RuntimeBindingRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/RuntimeBindingRecovery";
import type { DeliveryMember } from "./delivery";
import type { TeamRuntimeBindings } from "./deliveryTeamRuntime";
import type { RuntimeBindingCommand } from "./runtimeBindingCommand";
const state = vi.hoisted(() => ({ query: {} as any, options: {} as any, updates: [] as unknown[], command: {} as any, qc: {} as any }));
vi.mock("./runtimeBindingCommand", async () => ({ ...await vi.importActual<typeof import("./runtimeBindingCommand")>("./runtimeBindingCommand"), useRuntimeBindingCommand: () => state.command }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => [initial, (value: unknown) => state.updates.push(value)],
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => { state.options = options; return state.query; },
  useQueryClient: () => state.qc,
}));
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.action)];
}
function render(kind: DeliveryMember["kind"] = "tool") {
  return DeliveryMemberRuntime({ projectId: "P", sessionId: "S", member: {
    id: "member-tool", name: "Same name", kind, active: true, role: "Developer", tool: "zed",
  }, onSaved: vi.fn(), command: { current: () => true, snapshot: () => ({ phase: "idle" }), state: { phase: "idle" }, locked: false } as RuntimeBindingCommand });
}
beforeEach(() => {
  state.command = { scope: "scope-one", current: () => true, snapshot: () => ({ phase: "idle" }), state: { phase: "idle" }, locked: false };
  state.qc = { invalidateQueries: vi.fn(async () => {}), fetchQuery: vi.fn(async () => ({ project_id: "P", version: 9 })) };
  state.updates = [];
  state.query = { data: { project_id: "P", version: 4, as_of: "", runtime_configured: true,
    members: [{ member_id: "member-tool", member_name: "Same name", member_kind: "tool", status: "unbound", generation: 0, binding_basis: "basis", binding: null,
      reasons: [{ code: "executor_unbound", message: "Unbound" }], permissions: { can_bind: true, can_unbind: false } }],
    workspaces: [{ id: "W", name: "Workspace", agents: [{ id: "A", title: "Actual config", provider: "codex", version: 2 }] }],
  } satisfies TeamRuntimeBindings, isError: false, isPending: false, isFetching: false, refetch: vi.fn() };
});
describe("tool configuration is explicit", () => {
  it("keeps one operation owner as a missing member becomes readable", () => {
    const props = { projectId: "P", memberId: "member-tool", sessionId: "S", onSaved: vi.fn() };
    const missing = DeliveryMemberRuntimeOwner(props);
    expect(missing.type).toBe(RuntimeBindingRecovery); expect(missing.props.command).toBe(state.command);
    const readable = DeliveryMemberRuntimeOwner({ ...props, member: { id: "member-tool", name: "Tool", kind: "tool", active: true, role: "", tool: "" } });
    expect(readable.type).toBe(DeliveryMemberRuntime); expect(readable.props.command).toBe(state.command);
    expect(readable.key).toBe("scope-one"); state.command = { ...state.command, scope: "scope-two" };
    expect(DeliveryMemberRuntimeOwner(props).key).toBe("scope-two");
  });
  it("propagates actual asynchronous query failures from the missing-member application path", async () => {
    const rootSaved = vi.fn(), props = { projectId: "P", memberId: "member-tool", sessionId: "S", onSaved: rootSaved };
    state.qc.invalidateQueries.mockRejectedValueOnce(new Error("Current queries failed"));
    const owner = DeliveryMemberRuntimeOwner(props), ack: any = { project_id: "P", applied_version: 8 };
    await expect(owner.props.onSaved(ack)).rejects.toThrow("Current queries failed");
    expect(state.qc.fetchQuery).not.toHaveBeenCalled();
    await owner.props.onSaved(ack);
    expect(state.qc.invalidateQueries).toHaveBeenLastCalledWith(expect.anything(), { throwOnError: true, cancelRefetch: false });
    expect(state.qc.fetchQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["delivery-team-runtime", "P", "S"], staleTime: 0 }));
    state.qc.fetchQuery.mockResolvedValueOnce({ project_id: "Q", version: 99 });
    await expect(owner.props.onSaved(ack)).rejects.toThrow("scopeChanged");
  });
  it("reads tool bindings under the project and opens the exact identity without inferring a provider from its tool label", () => {
    const tree = render();
    expect(state.options.enabled).toBe(true);
    expect(state.options.queryKey).toEqual(["delivery-team-runtime", "P", "S"]);
    expect(JSON.stringify(tree)).toContain("deliveryTeamRuntime.toolHint");
    nodes(tree).find((node) => node.type === Button && node.props.children === "deliveryTeamRuntime.bind").props.onClick();
    expect(state.updates.at(-1)).toMatchObject({ projectId: "P", memberId: "member-tool", operation: "bind", workspaceId: "", agentId: "", agentVersion: 0 });
  });
  it("allows Agent configuration and keeps humans out of the runtime association flow", () => {
    expect(render("agent")).not.toBeNull(); expect(state.options.enabled).toBe(true);
    expect(render("human")).toBeNull(); expect(state.options.enabled).toBe(false);
  });
  it("disables mutations when the last read is stale and never hides the unavailable reason", () => {
    state.query.isError = true;
    const tree = render();
    expect(nodes(tree).find((node) => node.type === Button && node.props.children === "deliveryTeamRuntime.bind").props.disabled).toBe(true);
    expect(JSON.stringify(tree)).toContain("deliveryTeamRuntime.reasons.executor_unbound");
    expect(state.updates).toEqual([]);
  });
});
