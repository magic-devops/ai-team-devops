/** Behaviour definitions only; UNRUN while the validation window is deferred. */
import { describe, expect, it } from "vitest";
import { referenceChoices, referenceChangeAllowed, type ReferenceChoiceInput } from "./deliveryReferenceState";
const ref = (id: string, active = true, kind = "human") => ({ id, kind: "member" as const, label: `Name ${id}`, task_count: 0, data: { id, active, kind } });
const page = (items = [ref("user:a")], generation = 3) => ({ project_id: "P", query_generation: generation, version: 7, items, total: items.length, limit: 50, next_cursor: null, as_of: "now" });
const input = (): ReferenceChoiceInput => ({ projectId: "P", kind: "member", generation: 3, search: "", values: [], local: [], pages: [page()], listPending: false, listFailed: false,
  selectedPending: false, selectedFailed: false, filter: (data) => data.active === true && data.kind !== "tool" });
describe("reference choices use authoritative current reads", () => {
  it("never turns a failed read's cached remote choices into selectable candidates", () => {
    const args = input(); args.listFailed = true; args.local = [{ value: "user:a", label: "Cached member" }, { value: "", label: "Clear" }];
    const result = referenceChoices(args); expect(result.allowed.has("user:a")).toBe(false); expect(result.allowed.has("")).toBe(true); expect(result.listIssue).toBe("failed");
  });
  it("keeps local draft dependencies selectable without treating remote labels as authority", () => {
    const args = input(); args.kind = "task"; args.listFailed = true;
    args.local = [{ value: "generated-1", label: "Draft feature", local: true }, { value: "T-server", label: "Old server task" }];
    const result = referenceChoices(args); expect(result.allowed.has("generated-1")).toBe(true); expect(result.allowed.has("T-server")).toBe(false);
  });
  it("rejects foreign pages, mixed generations and malformed reference kinds", () => {
    for (const change of ["project", "generation", "kind", "inner-id"] as const) {
      const args = input(), p = page();
      if (change === "project") p.project_id = "Q";
      if (change === "generation") p.query_generation = 4;
      if (change === "kind") (p.items[0] as any).kind = "task";
      if (change === "inner-id") p.items[0].data.id = "other";
      args.pages = [p]; expect(referenceChoices(args).listIssue).toBe("changed"); expect(referenceChoices(args).allowed.has("user:a")).toBe(false);
    }
  });
  it("shows exact selected-read failures separately and does not accept stale selected cache", () => {
    const args = input(); args.values = ["user:selected"]; args.selectedPage = page([ref("user:selected")]); args.selectedFailed = true;
    const result = referenceChoices(args); expect(result.selectedIssue).toBe("failed"); expect(result.allowed.has("user:selected")).toBe(false);
    expect(result.options.find((o) => o.value === "user:selected")?.disabled).toBe(true); expect(result.allowed.has("user:a")).toBe(true);
  });
  it("lets exact missing/refused selected reads override an old candidate label without clearing that value", () => {
    const args = input(); args.values = ["user:a"]; args.selectedPage = page([]);
    const missing = referenceChoices(args); expect(missing.unavailable.has("user:a")).toBe(true); expect(missing.allowed.has("user:a")).toBe(false);
    args.selectedPage = page(); args.selectedFailed = true; expect(referenceChoices(args).allowed.has("user:a")).toBe(false);
  });
  it("rejects mixed page/selected generations, repeated pages and an explicitly missing query generation", () => {
    const args = input(); args.generation = undefined; args.values = ["user:selected"]; args.selectedPage = page([ref("user:selected")], 4);
    expect(referenceChoices(args).selectedIssue).toBe("changed"); expect(referenceChoices(args).allowed.has("user:a")).toBe(false);
    args.pages = [page(), page()]; expect(referenceChoices(args).listIssue).toBe("changed");
    args.pages = [page()]; args.generation = null; expect(referenceChoices(args).allowed.has("user:a")).toBe(false);
  });
  it("filters unavailable owners and includes only searched local choices", () => {
    const args = input(); args.pages = [page([ref("user:a"), ref("agent:b", false), ref("tool:c", true, "tool")])];
    args.local = [{ value: "draft-a", label: "Matching", local: true }, { value: "draft-b", label: "Other", local: true }]; args.search = "match";
    const result = referenceChoices(args); expect(result.allowed.has("agent:b")).toBe(false); expect(result.allowed.has("tool:c")).toBe(false);
    expect(result.options.some((o) => o.value === "draft-a")).toBe(true); expect(result.options.some((o) => o.value === "draft-b")).toBe(false);
  });
  it("permits removal of an unavailable selected dependency but rejects adding it or arbitrary identities", () => {
    const allowed = new Set(["T-good", ""]);
    expect(referenceChangeAllowed(["T-missing", "T-good"], ["T-missing"], true, allowed)).toBe(true);
    expect(referenceChangeAllowed([], ["T-missing"], true, allowed)).toBe(true);
    expect(referenceChangeAllowed(["T-missing"], [], true, allowed)).toBe(false);
    expect(referenceChangeAllowed("arbitrary", [], false, allowed)).toBe(false);
    expect(referenceChangeAllowed("", ["T-missing"], false, allowed)).toBe(true);
  });
});
