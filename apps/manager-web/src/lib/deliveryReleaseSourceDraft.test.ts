/** Source-only behavior definitions. Runtime execution is deferred by the user. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSession, USER_KEY } from "./authStorage";
import { releaseQuality, releaseIndex } from "./deliveryReleaseFixtures";
import { createReleaseSourceDraftStore, readReleaseSourceDraft, releaseSourceDraftIdentity,
  releaseSourceDraftKey, releaseSourceMappingProblem, type ReleaseSourceDraft } from "./deliveryReleaseSourceDraft";

const local = new Map<string, string>(), retained = new Map<string, string>();
const identity = () => releaseSourceDraftIdentity("P", { ...releaseQuality, tasks: releaseQuality.independent_tasks }, releaseIndex.policy!);
const input = (): ReleaseSourceDraft => ({ active_task_id: "T-one", mappings: [{ task_id: "T-one", kind: "change", base_commit: "incomplete", accepted_commit: null, comment: "Need to check this range" }] });
beforeEach(() => {
  local.clear(); retained.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, raw: string) => local.set(key, raw), removeItem: (key: string) => local.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => retained.get(key) ?? null, setItem: (key: string, raw: string) => retained.set(key, raw), removeItem: (key: string) => retained.delete(key) });
  setSession("private-token", "P", "tenant"); local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" }));
});
afterEach(() => vi.unstubAllGlobals());

describe("exact-scope source preparation drafts", () => {
  it("retains incomplete input for a cold editor without retaining a token or generated packet", () => {
    const store = createReleaseSourceDraftStore(identity());
    expect(store.status).toBe("empty"); expect(store.save(input())).toBe(true);
    const restored = createReleaseSourceDraftStore(identity());
    expect(restored.status).toBe("restored"); expect(restored.draft).toEqual(input());
    expect([...retained.entries()].flat().join()).not.toContain("private-token");
    expect(JSON.parse(retained.get(store.key!)!)).not.toHaveProperty("packet");
  });
  it("separates session, tenant, user, project, scope and policy", () => {
    const original = identity(), key = releaseSourceDraftKey(original);
    createReleaseSourceDraftStore(original).save(input());
    for (const changed of [{ ...original, project_id: "other" }, { ...original, scope_basis: "f".repeat(64) }, { ...original, policy_generation: 2 }]) {
      expect(releaseSourceDraftKey(changed)).not.toBe(key);
      expect(createReleaseSourceDraftStore(changed).draft).toBeNull();
    }
    for (const user of [{ id: "other", tenant_id: "tenant" }, { id: "U", tenant_id: "other" }]) {
      local.set(USER_KEY, JSON.stringify(user)); expect(releaseSourceDraftKey(original)).not.toBe(key);
    }
    local.set(USER_KEY, JSON.stringify({ id: "U", tenant_id: "tenant" }));
    setSession("new-token", "P", "tenant"); expect(releaseSourceDraftKey(original)).not.toBe(key);
  });
  it("does not overwrite a retained original when the payload shape or exact fixed identity differs", () => {
    const current = identity(), key = releaseSourceDraftKey(current)!;
    for (const changed of [{ ...current, repository: "https://other.example/repo" }, { ...current, workflow: "other" }, { ...current, task_ids: [] }, { ...current, included_task_ids: [] }]) {
      const raw = JSON.stringify({ schema_version: 1, identity: changed, draft: input() }); retained.set(key, raw);
      const store = createReleaseSourceDraftStore(current);
      expect(store.status).toBe("invalid"); expect(store.save(input())).toBe(false); expect(retained.get(key)).toBe(raw);
      expect(store.clear()).toBe(true); expect(retained.has(key)).toBe(false);
    }
    for (const draft of [{ ...input(), packet: {} }, { ...input(), mappings: [...input().mappings, ...input().mappings] },
      { ...input(), mappings: [{ ...input().mappings[0], kind: ["change"] }] }, { ...input(), active_task_id: "outside" }]) {
      expect(() => readReleaseSourceDraft(JSON.stringify({ schema_version: 1, identity: current, draft }), current)).toThrow();
    }
  });
  it("refuses stale owners, keeps a newer draft and clears only the confirmed exact slot", () => {
    const a = createReleaseSourceDraftStore(identity()), b = createReleaseSourceDraftStore(identity());
    expect(a.save(input())).toBe(true); const raw = retained.get(a.key!);
    expect(b.save({ ...input(), mappings: [] })).toBe(false); expect(b.clear()).toBe(false);
    expect(retained.get(a.key!)).toBe(raw);
    retained.set("unrelated", "keep"); expect(a.clear()).toBe(true); expect(retained.get("unrelated")).toBe("keep");
  });
  it("keeps the previous draft when storage fails or a multibyte draft exceeds the bounded size", () => {
    const current = identity(), store = createReleaseSourceDraftStore(current);
    expect(store.save(input())).toBe(true); const raw = retained.get(store.key!);
    vi.spyOn(sessionStorage, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
    expect(store.save({ ...input(), mappings: [] })).toBe(false); expect(retained.get(store.key!)).toBe(raw);
    const ids = Array.from({ length: 100 }, (_, index) => "T-" + index), large = { ...current, scope_basis: "c".repeat(64), included_task_ids: ids };
    expect(createReleaseSourceDraftStore(large).save({ active_task_id: ids[0], mappings: ids.map((task_id) => ({ task_id,
      kind: "no_code_change", base_commit: null, accepted_commit: null, comment: "文".repeat(4000) })) })).toBe(false);
    expect(retained.get(store.key!)).toBe(raw);
  });
  it("explains each unfinished association instead of silently disabling generation", () => {
    expect(releaseSourceMappingProblem(undefined)).toBe("sourceChooseKind");
    const row = input().mappings[0]; expect(releaseSourceMappingProblem(row)).toBe("sourceBaseInvalid");
    row.base_commit = "a".repeat(40); expect(releaseSourceMappingProblem(row)).toBe("sourceAcceptedInvalid");
    row.accepted_commit = row.base_commit; expect(releaseSourceMappingProblem(row)).toBe("sourceSameCommit");
    row.accepted_commit = "b".repeat(64); expect(releaseSourceMappingProblem(row)).toBe("sourceCommitFormatMismatch");
    row.accepted_commit = "b".repeat(40); row.comment = " "; expect(releaseSourceMappingProblem(row)).toBe("sourceReasonRequired");
    row.comment = "Confirmed range"; expect(releaseSourceMappingProblem(row)).toBeNull();
    row.comment = "First line\r\n\tSecond line 😀"; expect(releaseSourceMappingProblem(row)).toBeNull();
    for (const invalid of ["Text\u0000", "Text\u000b", "Text\u007f", "Text\ud800"]) {
      row.comment = invalid; expect(releaseSourceMappingProblem(row)).toBe("sourceReasonInvalid");
    }
  });
});
