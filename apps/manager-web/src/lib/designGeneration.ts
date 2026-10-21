import { useEffect, useMemo, useSyncExternalStore } from "react";
import { bindSessionRequest } from "./http";
import { getSessionRevision } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { eventProblem, eventRetryDraftKey } from "./eventReceipts";
import { designDigest, designExact, designIdentity, designRecord, type DesignReason } from "./designLibrary";
export type DesignGenerationInput = { base_revision_id: string; base_revision_digest: string; mode: "expand" | "review" | "diagram" | "free"; instructions: string; idempotency_key: string };
export type DesignGenerationOriginal = { document_id: string; body: DesignGenerationInput };
export type DesignGeneration = { project_id: string; document_id: string; id: string; request_key: string; status: "generating" | "succeeded" | "failed"; mode: DesignGenerationInput["mode"]; instructions: string; base_revision_id: string; base_revision_digest: string; requested_by: { id: string; name: string }; created_at: string; model: string; provider: string; usage: Record<string, unknown>; content: string | null; content_sha256: string | null; error: { code: string; message: string } | null; current_basis: boolean; can_save: boolean; reasons: DesignReason[] };
type State = { phase: "idle" | "sending" | "unknown" | "known" | "refused"; original?: DesignGenerationOriginal; view?: DesignGeneration; error?: string };
export function validGenerationOriginal(value: unknown): value is DesignGenerationOriginal {
  if (!designRecord(value) || !designExact(value, ["document_id", "body"]) || !designIdentity(value.document_id) || !designRecord(value.body) || !designExact(value.body, ["base_revision_id", "base_revision_digest", "mode", "instructions", "idempotency_key"])) return false;
  const body = value.body; return designIdentity(body.base_revision_id) && designDigest(body.base_revision_digest) && ["expand", "review", "diagram", "free"].includes(body.mode) && typeof body.instructions === "string" && Array.from(body.instructions).length <= 4000 && !body.instructions.includes("\0") && (body.mode !== "free" || Boolean(body.instructions.trim())) && typeof body.idempotency_key === "string" && body.idempotency_key.length >= 8 && body.idempotency_key.length <= 100 && !/[\s\u0000-\u001f\u007f-\u009f]/.test(body.idempotency_key);
}
export function validDesignGeneration(value: unknown, projectId: string, original: DesignGenerationOriginal): value is DesignGeneration {
  return validGenerationOriginal(original) && designRecord(value) && value.project_id === projectId && value.document_id === original.document_id && designIdentity(value.id) && value.request_key === original.body.idempotency_key && value.base_revision_id === original.body.base_revision_id && value.base_revision_digest === original.body.base_revision_digest && value.mode === original.body.mode && value.instructions === original.body.instructions && ["generating", "succeeded", "failed"].includes(value.status) && designRecord(value.requested_by) && designIdentity(value.requested_by.id) && typeof value.requested_by.name === "string" && typeof value.created_at === "string" && Number.isFinite(Date.parse(value.created_at)) && typeof value.model === "string" && typeof value.provider === "string" && designRecord(value.usage) && (value.content === null || typeof value.content === "string" && new TextEncoder().encode(value.content).length <= 65536) && (value.content_sha256 === null || designDigest(value.content_sha256)) && (value.error === null || designRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string") && typeof value.current_basis === "boolean" && typeof value.can_save === "boolean" && Array.isArray(value.reasons) && value.reasons.every((item) => designRecord(item) && typeof item.code === "string" && typeof item.message === "string") && (value.status !== "succeeded" || typeof value.content === "string" && Boolean(value.content.trim()) && designDigest(value.content_sha256)) && (!value.can_save || value.status === "succeeded" && value.current_basis);
}
export function createDesignGenerationController(options: { projectId: string; documentId: string; current: () => boolean; load: () => string | null; save: (raw: string) => void; send: (original: DesignGenerationOriginal) => Promise<unknown>; read?: (view: DesignGeneration) => Promise<unknown> }) {
  let state: State = { phase: "idle" }, live = true, epoch = 0;
  const immutable = <T,>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); } return value; };
  const listeners = new Set<() => void>(), current = () => live && options.current();
  const emit = (value: State) => { state = value; listeners.forEach((listener) => listener()); };
  const persist = (value: State) => { try { options.save(JSON.stringify(value)); emit(value); return true; } catch { emit({ ...state, error: "retainedOriginalUnavailable" }); return false; } };
  try { const raw = options.load(); if (raw) { if (raw.length > 1024 * 1024) throw new Error("retainedOriginalInvalid"); const value = JSON.parse(raw); if (!validGenerationOriginal(value.original) || value.original.document_id !== options.documentId || !["sending", "unknown", "known", "refused"].includes(value.phase) || value.phase === "known" && !validDesignGeneration(value.view, options.projectId, value.original)) throw new Error("retainedOriginalInvalid"); state = { ...value, original: immutable(structuredClone(value.original)), phase: value.phase === "sending" ? "unknown" : value.phase }; } } catch { state = { phase: "unknown", error: "retainedOriginalInvalid" }; }
  async function send(original: DesignGenerationOriginal) {
    if (!current() || state.phase === "sending") return; const captured = immutable(structuredClone(original)), recovery = state.phase === "unknown", operation = ++epoch;
    if (!persist({ phase: "sending", original: captured })) return;
    const valid = () => current() && operation === epoch && state.phase === "sending" && state.original === captured;
    try { const value = await options.send(structuredClone(captured)); if (!valid()) return; if (!validDesignGeneration(value, options.projectId, captured)) throw new Error("designInvalid"); persist({ phase: "known", original: captured, view: value }); }
    catch (cause) { if (!valid()) return; const problem = eventProblem(cause); persist({ phase: recovery || problem.unknown ? "unknown" : "refused", original: captured, error: problem.message }); }
  }
  return {
    snapshot: () => state, current, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run: (original: DesignGenerationOriginal) => state.phase === "idle" && validGenerationOriginal(original) && original.document_id === options.documentId ? send(original) : Promise.resolve(),
    replay: () => state.phase === "unknown" && state.original ? send(state.original) : Promise.resolve(),
    async refresh() { if (!current() || state.phase !== "known" || !state.view || !state.original || !options.read) return; const original = state.original, view = state.view, operation = ++epoch; const valid = () => current() && operation === epoch && state.phase === "known" && state.original === original && state.view?.id === view.id; try { const value = await options.read(view); if (!valid()) return; if (!validDesignGeneration(value, options.projectId, original)) throw new Error("designInvalid"); persist({ phase: "known", original, view: value }); } catch (cause) { if (valid()) emit({ ...state, error: (cause as Error).message }); } },
    reset() { if (!current() || !["known", "refused"].includes(state.phase)) return; epoch++; try { options.save(""); emit({ phase: "idle" }); } catch { emit({ ...state, error: "retainedOriginalUnavailable" }); } },
    activate() { live = true; }, invalidate() { epoch++; if (state.phase === "sending") persist({ ...state, phase: "unknown" }); live = false; },
  };
}
export function useDesignGeneration(projectId: string, documentId: string) {
  const scope = projectSessionKey(), revision = getSessionRevision() || "";
  const controller = useMemo(() => {
    const key = eventRetryDraftKey(projectId, `design-generation:${documentId}`)?.replace("sop.event-retry.v1:", "sop.design-generation.v1:");
    const transport = bindSessionRequest({ projectId, revision });
    return createDesignGenerationController({ projectId, documentId, current: () => scope === projectSessionKey(), load: () => key ? sessionStorage.getItem(key) : null, save: (raw) => { if (!key) throw new Error("retainedOriginalUnavailable"); sessionStorage.setItem(key, raw); }, send: (original) => transport(`/api/v1/design-docs/${encodeURIComponent(original.document_id)}/previews`, { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify(original.body) }), read: (view) => transport(`/api/v1/design-docs/${encodeURIComponent(documentId)}/previews/${encodeURIComponent(view.id)}`, { headers: { "X-Project-Id": projectId } }) });
  }, [projectId, documentId, scope, revision]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => { controller.activate(); return () => controller.invalidate(); }, [controller]); return { ...controller, state };
}
