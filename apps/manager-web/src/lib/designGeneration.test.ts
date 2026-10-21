/** Generation original definitions only; no provider or runtime runs in this stage. */
import { expect, it } from "vitest";
import { createDesignGenerationController, validDesignGeneration, type DesignGenerationOriginal } from "./designGeneration";
const d = "d".repeat(64);
const original = (): DesignGenerationOriginal => ({ document_id: "D", body: { base_revision_id: "R", base_revision_digest: d, mode: "expand", instructions: "Actual instruction", idempotency_key: "same-generation-key" } });
const view = () => ({ project_id: "P", document_id: "D", id: "G", request_key: "same-generation-key", status: "succeeded", mode: "expand", instructions: "Actual instruction", base_revision_id: "R", base_revision_digest: d, requested_by: { id: "U", name: "User" }, created_at: "2026-10-21T09:00:00Z", model: "Configured model", provider: "Configured provider", usage: {}, content: "# Actual suggestion", content_sha256: d, error: null, current_basis: true, can_save: true, reasons: [] });
it("retains original before network and replays it after a lost response without changing key or instructions", async () => {
  let raw: string | null = null; const sent: string[] = [];
  const create = () => createDesignGenerationController({ projectId: "P", documentId: "D", current: () => true, load: () => raw, save: (value) => { raw = value; }, send: async (value) => { expect(raw).toBeTruthy(); sent.push(JSON.stringify(value)); if (sent.length === 1) throw new TypeError("Lost response"); return view(); } });
  const value = original(); await create().run(value); value.body.instructions = "Edited after send"; await create().replay(); expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]); expect(create().snapshot().phase).toBe("known");
});
it.each(["project", "document", "base", "key"])("does not accept a mismatched %s generation view", (field) => {
  const result = view(); if (field === "project") result.project_id = "Q"; if (field === "document") result.document_id = "other"; if (field === "base") result.base_revision_id = "other"; if (field === "key") result.request_key = "another-key";
  expect(validDesignGeneration(result, "P", original())).toBe(false);
});
it("keeps a known failed provider result distinct from an unknown HTTP response", async () => {
  let raw: string | null = null;
  const command = createDesignGenerationController({ projectId: "P", documentId: "D", current: () => true, load: () => raw, save: (value) => { raw = value; }, send: async () => ({ ...view(), status: "failed", content: null, content_sha256: null, can_save: false, error: { code: "provider_unavailable", message: "Actual provider failure" } }) });
  await command.run(original()); expect(command.snapshot().phase).toBe("known"); expect(command.snapshot().view?.status).toBe("failed");
});
it("does not call the provider transport when browser persistence is unavailable", async () => {
  let calls = 0; const command = createDesignGenerationController({ projectId: "P", documentId: "D", current: () => true, load: () => null, save: () => { throw new Error("Storage failed"); }, send: async () => { calls++; return view(); } });
  await command.run(original()); expect(calls).toBe(0);
});
it("does not let a delayed G1 refresh replace a newer G2 unknown original", async () => {
  let raw: string | null = null, finish!: (value: unknown) => void, calls = 0;
  const command = createDesignGenerationController({ projectId: "P", documentId: "D", current: () => true, load: () => raw, save: (value) => { raw = value; }, send: async () => { if (++calls === 1) return view(); throw new TypeError("G2 reply lost"); }, read: async () => new Promise((resolve) => { finish = resolve; }) });
  await command.run(original()); const oldRead = command.refresh(); command.reset(); const next = original(); next.body.idempotency_key = "new-generation-key"; await command.run(next);
  finish(view()); await oldRead; expect(command.snapshot().phase).toBe("unknown"); expect(command.snapshot().original?.body.idempotency_key).toBe("new-generation-key"); expect(raw).toContain("new-generation-key");
});
it("ignores an older send completion after invalidate/reactivate and a recovery send", async () => {
  let finish!: (value: unknown) => void, calls = 0, raw: string | null = null;
  const command = createDesignGenerationController({ projectId: "P", documentId: "D", current: () => true, load: () => raw, save: (value) => { raw = value; }, send: async () => { if (++calls === 1) return new Promise((resolve) => { finish = resolve; }); throw new TypeError("Recovery reply lost"); } });
  const first = command.run(original()); command.invalidate(); command.activate(); await command.replay(); finish(view()); await first;
  expect(command.snapshot().phase).toBe("unknown"); expect(command.snapshot().original?.body.idempotency_key).toBe("same-generation-key");
});
