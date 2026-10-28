import { request } from "./http";

export const reflectionCategories = ["coding", "testing", "security", "workflow", "review", "other"] as const;
export type ReflectionCategory = (typeof reflectionCategories)[number];
export type ReflectionProducer = { id: string; name: string | null };
export type ReflectionPermissions = { read: boolean; collect: boolean; prepare: boolean };
export type ReflectionSelectionReference = { reflection_id: string; source_digest: string; attempt_id: string };
export type ReflectionSummary = {
  id: string; category: ReflectionCategory; occurred_at: string; collected_at: string;
  producer: ReflectionProducer; reference_count: number; intake_status: "collected";
  original_status: "not_loaded" | "available" | "restricted" | "unavailable";
  unavailable_reason: string | null;
};
export type ReflectionPageBase = {
  project_id: string; as_of: string; total: number; limit: number;
  has_more: boolean; next_cursor: string | null; permissions: ReflectionPermissions;
};
export type ReflectionPage = ReflectionPageBase & { items: ReflectionSummary[] };
export type ReflectionLink = { kind: "task" | "execution"; id: string | null; label: string | null; available: boolean; reason: string | null };
export type ReflectionDetail = {
  project_id: string; as_of: string; reflection: ReflectionSummary;
  available: boolean; unavailable_reason: string | null;
  statement: { category: ReflectionCategory; title: string; observation: string; lesson: string; claimed_occurred_at: string } | null;
  source: { receipt_id: string; event_id: string; digest: string; producer_id: string; stored_at: string; event_json: string } | null;
  verified: { attempt_id: string; handler: "reflection.record"; collected_at: string; identity_and_references_checked: true; is_acceptance_evidence: false } | null;
  links: ReflectionLink[]; selection_reference: ReflectionSelectionReference | null;
};
export type ReflectionInputSummary = { id: string; title: string; status: "prepared"; source_count: number; created_at: string; created_by: ReflectionProducer; source_version: number };
export type ReflectionInputsPage = ReflectionPageBase & { items: ReflectionInputSummary[] };
export type ReflectionInputDetail = {
  project_id: string; as_of: string; input: ReflectionInputSummary; rationale: string;
  manifest_digest: string; sources: Array<ReflectionSelectionReference & { available: boolean; unavailable_reason: string | null }>;
  available: boolean; is_acceptance_evidence: false;
};
export const reflectionCodepoints = (value: string) => Array.from(value).length;
export function validReflectionId(value: unknown, max = 64): value is string {
  return typeof value === "string" && !!value && value === value.trim() && reflectionCodepoints(value) <= max && !/[\/\\\u0000-\u001f\u007f-\u009f]/.test(value);
}
export const validReflectionDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validReflectionReference(value: unknown): value is ReflectionSelectionReference {
  const ref = value as ReflectionSelectionReference;
  return !!ref && Object.keys(ref).length === 3 && validReflectionId(ref.reflection_id) && validReflectionDigest(ref.source_digest) && validReflectionId(ref.attempt_id);
}
const invalid = () => { throw new Error("reflection_response_invalid"); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const time = (value: unknown): value is string => typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown, max: number, required = false): value is string => typeof value === "string" && reflectionCodepoints(value) <= max && (!required || !!value.trim());
const eventId = (value: unknown): value is string => typeof value === "string" && reflectionCodepoints(value) >= 1 && reflectionCodepoints(value) <= 128;
const category = (value: unknown): value is ReflectionCategory => reflectionCategories.includes(value as ReflectionCategory);
const producer = (value: ReflectionProducer) => object(value) && validReflectionId(value.id) && (value.name === null || typeof value.name === "string");
function summary(value: ReflectionSummary) {
  return object(value) && validReflectionId(value.id) && category(value.category) && time(value.occurred_at) && time(value.collected_at) && producer(value.producer) && Number.isSafeInteger(value.reference_count) && value.reference_count >= 0 && value.reference_count <= 8 && value.intake_status === "collected" && ["not_loaded", "available", "restricted", "unavailable"].includes(value.original_status) && (value.unavailable_reason === null || typeof value.unavailable_reason === "string");
}
function inputSummary(value: ReflectionInputSummary) {
  return object(value) && validReflectionId(value.id) && text(value.title, 160, true) && value.status === "prepared" && Number.isSafeInteger(value.source_count) && value.source_count >= 1 && value.source_count <= 32 && time(value.created_at) && producer(value.created_by) && Number.isSafeInteger(value.source_version) && value.source_version >= 1;
}
async function read<T extends { project_id: string }>(projectId: string, path: string, signal?: AbortSignal): Promise<T> {
  if (!validReflectionId(projectId)) invalid();
  const result = await request<T>("/api/v1/reflections" + path, { headers: { "X-Project-Id": projectId }, signal });
  if (!object(result) || result.project_id !== projectId || !time((result as T & { as_of?: unknown }).as_of)) invalid();
  return result;
}
function page<T>(value: ReflectionPageBase & { items: T[] }, valid: (item: T) => boolean) {
  if (!Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100 || typeof value.has_more !== "boolean" || (value.next_cursor !== null && (typeof value.next_cursor !== "string" || value.next_cursor.length > 4000)) || value.has_more !== !!value.next_cursor || !Array.isArray(value.items) || value.items.length > value.limit || value.items.length > value.total || !value.items.every(valid) || !object(value.permissions) || ["read", "collect", "prepare"].some((key) => typeof value.permissions[key as keyof ReflectionPermissions] !== "boolean")) invalid();
  return value;
}
export type ReflectionFilters = { category?: ReflectionCategory | ""; from?: string; to?: string; cursor?: string };
export async function fetchReflections(projectId: string, query: ReflectionFilters = {}, signal?: AbortSignal): Promise<ReflectionPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (query.category) { if (!category(query.category)) invalid(); params.set("category", query.category); }
  if (query.from) { if (!time(query.from)) invalid(); params.set("occurred_from", query.from); }
  if (query.to) { if (!time(query.to)) invalid(); params.set("occurred_to", query.to); }
  if (query.from && query.to && Date.parse(query.to) <= Date.parse(query.from)) invalid();
  if (query.cursor) { if (query.cursor.length > 4000) invalid(); params.set("cursor", query.cursor); }
  const result = await read<ReflectionPage>(projectId, "?" + params, signal);
  page(result, summary);
  if (new Set(result.items.map((item) => item.id)).size !== result.items.length) invalid();
  return result;
}
export async function fetchReflectionInputs(projectId: string, cursor = "", signal?: AbortSignal): Promise<ReflectionInputsPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) { if (cursor.length > 4000) invalid(); params.set("cursor", cursor); }
  const result = await read<ReflectionInputsPage>(projectId, "/inputs?" + params, signal);
  page(result, inputSummary);
  if (new Set(result.items.map((item) => item.id)).size !== result.items.length) invalid();
  return result;
}
export async function fetchReflection(projectId: string, reflectionId: string, signal?: AbortSignal): Promise<ReflectionDetail> {
  if (!validReflectionId(reflectionId)) invalid();
  const value = await read<ReflectionDetail>(projectId, "/" + encodeURIComponent(reflectionId), signal);
  if (!summary(value.reflection) || value.reflection.id !== reflectionId || typeof value.available !== "boolean" || !Array.isArray(value.links) || value.links.length > 8) invalid();
  if (!value.available) {
    if (value.statement !== null || value.source !== null || value.verified !== null || value.selection_reference !== null || value.links.length || !value.unavailable_reason || value.reflection.original_status === "available") invalid();
    return value;
  }
  const { statement: s, source: raw, verified: v } = value;
  if (!s || !raw || !v || value.unavailable_reason !== null || value.reflection.original_status !== "available" || !category(s.category) || s.category !== value.reflection.category || !text(s.title, 160, true) || !text(s.observation, 12000, true) || !text(s.lesson, 8000) || !time(s.claimed_occurred_at) || Date.parse(s.claimed_occurred_at) !== Date.parse(value.reflection.occurred_at) || raw.receipt_id !== reflectionId || !eventId(raw.event_id) || raw.producer_id !== value.reflection.producer.id || !time(raw.stored_at) || !validReflectionDigest(raw.digest) || typeof raw.event_json !== "string" || new TextEncoder().encode(raw.event_json).byteLength > 65536 || v.handler !== "reflection.record" || !validReflectionId(v.attempt_id) || v.collected_at !== value.reflection.collected_at || !time(v.collected_at) || v.identity_and_references_checked !== true || v.is_acceptance_evidence !== false) invalid();
  let event: Record<string, any>;
  try { event = JSON.parse(raw.event_json); } catch { return invalid(); }
  if (!object(event) || Object.keys(event).some((key) => !["specversion", "type", "id", "subject", "source", "time", "datacontenttype", "data"].includes(key)) || event.specversion !== "1.0" || event.type !== "sop.reflection.recorded" || event.id !== raw.event_id || event.subject !== "" || !text(event.source, 512) || event.datacontenttype !== "application/json" || event.time !== s.claimed_occurred_at || !object(event.data)) invalid();
  const data = event.data as Record<string, unknown>;
  if (data.schema_version !== 1 || data.category !== s.category || data.title !== s.title || data.observation !== s.observation || (data.lesson ?? "") !== s.lesson || Object.keys(data).some((key) => !["schema_version", "category", "title", "observation", "lesson", "references"].includes(key)) || ("lesson" in data && typeof data.lesson !== "string")) invalid();
  const refs = data.references === undefined ? [] : data.references;
  if (!Array.isArray(refs) || refs.length > 8 || refs.length !== value.reflection.reference_count || refs.some((ref) => !object(ref) || Object.keys(ref).length !== 2 || !["task", "execution"].includes(ref.kind as string) || !validReflectionId(ref.id, ref.kind === "task" ? 64 : 200)) || new Set(refs.map((ref) => JSON.stringify([ref.kind, ref.id]))).size !== refs.length) invalid();
  if (value.links.length !== refs.length || value.links.some((link, index) => !object(link) || !["task", "execution"].includes(link.kind) || link.kind !== refs[index].kind || (link.id !== null && link.id !== refs[index].id) || typeof link.available !== "boolean" || (link.id !== null && !validReflectionId(link.id, link.kind === "task" ? 64 : 200)) || (link.label !== null && typeof link.label !== "string") || (link.reason !== null && typeof link.reason !== "string") || (link.available && (!link.id || link.reason !== null)))) invalid();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw.event_json)))).map((n) => n.toString(16).padStart(2, "0")).join("");
  if (digest !== raw.digest) invalid();
  if (value.selection_reference && (!validReflectionReference(value.selection_reference) || value.selection_reference.reflection_id !== reflectionId || value.selection_reference.source_digest !== raw.digest || value.selection_reference.attempt_id !== v.attempt_id || value.links.some((link) => !link.available))) invalid();
  return value;
}
export async function fetchReflectionInput(projectId: string, inputId: string, signal?: AbortSignal): Promise<ReflectionInputDetail> {
  if (!validReflectionId(inputId)) invalid();
  const value = await read<ReflectionInputDetail>(projectId, "/inputs/" + encodeURIComponent(inputId), signal);
  if (!inputSummary(value.input) || value.input.id !== inputId || !text(value.rationale, 2000, true) || !validReflectionDigest(value.manifest_digest) || value.is_acceptance_evidence !== false || typeof value.available !== "boolean" || !Array.isArray(value.sources) || value.sources.length !== value.input.source_count || new Set(value.sources.map((source) => source.reflection_id)).size !== value.sources.length || value.sources.some(({ available, unavailable_reason, ...ref }) => !validReflectionReference(ref) || typeof available !== "boolean" || (available ? unavailable_reason !== null : !unavailable_reason)) || value.available !== value.sources.every((source) => source.available)) invalid();
  return value;
}
