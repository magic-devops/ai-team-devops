import { afterEach, describe, expect, it, vi } from "vitest";
import { bindRequirementPlanningBack, requirementListFilters, requirementPlanningHref, requirementPlanningReturn } from "./requirementPlanning";
import { parseDeliveryRoute } from "./deliveryProjectInbox";
import { setSession } from "./authStorage";

afterEach(() => vi.unstubAllGlobals());

function planningSession() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const location = { hash: requirementPlanningHref("R", "P", "#/requirements/generation", { keyword: "original", status: "blocked", priority: "P0" }) };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
  setSession("account-a", "P", "tenant-a");
  return location;
}

describe("requirement planning navigation", () => {
  it("opens the exact canonical requirement tasks with the original list filters and project", () => {
    const filters = { keyword: "release & 中文", status: "blocked", priority: "P0" };
    const href = requirementPlanningHref("REQ-1&other=2", "project-P", "#/requirements/generation?return_to=https://invalid.test", filters);
    expect(parseDeliveryRoute(href)).toMatchObject({ view: "list", requirement: "REQ-1&other=2", detail: "tasks" });
    expect(new URLSearchParams(href.split("?")[1]).get("project_id")).toBe("project-P");
    const back = requirementPlanningReturn(href, "project-P");
    expect(back).toBeTruthy();
    expect(back!.split("?")[0]).toBe("#/requirements/generation");
    expect(requirementListFilters(back!)).toEqual(filters);
    expect(new URLSearchParams(back!.split("?")[1]).get("return_to")).toBeNull();
  });

  it.each(["https://invalid.test", "#/requirements/not-a-route", "#/requirements/pool#evil"])("uses a local canonical background for %s", (background) => {
    const href = requirementPlanningHref("R", "P", background, { keyword: "", status: "__all__", priority: "__all__" });
    expect(requirementPlanningReturn(href, "P")).toBe("#/requirements/pool?project_id=P");
  });

  it("restores valid filters and drops unsupported values", () => {
    expect(requirementListFilters("#/requirements/pool?q=hello&status=unknown&priority=any")).toEqual({ keyword: "hello", status: "__all__", priority: "__all__" });
    expect(requirementListFilters("#/requirements/pool?q=%00private&status=in_progress&priority=P2")).toEqual({ keyword: "", status: "in_progress", priority: "P2" });
  });

  it.each([["", "P"], ["R", ""], ["R\nsecret", "P"], ["R", "P".repeat(129)]])("rejects invalid navigation identities", (requirement, project) => {
    expect(() => requirementPlanningHref(requirement, project, "#/requirements/pool", { keyword: "", status: "__all__", priority: "__all__" })).toThrow();
  });

  it.each(["https://invalid.test", "#/requirements/pool?project_id=Q", "#/requirements/pool?project_id=P#other", "#/requirements/unknown?project_id=P"])("rejects an unsafe or foreign return %s", (back) => {
    expect(requirementPlanningReturn(`#/dev-flow?project_id=P&return_to=${encodeURIComponent(back)}`, "P")).toBeNull();
  });

  it("rejects a retained return action after the current project changed", () => {
    const href = requirementPlanningHref("R", "P", "#/requirements/pool", { keyword: "", status: "__all__", priority: "__all__" });
    expect(requirementPlanningReturn(href, "Q")).toBeNull();
  });

  it("does not navigate from a retained return callback after the session changes", () => {
    const location = planningSession();
    const original = location.hash;
    const back = bindRequirementPlanningBack(() => true);
    setSession("account-b", "Q", "tenant-b");
    expect(back()).toBe(false);
    expect(location.hash).toBe(original);
  });

  it("preserves the unresolved-operation guard before returning to the original filtered list", () => {
    const location = planningSession();
    const original = location.hash;
    let allowed = false;
    const back = bindRequirementPlanningBack(() => allowed);
    expect(back()).toBe(false);
    expect(location.hash).toBe(original);
    allowed = true;
    expect(back()).toBe(true);
    expect(location.hash.split("?")[0]).toBe("#/requirements/generation");
    expect(requirementListFilters(location.hash)).toEqual({ keyword: "original", status: "blocked", priority: "P0" });
  });
});
