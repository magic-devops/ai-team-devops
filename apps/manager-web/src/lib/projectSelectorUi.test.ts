import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSelector } from "../components/ProjectSelector";
import { setWorkspaceScope } from "./authStorage";
const state = vi.hoisted(() => ({ projectId: "missing", businessCode: "", effects: [] as (() => void)[] }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useEffect: (effect: () => void) => state.effects.push(effect), useMemo: (value: () => unknown) => value() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./authStorage", () => ({ getProjectId: () => state.projectId, getBusinessCode: () => state.businessCode, getTenantCode: () => "tenant", getToken: () => "token", setWorkspaceScope: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "projects" ? [{ id: "first", name: "First", business_id: "business", tenant_code: "tenant", status: "active" }, { id: "old", name: "Archived", status: "archived" }] : queryKey[0] === "businesses" ? [{ id: "business", name: "Business" }] : { tenant_id: "tenant" }, isLoading: false }) }));
function find(node: ReactNode, predicate: (props: Record<string, any>) => boolean): Record<string, any> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return undefined;
  if (predicate(node.props)) return node.props;
  return find(node.props.children, predicate);
}
beforeEach(() => { vi.mocked(setWorkspaceScope).mockClear(); state.effects = []; state.projectId = "missing"; state.businessCode = ""; vi.stubGlobal("window", { location: { hash: "#/dev-flow?task=old-task" } }); });
describe("explicit project selection", () => {
  it("retains an unavailable nonempty current identity instead of adopting the first project", () => {
    const tree = ProjectSelector(); state.effects.forEach((effect) => effect());
    expect(setWorkspaceScope).not.toHaveBeenCalled();
    expect(find(tree, (props) => props.value === "missing" && props.disabled === true)).toBeDefined();
  });
  it("changing business leaves project unselected and drops the old entity route", () => {
    const tree = ProjectSelector();
    find(tree, (props) => props["aria-label"] === "projectSelector.businessLabel")!.onChange({ target: { value: "business" } });
    expect(setWorkspaceScope).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null, businessCode: "business" }));
    expect(window.location.hash).toBe("#/dev-flow?view=overview");
  });
  it("does not offer archived projects for new work but retains the current archived identity", () => {
    let tree = ProjectSelector();
    expect(find(tree, (props) => props.value === "old")).toBeUndefined();
    state.projectId = "old";
    tree = ProjectSelector();
    expect(find(tree, (props) => props.value === "old" && props.disabled === true)).toBeDefined();
  });
});
