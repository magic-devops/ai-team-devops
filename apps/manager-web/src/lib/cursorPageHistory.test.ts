/** Behavior definitions only; execution is deferred by the user. */
import { describe, expect, it } from "vitest";
import { MAX_CURSOR_HISTORY, cursorPageNumber, rememberCursorPage, previousCursorPage, type CursorHistory } from "./cursorPageHistory";

const empty = (): CursorHistory => ({ scope: "P", epoch: "snapshot", pages: [] });
describe("bounded verified cursor links", () => {
  it("offers only a predecessor whose successful response supplied the current cursor", () => {
    let history = rememberCursorPage(empty(), "P", "snapshot", { cursor: "", page: 1, next: "two" });
    expect(previousCursorPage(history, "P", "snapshot", "two")).toEqual({ cursor: "", page: 1, next: "two" });
    expect(previousCursorPage(history, "P", "snapshot", "unvisited-deep-link")).toBeNull();
    history = rememberCursorPage(history, "P", "snapshot", { cursor: "two", page: 2, next: "three" });
    expect(previousCursorPage(history, "P", "snapshot", "three")?.cursor).toBe("two");
    expect(previousCursorPage(history, "P", "snapshot", "")).toBeNull();
    expect(rememberCursorPage(history, "P", "snapshot", null)).toBe(history);
  });
  it("keeps confirmed links across a failed page read but clears them for another scope or source epoch", () => {
    const history = rememberCursorPage(empty(), "P", "snapshot", { cursor: "", page: 1, next: "two" });
    expect(previousCursorPage(history, "P", null, "two")?.cursor).toBe("");
    expect(previousCursorPage(history, "other-actor-project-or-collection", "snapshot", "two")).toBeNull();
    expect(previousCursorPage(history, "P", "new-snapshot", "two")).toBeNull();
    expect(rememberCursorPage(history, "P", "new-snapshot", null).pages).toEqual([]);
  });
  it("updates the same page without accumulating duplicates and bounds retained positions", () => {
    let history = empty();
    for (let index = 0; index < MAX_CURSOR_HISTORY + 2; index++) history = rememberCursorPage(history, "P", "snapshot", {
      cursor: "cursor-" + index, page: index + 1, next: "cursor-" + (index + 1),
    });
    expect(history.pages).toHaveLength(MAX_CURSOR_HISTORY);
    expect(previousCursorPage(history, "P", "snapshot", "cursor-1")).toBeNull();
    const last = history.pages.at(-1)!;
    expect(rememberCursorPage(history, "P", "snapshot", last)).toBe(history);
    history = rememberCursorPage(history, "P", "snapshot", { ...last, next: null });
    expect(history.pages).toHaveLength(MAX_CURSOR_HISTORY);
    expect(previousCursorPage(history, "P", "snapshot", "cursor-" + (MAX_CURSOR_HISTORY + 2))).toBeNull();
  });
  it("rejects looping or oversized links and normalizes invalid display page numbers", () => {
    const history = empty();
    expect(rememberCursorPage(history, "P", "snapshot", { cursor: "same", page: 2, next: "same" }).pages).toEqual([]);
    expect(rememberCursorPage(history, "P", "snapshot", { cursor: "x".repeat(16385), page: 2, next: null }).pages).toEqual([]);
    for (const value of ["Infinity", "NaN", "2.5", "-2", Number.MAX_SAFE_INTEGER + 1]) expect(cursorPageNumber(value)).toBe(1);
    expect(cursorPageNumber("3")).toBe(3);
    expect(cursorPageNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
