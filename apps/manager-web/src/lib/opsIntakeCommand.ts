import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
import { createDeliveryCommandController, validDeliveryCommandAck, type DeliveryControllerOptions } from "./deliveryCommandController";
import { eventRetryDraftKey } from "./eventReceipts";
import { getSessionRevision, getWorkspaceScope } from "./authStorage";
import { bindSessionRequest } from "./http";
import { projectSessionKey } from "./projectPortfolio";

export type OpsIntakeOriginal = { action: "issue.ops.intake" | "issue.rca.intake"; payload: { source_id: string; source_digest: string; title: string; description: string; severity: "P0" | "P1" | "P2" | "P3" }; intent: DeliveryIntent };
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, any>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const identity = (value: unknown, max = 128): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && (empty || Boolean(value.trim())) && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
const maxRetained = 64 * 1024;
export function validOpsIntakeOriginal(value: unknown): value is OpsIntakeOriginal {
 if (!record(value) || !exact(value,["action","payload","intent"]) || !["issue.ops.intake", "issue.rca.intake"].includes(value.action) || !record(value.intent) || !exact(value.intent,["version","key"]) || !Number.isSafeInteger(value.intent.version) || value.intent.version < 0 || !identity(value.intent.key,100) || value.intent.key.length < 8 || !record(value.payload)) return false;
 const p=value.payload; return exact(p,["source_id","source_digest","title","description","severity"]) && typeof p.source_id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(p.source_id) && typeof p.source_digest === "string" && /^[a-f0-9]{64}$/.test(p.source_digest) && text(p.title,256) && text(p.description,10000,true) && ["P0","P1","P2","P3"].includes(p.severity);
}
export function validOpsIntakeAck(projectId: string, original: OpsIntakeOriginal, value: unknown): value is DeliveryCommandAck {
 if (!validOpsIntakeOriginal(original) || !record(value) || !exact(value,["project_id","action","resource","result","affected_refs","applied_version","version","query_generation","replayed"]) || !validDeliveryCommandAck(projectId,original,value,"issue") || !record(value.resource) || !exact(value.resource,["kind","id"]) || !record(value.result) || !exact(value.result,["issue_id","source_id","source_digest"])) return false;
 return /^ISSUE-[a-f0-9]{32}$/.test(value.resource.id) && value.result.issue_id === value.resource.id && value.result.source_id === original.payload.source_id && value.result.source_digest === original.payload.source_digest && value.affected_refs.length === 1 && record(value.affected_refs[0]) && exact(value.affected_refs[0],["kind","id"]);
}
export function createOpsIntakeController(options: Omit<DeliveryControllerOptions<OpsIntakeOriginal>,"validateOriginal"|"validateAck">) {
 return createDeliveryCommandController<OpsIntakeOriginal>({...options, retainSucceededOnRestore:true,
 load:()=>{const raw=options.load();if(raw!==null && raw.length>maxRetained)throw new Error("retainedOriginalInvalid");return raw;},
 save:(raw)=>{if(raw.length>maxRetained)throw new Error("retainedOriginalUnavailable");options.save(raw);},
 validateOriginal:validOpsIntakeOriginal,validateAck:(original,value)=>validOpsIntakeAck(options.projectId,original,value)});
}
export function opsIntakeStorageKey(projectId: string) {
 const base=eventRetryDraftKey(projectId,"ops-intake");if(!base)return null;
 return "sop.ops-intake.v1:"+JSON.stringify([base,getWorkspaceScope().businessCode||""]);
}
export function useOpsIntakeCommand(projectId: string) {
  const currentScope = () => JSON.stringify([projectSessionKey(), projectId, typeof location === "undefined" ? "" : location.hash]);
  const scope = currentScope(), identity = projectId, live = useRef(identity); live.current = identity;
  const controller = useMemo(() => {
    const key = opsIntakeStorageKey(projectId); let expectedRaw: string | null = null;
    const send = bindSessionRequest({ projectId, revision: getSessionRevision() || "" });
    return createOpsIntakeController({ projectId, scope, currentScope: () => live.current === identity ? currentScope() : "",
      load: () => { if (!key && typeof window !== "undefined") throw new Error("retainedOriginalUnavailable"); expectedRaw = key ? sessionStorage.getItem(key) : null; return expectedRaw; },
      save: (raw) => {
        if (!key) throw new Error("retainedOriginalUnavailable");
        const actual = sessionStorage.getItem(key);
        if (actual !== expectedRaw && !sameUnresolvedOriginal(expectedRaw, actual)) throw new Error("retainedOriginalUnavailable");
        sessionStorage.setItem(key, raw); expectedRaw = raw;
      },
      send: (original) => send("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId }, body: JSON.stringify({
        action: original.action, payload: original.payload, expected_version: original.intent.version, idempotency_key: original.intent.key,
      }) }),
    });
  }, [projectId, scope]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    controller.activate(); const leave = () => { if (currentScope() !== scope) controller.invalidate(); };
    if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(name, leave);
    return () => { if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(name, leave); controller.invalidate(); };
  }, [controller]);
  return { ...controller, scope, state, locked: !["idle", "refused"].includes(state.phase) || state.error === "retainedOriginalUnavailable" };
}
export type OpsIntakeCommand = ReturnType<typeof useOpsIntakeCommand>;

function sameUnresolvedOriginal(expected: string | null, actual: string | null) {
  if (!expected || !actual || expected.length > maxRetained || actual.length > maxRetained) return false;
  try {
    const before = JSON.parse(expected), after = JSON.parse(actual);
    return before.phase === "sending" && after.phase === "unknown" && !before.ack && !after.ack &&
      validOpsIntakeOriginal(before.original) && validOpsIntakeOriginal(after.original) &&
      JSON.stringify(before.original) === JSON.stringify(after.original);
  } catch { return false; }
}
