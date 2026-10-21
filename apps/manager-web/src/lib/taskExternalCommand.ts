import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { projectSessionKey } from "./projectPortfolio";
import type { DeliveryControllerOptions, DeliveryOriginal } from "./deliveryCommandController";
import { createDeliveryCommandController } from "./deliveryCommandController";

export type TaskExternalKind = "submission" | "work-order";
type Controller<T extends DeliveryOriginal> = ReturnType<typeof createDeliveryCommandController<T>>;
type Options<T extends DeliveryOriginal> = {
  projectId: string; taskId: string; kind: TaskExternalKind; storageKey: () => string | null;
  create: (options: Pick<DeliveryControllerOptions<T>, "projectId" | "scope" | "currentScope" | "load" | "save" | "onPending">) => Controller<T>;
  onPending?: (value: boolean) => void;
};
type Entry = { controller: Controller<any>; owners: number; pending: Set<(value: boolean) => void> };
const entries = new Map<string, Entry>();
const pendingState = (entry: Entry) => !["idle", "refused"].includes(entry.controller.snapshot().phase);
const scopeFor = (projectId: string, taskId: string, kind: TaskExternalKind) => JSON.stringify([projectSessionKey(), projectId, taskId, kind, typeof location === "undefined" ? "" : location.hash]);

function entryFor<T extends DeliveryOriginal>(options: Options<T>, scope: string): Entry {
  const existing = entries.get(scope); if (existing) return existing;
  const key = options.storageKey(), pending = new Set<(value: boolean) => void>();
  let previousRaw: string | null = null, entry: Entry;
  const controller = options.create({ projectId: options.projectId, scope,
    currentScope: () => scopeFor(options.projectId, options.taskId, options.kind),
    load: () => { if (!key) throw new Error("retainedOriginalUnavailable"); try { previousRaw = sessionStorage.getItem(key); return previousRaw; } catch { throw new Error("retainedOriginalUnavailable"); } },
    save: (raw) => {
      if (!key || sessionStorage.getItem(key) !== previousRaw) throw new Error("retainedOriginalUnavailable");
      sessionStorage.setItem(key, raw); previousRaw = raw;
    },
    onPending: () => { if (entry) for (const notify of pending) notify(pendingState(entry)); },
  });
  entry = { controller, owners: 0, pending }; entries.set(scope, entry);
  if (entries.size > 128) for (const [name, old] of entries) {
    if (name !== scope && !old.owners) { old.controller.invalidate(); entries.delete(name); }
    if (entries.size <= 128) break;
  }
  return entry;
}

/** Normal, failed-context and startup consumers share one real scoped original. */
export function useTaskExternalCommand<T extends DeliveryOriginal>(options: Options<T>) {
  const scope = scopeFor(options.projectId, options.taskId, options.kind), notify = useRef(options.onPending); notify.current = options.onPending;
  const entry = useMemo(() => entryFor(options, scope), [scope]);
  const controller = entry.controller as Controller<T>;
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    if (!entries.has(scope)) entries.set(scope, entry);
    entry.owners++; controller.activate();
    const listener = (value: boolean) => notify.current?.(value); entry.pending.add(listener); listener(pendingState(entry));
    const leave = () => { if (scopeFor(options.projectId, options.taskId, options.kind) !== scope) controller.invalidate(); };
    if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(name, leave);
    return () => {
      if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(name, leave);
      entry.pending.delete(listener); entry.owners--; if (!entry.owners) { controller.invalidate(); if (entries.get(scope) === entry) entries.delete(scope); }
      notify.current?.(false);
    };
  }, [entry, scope]);
  return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: !["idle", "refused"].includes(state.phase) };
}

/** Keys are restricted to this authorized tab session; no other account is inspected. */
export function discoverTaskExternalRecovery(projectId: string, options: {
  prefix: string; receiptPrefix: string; key: (projectId: string, taskId: string) => string | null;
  identity: (value: unknown) => value is string; pending: (projectId: string, taskId: string) => boolean; includeRefused?: boolean;
}): string[] {
  const probe = options.key(projectId, "__scope__"); if (!probe) return [];
  const expected = JSON.parse(probe.slice(options.prefix.length)), tasks = new Set<string>();
  try {
    if (sessionStorage.length > 2048) throw new Error("retainedOriginalUnavailable");
    for (let at = 0; at < sessionStorage.length; at++) {
      const key = sessionStorage.key(at); if (!key?.startsWith(options.prefix)) continue;
      let parts: unknown; try { parts = JSON.parse(key.slice(options.prefix.length)); } catch { continue; }
      if (!Array.isArray(parts) || parts.length !== 5 || !parts.slice(0, 4).every((part, index) => part === expected[index]) || typeof parts[4] !== "string" || !parts[4].startsWith(options.receiptPrefix)) continue;
      const taskId = parts[4].slice(options.receiptPrefix.length);
      if (options.identity(taskId) && (options.pending(projectId, taskId) || options.includeRefused && Boolean(sessionStorage.getItem(key)))) tasks.add(taskId);
      if (tasks.size > 128) throw new Error("retainedOriginalUnavailable");
    }
  } catch { throw new Error("retainedOriginalUnavailable"); }
  return [...tasks].sort();
}
