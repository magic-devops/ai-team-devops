import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Button, Input } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectInspector } from "../../subapps/main-admin/src/pages/projects/ProjectInspector";
import { submitProjectCommand } from "./projectPortfolio";
import { portfolioDetail } from "./projectPortfolioFixtures";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], next: 0, data: null as unknown }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useEffect: () => {}, useRef: (value: unknown) => ({ current: value }), useState: (initial: unknown) => { const index = hooks.next++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial; return [hooks.state[index], (change: unknown) => { hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change; }]; } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./projectPortfolio", async () => ({ ...await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio"), projectSessionKey: () => "session", submitProjectCommand: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: hooks.data, isError: false, isLoading: false, refetch: async () => ({ data: hooks.data }) }) }));
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, any>) => boolean): Record<string, any> | undefined { if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean); if (!isValidElement<Record<string, any>>(node)) return undefined; if (node.type === type && predicate(node.props)) return node.props; return find(node.props.children, type, predicate); }
const saved = vi.fn();
function render() { hooks.next = 0; const drawer = ProjectInspector({ projectId: "P", background: "#/projects/portfolio?project_id=P", businesses: [], sessionKey: "session", onClose: vi.fn(), onSaved: saved }); const content = drawer.props.children as ReactElement; return (content.type as (props: unknown) => ReactNode)(content.props); }
const button = (key: string) => find(render(), Button, (props) => (Array.isArray(props.children) ? props.children[0] : props.children) === `projectPortfolio.${key}`)!;
beforeEach(() => { hooks.state = []; hooks.next = 0; hooks.data = structuredClone(portfolioDetail); saved.mockClear(); vi.mocked(submitProjectCommand).mockReset(); });
describe("project metadata remains a fixed user draft", () => {
  it("preserves edited fields when background facts change and requires explicit adoption after conflict", async () => {
    button("configure").onClick();
    find(render(), Input, (props) => props.value === "Release project")!.onChange({ target: { value: "My retained title" } });
    hooks.data = { ...portfolioDetail, project: { ...portfolioDetail.project, version: 9, name: "Other editor title" } };
    expect(find(render(), Input, (props) => props.value === "My retained title")).toBeDefined();
    vi.mocked(submitProjectCommand).mockRejectedValueOnce(new Error("HTTP 409"));
    await button("save").onClick();
    expect(vi.mocked(submitProjectCommand).mock.calls[0]).toEqual(["P", "project.update", expect.objectContaining({ name: "My retained title" }), expect.objectContaining({ version: 7 })]);
    expect(button("save").disabled).toBe(true);
    await button("readLatest").onClick(); expect(submitProjectCommand).toHaveBeenCalledOnce();
    button("adopt").onClick(); vi.mocked(submitProjectCommand).mockResolvedValueOnce({}); await button("save").onClick();
    expect(vi.mocked(submitProjectCommand).mock.calls[1][3]).toMatchObject({ version: 9 }); expect(saved).toHaveBeenCalledOnce();
    expect(vi.mocked(submitProjectCommand).mock.calls[1][2]).not.toHaveProperty("status"); expect(vi.mocked(submitProjectCommand).mock.calls[1][2]).not.toHaveProperty("vector_db_config");
  });
  it("keeps archived metadata read only while providing the independent lifecycle restore action", () => {
    hooks.data = { ...portfolioDetail, project: { ...portfolioDetail.project, status: "archived", permissions: { ...portfolioDetail.project.permissions, can_configure: false, can_write: false, can_restore: true, can_transition: true } } };
    expect(button("configure").disabled).toBe(true); expect(button("restore").disabled).toBe(false);
  });
});
