import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getSessionRevision } from "./authStorage";
import { bindSessionRequest } from "./http";
import { projectSessionKey } from "./projectPortfolio";
import { browserPlanLock, createTaskPlanRetention, taskPlanPrincipal } from "./taskPlanRetention";

const routeSnapshot = () => typeof location === "undefined" ? "" : location.hash;
const subscribeRoute = (notify: () => void) => {
  for (const name of ["hashchange", "popstate"]) window.addEventListener(name, notify);
  return () => { for (const name of ["hashchange", "popstate"]) window.removeEventListener(name, notify); };
};

export function useTaskPlanRetention(projectId: string, requirementId: string, onPending?: (value: boolean) => void) {
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot, () => "");
  const scope = JSON.stringify([projectSessionKey(), projectId, requirementId, route]), live = useRef(scope), active = useRef<{ scope: string } | null>(null), notify = useRef(onPending);
  live.current = scope; notify.current = onPending;
  const { store, lease } = useMemo(() => {
    const lease = { scope };
    const origin = projectSessionKey(), send = bindSessionRequest({ projectId, revision: getSessionRevision() || "" });
    const unavailable = { getItem: () => { throw new Error("planLocalUnavailable"); },
      setItem: () => { throw new Error("planLocalUnavailable"); }, removeItem: () => { throw new Error("planLocalUnavailable"); } };
    let storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = unavailable;
    try { storage = globalThis.localStorage || unavailable; } catch { /* The storage getter itself may be denied. */ }
    const store = createTaskPlanRetention({ identity: taskPlanPrincipal(projectId, requirementId),
      storage, lock: browserPlanLock,
      current: () => active.current === lease && live.current === scope && projectSessionKey() === origin && (typeof location === "undefined" ? "" : location.hash) === route,
      onPending: (value) => { if (live.current === scope && (active.current === lease || active.current === null)) notify.current?.(value); },
      send: (original) => send("/api/v1/delivery/commands", { method: "POST", headers: { "X-Project-Id": projectId },
        body: JSON.stringify({ action: original.action, payload: original.payload, expected_version: original.intent.version,
          idempotency_key: original.intent.key, ...(original.source_reference ? { source_reference: original.source_reference } : {}) }) }),
    });
    return { store, lease };
  }, [scope, projectId, requirementId, route]);
  const view = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    active.current = lease;
    store.open();
    const invalidate = () => { if (live.current !== scope || JSON.stringify([projectSessionKey(), projectId, requirementId, routeSnapshot()]) !== scope) store.close(); };
    for (const name of ["sop-session", "storage"]) window.addEventListener(name, invalidate);
    return () => {
      for (const name of ["sop-session", "storage"]) window.removeEventListener(name, invalidate);
      if (active.current === lease) active.current = null;
      // React may immediately reconnect this effect in development. Keep the same lock
      // in that case, while all callbacks are blocked during a real disconnection.
      queueMicrotask(() => { if (active.current !== lease) { store.close(); if (live.current === scope && active.current === null) notify.current?.(false); } });
    };
  }, [store, lease, scope, projectId, requirementId]);
  return { store, view };
}
