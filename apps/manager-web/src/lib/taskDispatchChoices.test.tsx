/** Actual choice projection and surface definitions. SOURCE ONLY, UNRUN. */
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Radio, Input, Button } from "antd";
import { dispatchChoices, dispatchChoiceKey, type TaskDispatchFacts } from "./taskDispatchChoices";
import { TaskDispatchChoices } from "../../subapps/ai-rd-center/src/pages/delivery/TaskDispatchChoices";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-US" }, t: (key: string) => key }) }));
const target = { id: "local", kind: "local", can_execute: true, reason_codes: [], runtime_capabilities: ["agent", "command"], providers: [{ id: "codex", executable_present: true }], policy: { allowed_runtimes: ["agent", "command"], allowed_providers: ["codex"] } };
function facts(): TaskDispatchFacts { return { data: { project: { id: "P" }, permissions: { write: true }, task: { id: "T", execution_gate: { eligible: true, reasons: [] } }, members: [{ id: "agent:one", name: "Bound agent", kind: "agent" }] },
  targets: { project_id: "P", runtime_configured: true, can_execute: true, workspaces: [{ id: "W", name: "Workspace", agents: [{ id: "A", version: 2, title: "Profile", provider: "codex" }], local: structuredClone(target), devices: [] }] },
  bindings: { project_id: "P", members: [{ member_id: "agent:one", status: "current", binding_basis: "b".repeat(64), binding: { workspace_id: "W", agent_id: "A", agent_version: 2 }, reasons: [] }] },
  external: { project_id: "P", task_id: "T", can_dispatch: true, active_work_order_id: null, reasons: [], executors: [{ id: "agent:one", name: "External agent", tool: "workbuddy", kind: "agent", active: true, available: true, reasons: [] }] }, failures: [] } as unknown as TaskDispatchFacts; }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...["children", "description", "action"].flatMap((key) => nodes(node.props[key]))]; }
describe("one explicit execution resource", () => {
  it("distinguishes the same formal member's native and external paths and pins the real profile", () => {
    const options = dispatchChoices(facts()), bound = options.find((row) => row.mode === "agent" && row.member === "agent:one")!;
    expect(bound).toMatchObject({ available: true, title: "Bound agent", workspace: "Workspace", profile: "Profile", version: 2, targetCount: 1 });
    expect(options.find((row) => row.mode === "external" && row.member === "agent:one")?.available).toBe(true);
    expect(dispatchChoiceKey("agent", "agent:one")).not.toBe(dispatchChoiceKey("external", "agent:one"));
  });
  for (const fault of ["active_order", "task_gate", "offline", "provider", "policy", "version", "binding", "runtime_read"]) it(`shows an unavailable reason before opening an editor: ${fault}`, () => {
    const f = facts();
    if (fault === "active_order") f.external!.active_work_order_id = "W-active";
    if (fault === "task_gate") f.data.task.execution_gate = { eligible: false, reasons: [{ code: "blocked", message: "Resolve dependency first" }] };
    if (fault === "offline") { f.targets!.workspaces[0].local.can_execute = false; f.targets!.workspaces[0].local.reason_codes = ["worker_offline"]; }
    if (fault === "provider") f.targets!.workspaces[0].local.providers[0].executable_present = false;
    if (fault === "policy") f.targets!.workspaces[0].local.policy.allowed_providers = [];
    if (fault === "version") f.bindings!.members[0].binding!.agent_version = 3;
    if (fault === "binding") f.bindings!.members[0].status = "stale";
    if (fault === "runtime_read") f.targets = undefined;
    const row = dispatchChoices(f).find((item) => item.mode === "agent" && item.member === "agent:one")!;
    expect(row.available).toBe(false); expect(row.reasons.length).toBeGreaterThan(0);
  });
  it("keeps external availability independent of native reads and retains the exact external denial", () => {
    const f = facts(); f.targets = undefined; f.bindings = undefined;
    expect(dispatchChoices(f).find((row) => row.mode === "external")?.available).toBe(true);
    f.external!.can_dispatch = false; f.external!.reasons = [{ code: "submission_dependencies_blocked", message: "Resolve dependencies" }];
    expect(dispatchChoices(f).find((row) => row.mode === "external")?.reasons).toContainEqual(f.external!.reasons[0]);
  });
  it("uses one standard radio change, preserves an off-filter selection and performs no automatic choice", () => {
    const options = dispatchChoices(facts()), choose = vi.fn(), search = vi.fn();
    const value = { mode: "agent" as const, member: "agent:one" };
    const render = (query: string) => TaskDispatchChoices({ options, value, search: query, limit: 40, disabled: false, onSearch: search, onChoose: choose, onMore: vi.fn() });
    const tree = render("not-found"); expect(JSON.stringify(tree)).toContain("Bound agent"); expect(choose).not.toHaveBeenCalled();
    const input = nodes(tree).find((node) => node.type === Input); input.props.onChange({ target: { value: "workbuddy" } }); expect(search).toHaveBeenCalledWith("workbuddy");
    const group = nodes(render("")).find((node) => node.type === Radio.Group); group.props.onChange({ target: { value: dispatchChoiceKey("external", "agent:one") } });
    expect(choose).toHaveBeenCalledWith("external", "agent:one");
  });
  it("limits a large visible directory without hiding the selected summary or selecting on search", () => {
    const option = dispatchChoices(facts()).find((row) => row.mode === "external")!;
    const options = Array.from({ length: 55 }, (_, index) => ({ ...option, key: dispatchChoiceKey("external", `member-${index}`), member: `member-${index}`, title: `Resource ${index}` }));
    const more = vi.fn(), tree = TaskDispatchChoices({ options, value: { mode: "external", member: "member-54" }, search: "", limit: 40, disabled: false, onSearch: vi.fn(), onChoose: vi.fn(), onMore: more });
    expect(nodes(tree).filter((node) => node.type === Radio)).toHaveLength(40); expect(JSON.stringify(tree)).toContain("Resource 54");
    nodes(tree).find((node) => node.type === Button)!.props.onClick(); expect(more).toHaveBeenCalledOnce();
  });
  it("names equal member titles distinctly for keyboard and screen reader selection", () => {
    const f = facts(); f.external!.executors[0].name = "Bound agent";
    const tree = TaskDispatchChoices({ options: dispatchChoices(f), value: null, search: "", limit: 40, disabled: false, onSearch: vi.fn(), onChoose: vi.fn(), onMore: vi.fn() });
    const radios = nodes(tree).filter((node) => node.type === Radio && node.props["aria-label"].startsWith("Bound agent"));
    expect(radios.map((node) => node.props["aria-label"])).toEqual(["Bound agent · Platform agent", "Bound agent · External collaboration"]);
    expect(nodes(tree).find((node) => node.type === Radio.Group).props.role).toBe("radiogroup");
  });
});
