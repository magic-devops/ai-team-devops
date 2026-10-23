/** SOURCE ONLY. Definitions for the actual panel boundary; not executed. */
import { isValidElement, type ReactNode } from "react";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryMemberRuntime } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryMemberRuntime";
import type { DeliveryMember } from "./delivery";
import type { TeamRuntimeBindings } from "./deliveryTeamRuntime";
const state = vi.hoisted(() => ({ query: {} as any, options: {} as any, updates: [] as unknown[] }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => [initial, (value: unknown) => state.updates.push(value)],
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => { state.options = options; return state.query; },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.action)];
}
function render(kind: DeliveryMember["kind"] = "tool") {
  return DeliveryMemberRuntime({ projectId: "P", sessionId: "S", member: {
    id: "member-tool", name: "Same name", kind, active: true, role: "Developer", tool: "zed",
  }, onSaved: vi.fn() });
}
beforeEach(() => {
  state.updates = [];
  state.query = { data: { project_id: "P", version: 4, as_of: "", runtime_configured: true,
    members: [{ member_id: "member-tool", member_name: "Same name", member_kind: "tool", status: "unbound", generation: 0, binding_basis: "basis", binding: null,
      reasons: [{ code: "executor_unbound", message: "Unbound" }], permissions: { can_bind: true, can_unbind: false } }],
    workspaces: [{ id: "W", name: "Workspace", agents: [{ id: "A", title: "Actual config", provider: "codex", version: 2 }] }],
  } satisfies TeamRuntimeBindings, isError: false, isPending: false, isFetching: false, refetch: vi.fn() };
});
describe("tool configuration is explicit", () => {
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
