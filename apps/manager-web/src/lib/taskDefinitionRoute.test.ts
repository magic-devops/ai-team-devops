import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTaskDefinitionRoute, taskDefinitionHref, taskDefinitionRequest, taskDefinitionRouteKeys, taskDefinitionSourceKeys } from "./taskDefinitionRoute";
import { applyTaskDeliverySelection } from "./taskDeliveryRoute";

afterEach(() => vi.unstubAllGlobals());

describe("task definition editing routes", () => {
  it("opens one explicit task and preserves its scoped return", () => {
    const back = "#/dev-flow?project_id=P&view=team&task=T&submission_id=S";
    const href = taskDefinitionHref("P", { id: "T" }, back), params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("project_id")).toBe("P"); expect(params.get("task_edit")).toBe("1"); expect(params.get("task_edit_task")).toBe("T"); expect(params.get("return_to")).toBe(back);
    expect(taskDefinitionRequest(href, "P", "T").open).toBe(true);
  });
  it("refuses duplicate flags, another project and an old task's edit target", () => {
    for (const href of ["#/tasks/execution?project_id=P&task_id=T&task_edit=1&task_edit=1&task_edit_task=T", "#/tasks/execution?project_id=other&task_id=T&task_edit=1&task_edit_task=T", "#/tasks/execution?project_id=P&task_id=T2&task_edit=1&task_edit_task=T"])
      expect(taskDefinitionRequest(href, "P", "T").open).toBe(false);
  });
  it("drops the private edit and source context when a navigation changes task", () => {
    const source = "#/dev-flow?project_id=P&view=list&detail=tasks&task=T&task_edit=1&task_edit_task=T&task_source_thread=D&task_source_message=M";
    const moved = applyTaskDeliverySelection("#/dev-flow?project_id=P&view=list&detail=tasks&task=T2&task_edit=1&task_edit_task=T&task_source_thread=D&task_source_message=M", source);
    const params = new URLSearchParams(moved.split("?")[1]);
    expect(params.has("task_edit")).toBe(false); expect(params.has("task_edit_task")).toBe(false);
    for (const key of taskDefinitionSourceKeys) expect(params.has(key)).toBe(false);
  });
});


describe("invalid Task edit link cleanup", () => {
  it.each(["task_edit=1&task_edit_task=other", "task_edit=1&task_edit=1&task_edit_task=T", "task_edit=oops&task_source_thread=D"])("clears malformed private flags in the exact live Task scope: %s", (broken) => {
    const location = { hash: `#/dev-flow?project_id=P&task=T&detail=tasks&submission_id=S&work_order_id=W&return_to=${encodeURIComponent("#/tasks/board?project_id=P")}&${broken}` };
    const history = { state: null, replaceState: vi.fn((_state: unknown, _title: string, href: string) => { location.hash = href; }) };
    vi.stubGlobal("location", location); vi.stubGlobal("history", history);
    expect(taskDefinitionRequest(location.hash, "P", "T").invalid).toBe(true);
    closeTaskDefinitionRoute("P", "T"); expect(history.replaceState).toHaveBeenCalledTimes(1);
    const params = new URLSearchParams(location.hash.split("?")[1]);
    for (const key of taskDefinitionRouteKeys) expect(params.has(key)).toBe(false);
    expect(Object.fromEntries(params)).toEqual({ project_id: "P", task: "T", detail: "tasks", submission_id: "S", work_order_id: "W", return_to: "#/tasks/board?project_id=P" });
  });
  it.each([
    "#/dev-flow?project_id=P&project_id=P&task=T", "#/dev-flow?project_id=P&task=T&task=T", "#/dev-flow?project_id=P&task=T&task_id=T",
    "#/dev-flow?project_id=other&task=T", "#/dev-flow?project_id=P&task=other", "#/tasks/execution?project_id=P&task_id=T&task=T", "#/unknown?project_id=P&task=T", "#/dev-flow?project_id=P&task=T#other",
  ])("does not clear a foreign, ambiguous or unsupported live scope: %s", (hash) => {
    const history = { state: null, replaceState: vi.fn() };
    vi.stubGlobal("location", { hash: `${hash}&task_edit=1&task_edit_task=other` }); vi.stubGlobal("history", history);
    closeTaskDefinitionRoute("P", "T"); expect(history.replaceState).not.toHaveBeenCalled();
  });
});
