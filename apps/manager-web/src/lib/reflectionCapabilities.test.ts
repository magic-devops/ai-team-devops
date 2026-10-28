import { beforeEach, describe, expect, it, vi } from "vitest";
import { flattenCapabilityGrants, useCapabilities } from "./capabilities";
import { filterNavByRole } from "../navigation";
const h = vi.hoisted(() => ({ project: "P", session: "S", query: null as any, options: [] as any[] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => { h.options.push(options); return h.query; } }));
vi.mock("./authStorage", async () => ({ ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")), getToken: () => "token", getProjectId: () => h.project }));
vi.mock("./projectPortfolio", async () => ({ ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")), projectSessionKey: () => h.session }));
function grant(write = false) {
  return { id: "reflectionIntake", capability: "ai.intelligence.reflections", permission_scope: "project", project_id: "P", allowed: { read: true, write, admin: false }, visible: true, actions: [{ id: "write", capability: "ai.intelligence.reflections.write", roles: ["developer"] }] };
}
beforeEach(() => { h.project = "P"; h.session = "S"; h.options = []; h.query = { data: { role: "developer", items: [grant()], visible_items: [grant()] }, error: null, status: "success", isPending: false }; });
describe("actual project-scoped reflection capability hook", () => {
  it("keys the actual capability read by the current project and account session", () => {
    useCapabilities(); h.project = "Q"; h.session = "Q-session"; useCapabilities();
    expect(h.options.map((options) => options.queryKey)).toEqual([["systemPagesCapabilitiesMe", "P", "S"], ["systemPagesCapabilitiesMe", "Q", "Q-session"]]);
  });
  it("does not retain cached grants when the current capability request is forbidden", () => {
    h.query.error = new Error("HTTP 403: denied"); h.query.status = "error";
    const current = useCapabilities();
    expect(current.can("ai.intelligence.reflections", "read")).toBe(false);
    expect(current.items).toEqual([]);
  });
  it("does not apply the previous project's explicit grants to the current project", () => {
    h.project = "Q";
    expect(useCapabilities().can("ai.intelligence.reflections", "read")).toBe(false);
  });
  it("does not retain the previous project's real navigation entry from a stale visible grant", () => {
    h.project = "Q";
    const current = useCapabilities();
    expect(filterNavByRole(current.role, current.items).some((item) => item.key === "reflectionIntake")).toBe(false);
  });
  it("keeps a project reader's write action denied even if the global role is developer", () => {
    const values = (flattenCapabilityGrants as any)([grant(false)], "developer", "P");
    expect(values.find((value: any) => value.capability === "ai.intelligence.reflections.write").allowed.write).toBe(false);
  });
  it("lets the actual project developer write even if its global role is viewer", () => {
    h.query.data.role = "viewer"; h.query.data.items = [grant(true)];
    expect(useCapabilities().can("ai.intelligence.reflections.write", "write")).toBe(true);
  });
  it("fails closed for a project grant without a verified current project identity", () => {
    h.query.data.items[0].project_id = null;
    expect(useCapabilities().can("ai.intelligence.reflections", "read")).toBe(false);
  });
});
