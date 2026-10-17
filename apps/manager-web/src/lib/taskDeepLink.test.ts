import { describe, expect, it } from "vitest";
import { linkedTaskRows, taskIdFromHash } from "./taskDeepLink";

describe("legacy tasks linked from the delivery inbox", () => {
  it("decodes an explicit task identity while rejecting malformed references", () => {
    expect(taskIdFromHash("#/tasks?task_id=T-one")).toBe("T-one");
    expect(taskIdFromHash("#/tasks?task_id=%E4%BB%BB%E5%8A%A1-1")).toBe("任务-1");
    for (const hash of ["#/tasks", "#/tasks?task_id=", "#/tasks?task_id=%0Awrong", `#/tasks?task_id=${"x".repeat(65)}`])
      expect(taskIdFromHash(hash)).toBe("");
  });
  it("opens only the requested ID, without mistaking references in other titles for that task", () => {
    const rows = [{ id: "T-one", title: "Legacy task" }, { id: "T-two", title: "Follow up T-one" }];
    expect(linkedTaskRows(rows, "T-one", "T-one")).toEqual([rows[0]]);
    expect(linkedTaskRows(rows, "missing", "missing")).toEqual([]);
    expect(linkedTaskRows(rows, "T-one", "Follow up")).toEqual(rows);
    expect(linkedTaskRows(rows, "", "")).toEqual(rows);
  });
});
