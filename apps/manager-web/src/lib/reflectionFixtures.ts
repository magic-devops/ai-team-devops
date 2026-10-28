import { createHash } from "node:crypto";
/** Hand-authored protocol fixtures; used only by reflection tests. */
export const reflectionRaw = '{"specversion":"1.0","id":"E","source":"sdk","type":"sop.reflection.recorded","time":"2026-10-18T00:00:00Z","subject":"","datacontenttype":"application/json","data":{"schema_version":1,"category":"testing","title":"A claim","observation":"A lesson","lesson":"","references":[]}}';
export const reflectionDigest = "103077a05da19140b48b57f2d99a5726c26b2b39187a50583df889354b044afe";
export function reflectionDetailFixture(id = "R") {
  return {
    project_id: "P", as_of: "2026-10-19T00:00:00Z",
    reflection: {
      id, category: "testing", occurred_at: "2026-10-18T00:00:00Z",
      collected_at: "2026-10-19T00:00:00Z", producer: { id: "user", name: null },
      reference_count: 0, intake_status: "collected", original_status: "available",
      unavailable_reason: null,
    },
    available: true, unavailable_reason: null,
    statement: { category: "testing", title: "A claim", observation: "A lesson", lesson: "", claimed_occurred_at: "2026-10-18T00:00:00Z" },
    source: { receipt_id: id, event_id: "E", digest: reflectionDigest, producer_id: "user", stored_at: "2026-10-19T00:00:00Z", event_json: reflectionRaw },
    verified: { attempt_id: "A", handler: "reflection.record", collected_at: "2026-10-19T00:00:00Z", identity_and_references_checked: true, is_acceptance_evidence: false },
    links: [],
    selection_reference: { reflection_id: id, source_digest: reflectionDigest, attempt_id: "A" },
  };
}
export function reflectionPageFixture() {
  const { reflection } = reflectionDetailFixture();
  return {
    project_id: "P", as_of: "2026-10-19T00:00:00Z",
    items: [{ ...reflection, original_status: "not_loaded" }],
    total: 43, limit: 20, has_more: true, next_cursor: "next/+page",
    permissions: { read: true, collect: true, prepare: true },
  };
}
export function reflectionWithTaskFixture() {
  const detail = reflectionDetailFixture();
  const event = JSON.parse(detail.source.event_json);
  event.data.references = [{ kind: "task", id: "T" }];
  detail.source.event_json = JSON.stringify(event);
  detail.source.digest = createHash("sha256").update(detail.source.event_json, "utf8").digest("hex");
  detail.selection_reference.source_digest = detail.source.digest;
  detail.reflection.reference_count = 1;
  return { ...detail, links: [{ kind: "task", id: "T", label: "Current task", available: true, reason: null }] };
}
export function reflectionEnvelopeFixture(changes: Record<string, unknown>) {
  const detail = reflectionDetailFixture();
  const event = { ...JSON.parse(detail.source.event_json), ...changes };
  detail.source.event_json = JSON.stringify(event);
  detail.source.event_id = event.id;
  detail.source.digest = createHash("sha256").update(detail.source.event_json, "utf8").digest("hex");
  detail.selection_reference.source_digest = detail.source.digest;
  return detail;
}
export function reflectionInputFixture() {
  return {
    project_id: "P", as_of: "2026-10-19T00:00:00Z",
    input: { id: "I", title: "Reviewed input", status: "prepared", source_count: 1, created_at: "2026-10-19T00:00:00Z", created_by: { id: "user", name: null }, source_version: 8 },
    rationale: "Reviewed rationale", manifest_digest: "b".repeat(64),
    sources: [{ ...reflectionDetailFixture().selection_reference, available: true, unavailable_reason: null }],
    available: true, is_acceptance_evidence: false,
  };
}
