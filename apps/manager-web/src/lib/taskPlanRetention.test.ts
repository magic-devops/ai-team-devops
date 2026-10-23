/** Pure protocol definitions only. No tests have run in the deferred validation window. */
import { describe, expect, it, vi } from "vitest";
import { createTaskPlanRetention, PLAN_RETENTION_LIMIT, taskPlanStorageKey, validTaskPlanAck, validTaskPlanDraft, validTaskPlanOriginal, type PlanLock } from "./taskPlanRetention";
import { planAck, planDraft, planOriginal, planPrincipal, planStorage } from "./taskPlanRetentionFixtures";
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function lockPort(): PlanLock {
  let held = false;
  return async (_name, work) => {
    if (held) { await work(false); return; }
    held = true; try { await work(true); } finally { held = false; }
  };
}
function fixture(send = vi.fn().mockResolvedValue(planAck)) {
  const storage = planStorage(), lock = lockPort(), identity = { ...planPrincipal }; let live = true;
  const create = () => createTaskPlanRetention({ identity, storage, lock, current: () => live, send });
  return { storage, create, send, key: taskPlanStorageKey(identity), leave: () => { live = false; } };
}
describe("durable task-plan originals and drafts", () => {
  it("validates bounded drafts separately from executable originals and exact task receipts", () => {
    const draft = planDraft(); draft.rows[0].title = "";
    expect(validTaskPlanDraft(draft, "R")).toBe(true); expect(validTaskPlanOriginal(planOriginal(draft), "R")).toBe(false);
    expect(validTaskPlanOriginal(planOriginal(), "other")).toBe(false);
    expect(validTaskPlanAck("P", planOriginal(), planAck)).toBe(true);
    for (const ack of [{ ...planAck, project_id: "Q" }, { ...planAck, result: null }, { ...planAck, result: { task_ids: ["other"] } },
      { ...planAck, applied_version: 10 }, { ...planAck, affected_refs: [] }]) expect(validTaskPlanAck("P", planOriginal(), ack)).toBe(false);
  });
  it("persists the current draft and preview request across new instances without storing a credential", async () => {
    const f = fixture(), first = f.create(); first.open();
    const draft = planDraft(); draft.preview_request = { requirement_id: "R", expected_version: 7, idempotency_key: "same-preview-key", generator: "ai", mode: "backend", max_items: 4 };
    expect(first.saveDraft(draft)).toBe(true); first.close(); await settle();
    const next = f.create(); next.open(); expect(next.snapshot().draft).toEqual(draft);
    expect(next.key).toContain('"user_id":"person"'); expect(next.key).not.toMatch(/token|revision|login/);
    next.close();
  });
  it("blocks a second owner and never replaces another editor's content", async () => {
    const f = fixture(), first = f.create(); first.open(); first.saveDraft(planDraft());
    const before = f.storage.getItem(f.key), second = f.create(); second.open();
    expect(second.snapshot().status).toBe("busy"); expect(second.saveDraft(planDraft())).toBe(false);
    expect(f.storage.getItem(f.key)).toBe(before); first.close(); second.close(); await settle();
    const reopened = f.create(); reopened.open(); expect(reopened.snapshot().owned).toBe(true); reopened.close();
  });
  it("retries a busy lock after the other editor closes without replacing retained content", async () => {
    const f = fixture(), first = f.create(); first.open(); first.saveDraft(planDraft()); const second = f.create(); second.open();
    await settle(); expect(second.snapshot().status).toBe("busy"); first.close(); await settle(); second.open();
    expect(second.snapshot().owned).toBe(true); expect(second.snapshot().draft).toEqual(planDraft()); second.close();
  });
  it("retains the exact discussion reference with the original across restart", async () => {
    const f = fixture(vi.fn().mockRejectedValueOnce(new Error("Network lost")).mockResolvedValueOnce(planAck)), first = f.create(); first.open();
    const draft = planDraft(); draft.source_reference = { thread_id: "D", expected_thread_version: 3, resolution_event_id: "E", message_id: "M", message_revision: 2 };
    first.saveDraft(draft); await first.run(planOriginal(draft)); first.close(); await settle(); const next = f.create(); next.open(); await next.replay();
    expect(f.send.mock.calls[1][0].source_reference).toEqual(draft.source_reference); expect(f.send.mock.calls[1][0]).toEqual(f.send.mock.calls[0][0]); next.close();
  });
  it("writes sending before the HTTP call and replays the byte-identical original after restart", async () => {
    const f = fixture(vi.fn().mockResolvedValue(planAck));
    const first = f.create(); first.open(); first.saveDraft(planDraft()); const original = planOriginal();
    f.send.mockImplementationOnce(async (sent) => {
      expect(JSON.parse(f.storage.getItem(f.key)!).command).toMatchObject({ phase: "sending", original: sent });
      throw new Error("Network connection lost");
    });
    await first.run(original); expect(first.snapshot().command.phase).toBe("unknown");
    expect(first.discard()).toBe(false); first.close(); await settle();
    const next = f.create(); next.open(); await next.replay();
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.send.mock.calls[0][0]).toEqual(f.send.mock.calls[1][0]);
    expect(next.snapshot().command.phase).toBe("succeeded"); next.close();
  });
  it("normalizes interrupted sending and ignores its late acknowledgement after the old owner leaves", async () => {
    let resolve!: (value: typeof planAck) => void;
    const f = fixture(vi.fn().mockImplementationOnce(() => new Promise((ok) => { resolve = ok; })).mockResolvedValueOnce(planAck));
    const first = f.create(); first.open(); first.saveDraft(planDraft()); const pending = first.run(planOriginal());
    first.close(); await settle(); const next = f.create(); next.open();
    expect(next.snapshot().command.phase).toBe("unknown"); resolve(planAck); await pending;
    expect(next.snapshot().command.phase).toBe("unknown"); await next.replay(); expect(next.snapshot().command.phase).toBe("succeeded"); next.close();
  });
  it("keeps known success on restore and never reruns it as a fresh creation", async () => {
    const f = fixture(), first = f.create(); first.open(); first.saveDraft(planDraft()); await first.run(planOriginal());
    first.close(); await settle(); const next = f.create(); next.open();
    expect(next.snapshot().command).toMatchObject({ phase: "succeeded", ack: planAck });
    await next.replay(); await next.run(planOriginal()); expect(f.send).toHaveBeenCalledTimes(1); next.close();
  });
  it.each(["HTTP 403: denied", "HTTP 409: project changed"])("never clears an unknown original after a later refusal: %s", async (message) => {
    const f = fixture(vi.fn().mockRejectedValueOnce(new Error("Network lost")).mockRejectedValueOnce(new Error(message)));
    const first = f.create(); first.open(); first.saveDraft(planDraft()); await first.run(planOriginal());
    await first.replay(); expect(first.snapshot().command.phase).toBe("unknown"); expect(first.discard()).toBe(false);
    expect(first.saveDraft(planDraft())).toBe(false); expect(f.send.mock.calls[1][0]).toEqual(f.send.mock.calls[0][0]); first.close();
  });
  it("permits editing only after a definite original refusal is explicitly acknowledged", async () => {
    const f = fixture(vi.fn().mockRejectedValue(new Error("HTTP 422: invalid input"))), store = f.create(); store.open(); store.saveDraft(planDraft());
    await store.run(planOriginal()); expect(store.snapshot().command.phase).toBe("refused");
    store.editRefused(); expect(store.snapshot().command.phase).toBe("idle"); expect(store.snapshot().draft).toEqual(planDraft()); store.close();
  });
  it("refuses storage or ownership failures before any HTTP mutation", async () => {
    const f = fixture(), store = f.create(); store.open(); store.saveDraft(planDraft());
    const saved = f.storage.getItem(f.key); f.storage.setItem = () => { throw new Error("quota"); };
    await store.run(planOriginal()); expect(f.send).not.toHaveBeenCalled(); expect(f.storage.getItem(f.key)).toBe(saved);
    expect(store.snapshot().status).toBe("unavailable"); store.close();
  });
  it("retains a failed edit in memory without changing durable bytes, then saves it explicitly", () => {
    const f = fixture(), store = f.create(); store.open(); store.saveDraft(planDraft()); const saved = f.storage.getItem(f.key), setItem = f.storage.setItem;
    f.storage.setItem = () => { throw new Error("quota"); }; const latest = planDraft(); latest.rows[0].title = "Latest unsaved input";
    expect(store.saveDraft(latest)).toBe(false); expect(store.snapshot().draft).toEqual(latest); expect(f.storage.getItem(f.key)).toBe(saved);
    f.storage.setItem = setItem; expect(store.saveDraft(store.snapshot().draft!)).toBe(true); expect(store.snapshot().status).toBe("saved");
    expect(JSON.parse(f.storage.getItem(f.key)!).draft).toEqual(latest); expect(f.send).not.toHaveBeenCalled(); store.close();
  });
  it("retains corrupt, foreign and oversized originals without clearing or overwriting them", async () => {
    for (const raw of ["", "{broken", JSON.stringify({ schema: 1, identity: { ...planPrincipal, user_id: "other" }, draft: planDraft(), command: null }), "x".repeat(PLAN_RETENTION_LIMIT + 1)]) {
      const f = fixture(); f.storage.setItem(f.key, raw); const store = f.create(); store.open();
      expect(store.snapshot().status).toBe("invalid"); expect(store.saveDraft(planDraft())).toBe(false);
      await store.run(planOriginal()); expect(f.send).not.toHaveBeenCalled(); expect(f.storage.getItem(f.key)).toBe(raw); store.close();
    }
  });
  it("guards changed records and changed principals even when an old callback still exists", async () => {
    const f = fixture(), store = f.create(); store.open(); store.saveDraft(planDraft());
    f.storage.setItem(f.key, "unique external record"); expect(store.saveDraft(planDraft())).toBe(false);
    await store.run(planOriginal()); expect(f.send).not.toHaveBeenCalled(); expect(f.storage.getItem(f.key)).toBe("unique external record"); store.close();
    const fresh = fixture(), owner = fresh.create(); owner.open(); owner.saveDraft(planDraft()); fresh.leave();
    await owner.run(planOriginal()); expect(fresh.send).not.toHaveBeenCalled(); owner.close();
  });
  it("rejects stale UI submission content even if an old save button is invoked", async () => {
    const f = fixture(), store = f.create(); store.open(); const changed = planDraft(); changed.rows[0].title = "Newest edit";
    store.saveDraft(changed); await store.run(planOriginal()); expect(f.send).not.toHaveBeenCalled(); store.close();
  });
  it("keeps a known receipt and can persist it after a post-response storage failure without another HTTP call", async () => {
    const f = fixture(); const normal = f.storage.setItem;
    f.send.mockImplementationOnce(async () => { f.storage.setItem = () => { throw new Error("quota after ACK"); }; return planAck; });
    const store = f.create(); store.open(); store.saveDraft(planDraft()); await store.run(planOriginal());
    expect(store.snapshot().command.phase).toBe("succeeded"); expect(store.snapshot().status).toBe("unavailable");
    f.storage.setItem = normal; expect(store.retainReceipt()).toBe(true); expect(f.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.storage.getItem(f.key)!).command.phase).toBe("succeeded"); store.close();
  });
});
