import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunsWorkbench } from "../../subapps/ai-foundation/src/pages/ai/AgentRunsWorkbench";
import { AgentOpsHub } from "../../subapps/ai-foundation/src/pages/ai/AgentOpsHub";
import { ProjectContextGate } from "../components/ProjectContextGate";
import { ProjectScopeNotice } from "../components/ProjectContextGate";
import { WorkbenchShell } from "../pages/shared/WorkbenchShell";
import { WorkbenchStats } from "../pages/shared/workbenchUi";
import { Table } from "antd";
import { setSession } from "./authStorage";

const h = vi.hoisted(() => ({ states: [] as any[], next: 0, options: [] as any[], results: {} as Record<string, any>, retries: {} as Record<string, ReturnType<typeof vi.fn>>, writes: [] as unknown[] }));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: any) => { const i = h.next++; if (!(i in h.states)) h.states[i] = typeof initial === "function" ? initial() : initial; return [h.states[i], (value: any) => { h.states[i] = typeof value === "function" ? value(h.states[i]) : value; }]; },
  useEffect: () => {}, useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
vi.mock("@tanstack/react-query", async () => ({
  ...await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query"),
  useQuery: (options: any) => { h.options.push(options); return { ...h.results[options.queryKey[0]], refetch: h.retries[options.queryKey[0]] }; },
  useMutation: () => ({ mutate: (value: unknown) => h.writes.push(value) }),
}));
function nodes(node: ReactNode): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...["children", "actions", "action", "description", "metrics", "footer", "extra"].flatMap((key) => nodes(node.props[key]))];
}
function render(tab: "runs" | "heartbeat" | "profiles" | "retry" = "runs") {
  h.next = 0;
  const gate = AgentRunsWorkbench({ focused: true, initialTab: tab });
  const child = gate.props.children as ReactElement<any>;
  return (child.type as (props: any) => ReactNode)(child.props);
}
const row = { id: "E-intent", task_id: "T-task", workspace_id: "W-runtime", status: "failed", run_id: "R-provider", run_version: 3, progress: 40, created_at: "2026-10-20T00:00:00Z", stale: false, attempt: 2 };
const ready = (data: unknown) => ({ data, error: null, isPending: false, isLoading: false, isFetching: false, isError: false });
beforeEach(() => {
  vi.clearAllMocks(); h.next = 0; h.states = []; h.options = []; h.writes = [];
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { hash: "#/ai/agent-ops/runs?project_id=P" } }));
  setSession("account-a", "P", "tenant-a");
  h.results = {
    "delivery-agent-context": ready({ project_id: "P", project: { id: "P", name: "Project" }, version: 8, query_generation: 4, query_state: { status: "ready" }, permissions: { write: true } }),
    "delivery-agent-executions": ready({ project_id: "P", items: [row], total: 21, next_cursor: "exact+opaque:next", limit: 20, query_generation: 4, as_of: "now" }),
    "delivery-agent-bindings": ready({ project_id: "P", members: [{ member_id: "M-agent", status: "current", binding_basis: "basis", binding: { workspace_id: "W-runtime", agent_id: "A-profile", agent_version: 2, source: { agent_title: "Actual profile", workspace_name: "Actual workspace", provider: "codex" } }, reasons: [], permissions: { can_bind: true, can_unbind: true } }], workspaces: [], runtime_configured: true }),
    "delivery-agent-runtime": ready(undefined),
  };
  h.retries = Object.fromEntries(Object.keys(h.results).map((key) => [key, vi.fn().mockResolvedValue({})]));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual AgentOps canonical consumers (definitions; execution deferred)", () => {
  it("routes the actual hub through the same project gate and canonical four-scenario consumer", () => {
    const hub = AgentOpsHub();
    expect(hub.type).toBe(AgentRunsWorkbench);
    const gate = (hub.type as typeof AgentRunsWorkbench)(hub.props);
    expect(gate.type).toBe(ProjectContextGate); expect(gate.props.requireSelection).toBe(true);
    const child = gate.props.children as ReactElement<any>;
    (child.type as (props: any) => ReactNode)(child.props);
    expect(h.options.every((query) => String(query.queryKey[0]).startsWith("delivery-agent-"))).toBe(true);
    expect(h.writes).toEqual([]);
  });
  it("uses scoped canonical bounded queries and does not instantiate legacy mutation controls", () => {
    render();
    expect(h.options.map((q) => q.queryKey[0])).toEqual(["delivery-agent-context", "delivery-agent-executions", "delivery-agent-bindings", "delivery-agent-runtime"]);
    for (const query of h.options) { expect(query.queryKey).toContain("P"); expect(query.queryKey.some((value: unknown) => typeof value === "string" && value.includes("account-a"))).toBe(false); }
    expect(h.options.find((q) => q.queryKey[0] === "delivery-agent-runtime").enabled).toBe(false);
    expect(h.writes).toEqual([]);
  });
  it("enters exact formal execution/attempt, standalone task and independent workspace", () => {
    const tree = render();
    const text = JSON.stringify(tree);
    expect(text).toContain("execution_id=E-intent"); expect(text).toContain("execution_attempt=2");
    expect(text).toContain("task_id=T-task"); expect(text).toContain("#/workspace");
    expect(text).not.toContain("success_rate"); expect(text).not.toContain("confidence");
    expect(h.writes).toEqual([]);
  });
  it("stores current tab/filter/cursor in formal-entry return URLs", () => {
    window.location.hash = "#/ai/agent-ops/retry?project_id=P&q=T-task&status=failed&cursor=source%2Bcursor";
    const tree = render("retry");
    const link = nodes(tree).find((node) => typeof node.props.href === "string" && node.props.href.includes("execution_id=E-intent"))!;
    expect(new URLSearchParams(link.props.href.split("?")[1]).get("return_to")).toBe(window.location.hash);
  });
  it.each([
    { key: "delivery-agent-context", tab: "runs" as const }, { key: "delivery-agent-executions", tab: "runs" as const },
    { key: "delivery-agent-bindings", tab: "profiles" as const }, { key: "delivery-agent-runtime", tab: "heartbeat" as const },
  ])("suppresses all cached business content for access failure in $key", ({ key, tab }) => {
    window.location.hash = `#/ai/agent-ops/${tab}?project_id=P&inspect=E-intent`;
    h.results[key] = { ...h.results[key], error: new Error("HTTP 403: denied"), isError: true };
    const tree = render(tab);
    expect(nodes(tree).find((node) => node.type === ProjectScopeNotice)).toBeDefined();
    expect(nodes(tree).find((node) => node.type === WorkbenchShell)).toBeUndefined();
    expect(JSON.stringify(tree)).not.toContain("Actual profile");
  });
  it("suppresses ordinary failed list cache and shows unavailable metrics with a read-only retry", () => {
    h.results["delivery-agent-executions"].error = new Error("HTTP 503: read unavailable");
    const tree = render();
    expect(JSON.stringify(tree)).not.toContain("R-provider");
    const stats = nodes(tree).find((node) => node.type === WorkbenchStats)!;
    expect(stats.props.items.every((item: any) => item.value === "—")).toBe(true);
    nodes(tree).find((node) => node.props["aria-label"] === "Retry execution records")!.props.onClick();
    expect(h.retries["delivery-agent-executions"]).toHaveBeenCalledTimes(1);
    expect(h.writes).toEqual([]);
  });
  it("retains exact next cursor and resets filters to the first page", () => {
    let tree = render();
    nodes(tree).find((node) => node.props["aria-label"] === "Next execution page")!.props.onClick();
    expect(new URLSearchParams(window.location.hash.split("?")[1]).get("cursor")).toBe("exact+opaque:next");
    tree = render();
    const search = nodes(tree).find((node) => node.props.placeholder === "Search this page by execution, task or workspace")!;
    search.props.onChange("T-next");
    const params = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(params.get("cursor")).toBeNull(); expect(params.get("q")).toBe("T-next");
  });
  it("keeps empty local-window state distinct from a server page with more records", () => {
    window.location.hash = "#/ai/agent-ops/heartbeat?project_id=P";
    const tree = render("heartbeat");
    expect(JSON.stringify(tree)).toContain("No matching execution in this page");
    expect(nodes(tree).find((node) => node.props["aria-label"] === "Next execution page")!.props.disabled).toBe(false);
    expect(JSON.stringify(tree)).toContain("Filters apply to this page of up to 20 records");
  });
  it("uses actual member binding facts and a precise selected-member link", () => {
    window.location.hash = "#/ai/agent-ops/profiles?project_id=P";
    const tree = render("profiles");
    expect(JSON.stringify(tree)).toContain("Actual profile");
    expect(JSON.stringify(tree)).toContain("team_member=M-agent");
    expect(h.options.find((q) => q.queryKey[0] === "delivery-agent-bindings").enabled).toBe(true);
    expect(h.options.find((q) => q.queryKey[0] === "delivery-agent-executions").enabled).toBe(false);
  });
  it("hides failed binding cache and never offers a stale profile as an executable fallback", () => {
    window.location.hash = "#/ai/agent-ops/profiles?project_id=P";
    h.results["delivery-agent-bindings"].error = new Error("HTTP 503: catalogue unavailable");
    expect(JSON.stringify(render("profiles"))).not.toContain("Actual profile");
    expect(h.writes).toEqual([]);
  });
  it("enables only the exact selected runtime query and hides its failed cached observation", () => {
    window.location.hash = "#/ai/agent-ops/heartbeat?project_id=P&inspect=E-intent";
    h.results["delivery-agent-runtime"] = { ...ready({ execution_id: "E-intent", run_id: "cached-runtime-private", nodes: [] }), error: new Error("HTTP 503: observation unavailable") };
    const tree = render("heartbeat");
    const options = h.options.find((q) => q.queryKey[0] === "delivery-agent-runtime");
    expect(options.enabled).toBe(true); expect(options.queryKey).toContain("E-intent");
    expect(JSON.stringify(tree)).not.toContain("cached-runtime-private");
  });
  it("does not render stale business records while query projection needs rebuilding", () => {
    h.results["delivery-agent-context"].data.query_state.status = "rebuild_required";
    const tree = render();
    expect(JSON.stringify(tree)).not.toContain("R-provider");
    expect(nodes(tree).find((node) => node.type === Table)).toBeUndefined();
    expect(h.options.find((q) => q.queryKey[0] === "delivery-agent-executions").enabled).toBe(false);
  });
});
