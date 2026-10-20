import { isValidElement, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsOverviewWorkbench } from "../../subapps/ai-data-center/src/pages/data/AnalyticsOverviewWorkbench";
import { GlobalSearchWorkbench } from "../../subapps/ai-rd-center/src/pages/ai/GlobalSearchWorkbench";
import { KnowledgeGraphHub } from "../../subapps/ai-foundation/src/pages/ai/KnowledgeGraphHub";
import { Analytics } from "../../subapps/ai-data-center/src/pages/Analytics";
import { api } from "./api";
import { setSession } from "./authStorage";

const h = vi.hoisted(() => ({
  mode: "no-project", options: [] as any[], states: [] as any[], next: 0,
  businessCalls: [] as string[], downloaded: 0,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial;
    return [h.states[index], (value: any) => { h.states[index] = typeof value === "function" ? value(h.states[index]) : value; }];
  },
  useEffect: () => {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  const read = (name: string, value: unknown) => vi.fn(async () => { h.businessCalls.push(name); return value; });
  return { ...actual, api: { ...actual.api,
    analyticsOverview: read("analyticsOverview", { ok: true, project_id: "P", metrics: {}, nlq: { enabled: true, hint: "POST /api/v1/analytics/nlq" } }),
    analyticsCharts: read("analyticsCharts", { ok: true, project_id: "P", task_status: [], issue_priority: [], activity_trend: { days: [], series: [] } }),
    workspaceSearch: read("workspaceSearch", []),
    semanticSearchStatus: read("semanticSearchStatus", { available: false, tables: [], default_tables: "tasks" }),
    semanticSearch: read("semanticSearch", { available: false, items: [] }),
  } };
});
vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")),
  useQuery: (options: any) => {
    h.options.push(options);
    if (h.mode === "no-project" && options.enabled !== false) void options.queryFn({ signal: new AbortController().signal });
    const key = options.queryKey[0];
    let data: any = {};
    if (key === "analyticsOverview") data = { ok: true, project_id: "P", metrics: {}, nlq: { enabled: true, hint: "POST /api/v1/analytics/nlq" } };
    if (key === "analyticsCharts") data = { ok: true, project_id: "P", task_status: [], issue_priority: [], activity_trend: { days: [], series: [] } };
    if (key === "workspaceSearchPage") data = [];
    if (key === "semanticSearchPage") data = { available: false, items: [] };
    if (key === "semanticSearchStatus") data = { available: false, tables: [], default_tables: "tasks" };
    if (key === "dataExchangeSummary") data = { project_id: "P", total: 1, modules: [{ name: "tasks", kind: "sql", count: 1 }] };
    if (key === "dataExchangeJobs") data = { items: [] };
    if (key === "knowledgeGraphSummary") data = { project_id: "P", summary: { nodes: 987654321, edges: 0, entity_types: 0, last_built_at: "cached-project-P-graph" } };
    const error = h.mode === "denied" ? new Error("HTTP 403: current project denied") : null;
    return { data, error, isError: !!error, status: error ? "error" : "success", isPending: false, isLoading: false, isFetching: false, refetch: vi.fn() };
  },
  useMutation: (options: any) => ({
    isPending: false, isError: false, data: undefined, error: null,
    mutate: async (value: unknown) => {
      try { const data = await options.mutationFn(value); options.onSuccess?.(data); return data; }
      catch (error) { options.onError?.(error); return undefined; }
    },
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

function find(node: ReactNode, predicate: (node: any) => boolean): any {
  if (Array.isArray(node)) return node.map((value) => find(value, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (predicate(node)) return node.props;
  return find(node.props.children, predicate) || find(node.props.actions, predicate) || find(node.props.footer, predicate);
}
const projectLink = /href="#\/projects(?:\/portfolio)?(?:\?|\")/;
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.clearAllMocks();
  h.mode = "no-project"; h.options = []; h.states = []; h.next = 0; h.businessCalls = []; h.downloaded = 0;
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  const location = { hash: "#/search?q=project-task", pathname: "/", search: "", href: "http://localhost/#/search?q=project-task" };
  const target = Object.assign(new EventTarget(), { location, setTimeout, clearTimeout });
  vi.stubGlobal("location", location); vi.stubGlobal("window", target);
  setSession("account-a", null, "tenant-a");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual project data consumer scope regressions", () => {
  it("does not issue analytics overview business reads without a selected project and offers a real project entry", async () => {
    const html = renderToStaticMarkup(createElement(AnalyticsOverviewWorkbench));
    await settle();
    expect(api.analyticsOverview).not.toHaveBeenCalled();
    expect(api.analyticsCharts).not.toHaveBeenCalled();
    expect(h.options.every((options) => options.enabled === false)).toBe(true);
    expect(html).toMatch(projectLink);
  });

  it("does not search business data without a selected project while keeping the project entry reachable", async () => {
    const html = renderToStaticMarkup(createElement(GlobalSearchWorkbench));
    await settle();
    expect(h.businessCalls).toEqual([]);
    expect(h.options.every((options) => options.enabled === false)).toBe(true);
    expect(html).toMatch(projectLink);
  });

  it("hides a cached knowledge graph after current project denial and offers a project recovery action", () => {
    h.mode = "denied"; setSession("account-a", "P", "tenant-a");
    const html = renderToStaticMarkup(createElement(KnowledgeGraphHub));
    expect(html).not.toContain("cached-project-P-graph");
    expect(html).not.toContain("987654321");
    expect(html).not.toContain("987,654,321");
    expect(html).toMatch(projectLink);
  });

  it("downloads through the actual Analytics export callback with original auth/project and rejects that old callback after session switch", async () => {
    h.mode = "export"; setSession("account-a", "P", "tenant-a");
    const tree = Analytics({ section: "exchange" });
    const control = find(tree, (node) => Array.isArray(node.props.children) && node.props.children.includes("page.analytics.exportJson"));
    expect(control).toBeDefined();
    expect(control.href).toBeUndefined();
    expect(typeof control.onClick).toBe("function");
    const fetcher = vi.fn(async (_url: string | Request | URL, _init?: RequestInit) => new Response(JSON.stringify({ project_id: "P", modules: { tasks: [{ id: "original-project-task" }] } }), { status: 200, headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=project-export.json" } }));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:original-project");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchor = { href: "", download: "", click: () => { h.downloaded++; }, remove: () => {} };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: () => {} } });
    await control.onClick({ preventDefault: () => {} }); await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer account-a");
    expect(headers.get("X-Project-Id")).toBe("P");
    expect(String(fetcher.mock.calls[0][0])).toContain("/api/v1/data-exchange/export");
    expect(h.downloaded).toBe(1);
    setSession("account-b", "Q", "tenant-b");
    await control.onClick({ preventDefault: () => {} }); await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(h.downloaded).toBe(1);
  });

  it("does not create or save the actual Analytics export after the session changes during its blob read", async () => {
    h.mode = "export"; setSession("account-a", "P", "tenant-a");
    const tree = Analytics({ section: "exchange" });
    const control = find(tree, (node) => Array.isArray(node.props.children) && node.props.children.includes("page.analytics.exportJson"));
    expect(control).toBeDefined();
    expect(control.href).toBeUndefined();
    expect(typeof control.onClick).toBe("function");
    let finishBody!: (blob: Blob) => void;
    const body = new Promise<Blob>((resolve) => { finishBody = resolve; });
    const response = new Response(JSON.stringify({ project_id: "P", modules: { tasks: [{ id: "original-project-task" }] } }), {
      status: 200, headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=project-export.json" },
    });
    const readBlob = vi.spyOn(response, "blob").mockReturnValue(body);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:discarded-project");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    const anchor = { href: "", download: "", click, remove: () => {} };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: () => {} } });
    const pending = Promise.resolve(control.onClick({ preventDefault: () => {} })).catch((error: Error) => error);
    await settle();
    try {
      expect(readBlob).toHaveBeenCalledTimes(1);
      expect(createUrl).not.toHaveBeenCalled();
      setSession("account-b", "Q", "tenant-b");
    } finally {
      finishBody(new Blob(["private-project-P-export"], { type: "application/json" }));
    }
    await pending; await settle();
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
