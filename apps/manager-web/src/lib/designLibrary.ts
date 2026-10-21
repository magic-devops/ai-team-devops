import { request } from "./http";
import { projectSessionKey } from "./projectPortfolio";
import { safeExecutionReturn } from "./executionCommands";
import type { RequirementImpactCounts, RequirementReadBudget } from "./deliveryRequirementReads";

export type DesignSlot = "prd" | "prototype" | "architecture";
export type DesignCategory = "product" | "ux" | "architecture" | "general";
export type DesignReason = { code: string; message: string };
export type DesignTarget = { kind: "requirement" | "task"; id: string };
export type DesignContent = { title: string; category: DesignCategory; tags: string[]; content: string; note: string };
export type DesignEnvelope = { project_id: string; version: number; query_generation: number | null; as_of: string };
export type DesignPermissions = { can_write: boolean; can_generate: boolean; reasons: DesignReason[] };
export type DesignDocument = { id: string; document_version: number; head_revision_id: string; head_revision_digest: string; revision_number: number; title: string; category: DesignCategory; tags: string[]; archived: boolean; created_at: string; updated_at: string };
export type DesignRevision = { id: string; document_id: string; number: number; digest: string; content_sha256: string; content_bytes: number; title: string; category: DesignCategory; tags: string[]; note: string; author: { id: string; name: string }; created_at: string; restored_from: string | null; preview_id: string | null };
export type DesignDocumentView = DesignEnvelope & { document: DesignDocument; permissions: DesignPermissions };
export type DesignRevisionView = DesignEnvelope & { document_id: string; revision: DesignRevision; content: string };
export type DesignPage = DesignEnvelope & { items: DesignDocument[]; total: number; limit: number; next_cursor: string | null; permissions: DesignPermissions };
export type DesignRevisionPage = DesignEnvelope & { document_id: string; items: DesignRevision[]; total: number; limit: number; next_cursor: string | null };
export type DesignCompare = DesignEnvelope & { document_id: string; from_revision_id: string; to_revision_id: string; added_lines: number; removed_lines: number; diff_preview: string; truncated: boolean };
export type DesignReference = { slot: DesignSlot; adoption_id: string; document_id: string; revision_id: string; revision_number: number; revision_digest: string; content_sha256: string; content_bytes: number; title: string; category: DesignCategory; origin_kind: "requirement" | "task"; origin_id: string };
export type DesignCurrent = DesignEnvelope & { target_kind: "requirement" | "task"; target_id: string; target_basis: string; design_basis: string; own: DesignReference[]; effective: DesignReference[]; can_adopt: boolean; reasons: DesignReason[] };
export type DesignPreviewInput = { operation: "adopt" | "clear"; target_basis: string; design_basis: string; slot: DesignSlot; document_id: string | null; revision_id: string | null; revision_digest: string | null };
export type DesignPreview = DesignCurrent & { available: boolean; complete: boolean; allowed: boolean; preview_basis: string | null; next_effective: DesignReference[]; impact: { counts: RequirementImpactCounts | null; invalidates_current_acceptance: boolean | null }; budget: RequirementReadBudget };
export const designSlots: DesignSlot[] = ["prd", "prototype", "architecture"];
export const designRecord = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export const designExact = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export const designIdentity = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value === value.trim() && Array.from(value).length <= 64 && !/[\/\\\u0000-\u001f\u007f-\u009f]/.test(value) && value !== "." && value !== "..";
export const designDigest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
const text = (value: unknown, max: number, required = true): value is string => typeof value === "string" && Array.from(value).length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) && (!required || Boolean(value.trim()));
const tags = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 24 && new Set(value).size === value.length && value.every((tag) => text(tag, 80));
const category = (value: unknown): value is DesignCategory => ["product", "ux", "architecture", "general"].includes(String(value));
const time = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const reasons = (value: unknown): value is DesignReason[] => Array.isArray(value) && value.every((item) => designRecord(item) && typeof item.code === "string" && typeof item.message === "string");
const permissions = (value: unknown): value is DesignPermissions => designRecord(value) && typeof value.can_write === "boolean" && typeof value.can_generate === "boolean" && reasons(value.reasons);
export function validDesignContent(value: unknown): value is DesignContent {
  return designRecord(value) && text(value.title, 200) && category(value.category) && tags(value.tags) && text(value.note, 300, false) && typeof value.content === "string" && Boolean(value.content.trim()) && !value.content.includes("\0") && new TextEncoder().encode(value.content).length <= 65536;
}
const validDocument = (value: unknown): value is DesignDocument => designRecord(value) && designIdentity(value.id) && integer(value.document_version, 1) && designIdentity(value.head_revision_id) && designDigest(value.head_revision_digest) && integer(value.revision_number, 1) && text(value.title, 200) && category(value.category) && tags(value.tags) && typeof value.archived === "boolean" && time(value.created_at) && time(value.updated_at);
const validRevision = (value: unknown): value is DesignRevision => designRecord(value) && designIdentity(value.id) && designIdentity(value.document_id) && integer(value.number, 1) && designDigest(value.digest) && designDigest(value.content_sha256) && integer(value.content_bytes, 1) && value.content_bytes <= 65536 && text(value.title, 200) && category(value.category) && tags(value.tags) && typeof value.note === "string" && designRecord(value.author) && designIdentity(value.author.id) && typeof value.author.name === "string" && time(value.created_at) && (value.restored_from === null || designIdentity(value.restored_from)) && (value.preview_id === null || designIdentity(value.preview_id));
export const validDesignReference = (value: unknown): value is DesignReference => designRecord(value) && designSlots.includes(value.slot) && [value.adoption_id, value.document_id, value.revision_id, value.origin_id].every(designIdentity) && integer(value.revision_number, 1) && designDigest(value.revision_digest) && designDigest(value.content_sha256) && integer(value.content_bytes, 1) && value.content_bytes <= 65536 && text(value.title, 200) && category(value.category) && ["requirement", "task"].includes(value.origin_kind);
export const validDesignReferences = (value: unknown): value is DesignReference[] => Array.isArray(value) && value.length <= 3 && value.every(validDesignReference) && new Set(value.map((item) => item.slot)).size === value.length;
const envelope = (value: unknown, projectId: string): value is Record<string, any> => designRecord(value) && value.project_id === projectId && integer(value.version) && (value.query_generation === null || integer(value.query_generation, 1)) && time(value.as_of);
export function validDesignCurrent(value: unknown, projectId: string, target: DesignTarget): value is DesignCurrent {
  return envelope(value, projectId) && value.target_kind === target.kind && value.target_id === target.id && designDigest(value.target_basis) && designDigest(value.design_basis) && validDesignReferences(value.own) && value.own.every((ref) => ref.origin_kind === target.kind && ref.origin_id === target.id) && validDesignReferences(value.effective) && typeof value.can_adopt === "boolean" && reasons(value.reasons);
}
const countKeys = ["direct_task", "dependent_task", "execution", "release_candidate", "deployment", "restricted_execution", "restricted_deployment"];
const budgetKeys = ["max_tasks", "max_closure_tasks", "max_requirements", "max_records_per_collection", "max_bytes", "max_item_bytes", "max_dependency_depth", "task_count", "closure_task_count", "requirement_count", "execution_count", "release_candidate_count", "deployment_count", "bytes_used"];
export function validDesignPreview(value: unknown, projectId: string, target: DesignTarget): value is DesignPreview {
  return validDesignCurrent(value, projectId, target) && designRecord(value) && typeof value.available === "boolean" && typeof value.complete === "boolean" && typeof value.allowed === "boolean" && (value.preview_basis === null || designDigest(value.preview_basis)) && validDesignReferences(value.next_effective) && designRecord(value.impact) && (value.impact.invalidates_current_acceptance === null || typeof value.impact.invalidates_current_acceptance === "boolean") && (value.impact.counts === null || designRecord(value.impact.counts) && countKeys.every((key) => integer(value.impact.counts[key]))) && designRecord(value.budget) && budgetKeys.every((key) => Object.hasOwn(value.budget, key) && (value.budget[key] === null || integer(value.budget[key]))) && (!value.allowed || value.available && value.complete && designDigest(value.preview_basis) && value.impact.counts !== null);
}
const ensure = (valid: unknown) => { if (!valid) throw new Error("designInvalid"); };
const scope = (origin: string) => { if (origin !== projectSessionKey()) throw new Error("designScopeChanged"); };
async function read(projectId: string, origin: string, path: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
  ensure(designIdentity(projectId)); scope(origin); const value = await request<unknown>(path, { headers: { "X-Project-Id": projectId }, signal, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }); scope(origin); return value;
}
const segment = (id: string) => { ensure(designIdentity(id)); return encodeURIComponent(id); };
function queryPage(cursor = "") { ensure(typeof cursor === "string" && cursor.length <= 4000 && !/[\u0000-\u001f\u007f-\u009f]/.test(cursor)); const params = new URLSearchParams({ limit: "20" }); if (cursor) params.set("cursor", cursor); return params; }
function validPage(value: Record<string, any>, cursor: string) { return Array.isArray(value.items) && value.items.length <= 20 && integer(value.total) && value.total >= value.items.length && value.limit === 20 && (value.next_cursor === null || typeof value.next_cursor === "string" && Boolean(value.next_cursor) && value.next_cursor !== cursor && value.next_cursor.length <= 4000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value.next_cursor)) && new Set(value.items.map((item: any) => item.id)).size === value.items.length; }
export async function readDesignDocuments(projectId: string, origin: string, options: { q?: string; cursor?: string; includeArchived?: boolean } = {}, signal?: AbortSignal): Promise<DesignPage> {
  const cursor = options.cursor || "", query = queryPage(cursor); query.set("q", options.q || ""); query.set("include_archived", String(Boolean(options.includeArchived)));
  const value = await read(projectId, origin, `/api/v1/design-docs?${query}`, signal); ensure(envelope(value, projectId) && validPage(value, cursor) && value.items.every(validDocument) && permissions(value.permissions)); return value as DesignPage;
}
export async function readDesignDocument(projectId: string, documentId: string, origin: string, signal?: AbortSignal): Promise<DesignDocumentView> {
  const value = await read(projectId, origin, `/api/v1/design-docs/${segment(documentId)}`, signal); ensure(envelope(value, projectId) && validDocument(value.document) && value.document.id === documentId && permissions(value.permissions)); return value as DesignDocumentView;
}
export async function readDesignRevisions(projectId: string, documentId: string, origin: string, cursor = "", signal?: AbortSignal): Promise<DesignRevisionPage> {
  const value = await read(projectId, origin, `/api/v1/design-docs/${segment(documentId)}/revisions?${queryPage(cursor)}`, signal); ensure(envelope(value, projectId) && value.document_id === documentId && validPage(value, cursor) && value.items.every((item: unknown) => validRevision(item) && item.document_id === documentId)); return value as DesignRevisionPage;
}
export async function readDesignRevision(projectId: string, documentId: string, revisionId: string, origin: string, signal?: AbortSignal): Promise<DesignRevisionView> {
  const value = await read(projectId, origin, `/api/v1/design-docs/${segment(documentId)}/revisions/${segment(revisionId)}`, signal); ensure(envelope(value, projectId) && value.document_id === documentId && validRevision(value.revision) && value.revision.id === revisionId && value.revision.document_id === documentId && typeof value.content === "string" && Boolean(value.content.trim()) && !value.content.includes("\0") && new TextEncoder().encode(value.content).length === value.revision.content_bytes); return value as DesignRevisionView;
}
export async function readDesignCompare(projectId: string, documentId: string, from: string, to: string, origin: string, signal?: AbortSignal): Promise<DesignCompare> {
  const query = new URLSearchParams({ from, to }); segment(from); segment(to); const value = await read(projectId, origin, `/api/v1/design-docs/${segment(documentId)}/compare?${query}`, signal);
  ensure(envelope(value, projectId) && value.document_id === documentId && value.from_revision_id === from && value.to_revision_id === to && integer(value.added_lines) && integer(value.removed_lines) && typeof value.diff_preview === "string" && typeof value.truncated === "boolean"); return value as DesignCompare;
}
const targetPath = (target: DesignTarget) => `/api/v1/delivery/${target.kind === "task" ? "tasks" : "requirements"}/${segment(target.id)}`;
export async function readDesignCurrent(projectId: string, target: DesignTarget, origin: string, signal?: AbortSignal): Promise<DesignCurrent> { const value = await read(projectId, origin, `${targetPath(target)}/designs`, signal); ensure(validDesignCurrent(value, projectId, target)); return value as DesignCurrent; }
export async function previewDesignAdoption(projectId: string, target: DesignTarget, input: DesignPreviewInput, origin: string, signal?: AbortSignal): Promise<DesignPreview> { const value = await read(projectId, origin, `${targetPath(target)}/design-adoption-preview`, signal, input); ensure(validDesignPreview(value, projectId, target) && (value as DesignPreview).target_basis === input.target_basis && (value as DesignPreview).design_basis === input.design_basis); return value as DesignPreview; }
export function designLibraryHref(projectId: string, documentId = "", revisionId = "", background = "") { const params = new URLSearchParams({ project_id: projectId }); if (documentId) params.set("doc", documentId); if (revisionId) params.set("revision", revisionId); const back = safeExecutionReturn(background); if (back) params.set("return_to", back); return `#/intelligence/design-docs?${params}`; }
export function parseDesignLibraryRoute(hash: string, projectId: string) {
  const params = new URLSearchParams(hash.split("?")[1]), documentId = params.get("doc") || "", revisionId = params.get("revision") || "";
  const invalid = hash.split("?")[0] !== "#/intelligence/design-docs" || params.getAll("project_id").length > 1 || params.has("project_id") && params.get("project_id") !== projectId || Boolean(documentId && params.getAll("project_id").length !== 1) || params.getAll("doc").length > 1 || params.getAll("revision").length > 1 || Boolean(documentId && !designIdentity(documentId) || revisionId && (!documentId || !designIdentity(revisionId)));
  return { documentId: invalid ? "" : documentId, revisionId: invalid ? "" : revisionId, invalid, background: safeExecutionReturn(params.get("return_to") || "") || "" };
}
export function parseDesignSourceRoute(hash: string, projectId: string, target: DesignTarget) {
  const params = new URLSearchParams(hash.split("?")[1]), hasSource = params.has("design_doc") || params.has("design_revision");
  if (!hasSource) return { documentId: "", revisionId: "", invalid: false };
  const path = hash.split("?")[0], targetKey = target.kind === "requirement" ? "requirement" : path === "#/dev-flow" ? "task" : "task_id";
  const documentId = params.get("design_doc") || "", revisionId = params.get("design_revision") || "";
  const valid = (path === "#/dev-flow" || target.kind === "task" && path === "#/tasks/execution") && params.getAll("project_id").length === 1 && params.get("project_id") === projectId && params.getAll(targetKey).length === 1 && params.get(targetKey) === target.id && (target.kind !== "task" || !params.has(targetKey === "task" ? "task_id" : "task")) && params.getAll("design_doc").length === 1 && params.getAll("design_revision").length === 1 && designIdentity(documentId) && designIdentity(revisionId);
  return { documentId: valid ? documentId : "", revisionId: valid ? revisionId : "", invalid: !valid };
}
export function designReturnHref(projectId: string, documentId: string, revisionId: string, background: string): string | null {
  const safe = safeExecutionReturn(background); if (!safe || !designIdentity(documentId) || !designIdentity(revisionId)) return null;
  const params = new URLSearchParams(safe.split("?")[1]), path = safe.split("?")[0];
  const taskKey = path === "#/dev-flow" ? "task" : "task_id", kind = params.has(taskKey) ? "task" : "requirement", id = params.get(kind === "task" ? taskKey : "requirement") || "";
  if (!designIdentity(id)) return null;
  params.set("design_doc", documentId); params.set("design_revision", revisionId);
  const href = `${path}?${params}`; return parseDesignSourceRoute(href, projectId, { kind, id }).invalid ? null : href;
}
