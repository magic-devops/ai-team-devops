import { afterEach, describe, expect, it, vi } from "vitest";
import { taskDispatchHref, taskDispatchRequest, taskDispatchOrderHref, closeTaskDispatchRoute, taskDispatchRouteEvent } from "./taskDispatchRoute";
describe("exact Task dispatch feedback routes", () => {
  it("carries only a selected immutable feedback reference and safe return", () => {
    const reference = { submission_id: "S", submission_digest: "a".repeat(64), decision_id: "D" };
    const href = taskDispatchHref("P", { id: "T", req_id: "R" }, "#/tasks/board?project_id=P&q=one", reference);
    expect(taskDispatchRequest(href, "P", "T")).toEqual({ open: true, invalid: false, feedback: reference });
    expect(new URLSearchParams(href.split("?")[1]).get("return_to")).toBe("#/tasks/board?project_id=P&q=one");
  });
  it("rejects cross-project, cross-Task and duplicate feedback locators", () => {
    for (const hash of ["#/tasks/execution?project_id=Q&task_id=T&task_dispatch=1", "#/tasks/execution?project_id=P&task_id=T2&task_dispatch=1", "#/tasks/execution?project_id=P&task_id=T&task_dispatch=1&feedback_submission=S&feedback_submission=S2"])
      expect(taskDispatchRequest(hash, "P", "T").open).toBe(false);
  });
});

afterEach(() => vi.unstubAllGlobals());
it("clears all definition/source fields and retains only a scoped external directory return", () => {
  const source = "#/tasks/execution?project_id=P&task_id=T&task_edit=1&task_edit_task=T&task_source_thread=Thread&task_source_message=M&task_source_version=2&task_source_revision=1&task_source_resolution=E&task_source_field=description";
  const href = taskDispatchHref("P", { id: "T" }, source), p = new URLSearchParams(href.split("?")[1]);
  expect([...p.keys()].some((key) => key.startsWith("task_source_") || key.startsWith("task_edit"))).toBe(false);
  const back = "#/ecosystem/a2a/dispatch?project_id=P&status=claimed&cursor=page";
  expect(new URLSearchParams(taskDispatchHref("P", { id: "T" }, back).split("?")[1]).get("return_to")).toBe(back);
  expect(new URLSearchParams(taskDispatchHref("Q", { id: "T" }, back).split("?")[1]).has("return_to")).toBe(false);
});
it("selects a confirmed W on the same Task without stale S/report/edit/dispatch and keeps filter/return", () => {
  const source = "#/tasks/execution?project_id=P&task_id=T&work_order_id=Old&submission_id=S&delivery_report=1&task_dispatch=1&dispatch_task=T&feedback_submission=S&task_edit=1&task_source_message=M&q=focus&return_to=%23%2Ftasks%2Fboard%3Fproject_id%3DP";
  const href = taskDispatchOrderHref(source, "P", "T", "W")!, p = new URLSearchParams(href.split("?")[1]);
  expect(p.get("work_order_id")).toBe("W"); expect(p.get("q")).toBe("focus"); expect(p.get("return_to")).toBe("#/tasks/board?project_id=P");
  for (const key of ["submission_id", "delivery_report", "task_dispatch", "dispatch_task", "feedback_submission", "task_edit", "task_source_message"]) expect(p.has(key)).toBe(false);
  for (const bad of [source.replace("project_id=P", "project_id=Other"), source.replace("task_id=T", "task_id=Other"), `${source}&task_id=T`, `${source}&task=T`, `${source}&project_id=P`]) expect(taskDispatchOrderHref(bad, "P", "T", "W")).toBeNull();
  expect(taskDispatchOrderHref(href, "P", "T", "W")).toBe(href);
});
it("closes even a bad dispatch flag only on the actual exact Task scope and publishes synchronous close", () => {
  const location = { hash: "#/tasks/execution?project_id=P&task_id=T&task_dispatch=1&dispatch_task=Wrong&q=keep" };
  const event = vi.fn(), target = new EventTarget(); target.addEventListener(taskDispatchRouteEvent, event);
  vi.stubGlobal("location", location); vi.stubGlobal("window", target); vi.stubGlobal("history", { state: null, replaceState: vi.fn((_state, _title, href) => { location.hash = href; }) });
  closeTaskDispatchRoute("P", "T"); expect(location.hash).toBe("#/tasks/execution?project_id=P&task_id=T&q=keep"); expect(event).toHaveBeenCalledTimes(1);
  for (const bad of ["#/tasks/execution?project_id=Other&task_id=T&task_dispatch=1", "#/tasks/execution?project_id=P&task_id=T&task_id=T&task_dispatch=1", "#/tasks/execution?project_id=P&task_id=T&task=T&task_dispatch=1"]) { location.hash = bad; closeTaskDispatchRoute("P", "T"); expect(location.hash).toBe(bad); }
});
