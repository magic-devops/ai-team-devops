/** Actual source/read/controller definitions; execution deferred by the shared validation window. */
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { request } from "./http";
import { projectSessionKey } from "./projectPortfolio";
import { setSession, USER_KEY } from "./authStorage";
import { designLibraryHref, parseDesignLibraryRoute, readDesignCurrent, readDesignDocument, readDesignRevision, readDesignDocuments, validDesignContent } from "./designLibrary";
import { createDesignController, validDesignAck, type DesignOriginal } from "./designCommand";

vi.mock("./http", async () => ({ ...await vi.importActual<typeof import("./http")>("./http"), request: vi.fn() }));
const d = "d".repeat(64), now = "2026-10-21T06:00:00Z";
const content = { title: "Current design", category: "architecture", tags: [], content: "# Exact saved source", note: "Reviewed source" };
const permissions = { can_write: true, can_generate: true, reasons: [] };
const head = { id: "D1", document_version: 2, head_revision_id: "R2", head_revision_digest: d, revision_number: 2, title: content.title, category: content.category, tags: [], archived: false, created_at: now, updated_at: now };
const envelope = { project_id: "P", version: 7, query_generation: null, as_of: now };
const revision = { id: "R1", document_id: "D1", number: 1, digest: d, content_sha256: d, content_bytes: 20, title: content.title, category: content.category, tags: [], note: "Saved", author: { id: "U", name: "User" }, created_at: now, restored_from: null, preview_id: null };
const original = (): DesignOriginal => ({ action: "design.document.create", payload: content, intent: { version: 7, key: "original-design-key" } });
const ack = (value: DesignOriginal) => ({ project_id: "P", action: value.action, resource: { kind: "design_document", id: "D1" }, result: { document_id: "D1", revision_id: "R1", revision_digest: d, document_version: 1 }, affected_refs: [{ kind: "design_document", id: "D1" }, { kind: "design_revision", id: "R1" }], applied_version: 8, version: 8, query_generation: null, replayed: false });
beforeEach(() => {
  const local = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) || null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) });
  setSession("private-token", "P", "tenant"); local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" })); vi.mocked(request).mockReset();
});
it("reads the exact saved revision instead of the newer document head", async () => {
  vi.mocked(request).mockResolvedValueOnce({ ...envelope, document: head, permissions }).mockResolvedValueOnce({ ...envelope, document_id: "D1", revision, content: "# Exact saved source" });
  expect((await readDesignDocument("P", "D1", projectSessionKey())).document.head_revision_id).toBe("R2");
  expect((await readDesignRevision("P", "D1", "R1", projectSessionKey())).revision.id).toBe("R1");
  expect(vi.mocked(request).mock.calls.map(([path]) => path)).toEqual(["/api/v1/design-docs/D1", "/api/v1/design-docs/D1/revisions/R1"]);
  expect(new Headers(vi.mocked(request).mock.calls[1][1]?.headers).get("X-Project-Id")).toBe("P");
});
it("uses one bounded catalogue page and an opaque cursor", async () => {
  vi.mocked(request).mockResolvedValue({ ...envelope, items: [head], total: 1, limit: 20, next_cursor: null, permissions });
  await readDesignDocuments("P", projectSessionKey(), { cursor: "opaque/+?=", q: "review", includeArchived: true });
  expect(request).toHaveBeenCalledTimes(1); expect(vi.mocked(request).mock.calls[0][0]).toContain("cursor=opaque%2F%2B%3F%3D");
});
it.each(["project", "document", "revision"])("refuses mismatched %s exact sources", async (field) => {
  vi.mocked(request).mockResolvedValue({ ...envelope, project_id: field === "project" ? "Q" : "P", document_id: field === "document" ? "other" : "D1", revision: { ...revision, id: field === "revision" ? "other" : "R1" }, content: "# Exact saved source" });
  await expect(readDesignRevision("P", "D1", "R1", projectSessionKey())).rejects.toThrow("designInvalid");
});
it("does not authorize writes from missing mandatory effective design context", async () => {
  vi.mocked(request).mockResolvedValue({ ...envelope, target_kind: "task", target_id: "T", target_basis: d, design_basis: d, own: [], can_adopt: true, reasons: [] });
  await expect(readDesignCurrent("P", { kind: "task", id: "T" }, projectSessionKey())).rejects.toThrow("designInvalid");
});
it("preserves exact deep-link identity and rejects duplicate or cross-project selectors", () => {
  const href = designLibraryHref("P", "D1", "R1", "#/dev-flow?project_id=P&task=T");
  expect(parseDesignLibraryRoute(href, "P")).toMatchObject({ documentId: "D1", revisionId: "R1", invalid: false });
  for (const hash of [href + "&doc=D1", href + "&revision=R2", href.replace("project_id=P", "project_id=Q")]) expect(parseDesignLibraryRoute(hash, "P").invalid).toBe(true);
});
it("requires complete nonempty UTF8 content within the actual 64KiB limit", () => {
  expect(validDesignContent(content)).toBe(true); expect(validDesignContent({ ...content, content: " " })).toBe(false);
  expect(validDesignContent({ ...content, content: "中".repeat(23000) })).toBe(false); expect(validDesignContent({ ...content, tags: ["same", "same"] })).toBe(false);
});
it("replays one immutable original after a lost reply and new controller", async () => {
  let raw: string | null = null; const sent: string[] = [];
  const create = () => createDesignController({ projectId: "P", scope: "scope", currentScope: () => "scope", load: () => raw, save: (value) => { raw = value; }, send: async (value) => { sent.push(JSON.stringify(value)); if (sent.length === 1) throw new TypeError("Lost reply"); return ack(value); } });
  const value = original(); await create().run(value); value.intent.version = 99; await create().replay(); expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]);
});
it.each(["resource", "extra", "version", "document-version", "duplicate"])("refuses malformed design command ACK %s", (change) => {
  const value = original(), reply: any = ack(value); if (change === "resource") reply.resource.id = "foreign"; if (change === "extra") reply.result.accepted = true;
  if (change === "version") reply.applied_version++; if (change === "document-version") reply.result.document_version++; if (change === "duplicate") reply.affected_refs.push(reply.affected_refs[0]); expect(validDesignAck("P", value, reply)).toBe(false);
});
it("retires the actual public design page into the canonical project workbench without old API calls", () => {
  const source = readFileSync(resolve(process.cwd(), "public/pages/design_docs.js"), "utf8"), window: any = {}, effects: (() => void)[] = [];
  runInNewContext(source, { window, URLSearchParams, localStorage: { getItem: () => "P" }, React: { useEffect: (effect: () => void) => effects.push(effect), createElement: (_tag: string, props: any) => props } });
  const anchor = window.DesignDocsManager(); expect(anchor.href).toBe("/#/intelligence/design-docs?project_id=P"); expect(effects).toHaveLength(1);
  expect(source).not.toContain("apiFetch"); expect(source).not.toContain("useFetch"); expect(source).not.toContain("/versions");
});
