/** Scoped project/member consumer definitions; not executed in this source-only phase. */
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Organization } from "../../subapps/main-admin/src/pages/Organization";
import { ProjectMembersModule } from "../../subapps/main-admin/src/pages/organization/ProjectMembersModule";
import { Projects } from "../../subapps/main-admin/src/pages/Projects";
import { projectMembersHash, projectTeamHash, requestedMemberProject } from "./projectTeamNavigation";
const h = vi.hoisted(() => ({ hooks: [] as any[], next: 0, session: "original", queries: [] as any[],
  data: {} as Record<string, any>, failed: "", invalidations: [] as any[], writes: [] as any[], effects: [] as Array<() => unknown> }));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")), useEffect: (make: () => unknown) => { h.effects.push(make); }, useMemo: (make: () => unknown) => make(),
  useState: (initial: any) => { const index = h.next++; if (!(index in h.hooks)) h.hooks[index] = typeof initial === "function" ? initial() : initial;
    return [h.hooks[index], (value: any) => { h.hooks[index] = typeof value === "function" ? value(h.hooks[index]) : value; }]; },
  useRef: (initial: any) => { const index = h.next++; return h.hooks[index] ||= { current: initial }; },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./authStorage", async () => ({ ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")),
  getToken: () => "present", getSessionRevision: () => h.session, getProjectId: () => "Q" }));
vi.mock("./projectPortfolio", async () => ({ ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")), projectSessionKey: () => h.session }));
vi.mock("./deliveryQuery", () => ({ invalidateDeliveryQueries: (_client: unknown, projectId: string) => { h.invalidations.push(["delivery", projectId]); } }));
vi.mock("./api", () => ({ api: {
  projectAddMember: (projectId: string, body: unknown) => { h.writes.push({ action: "add", projectId, body }); return new Promise(() => {}); },
  projectUpdateMember: (projectId: string, userId: string, body: unknown) => { h.writes.push({ action: "update", projectId, userId, body }); return new Promise(() => {}); },
  projectRemoveMember: (projectId: string, userId: string) => { h.writes.push({ action: "remove", projectId, userId }); return new Promise(() => {}); },
} }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: (value: any) => { h.invalidations.push(value.queryKey); } }),
  useQuery: (options: any) => { h.queries.push(options); const name = options.queryKey[0]; return {
    data: h.data[name], isError: name === h.failed, error: name === h.failed ? new Error("HTTP 403") : null,
    isPending: false, isLoading: false, isFetching: false,
  }; },
  useMutation: (options: any) => ({ isPending: false, error: null, mutate: (value: unknown) => {
    void Promise.resolve(options.mutationFn(value)).then((result) => options.onSuccess?.(result, value)).finally(() => options.onSettled?.());
  } }),
}));
function find(node: ReactNode): any {
  if (Array.isArray(node)) return node.map(find).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  return node.type === ProjectMembersModule ? node.props : find(node.props.children);
}
function render() { h.next = 0; h.queries = []; h.effects = []; return find(Organization({ initialTab: "projectMembers", focused: true })); }
beforeEach(() => {
  h.hooks = []; h.session = "original"; h.failed = ""; h.writes = []; h.invalidations = []; h.effects = [];
  h.data = { projects: [{ id: "Q", name: "First project" }, { id: "P", name: "Requested project" }],
    projectMembers: [{ user_id: "existing", username: "Existing", role: "developer" }],
    projectMemberCandidates: [{ id: "candidate", username: "Candidate" }], roleConstants: { project_member_roles: ["developer", "viewer"] } };
  vi.stubGlobal("location", { hash: "#/projects/members?project_id=P" });
  vi.stubGlobal("history", { state: null, replaceState: vi.fn((_state: unknown, _title: string, hash: string) => { location.hash = hash; }) });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
describe("project to team management", () => {
  it("connects the actual Projects members entry to the same scoped manager", () => {
    const entry = Projects({ initialTab: "members", focused: true });
    expect(isValidElement(entry) && entry.type).toBe(Organization);
    expect(entry.props).toMatchObject({ initialTab: "projectMembers", focused: true });
  });
  it("preserves the exact project in both directions without carrying a task or credential", () => {
    expect(projectMembersHash("project / A")).toBe("#/projects/members?project_id=project+%2F+A");
    expect(projectTeamHash("P")).toBe("#/dev-flow?view=team&project_id=P");
    expect(requestedMemberProject("#/projects/members?project_id=P&task=old")).toBe("P");
    expect(requestedMemberProject("#/dev-flow?project_id=P")).toBe("");
    expect(requestedMemberProject("#/projects/members?project_id=P&project_id=Q")).toBe("");
    const props = render(); expect(props.selectedProjectId).toBe("P");
    expect(h.queries.find((query) => query.queryKey[0] === "projectMembers").queryKey[1]).toBe("P");
  });
  it.each(["", "missing"])("does not silently manage the first project for requested project %s", (projectId) => {
    location.hash = projectMembersHash(projectId); const props = render();
    expect(props.selectedProjectId).toBe(projectId); expect(props.disabled).toBe(true);
    expect(h.queries.find((query) => query.queryKey[0] === "projectMembers").enabled).toBe(false);
  });
  it("clears the previous candidate on project selection and blocks a captured old-project add callback", () => {
    render().setNewMember({ user_id: "candidate", role: "developer" });
    const previous = render(); previous.setSelectedProjectId("Q"); previous.onAdd();
    const current = render();
    expect(current.selectedProjectId).toBe("Q"); expect(current.newMember.user_id).toBe("");
    expect(location.hash).toBe(projectMembersHash("Q")); expect(h.writes).toHaveLength(0);
  });
  it("pins the member write to its displayed project and blocks duplicate writes or selection before another render", () => {
    render().setNewMember({ user_id: "candidate", role: "developer" });
    const props = render(); props.onAdd(); props.onAdd(); props.onRemove("existing"); props.setSelectedProjectId("Q");
    expect(h.writes).toEqual([{ action: "add", projectId: "P", body: { user_id: "candidate", role: "developer" } }]);
    expect(location.hash).toBe(projectMembersHash("P"));
  });
  it("suppresses cached membership on read refusal and rejects old callbacks after login changes", () => {
    const old = render(); h.failed = "projectMembers";
    const refused = render(); expect(refused.members).toEqual([]); expect(refused.readFailed).toBe(true);
    old.onRemove("existing"); expect(h.writes).toHaveLength(0);
    h.failed = ""; render(); h.session = "next-login"; old.onUpdateRole("existing", "viewer");
    expect(h.writes).toHaveLength(0);
  });
  it("requires a successful role catalogue and never invents fallback project roles", () => {
    const old = render(); h.failed = "roleConstants";
    const refused = render(); expect(refused.disabled).toBe(true); expect(refused.roles).toEqual([]);
    old.onUpdateRole("existing", "viewer"); expect(h.writes).toHaveLength(0);
    h.failed = ""; delete h.data.roleConstants;
    expect(render().roles).toEqual([]); expect(render().disabled).toBe(true);
  });
  it("rejects a captured add callback after candidate reads are refused", () => {
    render().setNewMember({ user_id: "candidate", role: "developer" });
    const old = render(); h.failed = "projectMemberCandidates"; render();
    old.onAdd(); expect(h.writes).toHaveLength(0);
  });
  it("uses the current candidate draft and current member identities in captured callbacks", () => {
    render().setNewMember({ user_id: "candidate", role: "developer" });
    const old = render();
    h.data.projectMemberCandidates = [{ id: "next", username: "Next" }];
    h.data.projectMembers = [];
    old.setNewMember({ user_id: "next", role: "viewer" }); render();
    old.onRemove("existing"); old.onUpdateRole("existing", "viewer");
    expect(h.writes).toHaveLength(0);
    old.onAdd();
    expect(h.writes).toEqual([{ action: "add", projectId: "P", body: { user_id: "next", role: "viewer" } }]);
  });
  it("invalidates captured member callbacks on another route and after effect cleanup", () => {
    const old = render(); location.hash = "#/dev-flow?project_id=P"; old.onRemove("existing");
    expect(h.writes).toHaveLength(0);
    location.hash = projectMembersHash("P"); const mounted = render();
    const cleanups = h.effects.map((make) => make()).filter((value) => typeof value === "function") as Array<() => void>;
    cleanups.forEach((cleanup) => cleanup()); mounted.onRemove("existing");
    expect(h.writes).toHaveLength(0);
  });
});
