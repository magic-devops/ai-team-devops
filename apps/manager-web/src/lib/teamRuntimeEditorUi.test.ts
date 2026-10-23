import { isValidElement, type ReactNode } from "react";
import { Button, Modal, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRuntimeBindingEditor } from "../../subapps/ai-rd-center/src/pages/delivery/MemberRuntimeBindingEditor";
import { fetchTeamRuntimeBindings, openRuntimeBindingDraft, type TeamRuntimeBindings } from "./deliveryTeamRuntime";
import { saveDelivery } from "./delivery";
import { createRuntimeBindingController, type RuntimeBindingCommand } from "./runtimeBindingCommand";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], next: 0, projectId: "project" }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useState: (initial: unknown) => {
  const index = hooks.next++;
  if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial;
  return [hooks.state[index], (change: unknown) => { hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change; }];
}, useRef: (initial: unknown) => {
  const index = hooks.next++; if (!(index in hooks.state)) hooks.state[index] = { current: initial }; return hooks.state[index];
}, useEffect: () => {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./authStorage", () => ({ getWorkspaceScope: () => ({ projectId: hooks.projectId }), getSessionRevision: () => "session" }));
vi.mock("./delivery", async () => ({ ...await vi.importActual<typeof import("./delivery")>("./delivery"), saveDelivery: vi.fn() }));
vi.mock("./deliveryTeamRuntime", async () => ({ ...await vi.importActual<typeof import("./deliveryTeamRuntime")>("./deliveryTeamRuntime"), fetchTeamRuntimeBindings: vi.fn() }));
const data: TeamRuntimeBindings = { project_id: "project", version: 7, as_of: "", runtime_configured: true, members: [{ member_id: "agent:one", member_name: "Original member", member_kind: "agent", generation: 2, binding_basis: "basis", status: "current", reasons: [], permissions: { can_bind: true, can_unbind: true }, binding: { workspace_id: "runtime", agent_id: "profile", agent_version: 2, profile_digest: "digest", source: { workspace_name: "Runtime", agent_title: "Profile", provider: "codex" }, bound_by: "user:lead", bound_at: "2026-10-17T00:00:00Z" } }], workspaces: [{ id: "runtime", name: "Runtime", agents: [{ id: "profile", title: "Profile", version: 2, provider: "codex" }] }] };
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, unknown>) => boolean): Record<string, any> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return find(node.props.children as ReactNode, type, predicate) || find(node.props.footer as ReactNode, type, predicate);
}
const onSaved = vi.fn(), onClose = vi.fn();
let controller: ReturnType<typeof createRuntimeBindingController>;
const ack = (version = 7) => ({ project_id: "project", action: "member.runtime.bind", resource: { kind: "member", id: "agent:one" }, result: null,
  affected_refs: [{ kind: "member", id: "agent:one" }], applied_version: version + 1, version: version + 1, query_generation: 3, replayed: false });
function render(operation: "bind" | "unbind" = "bind") {
  hooks.next = 0;
  return MemberRuntimeBindingEditor({ initial: openRuntimeBindingDraft(data, "agent:one", operation, "original-key"), initialCatalogue: data, memberName: "Original member", onClose, onSaved,
    command: { ...controller, state: controller.snapshot(), locked: !["idle", "refused"].includes(controller.snapshot().phase) } as RuntimeBindingCommand,
    isActive: () => hooks.projectId === "project", canSubmit: () => true });
}
const button = (tree: ReactNode, label: string) => find(tree, Button, (props) => props.children === `deliveryTeamRuntime.${label}`)!;
async function settle() { for (let at = 0; at < 10; at++) await Promise.resolve(); }
beforeEach(() => { hooks.state = []; hooks.next = 0; hooks.projectId = "project"; vi.mocked(saveDelivery).mockReset(); vi.mocked(fetchTeamRuntimeBindings).mockReset(); onSaved.mockClear(); onClose.mockClear();
  controller = createRuntimeBindingController({ projectId: "project", memberId: "agent:one", scope: "project", currentScope: () => hooks.projectId,
    load: () => null, save: vi.fn(), send: (value) => saveDelivery("project", value.action, value.payload, value.intent.version, value.intent.key) });
});
describe("binding editor keeps drafts and adopts explicitly", () => {
  it("saves using pinned scope/version and keeps a newer profile out until explicit adoption and selection", async () => {
    vi.mocked(saveDelivery).mockRejectedValueOnce(new Error("HTTP 409: project changed")).mockResolvedValueOnce(ack(9) as never);
    button(render(), "save").onClick(); await settle();
    expect(saveDelivery).toHaveBeenLastCalledWith("project", "member.runtime.bind", { member_id: "agent:one", workspace_id: "runtime", agent_id: "profile", agent_version: 2 }, 7, "original-key");
    expect(button(render(), "save").disabled).toBe(true);
    const latest = { ...data, version: 9, workspaces: [{ ...data.workspaces[0], agents: [{ ...data.workspaces[0].agents[0], version: 3 }] }] };
    vi.mocked(fetchTeamRuntimeBindings).mockResolvedValueOnce(latest);
    button(render(), "readLatest").onClick(); await settle();
    expect(saveDelivery).toHaveBeenCalledTimes(1);
    button(render(), "adopt").onClick();
    const tree = render();
    const profile = find(tree, Select, (props) => props["aria-label"] === "deliveryTeamRuntime.profile")!;
    expect(profile.value).toBe("profile:2");
    profile.onChange("profile:3");
    button(render(), "save").onClick(); await settle();
    expect(saveDelivery).toHaveBeenLastCalledWith("project", "member.runtime.bind", { member_id: "agent:one", workspace_id: "runtime", agent_id: "profile", agent_version: 3 }, 9, expect.not.stringMatching(/^original-key$/));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("clears the previous latest candidate when a second read fails", async () => {
    vi.mocked(saveDelivery).mockRejectedValueOnce(new Error("HTTP 409"));
    button(render(), "save").onClick(); await settle();
    vi.mocked(fetchTeamRuntimeBindings).mockResolvedValueOnce({ ...data, version: 9 }).mockRejectedValueOnce(new Error("unavailable"));
    button(render(), "readLatest").onClick(); await settle();
    expect(button(render(), "adopt")).toBeDefined();
    button(render(), "readLatest").onClick(); await settle();
    expect(button(render(), "adopt")).toBeUndefined();
    expect(button(render(), "save").disabled).toBe(true);
  });
  it("unbinds with its independent permission and sends only the member identity", async () => {
    vi.mocked(saveDelivery).mockResolvedValueOnce({ ...ack(), action: "member.runtime.unbind" } as never);
    button(render("unbind"), "unbind").onClick(); await settle();
    expect(saveDelivery).toHaveBeenCalledWith("project", "member.runtime.unbind", { member_id: "agent:one" }, 7, "original-key");
  });
  it("does not submit a pinned draft under another project or session", async () => {
    const tree = render();
    hooks.projectId = "other-project";
    button(tree, "save").onClick(); await settle();
    expect(saveDelivery).not.toHaveBeenCalled();
    expect(find(render(), Modal, () => true)).toBeDefined();
  });
  it("locks unknown saves and guards repeated clicks before the first render", async () => {
    let reject!: (failure: unknown) => void;
    vi.mocked(saveDelivery).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const tree = render(), click = button(tree, "save").onClick;
    click(); click(); expect(saveDelivery).toHaveBeenCalledTimes(1);
    reject(new TypeError("Lost response")); await settle();
    expect(controller.snapshot().phase).toBe("unknown"); expect(button(render(), "save").disabled).toBe(true);
    expect(find(render(), Select, () => true)!.disabled).toBe(true);
    expect(find(render(), Modal, () => true)!.closable).toBe(false);
  });
  it("does not apply a late save response after the active project changes", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(saveDelivery).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    button(render(), "save").onClick(); hooks.projectId = "other"; resolve(ack()); await settle();
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
});
