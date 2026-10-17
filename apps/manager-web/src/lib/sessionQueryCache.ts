import type { QueryClient } from "@tanstack/react-query";
import { getSessionRevision, getToken, getWorkspaceScope } from "./authStorage";

/** Discard cached results before rendering another account or project. */
export function watchSessionQueryCache(client: QueryClient, remount: () => void = () => {}) {
  const identity = () => JSON.stringify([getToken(), getSessionRevision(), getWorkspaceScope()]);
  let previous = identity();
  const changed = () => {
    const current = identity();
    if (current === previous) return;
    previous = current;
    client.clear();
    remount();
  };
  window.addEventListener("sop-session", changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener("sop-session", changed);
    window.removeEventListener("storage", changed);
  };
}
