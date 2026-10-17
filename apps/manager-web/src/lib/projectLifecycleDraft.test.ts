import { describe, expect, it, vi } from "vitest";
import { prepareLifecycleSubmission, type ProjectLifecyclePreview, type LifecycleDraft } from "./projectPortfolio";
import { prepareDeliveryIntent } from "./delivery";

const preview = { project_id: "P", version: 7, from_status: "active", target_status: "archived", reason: "Project finished", preview_basis: "a".repeat(64), allowed: true, blockers: [], warnings: [], permissions: { can_transition: true } } as unknown as ProjectLifecyclePreview;
const draft: LifecycleDraft = { projectId: "P", targetStatus: "archived", reason: "Project finished", preview, intent: { version: 7, key: "original" } };
describe("fixed lifecycle proposal", () => {
  it("submits the exact preview and preserves the key for unknown-result retries", () => {
    const first = prepareLifecycleSubmission(draft);
    expect(first).toMatchObject({ action: "project.lifecycle", projectId: "P", version: 7, key: "original", payload: { target_status: "archived", reason: "Project finished", preview_basis: "a".repeat(64) } });
    expect(prepareLifecycleSubmission(first.draft).key).toBe("original");
  });
  it("does not reuse a preview after reason, target, project or permission changes", () => {
    for (const changed of [{ reason: "A different reason" }, { targetStatus: "paused" }, { projectId: "other" }, { preview: { ...preview, allowed: false } }, { preview: { ...preview, permissions: { can_transition: false } } }]) {
      expect(() => prepareLifecycleSubmission({ ...draft, ...changed } as LifecycleDraft)).toThrow();
    }
  });
  it("keeps delivery command idempotency tied to the original payload", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "changed-key" });
    const pinned = prepareDeliveryIntent(draft.intent, "project.lifecycle", { target_status: "archived" });
    expect(prepareDeliveryIntent(pinned, "project.lifecycle", { target_status: "active" }).key).toBe("changed-key");
    vi.unstubAllGlobals();
  });
});
