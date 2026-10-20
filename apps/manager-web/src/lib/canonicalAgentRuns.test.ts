import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProjectId, setSession } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { fetchDeliveryContext, fetchDeliveryReferences } from "./deliveryQuery";
import { fetchTeamRuntimeBindings } from "./deliveryTeamRuntime";
import { fetchExecutionRuntime } from "./executionRuntime";
import {
  agentRunsHash, changeAgentRunsRoute, parseAgentRunsRoute, canonicalExecutionHref,
  canonicalMemberHref, canonicalTaskHref, filterAgentRuns, readAgentContext,
  readAgentRuns, readAgentBindings, readAgentRuntime, agentAccessFailure, type CanonicalAgentExecution,
} from "./canonicalAgentRuns";

vi.mock("./deliveryQuery", async () => ({ ...await vi.importActual<typeof import("./deliveryQuery")>("./deliveryQuery"), fetchDeliveryContext: vi.fn(), fetchDeliveryReferences: vi.fn() }));
vi.mock("./deliveryTeamRuntime", async () => ({ ...await vi.importActual<typeof import("./deliveryTeamRuntime")>("./deliveryTeamRuntime"), fetchTeamRuntimeBindings: vi.fn() }));
vi.mock("./executionRuntime", async () => ({ ...await vi.importActual<typeof import("./executionRuntime")>("./executionRuntime"), fetchExecutionRuntime: vi.fn() }));
const execution: CanonicalAgentExecution = { id: "E-intent", task_id: "T-task", workspace_id: "W-runtime", status: "failed", run_id: "R-provider", run_version: 3, progress: 40, created_at: "2026-10-20T00:00:00Z", stale: false, attempt: 2 };
const context = { project_id: "P", project: { id: "P" }, version: 8, query_generation: 4, query_state: { status: "ready" }, permissions: { write: true, approve: false, configure: false } } as any;
const page = () => ({ project_id: "P", version: 8, query_generation: 4, as_of: "now", items: [{ id: execution.id, kind: "execution", label: execution.id, task_count: 0, data: { ...execution } }], total: 21, next_cursor: "opaque-server-token", limit: 20 });
const runtime = () => ({ project_id: "P", execution_id: "E-intent", run_id: "R-provider", run_version: 3, attempt: 2, status: "interrupted", runtime_status: "interrupted", stale: false, active_node_id: null, observed_at: "now", recovery_requires_review: false, stop: null, approval: null, nodes: [], controls: Object.fromEntries(["start", "retry", "cancel", "approval", "approval_reject"].map((key) => [key, { allowed: false, reasons: [] }])) });
beforeEach(() => {
  vi.clearAllMocks();
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.stubGlobal("window", new EventTarget());
  setSession("account-a", "P", "tenant-a");
  vi.mocked(fetchDeliveryContext).mockResolvedValue(context);
  vi.mocked(fetchDeliveryReferences).mockResolvedValue(page() as any);
  vi.mocked(fetchExecutionRuntime).mockResolvedValue(runtime() as any);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("canonical AgentOps routes and bounded reads (definitions; execution deferred)", () => {
  it.each(["HTTP 401: expired", "HTTP 403: forbidden", "HTTP 404: missing", "scopeChanged", "账号或项目已切换，请在当前工作区重新操作"])("recognizes project/session access failure: %s", (message) => {
    expect(agentAccessFailure(new Error(message))).toBe(true);
    expect(agentAccessFailure(new Error("HTTP 503: read unavailable"))).toBe(false);
  });
  it("restores focused route, project, local filters and exact opaque cursor", () => {
    const route = parseAgentRunsRoute("#/ai/agent-ops/heartbeat?project_id=P&q=W-runtime&status=running&cursor=opaque%2Bcursor&inspect=E-intent", "runs");
    expect(route).toMatchObject({ tab: "heartbeat", projectId: "P", q: "W-runtime", status: "running", cursor: "opaque+cursor", inspect: "E-intent" });
    expect(parseAgentRunsRoute(agentRunsHash(route), "runs")).toEqual(route);
  });
  it.each([{ q: "new search" }, { status: "failed" }, { tab: "profiles" as const }])("clears paging and exact observation when filters or scenario change: %j", (patch) => {
    const route = parseAgentRunsRoute("#/ai/agent-ops/runs?cursor=old&inspect=E-intent");
    expect(changeAgentRunsRoute(route, patch)).toMatchObject({ cursor: "", inspect: "", ...patch });
  });
  it("retains literal cursor only for explicit next-page navigation", () => {
    const route = parseAgentRunsRoute("#/ai/agent-ops/retry?q=T&status=failed");
    expect(changeAgentRunsRoute(route, { cursor: "server:cursor+2" })).toMatchObject({ q: "T", status: "failed", cursor: "server:cursor+2" });
  });
  it("binds execution intent and attempt without substituting the provider run identity", () => {
    const href = canonicalExecutionHref("P", execution);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("#/dev-flow?")).toBe(true);
    expect(params.get("project_id")).toBe("P");
    expect(params.get("execution_id")).toBe("E-intent");
    expect(params.get("execution_attempt")).toBe("2");
    expect(href).not.toContain("R-provider");
    expect(href).not.toContain("requirement=");
  });
  it("uses actual standalone task and selected member routes without guessed requirement links", () => {
    expect(canonicalTaskHref("P", "T-task")).toBe("#/tasks/execution?task_id=T-task&project_id=P");
    expect(canonicalMemberHref("P", "M-agent")).toBe("#/dev-flow?view=team&team_view=members&team_member=M-agent&project_id=P");
  });
  it("preserves the exact AgentOps source page and local filters across all three formal entries", () => {
    const background = "#/ai/agent-ops/retry?project_id=P&q=T-task&status=failed&cursor=opaque%2Bcursor&inspect=E-intent";
    for (const href of [canonicalExecutionHref("P", execution, background), canonicalTaskHref("P", "T-task", background), canonicalMemberHref("P", "M-agent", background)]) {
      expect(new URLSearchParams(href.split("?")[1]).get("return_to")).toBe(background);
    }
  });
  it.each(["https://example.org/phish", "#/ai/agent-ops/unlisted", "#/ai/agent-ops/runs#external", "#/ai/agent-ops/runs?bad=\nvalue"])("does not carry an unsafe return origin: %s", (background) => {
    for (const href of [canonicalExecutionHref("P", execution, background), canonicalTaskHref("P", "T-task", background), canonicalMemberHref("P", "M-agent", background)]) expect(new URLSearchParams(href.split("?")[1]).has("return_to")).toBe(false);
  });
  it("filters current window only and does not classify accepted records as running or retryable", () => {
    const entries = [execution, { ...execution, id: "E-accepted", status: "accepted" }, { ...execution, id: "E-running", status: "running" }];
    expect(filterAgentRuns(entries, { tab: "heartbeat", q: "", status: "" }).map((row) => row.id)).toEqual(["E-running"]);
    expect(filterAgentRuns(entries, { tab: "retry", q: "", status: "" }).map((row) => row.id)).toEqual(["E-intent"]);
  });
  it("retains actual planned/queued/interrupted states and does not equate interruption to approval", () => {
    const rows = ["pending_dispatch", "planned", "queued", "running", "interrupted", "retrying"].map((status) => ({ ...execution, id: status, status }));
    expect(filterAgentRuns(rows, { tab: "heartbeat", q: "", status: "" }).map((row) => row.status)).toEqual(["planned", "queued", "running", "interrupted", "retrying"]);
    expect(filterAgentRuns(rows, { tab: "retry", q: "", status: "" }).map((row) => row.status)).toEqual(["interrupted"]);
  });
  it("reads one bounded generation-pinned page and preserves the server cursor", async () => {
    const value = await readAgentRuns("P", projectSessionKey(), context, "opaque+cursor");
    expect(fetchDeliveryReferences).toHaveBeenCalledWith("P", "execution", { limit: 20, sort: "created_desc", cursor: "opaque+cursor" }, undefined, 4);
    expect(value.next_cursor).toBe("opaque-server-token");
    expect(value.items).toEqual([execution]);
  });
  it("rejects mixed-generation and foreign-project pages", async () => {
    vi.mocked(fetchDeliveryReferences).mockResolvedValueOnce({ ...page(), query_generation: 5 } as any);
    await expect(readAgentRuns("P", projectSessionKey(), context, "")).rejects.toThrow();
    vi.mocked(fetchDeliveryReferences).mockResolvedValueOnce({ ...page(), project_id: "Q" } as any);
    await expect(readAgentRuns("P", projectSessionKey(), context, "")).rejects.toThrow();
  });
  it.each([
    { id: "wrong-intent" }, { task_id: "" }, { workspace_id: "" }, { attempt: 0 }, { progress: 101 },
  ])("rejects invalid execution identities or facts: %j", async (patch) => {
    const value = page(); value.items[0].data = { ...execution, ...patch };
    vi.mocked(fetchDeliveryReferences).mockResolvedValue(value as any);
    await expect(readAgentRuns("P", projectSessionKey(), context, "")).rejects.toThrow("agentResponseInvalid");
  });
  it("does not send a read from a callback captured in another session", async () => {
    const scope = projectSessionKey(); setSession("account-b", "P", "tenant-a");
    await expect(readAgentContext("P", scope)).rejects.toThrow("scopeChanged");
    expect(fetchDeliveryContext).not.toHaveBeenCalled();
  });
  it("drops a late project response before it can populate the next scope", async () => {
    const scope = projectSessionKey();
    vi.mocked(fetchDeliveryContext).mockImplementation(async () => { setProjectId("Q"); return context; });
    await expect(readAgentContext("P", scope)).rejects.toThrow("scopeChanged");
  });
  it("rejects a foreign binding catalogue rather than linking to another project member", async () => {
    vi.mocked(fetchTeamRuntimeBindings).mockResolvedValue({ project_id: "Q" } as any);
    await expect(readAgentBindings("P", projectSessionKey())).rejects.toThrow("agentResponseInvalid");
  });
  it.each([{ nodes: null }, { nodes: [null] }, { nodes: [{ id: "node", title: "Node" }] }, { controls: null }, { controls: { retry: { allowed: true } } }, { stop: {} }, { attempt: 0 }])("rejects malformed exact runtime data before a consumer maps it: %j", async (patch) => {
    vi.mocked(fetchExecutionRuntime).mockResolvedValue({ ...runtime(), ...patch } as any);
    await expect(readAgentRuntime("P", projectSessionKey(), "E-intent")).rejects.toThrow("agentResponseInvalid");
  });
  it("accepts an actual interrupted runtime without inventing an approval", async () => {
    const value = await readAgentRuntime("P", projectSessionKey(), "E-intent");
    expect(value.status).toBe("interrupted"); expect(value.approval).toBeNull();
  });
  const cancelledBeforeDispatch = () => ({
    ...runtime(), run_id: "", run_version: 0, attempt: 1, status: "cancelled", runtime_status: null,
    stop: { id: "", state: "not_started", reason: "No runtime dispatch exists.", node_id: null, attempt: 1,
      requested_at: "2026-10-20T00:00:00Z", confirmed_at: null, evidence: "No external dispatch receipt was found." },
  });
  it("accepts the producer's cancelled-before-dispatch stop with no runtime or physical stop ID", async () => {
    vi.mocked(fetchExecutionRuntime).mockResolvedValue(cancelledBeforeDispatch() as any);
    const value = await readAgentRuntime("P", projectSessionKey(), "E-intent");
    expect(value.run_id).toBe(""); expect(value.run_version).toBe(0);
    expect(value.stop).toMatchObject({ id: "", state: "not_started", node_id: null });
  });
  it.each([
    { state: "unknown" }, { state: "requested" }, { state: "confirmed" },
    { run_id: "R-provider" }, { run_version: 1 }, { status: "running" }, { node_id: "executed-node" },
  ])("does not generalize empty stop IDs to other runtime states: %j", (patch) => {
    const value = cancelledBeforeDispatch();
    const { state, node_id, ...runtimePatch } = patch;
    vi.mocked(fetchExecutionRuntime).mockResolvedValue({ ...value, ...runtimePatch, stop: { ...value.stop, ...(state ? { state } : {}), ...(node_id ? { node_id } : {}) } } as any);
    return expect(readAgentRuntime("P", projectSessionKey(), "E-intent")).rejects.toThrow("agentResponseInvalid");
  });
});
