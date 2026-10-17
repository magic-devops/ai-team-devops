import { createElement, isValidElement, type ReactNode } from "react";
import { Alert, Button, Empty, Input, Modal } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioModule } from "../../subapps/main-admin/src/pages/projects/PortfolioModule";
import { ProjectContextGate } from "../components/ProjectContextGate";
import { api } from "./api";
import { setWorkspaceScope } from "./authStorage";
import { portfolioDetail, portfolioResponse } from "./projectPortfolioFixtures";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], next: 0, currentProject: "other", error: false, noData: false, empty: false }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: (value: unknown) => ({ current: value }), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(), useState: (initial: unknown) => { const index = hooks.next++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial; return [hooks.state[index], (change: unknown) => { hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change; }]; } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("./authStorage", () => ({ getProjectId: () => hooks.currentProject, getToken: () => "token", getSessionRevision: () => "session", getWorkspaceScope: () => ({ projectId: hooks.currentProject }), setWorkspaceScope: vi.fn() }));
vi.mock("./api", () => ({ api: { createProject: vi.fn(), businesses: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: hooks.noData ? undefined : queryKey[0] === "projectPortfolio" ? { ...portfolioResponse, rows: hooks.empty ? [] : portfolioResponse.rows } : queryKey[0] === "projectContext" ? portfolioDetail : [], isError: hooks.error, error: hooks.error ? new Error("offline") : null, isLoading: false, isFetching: false, refetch: vi.fn() }) }));
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, any>) => boolean = () => true): Record<string, any> | undefined { if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean); if (!isValidElement<Record<string, any>>(node)) return undefined; if (node.type === type && predicate(node.props)) return node.props; return find(node.props.children, type, predicate) || find(node.props.footer, type, predicate); }
const render = () => { hooks.next = 0; return PortfolioModule(); };
const button = (name: string) => find(render(), Button, (props) => props.children === `projectPortfolio.${name}`)!;
beforeEach(() => { hooks.state = []; hooks.next = 0; hooks.currentProject = "other"; hooks.error = false; hooks.noData = false; hooks.empty = false; vi.mocked(setWorkspaceScope).mockReset(); vi.mocked(api.createProject).mockReset(); vi.stubGlobal("window", { location: { hash: "#/projects/portfolio?q=release" } }); });
describe("portfolio real controls", () => {
  it("inspects the exact project without switching workspace", () => {
    button("inspect").onClick();
    expect(window.location.hash).toBe("#/projects/portfolio?q=release&project_id=P");
    expect(setWorkspaceScope).not.toHaveBeenCalled();
  });
  it("enters explicitly with the complete project scope and a normalized return route", () => {
    button("enter").onClick();
    expect(setWorkspaceScope).toHaveBeenCalledWith({ tenantCode: "tenant", businessCode: "business", projectId: "P", projectCode: "P" });
    const params = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(params.get("project_id")).toBe("P"); expect(params.get("return_to")).toBe("#/projects/portfolio?q=release&project_id=P");
  });
  it("keeps a failed creation open with its draft and only closes/selects after success", async () => {
    button("create").onClick();
    find(render(), Input, (props) => props.value === "" && !props["aria-label"])!.onChange({ target: { value: "Retained draft" } });
    vi.mocked(api.createProject).mockRejectedValueOnce(new Error("invalid path"));
    await find(render(), Modal)!.onOk();
    expect(find(render(), Modal)!.open).toBe(true); expect(find(render(), Input, (props) => props.value === "Retained draft")).toBeDefined();
    vi.mocked(api.createProject).mockResolvedValueOnce({ id: "new-project" });
    await find(render(), Modal)!.onOk();
    expect(find(render(), Modal)!.open).toBe(false); expect(window.location.hash).toContain("project_id=new-project"); expect(setWorkspaceScope).not.toHaveBeenCalled();
    expect(vi.mocked(api.createProject).mock.calls[1][0]).toMatchObject({ name: "Retained draft", status: "planning" });
  });
  it("distinguishes empty inventory, no matches and failed facts without fabricated zero data", () => {
    hooks.empty = true;
    expect(find(render(), Empty)!.description).toBe("projectPortfolio.noMatches");
    window.location.hash = "#/projects/portfolio";
    expect(find(render(), Empty)!.description).toBe("projectPortfolio.empty");
    hooks.error = true; hooks.noData = true;
    expect(find(render(), Alert)!.title).toBe("projectPortfolio.refreshFailed");
    expect(find(render(), Empty)).toBeUndefined();
  });
});
describe("cross-project deep link gate", () => {
  const Child = () => null;
  it("withholds target contents until explicit entry, preserving the original exact route", () => {
    window.location.hash = "#/tasks/execution?project_id=P&task_id=T&return_to=%23%2Fprojects%2Fportfolio%3Fq%3Drelease";
    let tree = ProjectContextGate({ children: createElement(Child) });
    expect(find(tree, Child)).toBeUndefined(); expect(setWorkspaceScope).not.toHaveBeenCalled();
    find(tree, Button, (props) => props.children === "projectPortfolio.enter")!.onClick();
    expect(setWorkspaceScope).toHaveBeenCalledWith(expect.objectContaining({ projectId: "P" })); expect(window.location.hash).toContain("task_id=T");
    hooks.currentProject = "P";
    tree = ProjectContextGate({ children: createElement(Child) });
    expect(find(tree, Child)).toBeDefined();
    expect(find(tree, Button, (props) => props.href === "#/projects/portfolio?q=release")).toBeDefined();
  });
});
