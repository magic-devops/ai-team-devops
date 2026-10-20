import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Requirements, type RequirementMode } from "../../subapps/ai-rd-center/src/pages/Requirements";
import { ProductRequirementsShell } from "../../subapps/ai-rd-center/src/pages/product/ProductRequirementsShell";
import { AiAssistDrawer } from "../components/ai/AiAssistDrawer";
import { SearchInput, LoadingBlock } from "../components/PageStates";
import { ProjectScopeNotice } from "../components/ProjectContextGate";
import { WorkbenchShell } from "../pages/shared/WorkbenchShell";
import { WorkbenchStats } from "../pages/shared/workbenchUi";
import { setSession } from "./authStorage";

const QUERY_NAMES = ["requirements", "requirementsSummary", "requirementOpsPlan"] as const;
type QueryName = (typeof QUERY_NAMES)[number];
const PRIVATE_ROW = "cached-private-requirement";
const PRIVATE_RISK = "cached-private-risk";
const h = vi.hoisted(() => ({
  states: [] as any[], next: 0, options: [] as any[],
  results: {} as Record<string, any>, retries: {} as Record<string, ReturnType<typeof vi.fn>>,
  writes: [] as unknown[], invalidations: [] as unknown[],
}));

vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.states)) h.states[index] = typeof initial === "function" ? initial() : initial;
    return [h.states[index], (value: any) => { h.states[index] = typeof value === "function" ? value(h.states[index]) : value; }];
  },
  useMemo: (read: () => unknown) => read(), useEffect: () => {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  i18n: { language: "en-US", resolvedLanguage: "en-US" },
}) }));
vi.mock("@tanstack/react-query", async () => ({
  ...await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query"),
  useQuery: (options: any) => {
    h.options.push(options);
    const key = String(options.queryKey[0]);
    return { ...h.results[key], refetch: h.retries[key] };
  },
  useMutation: () => ({
    isPending: false, isError: false, error: null,
    mutate: (value: unknown) => { h.writes.push(value); },
  }),
  useQueryClient: () => ({ invalidateQueries: (value: unknown) => { h.invalidations.push(value); } }),
}));

function nodes(node: ReactNode): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...["children", "actions", "action", "description", "metrics", "footer"].flatMap((key) => nodes(node.props[key]))];
}
function find(node: ReactNode, predicate: (value: ReactElement<any>) => boolean) { return nodes(node).find(predicate); }
function snapshot(node: ReactNode) { return JSON.stringify(node); }
function render(mode: RequirementMode = "pool") {
  h.next = 0;
  return Requirements({ initialMode: mode, focused: true });
}
function retry(tree: ReactNode, label: string) {
  const control = find(tree, (node) => node.props["aria-label"] === `${label}: common.refresh`);
  expect(control).toBeDefined();
  control!.props.onClick();
}
function expectOnlyRetried(name: QueryName) {
  for (const query of QUERY_NAMES) expect(h.retries[query]).toHaveBeenCalledTimes(query === name ? 1 : 0);
  expect(h.writes).toEqual([]);
  expect(h.invalidations).toEqual([]);
}
function fail(name: QueryName, message: string) {
  h.results[name] = { ...h.results[name], status: "error", isSuccess: false, isError: true, error: new Error(message) };
}
function pending(name: QueryName) {
  h.results[name] = { data: undefined, status: "pending", error: null, isSuccess: false, isError: false, isPending: true, isLoading: true, isFetching: true };
}
function opsCard(tree: ReactNode) { return find(tree, (node) => node.props.title === "page.requirements.opsPlan")!; }

beforeEach(() => {
  vi.clearAllMocks(); h.states = []; h.next = 0; h.options = []; h.writes = []; h.invalidations = [];
  const ready = (data: unknown) => ({ data, status: "success", isSuccess: true, isError: false, error: null, isPending: false, isLoading: false, isFetching: false });
  h.results = {
    requirements: ready([{ id: "REQ-private", title: PRIVATE_ROW, description: "Original private requirement body", status: "pending", priority: "P1", acceptance_criteria: ["Original private acceptance"] }]),
    requirementsSummary: ready({ summary: { total: 765432, by_status: { pending: 765430, in_progress: 1, completed: 1 }, by_priority: { P1: 765432 }, ready: 1, completed: 1, completion_rate: 0.1 } }),
    requirementOpsPlan: ready({ health: { score: 87, grade: "healthy", avg_review_score: 82 }, summary: { needs_work: 0, high_priority_without_tasks: 0 }, risks: [{ id: "risk-private", title: PRIVATE_RISK, severity: "P1", category: "quality", description: "Original private risk", command: "sop requirement show REQ-risk" }] }),
  };
  h.retries = Object.fromEntries(QUERY_NAMES.map((name) => [name, vi.fn().mockResolvedValue({})]));
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  const location = { hash: "#/requirements/pool?project_id=P", pathname: "/", search: "" };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("account-a", "P", "tenant-a");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Requirements current read recovery consumers", () => {
  const accessCases = QUERY_NAMES.flatMap((query) => [
    "HTTP 401: original session is no longer valid",
    "HTTP 403: current project is forbidden",
    "HTTP 404: current project no longer exists",
    "账号或项目已切换，请在当前工作区重新操作",
  ].map((message) => ({ query, message })));
  it.each(accessCases)("hides all cached business content and offers project recovery for $query / $message", ({ query, message }) => {
    fail(query, message);
    const tree = render("generation");
    expect(find(tree, (node) => node.type === WorkbenchShell)).toBeUndefined();
    expect(find(tree, (node) => node.type === ProductRequirementsShell)).toBeUndefined();
    expect(find(tree, (node) => node.type === AiAssistDrawer)).toBeUndefined();
    expect(snapshot(tree)).not.toContain(PRIVATE_ROW);
    expect(snapshot(tree)).not.toContain(PRIVATE_RISK);
    expect(snapshot(tree)).not.toContain("765432");
    const recovery = find(tree, (node) => node.type === ProjectScopeNotice);
    expect(recovery).toBeDefined();
    const renderedRecovery = ProjectScopeNotice(recovery!.props);
    expect(find(renderedRecovery, (node) => typeof node.props.href === "string" && /^#\/projects(?:\/portfolio)?(?:\?|$)/.test(node.props.href))).toBeDefined();
    expect(snapshot(renderedRecovery)).toContain(message);
    expect(h.writes).toEqual([]);
  });

  it.each(["pool", "review", "generation", "batch"] as RequirementMode[])("keeps search and a list-only retry while withholding a failed cached %s list", (mode) => {
    fail("requirements", "HTTP 500: requirement list temporarily unavailable");
    const tree = render(mode);
    expect(snapshot(tree)).not.toContain(PRIVATE_ROW);
    expect(snapshot(tree)).not.toContain("Original private acceptance");
    expect(find(tree, (node) => Array.isArray(node.props.requirements))).toBeUndefined();
    const search = find(tree, (node) => node.type === SearchInput);
    expect(search).toBeDefined();
    search!.props.onChange("retain my recovery search");
    const rerendered = render(mode);
    expect(find(rerendered, (node) => node.type === SearchInput)?.props.value).toBe("retain my recovery search");
    const currentOptions = h.options.filter((options) => options.queryKey[0] === "requirements");
    expect(currentOptions[currentOptions.length - 1].queryKey).toContain("retain my recovery search");
    retry(rerendered, "page.requirements.list");
    expectOnlyRetried("requirements");
    expect(find(rerendered, (node) => node.type === AiAssistDrawer)?.props.context).toBeUndefined();
  });

  it.each(["review", "generation"] as const)("removes an already selected %s panel after the current list read fails", (mode) => {
    const before = render(mode);
    const workbench = find(before, (node) => Array.isArray(node.props.requirements) && typeof node.props.onPickReview === "function");
    expect(workbench).toBeDefined();
    if (mode === "review") workbench!.props.onPickReview("REQ-private");
    else workbench!.props.onPickGeneration(h.results.requirements.data[0]);
    fail("requirements", "HTTP 500: current list read failed after selection");
    const after = render(mode);
    expect(find(after, (node) => Array.isArray(node.props.requirements))).toBeUndefined();
    expect(snapshot(after)).not.toContain(PRIVATE_ROW);
    expect(snapshot(after)).not.toContain("REQ-private");
    expect(find(after, (node) => node.type === SearchInput)).toBeDefined();
  });

  it("shows unavailable summary metrics instead of cached totals or filtered-list substitutes, with an independent retry", () => {
    fail("requirementsSummary", "HTTP 500: summary temporarily unavailable");
    const tree = render();
    const metrics = find(tree, (node) => node.type === WorkbenchStats);
    expect(metrics).toBeDefined();
    expect(metrics!.props.items.map((item: { value: unknown }) => item.value)).toEqual(["—", "—", "—", "—"]);
    expect(find(tree, (node) => node.type === ProductRequirementsShell)?.props.factsReady).toBe(false);
    expect(snapshot(tree)).not.toContain("765432");
    expect(snapshot(tree)).toContain(PRIVATE_ROW);
    retry(tree, "page.requirements.total");
    expectOnlyRetried("requirementsSummary");
  });

  it("does not manufacture zero summary facts before the first summary arrives", () => {
    pending("requirementsSummary");
    const tree = render();
    expect(find(tree, (node) => node.type === WorkbenchStats)?.props.items.every((item: { value: unknown }) => item.value === "—")).toBe(true);
    expect(find(tree, (node) => node.type === ProductRequirementsShell)?.props.factsReady).toBe(false);
    expect(snapshot(tree)).toContain(PRIVATE_ROW);
  });

  it("withholds a failed cached ops plan, health and no-risks claim while retrying only the plan", () => {
    fail("requirementOpsPlan", "HTTP 500: current ops plan unavailable");
    const tree = render();
    const ops = opsCard(tree);
    expect(ops).toBeDefined();
    expect(snapshot(ops)).not.toContain(PRIVATE_RISK);
    expect(snapshot(ops)).not.toContain("page.requirements.opsNoRisks");
    expect(find(ops, (node) => node.props.title === "page.requirements.opsHealth")).toBeUndefined();
    for (const label of ["page.requirements.opsPreview", "page.requirements.opsCreate"])
      expect(find(ops, (node) => node.props.children === label)?.props.disabled).toBe(true);
    retry(ops, "page.requirements.opsPlan");
    expectOnlyRetried("requirementOpsPlan");
    expect(snapshot(tree)).toContain(PRIVATE_ROW);
  });

  it("shows loading rather than health zero or no risks before the first ops response", () => {
    pending("requirementOpsPlan");
    const tree = render();
    const ops = opsCard(tree);
    expect(find(ops, (node) => node.type === LoadingBlock)).toBeDefined();
    expect(find(ops, (node) => node.props.title === "page.requirements.opsHealth")).toBeUndefined();
    expect(snapshot(ops)).not.toContain("page.requirements.opsNoRisks");
    for (const label of ["page.requirements.opsPreview", "page.requirements.opsCreate"])
      expect(find(ops, (node) => node.props.children === label)?.props.disabled).toBe(true);
  });

  it("retains a positive successful empty-plan state and real summary metrics", () => {
    h.results.requirementOpsPlan.data = { ...h.results.requirementOpsPlan.data, risks: [] };
    const tree = render();
    const ops = opsCard(tree);
    expect(find(ops, (node) => node.props.title === "page.requirements.opsHealth")?.props.value).toBe(87);
    const table = find(ops, (node) => node.props.locale?.emptyText === "page.requirements.opsNoRisks");
    expect(table?.props.dataSource).toEqual([]);
    expect(find(tree, (node) => node.type === WorkbenchStats)?.props.items[0].value).toBe(765432);
    expect(find(tree, (node) => node.type === ProductRequirementsShell)?.props.factsReady).toBe(true);
    expect(snapshot(tree)).toContain(PRIVATE_ROW);
  });

  it.each(QUERY_NAMES)("rejects the retained %s query before it can read through a switched session", async (query) => {
    render();
    const oldOptions = h.options.find((options) => options.queryKey[0] === query);
    expect(oldOptions).toBeDefined();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    setSession("account-b", "Q", "tenant-b");
    await expect(Promise.resolve().then(() => oldOptions.queryFn())).rejects.toThrow("账号或项目已切换，请在当前工作区重新操作");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
