import { useCallback, useEffect, useRef, useState } from "react";
import { projectSessionKey } from "./projectPortfolio";
export function sameExecutionLocation(before: string, after: string) {
  const canonical = (href: string) => {
    const url = new URL(href),
      [path, query] = url.hash.split("?");
    const params = new URLSearchParams(query);
    for (const key of [
      "execution_node",
      "execution_attempt",
      "execution_stream",
    ])
      params.delete(key);
    params.sort();
    return `${url.origin}${url.pathname}${url.search}${path}?${params}`;
  };
  try {
    return canonical(before) === canonical(after);
  } catch {
    return false;
  }
}
export function installExecutionExitGuard(
  target: Window,
  shouldBlock: () => boolean,
  onBlocked: () => void,
) {
  let retained = target.location.href;
  const route = (event: Event) => {
    if (
      shouldBlock() &&
      !sameExecutionLocation(retained, target.location.href)
    ) {
      target.history.replaceState(target.history.state, "", retained);
      event.stopImmediatePropagation();
      onBlocked();
    } else retained = target.location.href;
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (shouldBlock()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const click = (event: MouseEvent) => {
    if (
      !shouldBlock() ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0
    )
      return;
    const anchor = (event.target as Element | null)?.closest?.(
      "a[href]",
    ) as HTMLAnchorElement | null;
    if (
      !anchor ||
      anchor.target === "_blank" ||
      anchor.hasAttribute("download")
    )
      return;
    if (!sameExecutionLocation(retained, anchor.href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      onBlocked();
    }
  };
  target.addEventListener("hashchange", route, true);
  target.addEventListener("popstate", route, true);
  target.addEventListener("beforeunload", unload);
  target.document.addEventListener("click", click, true);
  return Object.assign(
    () => {
      target.removeEventListener("hashchange", route, true);
      target.removeEventListener("popstate", route, true);
      target.removeEventListener("beforeunload", unload);
      target.document.removeEventListener("click", click, true);
    },
    {
      retainCurrent: () => {
        retained = target.location.href;
      },
    },
  );
}
export function useExecutionExitGuard() {
  const origin = useRef(projectSessionKey());
  const pendingIds = useRef(new Set<string>());
  const installed = useRef<ReturnType<typeof installExecutionExitGuard>>();
  const [pending, setPendingState] = useState(false),
    [blocked, setBlocked] = useState(false);
  const setPending = useCallback((id: string, value: boolean) => {
    if (value && !pendingIds.current.size) installed.current?.retainCurrent();
    if (value) pendingIds.current.add(id);
    else pendingIds.current.delete(id);
    setPendingState(pendingIds.current.size > 0);
    if (!pendingIds.current.size) setBlocked(false);
    return pendingIds.current.size > 0;
  }, []);
  const canNavigate = useCallback(() => {
    if (origin.current !== projectSessionKey() || !pendingIds.current.size)
      return true;
    setBlocked(true);
    return false;
  }, []);
  useEffect(() => {
    const dispose = installExecutionExitGuard(
      window,
      () =>
        origin.current === projectSessionKey() && pendingIds.current.size > 0,
      () => setBlocked(true),
    );
    installed.current = dispose;
    return dispose;
  }, []);
  return { pending, blocked, setPending, canNavigate };
}
