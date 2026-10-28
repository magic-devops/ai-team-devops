/** UNRUN: actual creation and member-confirmation controls, without replacing their callbacks. */
import { isValidElement, type ReactNode } from "react";
import { Button, Input, Popconfirm, Table } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCreationPanel } from "../../subapps/main-admin/src/pages/projects/ProjectCreationPanel";
import { ProjectMembersModule } from "../../subapps/main-admin/src/pages/organization/ProjectMembersModule";
import { blankProjectCreation } from "./projectCreation";
const h = vi.hoisted(() => ({ states: [] as any[], next: 0 }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useMemo: (make: () => unknown) => make(), useRef: (value: unknown) => { const i = h.next++; return h.states[i] ||= { current: value }; },
  useState: (value: any) => { const i = h.next++; if (!(i in h.states)) h.states[i] = typeof value === "function" ? value() : value;
    return [h.states[i], (next: any) => { h.states[i] = typeof next === "function" ? next(h.states[i]) : next; }]; },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
function find(node: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true): any {
  if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  return node.type === type && predicate(node.props) ? node.props : find(node.props.children, type, predicate) || find(node.props.footer, type, predicate);
}
beforeEach(() => { h.states = []; h.next = 0; });
function panel() {
  const state: any = { phase: "editing", local: "saved", error: "", unsaved: false, retained: false, draft: { ...blankProjectCreation(), name: "New" }, original: null, ack: null };
  const creation: any = { state, snapshot: () => state, current: () => true, create: vi.fn(), replay: vi.fn(), revise: vi.fn(), edit: vi.fn(), retryStorage: vi.fn(), clear: vi.fn(() => true) };
  const props = { creation, open: true, onClose: vi.fn(), businesses: [{ id: "B", name: "Business" }], businessesReady: true, canCreate: true, onRetryReads: vi.fn(), onCreated: vi.fn() };
  const render = () => { h.next = 0; return ProjectCreationPanel(props); };
  return { props, creation, state, render };
}
describe("creation controls", () => {
  it("uses current permissions and business read readiness even in a captured create callback", () => {
    const f = panel(); const old = find(f.render(), Button, (p) => p["data-action"] === "create-project");
    f.props.canCreate = false; f.render(); old.onClick(); expect(f.creation.create).not.toHaveBeenCalled();
    f.props.canCreate = true; f.props.businessesReady = false; f.state.draft.business_id = "B"; f.render(); old.onClick();
    expect(f.creation.create).not.toHaveBeenCalled();
    f.props.businessesReady = true; f.render(); old.onClick(); expect(f.creation.create).toHaveBeenCalledOnce();
  });
  it("offers original replay without granting a new create after unknown results", () => {
    const f = panel(); f.state.phase = "unknown"; f.state.original = { idempotency_key: "fixed-key" }; f.props.canCreate = false;
    const tree = f.render(); expect(find(tree, Button, (p) => p["data-action"] === "create-project")).toBeUndefined();
    find(tree, Button, (p) => p["data-action"] === "replay-creation").onClick(); expect(f.creation.replay).toHaveBeenCalledOnce();
    expect(find(tree, Input, (p) => p["aria-label"] === "projectPortfolio.name").disabled).toBe(true);
  });
  it("retains a successful result until an explicit next step and does not navigate when cleanup fails", () => {
    const f = panel(); f.state.phase = "succeeded"; f.state.original = { name: "Created" }; f.state.ack = { id: "created-project" };
    const action = find(f.render(), Button, (p) => p["data-action"] === "creation-team");
    f.creation.clear.mockReturnValueOnce(false); action.onClick(); expect(f.props.onCreated).not.toHaveBeenCalled();
    action.onClick(); expect(f.props.onCreated).toHaveBeenCalledWith(f.state.ack, "team");
  });
});
describe("member controls", () => {
  function members() {
    const props = { projects: [{ id: "P", name: "Project" }], selectedProjectId: "P", setSelectedProjectId: vi.fn(),
      members: [{ user_id: "U1", username: "Alice", email: "alice@example.test", role: "developer" }, { user_id: "U2", username: "Bob", role: "viewer" }],
      candidates: [], roles: ["developer", "viewer"], loading: false, candidateLoading: false, errors: [],
      newMember: { user_id: "", role: "developer" }, setNewMember: vi.fn(), addPending: false, updatePending: false, removePending: false,
      onAdd: vi.fn(), onUpdateRole: vi.fn(), onRemove: vi.fn() };
    const render = () => { h.next = 0; return ProjectMembersModule(props); };
    return { props, render };
  }
  it("requires a project-identified confirmation before removal", () => {
    const f = members(), table = find(f.render(), Table);
    const cell = table.columns[2].render(null, f.props.members[0]);
    expect(find(cell, Button).onClick).toBeUndefined(); expect(f.props.onRemove).not.toHaveBeenCalled();
    const confirm = find(cell, Popconfirm); expect(confirm.title).toContain("Alice"); confirm.onConfirm();
    expect(f.props.onRemove).toHaveBeenCalledWith("U1");
  });
  it("searches the actual member list and resets pagination and search on another project", () => {
    const f = members(); find(f.render(), Input.Search).onChange({ target: { value: "ALICE@" } });
    expect(find(f.render(), Table).dataSource.map((row: any) => row.user_id)).toEqual(["U1"]);
    expect(find(f.render(), Table).pagination).toHaveProperty("defaultPageSize", 10);
    f.props.selectedProjectId = "Q"; f.props.projects.push({ id: "Q", name: "Other" });
    expect(find(f.render(), Input.Search).value).toBe("");
  });
});
