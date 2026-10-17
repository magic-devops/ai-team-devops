import { describe, expect, it } from "vitest";
import { linkedTaskRows, taskIdFromHash } from "./taskDeepLink";
import { manualTaskHref } from "./deliveryTaskReview";

describe("legacy tasks linked from the delivery inbox", () => {
  it("retains a safe filtered task background while opening a standalone task", () => {
    const background = "#/tasks/execution?q=verify&status=pending&priority=P1&source=manual";
    const href = manualTaskHref({ id: "T-one", req_id: "" }, background);
    expect(new URLSearchParams(href.split("?")[1]).get("return_to")).toBe(background);
    expect(manualTaskHref({ id: "T-one", req_id: "" }, "https://example.test")).not.toContain("return_to");
  });
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
