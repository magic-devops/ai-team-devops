import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReflection, fetchReflections, fetchReflectionInput } from "./reflectionReads";
import { reflectionDetailFixture, reflectionEnvelopeFixture, reflectionInputFixture, reflectionPageFixture, reflectionWithTaskFixture } from "./reflectionFixtures";
import { request } from "./http";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.stubGlobal("crypto", webcrypto);
});
describe("bounded reflection readers", () => {
  it.each([{ source: "" }, { id: "producer/reflection-001" }, { id: "producer\\reflection-001" }, { id: " ", source: "" }])("accepts an actual canonical producer envelope without treating its original fields as resource routes: %j", async (changes) => {
    vi.mocked(request).mockResolvedValue(reflectionEnvelopeFixture(changes));
    const value = await fetchReflection("P", "R");
    expect(value.available).toBe(true);
    expect(value.selection_reference?.reflection_id).toBe("R");
  });
  it.each([{ datacontenttype: "text/html" }, { source: "x".repeat(513) }])("rejects an original that violates the canonical CloudEvent envelope: %j", async (changes) => {
    vi.mocked(request).mockResolvedValue(reflectionEnvelopeFixture(changes));
    await expect(fetchReflection("P", "R")).rejects.toThrow();
  });
  it("reads the exact original independently of a failed or absent directory", async () => {
    vi.mocked(request).mockResolvedValue(reflectionDetailFixture());
    const result = await fetchReflection("P", "R");
    expect(result.selection_reference?.reflection_id).toBe("R");
    expect(vi.mocked(request).mock.calls).toHaveLength(1);
    expect(vi.mocked(request).mock.calls[0]).toMatchObject([
      "/api/v1/reflections/R", { headers: { "X-Project-Id": "P" } },
    ]);
  });
  it("uses signed SQL cursor and offset-aware occurrence bounds without local sampling", async () => {
    vi.mocked(request).mockResolvedValue(reflectionPageFixture());
    const result = await fetchReflections("P", { category: "testing", from: "2026-10-18T00:00:00Z", to: "2026-10-19T00:00:00Z", cursor: "next/+page" });
    expect(result.total).toBe(43);
    const params = new URLSearchParams(vi.mocked(request).mock.calls[0][0].split("?")[1]);
    expect(params.get("occurred_from")).toBe("2026-10-18T00:00:00Z");
    expect(params.get("occurred_to")).toBe("2026-10-19T00:00:00Z");
    expect(params.get("limit")).toBe("20");
    expect(params.get("cursor")).toBe("next/+page");
  });
  it.each(["project", "target", "raw", "digest", "statement", "attempt", "reference"])(
    "rejects a mismatched %s exact response instead of displaying or adopting it", async (kind) => {
      const bad = reflectionDetailFixture();
      if (kind === "project") bad.project_id = "other";
      if (kind === "target") bad.reflection.id = "other";
      if (kind === "raw") bad.source.event_json = "{}";
      if (kind === "digest") bad.source.digest = "a".repeat(64);
      if (kind === "statement") bad.statement.observation = "Changed claim";
      if (kind === "attempt") bad.verified.handler = "task.update";
      if (kind === "reference") bad.selection_reference.attempt_id = "other";
      vi.mocked(request).mockResolvedValue(bad);
      await expect(fetchReflection("P", "R")).rejects.toThrow();
    },
  );
  it("preserves historical statements when links are unavailable but forbids selection", async () => {
    const detail = { ...reflectionWithTaskFixture(), links: [{ kind: "task", id: "T", label: null, available: false, reason: "target_missing" }], selection_reference: null };
    vi.mocked(request).mockResolvedValue(detail);
    expect((await fetchReflection("P", "R")).statement?.observation).toBe("A lesson");
  });
  it("refuses a restricted shell that carries stale raw content", async () => {
    vi.mocked(request).mockResolvedValue({ ...reflectionDetailFixture(), available: false, unavailable_reason: "restricted" });
    await expect(fetchReflection("P", "R")).rejects.toThrow();
  });
  it("rejects a link projection that does not belong to the immutable typed references", async () => {
    const detail = reflectionWithTaskFixture(); detail.links[0].id = "foreign";
    vi.mocked(request).mockResolvedValue(detail);
    await expect(fetchReflection("P", "R")).rejects.toThrow();
  });
  it("keeps the fixed manifest count and order after an original disappears", async () => {
    const input = reflectionInputFixture();
    input.available = false;
    input.sources[0].available = false;
    input.sources[0].unavailable_reason = "source_missing" as never;
    vi.mocked(request).mockResolvedValue(input);
    const result = await fetchReflectionInput("P", "I");
    expect(result.input.source_count).toBe(1);
    expect(result.sources[0].reflection_id).toBe("R");
    expect(result.available).toBe(false);
  });
  it.each(["R/path", "R\\path", " R", "R\u0085"])("rejects unsafe resource ID %s before transport", async (id) => {
    await expect(fetchReflection("P", id)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
