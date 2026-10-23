/** Stable-account discovery definitions only; UNRUN. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverTaskPlans, taskPlanPrincipal, taskPlanStorageKey } from "./taskPlanRetention";
import { planDraft, planPrincipal, planStorage } from "./taskPlanRetentionFixtures";
const h = vi.hoisted(() => ({ token: "credential", project: "P", business: "business" }));
vi.mock("./authStorage", async () => ({ ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")), USER_KEY: "user", getToken: () => h.token, getWorkspaceScope: () => ({ projectId: h.project, businessCode: h.business }) }));
let storage: ReturnType<typeof planStorage>;
beforeEach(() => {
  storage = planStorage(); h.token = "credential"; h.project = "P"; h.business = "business";
  storage.setItem("user", JSON.stringify({ id: "person", tenant_id: "tenant" }));
  vi.stubGlobal("localStorage", { ...storage, get length() { return storage.data.size; }, key: (i: number) => [...storage.data.keys()][i] ?? null });
});
afterEach(() => vi.unstubAllGlobals());
describe("stable account task-plan discovery", () => {
  it("restores the same identity after a new credential without storing the credential", () => {
    const before = taskPlanPrincipal("P", "R"); h.token = "new credential"; expect(taskPlanPrincipal("P", "R")).toEqual(before);
    expect(taskPlanStorageKey(before!)).not.toContain("credential"); h.token = ""; expect(taskPlanPrincipal("P", "R")).toBeNull();
  });
  it("discovers only the current tenant, user, business and project, keeping corrupt originals visible", () => {
    for (const identity of [planPrincipal, { ...planPrincipal, user_id: "other" }, { ...planPrincipal, tenant_id: "other" },
      { ...planPrincipal, business_code: "other" }, { ...planPrincipal, project_id: "Q" }]) {
      storage.setItem(taskPlanStorageKey(identity), JSON.stringify({ schema: 1, identity, draft: planDraft(), command: null }));
    }
    expect(discoverTaskPlans("P")).toEqual([{ requirementId: "R", title: "Requirement", phase: "draft" }]);
    const key = taskPlanStorageKey(planPrincipal); storage.setItem(key, ""); expect(discoverTaskPlans("P")[0].phase).toBe("invalid");
    expect(storage.getItem(key)).toBe(""); storage.setItem("user", JSON.stringify({ id: "another", tenant_id: "tenant" })); expect(discoverTaskPlans("P")).toEqual([]);
  });
  it("does not discover a former project or business after switching scope", () => {
    h.project = "Q"; expect(taskPlanPrincipal("P", "R")).toBeNull(); h.project = "P"; h.business = "new";
    expect(taskPlanPrincipal("P", "R")?.business_code).toBe("new");
  });
});
