/** Authored for the real page. Runtime verification is deferred by the user; not yet executed. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearchWorkbench } from "../../subapps/ai-rd-center/src/pages/ai/GlobalSearchWorkbench";
import { setSession } from "./authStorage";

const h = vi.hoisted(() => ({
  states: [] as any[], next: 0,
  initialMode: "hybrid",
  failures: {} as Record<string, number | string>,
  retryingKey: "",
  pendingKeys: [] as string[],
  refetches: {} as Record<string, any>,
  buttons: [] as any[], metrics: [] as any[], alerts: [] as any[], lists: [] as any[],
  tabs: null as any, search: null as any,
}));

vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.states)) {
      const value = typeof initial === "function" ? initial() : initial;
      h.states[index] = value === "hybrid" ? h.initialMode : value;
    }
    return [h.states[index], (next: any) => {
      h.states[index] = typeof next === "function" ? next(h.states[index]) : next;
    }];
  },
  useEffect: () => {},
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// Capture controls rendered by the real page; replacing visual primitives avoids browser dependencies.
vi.mock("antd", async () => {
  const { createElement: element } = await import("react");
  const box = (props: any) => element("div", null, props.children);
  const Empty = Object.assign((props: any) => element("div", null, props.description), { PRESENTED_IMAGE_SIMPLE: "empty" });
  const List = Object.assign((props: any) => {
    h.lists.push(props);
    return element("ul", null, props.dataSource.length
      ? props.dataSource.map((row: any, index: number) => element("li", { key: index }, props.renderItem(row)))
      : props.locale?.emptyText);
  }, { Item: box });
  return {
    Alert: (props: any) => { h.alerts.push(props); return element("div", { role: "alert" }, props.title ?? props.message, props.description, props.action); },
    Button: (props: any) => {
      h.buttons.push(props);
      return element(props.href ? "a" : "button", { href: props.href, onClick: props.onClick, "aria-label": props["aria-label"], disabled: props.disabled }, props.children);
    },
    Card: box,
    Empty,
    Input: { Search: (props: any) => { h.search = props; return element("input", { value: props.value, readOnly: true }); } },
    List,
    Segmented: box,
    Skeleton: box,
    Spin: box,
    Statistic: (props: any) => { h.metrics.push({ label: props.title?.props?.children, value: props.value }); return element("div", null, props.title, props.value); },
    Tag: box,
    Tabs: (props: any) => {
      h.tabs = props;
      return element("section", { "data-active-mode": props.activeKey }, props.items.find((item: any) => item.key === props.activeKey)?.children);
    },
    Typography: { Paragraph: box, Text: box },
  };
});

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")),
  useQuery: (options: any) => {
    const key = options.queryKey[0];
    let data: any;
    if (key === "semanticSearchStatus") data = { available: true, tables: [{ table: "tasks", rows: 77, ready: true }], default_tables: "tasks" };
    if (key === "workspaceSearchPage") data = [{ type: "tasks", id: "private-keyword-P", title: "keyword-result-original-project" }];
    if (key === "semanticSearchPage") data = { available: true, items: [{ table: "tasks", id: "private-semantic-P", title: "cached-semantic-original-project" }] };
    if (h.pendingKeys.includes(key)) data = undefined;
    const failure = h.failures[key];
    const error = typeof failure === "number" ? new Error(`HTTP ${failure}: current search read failed`)
      : typeof failure === "string" ? new Error(failure) : null;
    if (!h.refetches[key]) h.refetches[key] = vi.fn();
    return {
      data, error, isError: Boolean(error), status: error ? "error" : "success",
      isPending: h.pendingKeys.includes(key), isLoading: h.pendingKeys.includes(key),
      isFetching: h.pendingKeys.includes(key) || key === h.retryingKey, refetch: h.refetches[key],
    };
  },
}));

function renderPage() {
  h.next = 0;
  h.tabs = null;
  h.search = null;
  h.buttons = []; h.metrics = []; h.alerts = []; h.lists = [];
  return renderToStaticMarkup(createElement(GlobalSearchWorkbench));
}

beforeEach(() => {
  h.states = []; h.next = 0; h.initialMode = "hybrid";
  h.failures = {}; h.retryingKey = ""; h.pendingKeys = []; h.refetches = {}; h.tabs = null; h.search = null;
  h.buttons = []; h.metrics = []; h.alerts = []; h.lists = [];
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  const location = { hash: "#/search?q=needle", pathname: "/", search: "", href: "http://localhost/#/search?q=needle" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location, setTimeout, clearTimeout }));
  setSession("account-a", "P", "tenant-a");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual GlobalSearch read failure recovery", () => {
  it("keeps keyword results and controls usable when optional semantic status returns 500", () => {
    h.initialMode = "keyword";
    h.failures.semanticSearchStatus = 500;
    const html = renderPage();
    expect(h.search, "the real search input remains mounted").not.toBeNull();
    expect(h.tabs, "the real mode switch remains reachable").not.toBeNull();
    expect(h.tabs.activeKey).toBe("keyword");
    expect(typeof h.tabs.onChange).toBe("function");
    expect(html).toContain("keyword-result-original-project");
    expect(html).toContain("500");
    expect(h.metrics.find((metric) => metric.label === "page.search.indexHealth")?.value).toBe("—");
    expect(h.alerts.every((alert) => alert.type !== "success")).toBe(true);
  });

  it("offers keyword recovery after a hybrid semantic request returns 500", () => {
    h.failures.semanticSearchPage = 500;
    const failedSemantic = renderPage();
    expect(h.search).not.toBeNull();
    expect(h.tabs, "hybrid failure must not remove the mode control").not.toBeNull();
    expect(typeof h.tabs.onChange).toBe("function");
    expect(failedSemantic).toContain("500");
    // Cached semantic data must not be represented as a successful semantic response.
    expect(failedSemantic).not.toContain("cached-semantic-original-project");
    expect(failedSemantic).toContain("keyword-result-original-project");
    expect(h.metrics.find((metric) => metric.label === "page.search.results")?.value).toBe("—");
    h.tabs.onChange("keyword");
    const keyword = renderPage();
    expect(h.tabs.activeKey).toBe("keyword");
    expect(keyword).toContain("keyword-result-original-project");
    expect(keyword).not.toContain("cached-semantic-original-project");
  });

  it("keeps keyword search usable during an optional status network failure and marks index health unknown", () => {
    h.initialMode = "keyword";
    h.failures.semanticSearchStatus = "Failed to fetch semantic status";
    const html = renderPage();
    expect(h.search).not.toBeNull();
    expect(h.tabs.activeKey).toBe("keyword");
    expect(html).toContain("keyword-result-original-project");
    expect(html).toContain("Failed to fetch semantic status");
    expect(html).not.toContain("page.search.semanticReady");
    expect(html).not.toContain("tasks:77");
    expect(h.alerts.every((alert) => alert.type !== "success")).toBe(true);
    expect(h.metrics.find((metric) => metric.label === "page.search.indexHealth")?.value).toBe("—");
    h.search.onChange({ target: { value: "another search" } });
    renderPage();
    expect(h.search.value).toBe("another search");
  });

  it("retains healthy keyword rows and mode controls during a semantic network failure", () => {
    h.failures.semanticSearchPage = "Network connection lost";
    const html = renderPage();
    expect(h.search).not.toBeNull();
    expect(html).toContain("Network connection lost");
    expect(html).toContain("keyword-result-original-project");
    expect(html).not.toContain("cached-semantic-original-project");
    expect(h.alerts.every((alert) => alert.type !== "success")).toBe(true);
    h.tabs.onChange("keyword");
    const keyword = renderPage();
    expect(h.tabs.activeKey).toBe("keyword");
    expect(keyword).toContain("keyword-result-original-project");
    expect(keyword).not.toContain("Network connection lost");
  });

  it.each([500, "Failed to fetch keyword search"] as const)("hides failed keyword cache while retaining input, filters and retry: %s", (failure) => {
    h.initialMode = "keyword";
    h.failures.workspaceSearchPage = failure;
    const html = renderPage();
    expect(h.search).not.toBeNull();
    expect(h.tabs.activeKey).toBe("keyword");
    expect(html).not.toContain("keyword-result-original-project");
    expect(html).not.toContain("private-keyword-P");
    expect(html).not.toContain("page.search.empty");
    expect(h.lists.at(-1)?.locale.emptyText).toBeNull();
    expect(h.metrics.find((metric) => metric.label === "page.search.results")?.value).toBe("—");
    expect(h.buttons.some((button) => button["aria-label"] === "page.search.tabKeyword: common.refresh")).toBe(true);
    h.tabs.onChange("semantic");
    const semantic = renderPage();
    expect(h.tabs.activeKey).toBe("semantic");
    expect(semantic).toContain("cached-semantic-original-project");
    expect(semantic).not.toContain("keyword-result-original-project");
  });

  it("keeps successful semantic rows when only the hybrid keyword request fails", () => {
    h.failures.workspaceSearchPage = 500;
    const html = renderPage();
    expect(html).toContain("cached-semantic-original-project");
    expect(html).not.toContain("keyword-result-original-project");
    expect(html).toContain("500");
    expect(h.tabs.activeKey).toBe("hybrid");
    expect(h.metrics.find((metric) => metric.label === "page.search.results")?.value).toBe("—");
  });

  it("keeps the controls and both recovery actions when both search reads fail", () => {
    h.failures.workspaceSearchPage = 500;
    h.failures.semanticSearchPage = "Network connection lost";
    const html = renderPage();
    expect(h.search).not.toBeNull();
    expect(h.tabs).not.toBeNull();
    expect(html).not.toContain("keyword-result-original-project");
    expect(html).not.toContain("cached-semantic-original-project");
    expect(html).not.toContain("page.search.empty");
    expect(h.buttons.filter((button) => button["aria-label"]?.endsWith(": common.refresh"))).toHaveLength(2);
  });

  it.each([
    ["semanticSearchStatus", "keyword", "page.search.indexHealth"],
    ["workspaceSearchPage", "keyword", "page.search.tabKeyword"],
    ["semanticSearchPage", "hybrid", "page.search.tabSemantic"],
  ] as const)("retries only the failed read from its actual control: %s", (key, mode, label) => {
    h.initialMode = mode;
    h.failures[key] = 500;
    renderPage();
    const retry = h.buttons.find((button) => button["aria-label"] === `${label}: common.refresh`);
    expect(retry).toBeDefined();
    retry.onClick();
    expect(h.refetches[key]).toHaveBeenCalledTimes(1);
    for (const [other, refetch] of Object.entries(h.refetches)) {
      if (other !== key) expect(refetch).not.toHaveBeenCalled();
    }
  });

  it("marks an in-flight retry busy without removing search and mode controls", () => {
    h.failures.semanticSearchPage = 500;
    h.retryingKey = "semanticSearchPage";
    renderPage();
    const retry = h.buttons.find((button) => button["aria-label"] === "page.search.tabSemantic: common.refresh");
    expect(retry.disabled).toBe(true);
    expect(retry.loading).toBe(true);
    expect(h.search).not.toBeNull();
    expect(h.tabs).not.toBeNull();
  });

  it("returns to the normal semantic results only after the failing query becomes successful", () => {
    h.failures.semanticSearchPage = 500;
    expect(renderPage()).not.toContain("cached-semantic-original-project");
    delete h.failures.semanticSearchPage;
    const recovered = renderPage();
    expect(recovered).toContain("cached-semantic-original-project");
    expect(recovered).toContain("keyword-result-original-project");
    expect(h.metrics.find((metric) => metric.label === "page.search.results")?.value).toBe(2);
  });

  it.each([
    ["keyword", ["workspaceSearchPage"]],
    ["semantic", ["semanticSearchPage"]],
    ["hybrid", ["workspaceSearchPage"]],
    ["hybrid", ["semanticSearchPage"]],
    ["hybrid", ["workspaceSearchPage", "semanticSearchPage"]],
  ] as const)("does not report zero results before the active %s reads return: %j", (mode, pendingKeys) => {
    h.initialMode = mode;
    h.pendingKeys = [...pendingKeys];
    renderPage();
    expect(h.search).not.toBeNull();
    expect(h.tabs.activeKey).toBe(mode);
    expect(h.metrics.find((metric) => metric.label === "page.search.results")?.value).toBe("—");
  });

  it("retains the known result count while successful data refreshes in the background", () => {
    h.initialMode = "keyword";
    h.retryingKey = "workspaceSearchPage";
    const html = renderPage();
    expect(html).toContain("keyword-result-original-project");
    expect(h.search.loading).toBe(true);
    expect(h.metrics.find((metric) => metric.label === "page.search.results")?.value).toBe(1);
  });

  it("does not let an inactive semantic query error block the current keyword mode", () => {
    h.initialMode = "keyword";
    h.failures.semanticSearchPage = 403;
    const html = renderPage();
    expect(h.search).not.toBeNull();
    expect(h.tabs.activeKey).toBe("keyword");
    expect(html).toContain("keyword-result-original-project");
    expect(html).not.toContain("cached-semantic-original-project");
    expect(html).not.toContain("HTTP 403");
  });

  it("hides cached business results when a current query reports a changed session", () => {
    h.failures.workspaceSearchPage = "账号或项目已切换，请在当前工作区重新操作";
    const html = renderPage();
    expect(html).not.toContain("keyword-result-original-project");
    expect(html).not.toContain("cached-semantic-original-project");
    expect(html).toMatch(/href="#\/projects(?:\/portfolio)?(?:\?|\")/);
    expect(html).toContain("账号或项目已切换");
  });

  it.each([
    ["semanticSearchStatus", 401], ["semanticSearchStatus", 403], ["semanticSearchStatus", 404],
    ["workspaceSearchPage", 401], ["workspaceSearchPage", 403], ["workspaceSearchPage", 404],
    ["semanticSearchPage", 401], ["semanticSearchPage", 403], ["semanticSearchPage", 404],
  ] as const)("hides cached business bodies on %s denial %s", (key, status) => {
    h.failures[key] = status;
    const html = renderPage();
    expect(html).not.toContain("keyword-result-original-project");
    expect(html).not.toContain("cached-semantic-original-project");
    expect(html).not.toContain("private-keyword-P");
    expect(html).not.toContain("private-semantic-P");
    expect(html).toMatch(/href="#\/projects(?:\/portfolio)?(?:\?|\")/);
    expect(html).toContain(String(status));
  });
});
