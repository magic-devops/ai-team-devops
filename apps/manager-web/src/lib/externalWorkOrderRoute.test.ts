import { describe, expect, it } from "vitest";
import { externalWorkOrderHref, externalWorkOrderTaskHref, parseExternalWorkOrderRoute, selectedTaskWorkOrder } from "./externalWorkOrderRoute";
import { parseSubmissionSelection } from "./deliveryTaskSubmission";

describe("formal external work order navigation", () => {
  it("keeps the real project/task/order and selected fixed report on the actual Task report route", () => {
    const href = externalWorkOrderTaskHref("P", "任务 甲", "W1", "S1", externalWorkOrderHref({ projectId: "P", view: "orders", taskId: "任务 甲", workOrderId: "W1" }));
    expect(selectedTaskWorkOrder(href, "P", "任务 甲")).toBe("W1");
    expect(parseSubmissionSelection(href, "P", "任务 甲")).toEqual({ id: "S1", invalid: false });
    expect(new URLSearchParams(href.split("?")[1]).get("return_to")).toContain("work_order_id=W1");
  });

  it.each(["registry", "negotiate", "workbench", "dispatch", "evidence", "sla", "windows"])("retains project and task scope for the actual former %s entry", (entry) => {
    const route = parseExternalWorkOrderRoute(`#/ecosystem/a2a/${entry}?project_id=P&task_id=T&work_order_id=W1`);
    expect(route.invalid).toBe(false);
    expect([route.projectId, route.taskId, route.workOrderId]).toEqual(["P", "T", "W1"]);
  });

  it.each([
    "project_id=P&project_id=P&task_id=T&work_order_id=W1",
    "project_id=P&task_id=T&task_id=Other&work_order_id=W1",
    "project_id=P&task_id=T&work_order_id=W1&work_order_id=W2",
    "project_id=P&task=T&task_id=T&work_order_id=W1",
    "project_id=P&work_order_id=W1",
  ])("rejects duplicate or mixed identities in actual work order links: %s", (query) => {
    expect(parseExternalWorkOrderRoute(`#/ecosystem/a2a/dispatch?${query}`).invalid).toBe(true);
    expect(selectedTaskWorkOrder(`#/tasks/execution?${query}`, "P", "T")).toBe("");
  });

  it("rejects a Task order link from a different project or task, and never replaces it with a latest order", () => {
    const href = externalWorkOrderTaskHref("P", "T", "W1");
    expect(selectedTaskWorkOrder(href, "Other", "T")).toBe("");
    expect(selectedTaskWorkOrder(href, "P", "Other")).toBe("");
    expect(selectedTaskWorkOrder("#/tasks/execution?project_id=P&task_id=T", "P", "T")).toBe("");
  });
  it("retains the safe portfolio return while switching work order views and opening the existing Task report", () => {
    const route = parseExternalWorkOrderRoute("#/ecosystem/a2a/dispatch?project_id=P&return_to=%23%2Fprojects%2Fportfolio%3Fq%3Drelease%26status%3Dactive");
    const reportView = externalWorkOrderHref({ ...route, view: "reports", taskId: "T", workOrderId: "W1" });
    expect(parseExternalWorkOrderRoute(reportView).returnTo).toBe(route.returnTo);
    const href = externalWorkOrderTaskHref("P", "T", "W1", "S1", reportView);
    expect(new URLSearchParams(href.split("?")[1]).get("return_to")).toBe(reportView);
    expect(parseExternalWorkOrderRoute("#/ecosystem/a2a/dispatch?project_id=P&return_to=https%3A%2F%2Fother.example").invalid).toBe(true);
  });
});
