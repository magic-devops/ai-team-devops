import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { getSessionRevision, getWorkspaceScope } from "./authStorage";
import { bindSessionRequest } from "./http";
import { projectSessionKey } from "./projectPortfolio";

export type RuntimeBindingOriginal = { action: "member.runtime.bind" | "member.runtime.unbind"; payload: Record<string, unknown>; intent: DeliveryIntent };
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export const runtimeBindingIdentity = (value: unknown, max = 100): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value);
const maxRetained = 64 * 1024;
export const RUNTIME_BINDING_CHANGE = "sop-runtime-binding-recovery";
const prefix = "sop.runtime-binding.v1:";

export function validRuntimeBindingOriginal(value: unknown, memberId: string): value is RuntimeBindingOriginal {
  if (!record(value) || !exact(value, ["action", "payload", "intent"]) || !record(value.intent) || !exact(value.intent, ["version", "key"]) ||
    !Number.isSafeInteger(value.intent.version) || value.intent.version < 0 || !runtimeBindingIdentity(value.intent.key) || value.intent.key.length < 8 ||
    !record(value.payload) || !runtimeBindingIdentity(memberId) || memberId.startsWith("user:") || value.payload.member_id !== memberId) return false;
  const p = value.payload;
  if (value.action === "member.runtime.bind") return exact(p, ["member_id", "workspace_id", "agent_id", "agent_version"]) &&
    runtimeBindingIdentity(p.workspace_id, 64) && runtimeBindingIdentity(p.agent_id, 64) && Number.isSafeInteger(p.agent_version) && p.agent_version > 0;
  return value.action === "member.runtime.unbind" && exact(p, ["member_id"]);
}
export function validRuntimeBindingAck(projectId: string, memberId: string, original: RuntimeBindingOriginal, value: unknown): value is DeliveryCommandAck {
  return validRuntimeBindingOriginal(original, memberId) && record(value) && exact(value, ["project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"]) &&
    validDeliveryCommandAck(projectId, original, value, "member", memberId) && record(value.resource) && exact(value.resource, ["kind", "id"]) && value.result === null &&
    value.affected_refs.length === 1 && record(value.affected_refs[0]) && exact(value.affected_refs[0], ["kind", "id"]);
}
export function createRuntimeBindingController(options: Omit<DeliveryControllerOptions<RuntimeBindingOriginal>, "validateOriginal" | "validateAck"> & { memberId: string }) {
  return createDeliveryCommandController<RuntimeBindingOriginal>({ ...options, retainSucceededOnRestore: true,
    load: () => { const raw = options.load(); if (raw !== null && raw.length > maxRetained) throw new Error("retainedOriginalInvalid"); return raw; },
    save: (raw) => { if (raw.length > maxRetained) throw new Error("retainedOriginalUnavailable"); options.save(raw); },
    validateOriginal: (value) => validRuntimeBindingOriginal(value, options.memberId),
    validateAck: (original, value) => validRuntimeBindingAck(options.projectId, options.memberId, original, value),
  });
}
export function runtimeBindingStorageKey(projectId: string, memberId: string): string | null {
  if (!runtimeBindingIdentity(projectId) || !runtimeBindingIdentity(memberId) || memberId.startsWith("user:")) return null;
  const base = eventRetryDraftKey(projectId, "runtime-binding"); if (!base) return null;
  try { return prefix + JSON.stringify([...JSON.parse(base.slice("sop.event-retry.v1:".length)).slice(0, 4), getWorkspaceScope().businessCode || "", memberId]); } catch { return null; }
}
export function discoverRuntimeBindingRecovery(projectId: string): string[] {
  const probe = runtimeBindingStorageKey(projectId, "__probe__"); if (!probe) return [];
  const expected = JSON.parse(probe.slice(prefix.length)), members = new Set<string>();
  try {
    for (let at = 0; at < sessionStorage.length; at++) {
      const key = sessionStorage.key(at); if (!key?.startsWith(prefix)) continue;
      let parts: unknown; try { parts = JSON.parse(key.slice(prefix.length)); } catch { continue; }
      if (!Array.isArray(parts) || parts.length !== 6 || !parts.slice(0, 5).every((value, index) => value === expected[index]) ||
        !runtimeBindingIdentity(parts[5]) || parts[5].startsWith("user:") || !sessionStorage.getItem(key)) continue;
      members.add(parts[5]);
    }
  } catch { throw new Error("retainedOriginalUnavailable"); }
  return [...members].sort();
}
export function useRuntimeBindingCommand(projectId: string, memberId: string, sessionId: string) {
  const currentScope = () => JSON.stringify([projectSessionKey(), projectId, memberId, sessionId, typeof location === "undefined" ? "" : location.hash]);
  const scope = currentScope(), identity = `${projectId}:${memberId}:${sessionId}`, live = useRef(identity); live.current = identity;
  const controller = useMemo(() => {
    const key = runtimeBindingStorageKey(projectId, memberId); let expectedRaw: string | null = null;
    const send = bindSessionRequest({ projectId, revision: getSessionRevision() || "" });
    return createRuntimeBindingController({ projectId, memberId, scope, currentScope: () => live.current === identity ? currentScope() : "",
      load: () => { if (!key && typeof window !== "undefined") throw new Error("retainedOriginalUnavailable"); expectedRaw = key ? sessionStorage.getItem(key) : null; return expectedRaw; },
      save: (raw) => {
        if (!key) throw new Error("retainedOriginalUnavailable");
        const actual = sessionStorage.getItem(key);
        if (actual !== expectedRaw && !sameUnresolvedOriginal(expectedRaw, actual, memberId)) throw new Error("retainedOriginalUnavailable");
        sessionStorage.setItem(key, raw); expectedRaw = raw;
        if (typeof window !== "undefined") window.dispatchEvent(new Event(RUNTIME_BINDING_CHANGE));
      },
      send: (original) => send("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({
        action: original.action, payload: original.payload, expected_version: original.intent.version, idempotency_key: original.intent.key,
      }) }),
    });
  }, [projectId, memberId, sessionId, scope]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    controller.activate(); const leave = () => { if (currentScope() !== scope) controller.invalidate(); };
    if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(name, leave);
    return () => { if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(name, leave); controller.invalidate(); };
  }, [controller]);
  return { ...controller, scope, state, locked: !["idle", "refused"].includes(state.phase) || state.error === "retainedOriginalUnavailable" };
}
export type RuntimeBindingCommand = ReturnType<typeof useRuntimeBindingCommand>;

function sameUnresolvedOriginal(expected: string | null, actual: string | null, memberId: string) {
  if (!expected || !actual || expected.length > maxRetained || actual.length > maxRetained) return false;
  try {
    const before = JSON.parse(expected), after = JSON.parse(actual);
    return before.phase === "sending" && after.phase === "unknown" && !before.ack && !after.ack &&
      validRuntimeBindingOriginal(before.original, memberId) && validRuntimeBindingOriginal(after.original, memberId) &&
      JSON.stringify(before.original) === JSON.stringify(after.original);
  } catch { return false; }
}
