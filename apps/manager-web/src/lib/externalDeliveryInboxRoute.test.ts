import { describe, expect, it } from "vitest";
import { deliveryInboxHash, deliveryInboxHref } from "./deliveryProjectInbox";
import { preserveProjectContext, projectWorkspaceHash } from "./projectPortfolioRoute";
import { applyTaskDeliverySelection } from "./taskDeliveryRoute";

const params = (hash: string) => new URLSearchParams(hash.split("?")[1]);
const selected = "#/dev-flow?project_id=P&view=list&requirement=R&detail=tasks&task=T&submission_id=S-old&work_order_id=W-old&delivery_report=1&inbox_scope=team&category=acceptance&inbox_cursor=page-2";
const target = { view: "list", requirement_id: "R", detail: "tasks", task_id: "T" };

describe("external delivery attention navigation", () => {
  it("retains the exact selected original only within the same project and Task", () => {
    const next = deliveryInboxHash(target, {}, selected, "P");
    expect(params(next).get("submission_id")).toBe("S-old");
    expect(params(next).get("work_order_id")).toBe("W-old");
    expect(params(next).has("delivery_report")).toBe(false);
    expect(params(next).get("inbox_cursor")).toBe("page-2");
  });
  it.each([
    { ...target, task_id: "T-new" },
    { view: "inbox", requirement_id: "", detail: "details", task_id: "" },
    { view: "issues", requirement_id: "R", detail: "tasks", task_id: "T", issue_id: "I" },
    { ...target, detail: "details" },
  ])("clears foreign report, work order and compose state at a scope transition", (next) => {
    const output = params(deliveryInboxHash(next, {}, selected, "P"));
    for (const key of ["submission_id", "work_order_id", "delivery_report"]) expect(output.has(key)).toBe(false);
  });
  it("replaces old selections only with the explicit destination IDs", () => {
    const output = params(deliveryInboxHash({ ...target, task_id: "T-new", submission_id: "S-new", work_order_id: null }, {}, selected, "P"));
    expect(output.get("task")).toBe("T-new");
    expect(output.get("submission_id")).toBe("S-new");
    expect(output.has("work_order_id")).toBe(false);
    expect(output.has("delivery_report")).toBe(false);
  });
  it("does not carry an original between projects even when Task IDs match", () => {
    const output = params(deliveryInboxHash(target, {}, selected, "P-new"));
    expect(output.get("project_id")).toBe("P-new");
    expect(output.has("submission_id")).toBe(false);
    expect(output.has("work_order_id")).toBe(false);
  });
  it("does not let project-context preservation overwrite an explicitly bound destination", () => {
    const next = deliveryInboxHash({ ...target, submission_id: "S-new" }, {}, selected, "P-new");
    const output = params(preserveProjectContext(next, selected, "P-new"));
    expect(output.get("project_id")).toBe("P-new");
    expect(output.get("submission_id")).toBe("S-new");
    const moved = params(projectWorkspaceHash("P-new", selected));
    expect(moved.has("submission_id")).toBe(false);
    expect(moved.has("work_order_id")).toBe(false);
    expect(moved.has("delivery_report")).toBe(false);
  });
  it("opens an independent Task's exact report and restores the inbox page", () => {
    const background = "#/dev-flow?project_id=P&view=inbox&inbox_scope=mine&category=acceptance&inbox_cursor=page-2&return_to=%23%2Fprojects%2Fportfolio%3Fstatus%3Dactive";
    const href = deliveryInboxHref({ ...target, requirement_id: "", submission_id: "S", work_order_id: null }, {}, background, "P");
    expect(href.split("?")[0]).toBe("#/tasks/execution");
    const output = params(href);
    expect(output.get("project_id")).toBe("P");
    expect(output.get("task_id")).toBe("T");
    expect(output.get("submission_id")).toBe("S");
    expect(output.get("return_to")).toBe(background);
    expect(output.has("task")).toBe(false);
    expect(output.has("delivery_report")).toBe(false);
  });
  it("keeps an active work order precise without borrowing an old saved report", () => {
    const href = deliveryInboxHref({ ...target, requirement_id: "", submission_id: null, work_order_id: "W" }, {}, selected, "P");
    expect(params(href).get("work_order_id")).toBe("W");
    expect(params(href).has("submission_id")).toBe(false);
    expect(params(href).has("delivery_report")).toBe(false);
  });
  it("does not preserve an ambiguous source or malformed explicit original", () => {
    const duplicate = `${selected}&submission_id=second`;
    expect(params(deliveryInboxHash(target, {}, duplicate, "P")).has("submission_id")).toBe(false);
    expect(params(deliveryInboxHash(target, {}, `${selected}&task_id=other`, "P")).has("work_order_id")).toBe(false);
    expect(() => deliveryInboxHash({ ...target, submission_id: "S/other" }, {}, selected, "P")).toThrow("invalidTaskDeliveryTarget");
    expect(() => deliveryInboxHash({ ...target, work_order_id: "W\ud800" }, {}, selected, "P")).toThrow("invalidTaskDeliveryTarget");
  });
  it("preserves an explicit same-Task compose request only while no report is selected", () => {
    const compose = "#/tasks/execution?project_id=P&task_id=T&work_order_id=W&delivery_report=1";
    const moved = applyTaskDeliverySelection("#/dev-flow?project_id=P&view=list&requirement=R&detail=tasks&task=T", compose);
    expect(params(moved).get("delivery_report")).toBe("1");
    expect(params(moved).get("work_order_id")).toBe("W");
    expect(params(applyTaskDeliverySelection("#/tasks/execution?project_id=P&task_id=T2", compose)).has("delivery_report")).toBe(false);
  });
  it.each([
    "#/tasks/execution?task_id=T&submission_id=S&work_order_id=W&delivery_report=1",
    "#/tasks/execution?project_id=P&project_id=P&task_id=T&submission_id=S&work_order_id=W&delivery_report=1",
  ])("does not attach unbound or ambiguous originals while adding project context", (unbound) => {
    for (const href of [projectWorkspaceHash("P", unbound), preserveProjectContext(unbound, "#/dev-flow?project_id=P")]) {
      const output = params(href);
      expect(output.getAll("project_id")).toEqual(["P"]);
      for (const key of ["submission_id", "work_order_id", "delivery_report"]) expect(output.has(key)).toBe(false);
    }
  });
  it("does not use another project's inbox as the Task return target", () => {
    const href = deliveryInboxHref({ ...target, requirement_id: "", submission_id: "S-new" }, {}, "#/dev-flow?project_id=OTHER&view=inbox&inbox_cursor=foreign", "P");
    expect(params(href).get("project_id")).toBe("P");
    expect(params(href).get("submission_id")).toBe("S-new");
    expect(params(href).has("return_to")).toBe(false);
  });
});
