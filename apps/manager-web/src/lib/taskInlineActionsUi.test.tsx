import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tasks } from "../../subapps/ai-rd-center/src/pages/Tasks";
import { setSession } from "./authStorage";
import { manualTaskHref } from "./deliveryTaskReview";
import { safeExecutionReturn } from "./executionCommands";

const h = vi.hoisted(() => ({
  states: [] as any[], next: 0, mutations: [] as any[], invalidations: [] as unknown[],
  rows: [{ id: "T-original", title: "Original task", status: "pending", priority: "P1", req_id: "" }],
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
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("@tanstack/react-query", async () => ({
  ...await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query"),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === "tasks" ? h.rows : queryKey[0] === "sprints" ? [] : undefined,
    isPending: false, isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }),
  useMutation: (options: any) => {
    h.mutations.push(options);
    return { isPending: false, isError: false, error: null,
      mutate: (variables: unknown) => {
        void (async () => {
          try { const data = await options.mutationFn(variables); await options.onSuccess?.(data, variables); }
          catch (error) { options.onError?.(error, variables); }
          finally { options.onSettled?.(undefined, undefined, variables); }
        })();
      },
    };
  },
  useQueryClient: () => ({ invalidateQueries: (value: unknown) => { h.invalidations.push(value); } }),
}));

function find(node: ReactNode, predicate: (node: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (predicate(node)) return node;
  return find(node.props.children, predicate) || find(node.props.description, predicate) || find(node.props.action, predicate);
}
function all(node: ReactNode, predicate: (node: ReactElement<any>) => boolean): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap((item) => all(item, predicate));
  if (!isValidElement<any>(node)) return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props.children, predicate), ...all(node.props.description, predicate), ...all(node.props.action, predicate)];
}
function render(tab: "list" | "board" = "board") {
  h.next = 0;
  const wrapper = Tasks({ initialTab: tab });
  const content = wrapper.props.children;
  return (content.type as (props: unknown) => ReactElement)(content.props);
}
function card(tree: ReactNode) { return find(tree, (node) => node.props.task?.id === "T-original")!; }
function notice(tree: ReactNode) { return find(tree, (node) => node.props["data-task-edit"] === "T-original"); }
async function settle() { for (let i = 0; i < 50; i++) await Promise.resolve(); }

beforeEach(() => {
  vi.clearAllMocks(); h.states = []; h.next = 0; h.mutations = []; h.invalidations = [];
  h.rows = [{ id: "T-original", title: "Original task", status: "pending", priority: "P1", req_id: "" }];
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  const location = { hash: "#/tasks/board?q=Original&status=pending&priority=P1&source=manual&project_id=P", pathname: "/", search: "" };
  const history = { state: null, replaceState: vi.fn((_state: unknown, _unused: string, url: string) => { location.hash = url; }) };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location, history }));
  setSession("account-a", "P", "tenant-a");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("task board actual inline edit feedback", () => {
  it.each([403, 409])("keeps the task in its original column and displays the real HTTP %s rejection", async (status) => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ detail: { code: "task_gate_blocked", message: "Resolve the dependency before changing status" } }), { status }));
    vi.stubGlobal("fetch", fetcher);
    const tree = render();
    const zones = all(tree, (node) => typeof node.props.onDrop === "function");
    zones[1].props.onDrop({ preventDefault() {}, dataTransfer: { getData: () => "T-original" } });
    await settle();
    const after = render();
    expect(h.rows[0].status).toBe("pending");
    expect(card(after).props.task.status).toBe("pending");
    expect(notice(after)).toBeDefined();
    expect(JSON.stringify(notice(after)?.props)).toContain("Resolve the dependency before changing status");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Project-Id")).toBe("P");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer account-a");
    expect(h.invalidations).toEqual([]);
    expect(all(notice(after), (node) => typeof node.props.onClick === "function")).toHaveLength(1);
  });

  it("prevents two stale drop/select callbacks from sending the same pending edit twice", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const original = card(render()).props;
    original.onStatus("T-original", "in_progress");
    original.onStatus("T-original", "completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(card(render()).props.busy).toBe(true);
    finish(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await settle();
    expect(card(render()).props.busy).toBe(false);
    expect(h.invalidations).toContainEqual({ queryKey: ["tasks"] });
  });

  it("shows the same rejection from the list's actual status selector without changing its controlled value", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Acceptance evidence must be reviewed" }), { status: 409 })));
    const tree = render("list");
    const table = find(tree, (node) => Array.isArray(node.props.columns) && node.props.columns.some((column: any) => column.dataIndex === "status"))!;
    const column = table.props.columns.find((value: any) => value.dataIndex === "status");
    const select = column.render("pending", h.rows[0]);
    select.props.onChange("completed"); await settle();
    const after = render("list");
    const currentTable = find(after, (node) => Array.isArray(node.props.columns) && node.props.columns.some((value: any) => value.dataIndex === "status"))!;
    expect(currentTable.props.columns.find((value: any) => value.dataIndex === "status").render("pending", h.rows[0]).props.value).toBe("pending");
    expect(JSON.stringify(notice(after)?.props)).toContain("Acceptance evidence must be reviewed");
  });

  it("uses a read-only recovery after a lost reply and does not retry a webhook-producing PATCH", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ ...h.rows[0], status: "in_progress" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    card(render()).props.onStatus("T-original", "in_progress"); await settle();
    const failed = render();
    expect(JSON.stringify(notice(failed)?.props)).toContain("Failed to fetch");
    expect(card(failed).props.busy).toBe(true);
    const read = find(notice(failed), (node) => typeof node.props.onClick === "function")!;
    await read.props.onClick(); await settle();
    const checked = render();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.method).toBe("GET");
    expect(String(fetcher.mock.calls[1][0])).toContain("/api/v1/tasks/T-original");
    expect(JSON.stringify(notice(checked)?.props)).toContain("in_progress");
    expect(card(checked).props.busy).toBe(true);
    card(checked).props.onStatus("T-original", "in_progress"); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("blocks an old render's mutation after the project changes", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const old = card(render()).props;
    setSession("account-b", "Q", "tenant-b");
    old.onStatus("T-original", "completed"); await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(h.invalidations).toEqual([]);
  });

  it("does not invalidate the new workspace when a previous project's reply arrives", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    card(render()).props.onStatus("T-original", "in_progress");
    setSession("account-b", "Q", "tenant-b");
    finish(new Response(JSON.stringify({ ok: true }), { status: 200 })); await settle();
    expect(h.invalidations).toEqual([]);
    expect(h.rows[0].status).toBe("pending");
  });
});

describe("task board filter and return contract", () => {
  it("opens task details with the actual board route and all current filters", () => {
    const href = card(render()).props.detailHref;
    const background = new URLSearchParams(href.split("?")[1]).get("return_to")!;
    expect(background.startsWith("#/tasks/board?")).toBe(true);
    const params = new URLSearchParams(background.split("?")[1]);
    expect(Object.fromEntries(params)).toEqual({ q: "Original", status: "pending", priority: "P1", source: "manual", project_id: "P" });
    expect(safeExecutionReturn(background)).toBe(background);
    expect(new URLSearchParams(manualTaskHref({ id: "T-original" }, background).split("?")[1]).get("return_to")).toBe(background);
  });

  it("writes filters to the current board URL before a refresh and keeps project and safe parent context", () => {
    window.location.hash += `&return_to=${encodeURIComponent("#/projects/portfolio?q=parent")}`;
    const tree = render();
    const search = find(tree, (node) => node.props.placeholder === "page.tasks.searchPh")!;
    search.props.onChange({ target: { value: "updated query" } });
    const params = new URLSearchParams(window.location.hash.split("?")[1]);
    expect(params.get("q")).toBe("updated query");
    expect(params.get("project_id")).toBe("P");
    expect(params.get("return_to")).toBe("#/projects/portfolio?q=parent");
    expect(window.location.hash.startsWith("#/tasks/board?")).toBe(true);
    h.states = [];
    const remounted = render();
    expect(find(remounted, (node) => node.props.placeholder === "page.tasks.searchPh")?.props.value).toBe("updated query");
  });

  it("extends only the precise board allowlist while retaining recursive return checks", () => {
    const board = "#/tasks/board?q=one&project_id=P";
    expect(safeExecutionReturn(board)).toBe(board);
    for (const unsafe of ["https://example.test/#/tasks/board", "#/tasks/board/extra", "#/tasks/board-other", "#/tasks", "#/unknown", `#/tasks/board?return_to=${encodeURIComponent("https://example.test")}`])
      expect(safeExecutionReturn(unsafe)).toBeNull();
    const nested = `#/dev-flow?return_to=${encodeURIComponent(board)}`;
    expect(safeExecutionReturn(nested)).toBe(nested);
    expect(safeExecutionReturn(`#/tasks/board?return_to=${encodeURIComponent("#/projects/portfolio?q=parent")}`)).not.toBeNull();
  });

  it("rejects board lookalikes, fragments, controls and unsafe nested parents", () => {
    for (const route of [
      "https://example.test/#/tasks/board", "//example.test/#/tasks/board", "#/tasks/board-other", "#/tasks/board/extra",
      "#/tasks/board?q=x#fragment", "#/tasks/board?q=line\nbreak", "#/tasks/board?q=%0aencoded", "#/tasks/board?q=%7Fencoded",
      `#/tasks/board?return_to=${encodeURIComponent("https://example.test")}`,
      `#/tasks/board?return_to=${encodeURIComponent("#/tasks/board/extra")}`,
      `#/tasks/board?return_to=${encodeURIComponent("#/projects/portfolio?q=%0aencoded")}`,
      "#/requirements", "#/requirements/pool", "#/requirements/review",
    ]) expect(safeExecutionReturn(route)).toBeNull();
  });
});
