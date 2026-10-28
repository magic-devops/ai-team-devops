import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { projectSessionKey } from "./projectPortfolio";
import { browserCreationLock, createProjectCreationStore, projectCreationPrincipal, sendProjectCreation } from "./projectCreation";
import { installExecutionExitGuard } from "./executionExitGuard";

export function useProjectCreation(enabled: boolean) {
  const principal = projectCreationPrincipal();
  const scope = JSON.stringify([projectSessionKey(), window.location.hash]);
  const principalKey = JSON.stringify(principal);
  const binding = useRef(scope);
  const store = useMemo(() => createProjectCreationStore({ principal,
    storage: { getItem: (key) => localStorage.getItem(key), setItem: (key, raw) => localStorage.setItem(key, raw), removeItem: (key) => localStorage.removeItem(key) },
    lock: browserCreationLock, send: sendProjectCreation,
    current: () => JSON.stringify([projectSessionKey(), window.location.hash]) === binding.current && JSON.stringify(projectCreationPrincipal()) === principalKey,
  }), [principalKey]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    binding.current = scope;
    if (enabled) store.connect();
    const leave = () => { if (JSON.stringify([projectSessionKey(), window.location.hash]) !== scope) store.disconnect(); };
    for (const event of ["sop-session", "hashchange", "popstate", "storage"]) window.addEventListener(event, leave);
    return () => { for (const event of ["sop-session", "hashchange", "popstate", "storage"]) window.removeEventListener(event, leave); store.disconnect(); };
  }, [store, enabled, scope]);
  useEffect(() => installExecutionExitGuard(window, () => store.snapshot().unsaved, () => {}), [store]);
  const current = () => JSON.stringify([projectSessionKey(), window.location.hash]) === scope && store.current();
  return { ...store, state, current,
    edit: (patch: Parameters<typeof store.edit>[0]) => { if (current()) store.edit(patch); },
    create: () => current() ? store.create() : Promise.resolve(),
    replay: () => current() ? store.replay() : Promise.resolve(),
    revise: () => { if (current()) store.revise(); },
    retryStorage: () => current() && store.retryStorage(),
    clear: () => current() && store.clear(),
  };
}
