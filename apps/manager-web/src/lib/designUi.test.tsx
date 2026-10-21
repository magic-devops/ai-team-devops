/** Actual UI consumers and real session-bound controller; definitions only, not executed. */
import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Input, Modal, Select } from "antd";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { request } from "./http";
import { setSession, USER_KEY } from "./authStorage";
import { designCopy } from "../i18n/design-library";
import { designLibraryHref, designReturnHref, type DesignReference } from "./designLibrary";
import { DeliveryDesignContextPanel, DesignReferenceFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDesignContextPanel";
import { DesignLibrarySession } from "../../subapps/ai-rd-center/src/pages/intelligence/DesignLibraryWorkbench";
import { DesignOperationRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/DesignOperationRecovery";
import { RequirementRecordOriginal } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementReads";
import { DeliveryIssueWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueWorkbench";
import { RequirementAssistance } from "../../subapps/ai-rd-center/src/pages/product/RequirementAssistance";
import { api } from "./api";
const h = vi.hoisted(() => ({ frame: "", next: 0, frames: {} as Record<string, any[]>, local: new Map<string, string>(), storage: new Map<string, string>(), queries: [] as any[], current: {} as any, page: {} as any, doc: {} as any, revision: {} as any, revisions: {} as any, preview: {} as any, currentError: null as Error | null, sent: [] as any[], mode: "success", storageFail: false, canWrite: true, saved: vi.fn(), pending: vi.fn() }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: (value: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; }, useState: (value: any) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; }, useMemo: (factory: () => any, deps: any[]) => { const slots = h.frames[h.frame] ||= [], index = h.next++; if (!(index in slots) || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { deps, value: factory() }; return slots[index].value; }, useEffect: () => {}, useCallback: (value: unknown) => value, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }) }));
vi.mock("./http", async () => ({ ...await vi.importActual<typeof import("./http")>("./http"), request: vi.fn() }));
vi.mock("./api", () => ({ api: { previewRequirementPrototype: vi.fn(), applyRequirementPrototype: vi.fn(), requirementAssistanceHistory: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: any) => { h.queries.push(options); const key = options.queryKey[0], data = key === "requirement-assistance" ? { expected_version: 7, requirement_basis: "d".repeat(64), items: [] } : key === "delivery-design-current" ? h.current : key === "design-document" ? h.doc : key === "design-revision" || key === "design-adoption-source" ? h.revision : String(key).includes("revisions") ? h.revisions : h.page, error = key === "delivery-design-current" ? h.currentError : null; return { data, error, isError: Boolean(error), isPending: !data, isFetching: false, refetch: vi.fn(async () => ({ data, isError: Boolean(error) })) }; } }));
const digest = "d".repeat(64), now = "2026-10-21T08:00:00Z", copy = designCopy("zh-CN");
const reference = (own = true): DesignReference => ({ slot: "prd", adoption_id: "A1", document_id: "D1", revision_id: "R1", revision_number: 1, revision_digest: digest, content_sha256: digest, content_bytes: 8, title: "Fixed design", category: "product", origin_kind: own ? "task" : "requirement", origin_id: own ? "T" : "REQ" });
const envelope = { project_id: "P", version: 7, query_generation: null, as_of: now };
function frame<T>(key: string, fn: () => T) { h.frame = key; h.next = 0; return fn(); }
function nodes(value: ReactNode): any[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!isValidElement<any>(value)) return []; return [value, ...["children", "footer", "action", "description"].flatMap((key) => nodes(value.props[key]))]; }
const find = (tree: ReactNode, type: unknown, test: (value: any) => boolean = () => true) => nodes(tree).find((node) => node.type === type && test(node.props))?.props;
const button = (tree: ReactNode, label: string) => find(tree, Button, (props) => props.children === label);
const panel = () => frame("panel", () => DeliveryDesignContextPanel({ projectId: "P", target: { kind: "task", id: "T" }, sessionId: "session", canSubmit: () => h.canWrite, onSaved: h.saved, onUnresolvedChange: h.pending }));
const library = () => frame("library", () => DesignLibrarySession({ projectId: "P" }));
beforeEach(() => {
  h.frames = {}; h.queries = []; h.local.clear(); h.storage.clear(); h.sent = []; h.currentError = null; h.mode = "success"; h.storageFail = false; h.canWrite = true; h.saved.mockReset(); h.pending.mockReset();
  vi.stubGlobal("localStorage", { getItem: (key: string) => h.local.get(key) || null, setItem: (key: string, value: string) => h.local.set(key, value), removeItem: (key: string) => h.local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.storage.get(key) || null, setItem: (key: string, value: string) => { if (h.storageFail && (!value || JSON.parse(value).phase === "succeeded")) throw new Error("Storage failed"); h.storage.set(key, value); } });
  setSession("private-token", "P", "tenant"); h.local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" }));
  const location = { hash: "#/dev-flow?project_id=P&task=T", href: "http://localhost/#/dev-flow?project_id=P&task=T" }; vi.stubGlobal("location", location); vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  const head = { id: "D1", document_version: 2, head_revision_id: "R2", head_revision_digest: digest, revision_number: 2, title: "Design", category: "product", tags: [], archived: false, created_at: now, updated_at: now };
  const permissions = { can_write: true, can_generate: true, reasons: [] };
  h.doc = { ...envelope, document: head, permissions }; h.page = { ...envelope, items: [head], total: 1, limit: 20, next_cursor: null, permissions };
  h.revision = { ...envelope, document_id: "D1", revision: { id: "R1", document_id: "D1", number: 1, digest, content_sha256: digest, content_bytes: 8, title: "Fixed design", category: "product", tags: [], note: "Saved", author: { id: "U", name: "User" }, created_at: now, restored_from: null, preview_id: null }, content: "# Design" };
  h.revisions = { ...envelope, document_id: "D1", items: [h.revision.revision], total: 1, limit: 20, next_cursor: null };
  h.current = { ...envelope, target_kind: "task", target_id: "T", target_basis: digest, design_basis: digest, own: [reference()], effective: [reference()], can_adopt: true, reasons: [] };
  h.preview = { ...h.current, available: true, complete: true, allowed: true, preview_basis: digest, next_effective: [reference(false)], impact: { counts: { direct_task: 1, dependent_task: 0, execution: 1, release_candidate: 0, deployment: 0, restricted_execution: 0, restricted_deployment: 0 }, invalidates_current_acceptance: true }, budget: { max_tasks: 10000, max_closure_tasks: 10000, max_requirements: 10000, max_records_per_collection: 10000, max_bytes: 16777216, max_item_bytes: 1048576, max_dependency_depth: 64, task_count: 1, closure_task_count: 1, requirement_count: 1, execution_count: 1, release_candidate_count: 0, deployment_count: 0, bytes_used: 2000 } };
  vi.mocked(request).mockReset().mockImplementation(async (path, init) => {
    if (path.endsWith("/designs")) return h.current; if (path.endsWith("/design-adoption-preview")) return h.preview; if (path === "/api/v1/design-docs/D1") return h.doc;
    if (path.startsWith("/api/v1/design-docs?")) return h.page; if (path.includes("/revisions/")) return h.revision;
    const body = JSON.parse(String(init?.body)); h.sent.push(body); if (h.mode === "unknown") throw new TypeError("Lost response");
    const document = body.action.startsWith("design."), resource = { kind: document ? "design_document" : "design_adoption", id: document ? "D1" : "A2" };
    return { ...envelope, action: body.action, resource, result: document ? { document_id: "D1", revision_id: "R3", revision_digest: digest, document_version: 3 } : { adoption_id: "A2", target_kind: "task", target_id: "T", design_basis: digest, task_ids: ["T"], requirement_id: "REQ" }, affected_refs: document ? [resource, { kind: "design_revision", id: "R3" }] : [resource, { kind: "task", id: "T" }, { kind: "requirement", id: "REQ" }], applied_version: 8, version: 8, replayed: false };
  });
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => { const parsed = new URL(String(url), "http://fixture.invalid"), value = await request(parsed.pathname + parsed.search, init); return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function clearPreview() {
  const clear = find(panel(), Button, (props) => Array.isArray(props.children) && props.children[0] === copy.clear); clear.onClick();
  find(panel(), Input.TextArea, (props) => props["aria-label"] === copy.comment).onChange({ target: { value: "Use requirement design again" } });
  await button(panel(), copy.preview).onClick(); return panel();
}
it("shows explicit clear with inherited fallback before one actual clear command", async () => {
  const tree = await clearPreview(); expect(JSON.stringify(tree)).toContain(copy.after); expect(find(tree, DesignReferenceFacts, (props) => props.references[0]?.origin_kind === "requirement")).toBeDefined();
  await button(tree, copy.clearConfirm).onClick(); expect(h.sent).toHaveLength(1); expect(h.sent[0].action).toBe("task.design.clear"); expect(h.sent[0].payload).not.toHaveProperty("document_id");
});
it("keeps warm unknown recovery inside the modal and replays identical clear payload", async () => {
  h.mode = "unknown"; const tree = await clearPreview(), oldConfirm = button(tree, copy.clearConfirm); await oldConfirm.onClick();
  oldConfirm.onClick(); expect(h.sent).toHaveLength(1); expect(find(panel(), Modal).open).toBe(true);
  const recovery = find(find(panel(), Modal).children, DesignOperationRecovery); h.mode = "success"; await recovery.onReplay(); expect(h.sent[1]).toEqual(h.sent[0]); expect(h.saved).toHaveBeenCalledTimes(1);
});
it("recovers cold originals despite a failed fresh read and revoked fresh permission", async () => {
  h.mode = "unknown"; await button(await clearPreview(), copy.clearConfirm).onClick(); h.frames = {}; h.currentError = new Error("HTTP 403: current unavailable"); h.canWrite = false; h.mode = "success";
  await find(panel(), DesignOperationRecovery).onReplay(); expect(h.sent[1]).toEqual(h.sent[0]);
});
it("preserves a confirmed receipt through local cleanup failure without repeating POST", async () => {
  const tree = await clearPreview(); h.storageFail = true; await button(tree, copy.clearConfirm).onClick(); expect(h.saved).not.toHaveBeenCalled();
  const recovery = find(find(panel(), Modal).children, DesignOperationRecovery); expect(recovery.command.state.phase).toBe("succeeded"); h.storageFail = false; await recovery.onFinish(); expect(h.sent).toHaveLength(1); expect(h.saved).toHaveBeenCalledTimes(1);
});
it("rejects incomplete impact rather than treating a visible page as complete", async () => {
  h.preview.complete = false; h.preview.allowed = false; h.preview.preview_basis = null; await clearPreview(); expect(button(panel(), copy.clearConfirm)).toBeUndefined(); expect(h.sent).toHaveLength(0);
});
it("blocks an old fresh action after current canonical read failure", () => {
  const old = button(panel(), copy.adopt); h.currentError = new Error("HTTP 503: unavailable"); panel(); old.onClick(); expect(find(panel(), Modal).open).toBe(false);
});
it("uses actual library return output to select exact source rather than current head", () => {
  const href = designReturnHref("P", "D1", "R1", "#/dev-flow?project_id=P&task=T")!; location.hash = href; button(panel(), copy.adopt).onClick(); panel();
  expect(h.queries.find((query) => query.queryKey[0] === "design-adoption-source").queryKey.at(-1)).toBe("R1");
});
it("opens the adopted fixed revision in the actual library instead of silently choosing head R2", () => {
  const facts = frame("facts", () => DesignReferenceFacts({ references: [reference()], projectId: "P", background: "#/dev-flow?project_id=P&task=T" }));
  location.hash = button(facts, copy.sourceOpen).href; library(); expect(h.queries.find((query) => query.queryKey[0] === "design-revision").queryKey.at(-1)).toBe("R1");
});
it("labels real requirement record provenance and exact SQL design original", () => {
  const tree = frame("record", () => RequirementRecordOriginal({ collection: "artifacts", projectId: "P", position: 0, record: { source: "design_revision", design: reference(), title: "Design", result: "recorded" } }));
  expect(JSON.stringify(tree)).toContain(copy.fixedSource); expect(button(tree, copy.sourceOpen).href).toBe(designLibraryHref("P", "D1", "R1", location.hash));
});
it("offers the canonical external issue source filter", () => {
  const tree = frame("issues", () => DeliveryIssueWorkbench({ projectId: "P", sessionId: "session", workspace: { query_generation: 1 } as any, issueId: "", background: location.hash, readOnly: true, onSaved: h.saved, onOpenIssue: () => {}, onCloseIssue: () => {} }));
  expect(find(tree, Select, (props) => props["aria-label"] === "deliveryIssue.sourceFilter").options.some((option: any) => option.value === "external")).toBe(true);
});
it("preserves the real prototype adoption artifact identity and returned content in its actual consumer", async () => {
  vi.mocked(api.previewRequirementPrototype).mockResolvedValue({ expected_version: 7, generation: { id: "G1", source: "ai", basis: digest }, content: "# Preview" });
  vi.mocked(api.applyRequirementPrototype).mockResolvedValue({ ok: true, replayed: false, applied_version: 8, generation: { id: "G1" }, artifact_id: "artifact-exact-1", content: "# Exact saved prototype" });
  const render = () => frame("assistance", () => RequirementAssistance({ requirementId: "REQ", onApplied: h.saved }));
  find(render(), "button", (props) => props.children === "assistance.prototype").onClick();
  await find(render(), "button", (props) => props.children === "assistance.generate").onClick();
  await find(render(), "button", (props) => props.children === "assistance.applyPrototype").onClick();
  const tree = render(); expect(JSON.stringify(tree)).toContain("artifact-exact-1"); expect(JSON.stringify(tree)).toContain("# Exact saved prototype"); expect(h.saved).toHaveBeenCalledTimes(1);
});
