import { useEffect, useState } from "react";

export type CursorPage = { cursor: string; page: number; next: string | null };
export type CursorHistory = {
  scope: string;
  epoch: string | null;
  pages: CursorPage[];
};
export const MAX_CURSOR_HISTORY = 32;
const MAX_CURSOR_LENGTH = 16384;

export function cursorPageNumber(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return 1;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : 1;
}
function inScope(
  history: CursorHistory,
  scope: string,
  epoch: string | null,
): CursorHistory {
  if (history.scope !== scope || (epoch !== null && history.epoch !== epoch))
    return { scope, epoch, pages: [] };
  return history;
}
export function rememberCursorPage(
  history: CursorHistory,
  scope: string,
  epoch: string | null,
  page: CursorPage | null,
): CursorHistory {
  const current = inScope(history, scope, epoch);
  if (
    !page || epoch === null || page.cursor.length > MAX_CURSOR_LENGTH ||
    (page.next?.length || 0) > MAX_CURSOR_LENGTH || page.next === page.cursor
  ) return current;
  const value = { ...page, page: page.cursor ? cursorPageNumber(page.page) : 1 };
  const previous = current.pages.find((item) => item.cursor === value.cursor);
  if (previous && previous.page === value.page && previous.next === value.next)
    return current;
  return {
    ...current,
    pages: [
      ...current.pages.filter((item) => item.cursor !== value.cursor), value,
    ].slice(-MAX_CURSOR_HISTORY),
  };
}
export function previousCursorPage(
  history: CursorHistory,
  scope: string,
  epoch: string | null,
  cursor: string,
): CursorPage | null {
  if (!cursor) return null;
  const current = inScope(history, scope, epoch);
  return [...current.pages].reverse().find(
    (item) => item.next === cursor && item.cursor !== cursor,
  ) || null;
}

/** Retain only links from successful exact reads, outside a conditional pager's lifetime. */
export function useCursorPageHistory(
  scope: string,
  epoch: string | null,
  cursor: string,
  page: CursorPage | null,
) {
  const [history, setHistory] = useState<CursorHistory>(() => ({ scope, epoch, pages: [] }));
  const acceptedCursor = page?.cursor, acceptedPage = page?.page, next = page?.next;
  useEffect(() => {
    setHistory((current) => rememberCursorPage(
      current, scope, epoch, acceptedCursor === undefined ? null : {
        cursor: acceptedCursor, page: acceptedPage!, next: next ?? null,
      },
    ));
  }, [scope, epoch, acceptedCursor, acceptedPage, next]);
  return previousCursorPage(history, scope, epoch, cursor);
}
