import type { DeliveryQuality, ReleasePolicy, ReleaseSourceMapping } from "./deliveryRelease";
import { eventRetryDraftKey } from "./eventReceipts";

export type ReleaseSourceDraftIdentity = {
  project_id: string;
  scope_basis: string;
  policy_generation: number;
  repository: string;
  workflow: string;
  requirement_ids: string[];
  task_ids: string[];
  included_task_ids: string[];
};
export type ReleaseSourceDraft = { active_task_id: string; mappings: ReleaseSourceMapping[] };
export type SourceDraftStatus = "empty" | "saved" | "restored" | "unavailable" | "invalid";
export const SOURCE_DRAFT_MAX_BYTES = 1024 * 1024;

export function releaseSourceDraftIdentity(projectId: string, quality: DeliveryQuality, policy: ReleasePolicy): ReleaseSourceDraftIdentity {
  return { project_id: projectId, scope_basis: quality.scope_basis || "", policy_generation: policy.generation,
    repository: policy.repository, workflow: policy.workflow,
    requirement_ids: [...quality.selected.requirement_ids].sort(), task_ids: [...quality.selected.task_ids].sort(),
    included_task_ids: quality.tasks.map((task) => task.id).sort() };
}
export function releaseSourceDraftKey(identity: ReleaseSourceDraftIdentity): string | null {
  if (!/^[0-9a-f]{64}$/.test(identity.scope_basis) || !Number.isSafeInteger(identity.policy_generation) || identity.policy_generation < 1) return null;
  return eventRetryDraftKey(identity.project_id, `release-source:${identity.scope_basis}:${identity.policy_generation}`)
    ?.replace("sop.event-retry.v1:", "sop.release-source-draft.v1:") || null;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function validDraft(value: unknown, identity: ReleaseSourceDraftIdentity): value is ReleaseSourceDraft {
  if (!record(value) || !exact(value, ["active_task_id", "mappings"]) || typeof value.active_task_id !== "string" ||
      !identity.included_task_ids.includes(value.active_task_id) || !Array.isArray(value.mappings) || value.mappings.length > 500) return false;
  const ids = new Set<string>();
  return value.mappings.every((row: unknown) => {
    if (!record(row) || !exact(row, ["task_id", "kind", "base_commit", "accepted_commit", "comment"]) ||
        typeof row.task_id !== "string" || !identity.included_task_ids.includes(row.task_id) || ids.has(row.task_id) ||
        typeof row.kind !== "string" || !["change", "no_code_change"].includes(row.kind) || typeof row.comment !== "string" || row.comment.length > 4000 ||
        ![row.base_commit, row.accepted_commit].every((sha) => sha === null || (typeof sha === "string" && sha.length <= 64)) ||
        (row.kind === "no_code_change" && (row.base_commit !== null || row.accepted_commit !== null))) return false;
    ids.add(row.task_id);
    return true;
  });
}
export function readReleaseSourceDraft(raw: string, identity: ReleaseSourceDraftIdentity): ReleaseSourceDraft {
  if (raw.length > SOURCE_DRAFT_MAX_BYTES || new TextEncoder().encode(raw).length > SOURCE_DRAFT_MAX_BYTES) throw new Error("sourceDraftInvalid");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !exact(value, ["schema_version", "identity", "draft"]) || value.schema_version !== 1 ||
      JSON.stringify(value.identity) !== JSON.stringify(identity) || !validDraft(value.draft, identity)) throw new Error("sourceDraftInvalid");
  return value.draft;
}

/** One exact-scope tab draft. Compare before changing storage; never replace another editor's draft. */
export function createReleaseSourceDraftStore(identity: ReleaseSourceDraftIdentity) {
  const key = releaseSourceDraftKey(identity);
  let expected: string | null | undefined, invalid = false;
  let status: SourceDraftStatus = "empty", draft: ReleaseSourceDraft | null = null;
  try {
    if (!key) throw new Error("unavailable");
    expected = sessionStorage.getItem(key);
    if (expected !== null) {
      try { draft = readReleaseSourceDraft(expected, identity); status = "restored"; }
      catch { status = "invalid"; invalid = true; }
    }
  } catch { status = "unavailable"; }
  return {
    key, status, draft,
    save(next: ReleaseSourceDraft): boolean {
      if (!key || expected === undefined || invalid || !validDraft(next, identity)) return false;
      try {
        const raw = JSON.stringify({ schema_version: 1, identity, draft: next });
        if (new TextEncoder().encode(raw).length > SOURCE_DRAFT_MAX_BYTES || sessionStorage.getItem(key) !== expected) return false;
        sessionStorage.setItem(key, raw); expected = raw;
        return sessionStorage.getItem(key) === raw;
      } catch { return false; }
    },
    clear(): boolean {
      if (!key) return true;
      if (expected === undefined) return false;
      try {
        if (sessionStorage.getItem(key) !== expected) return false;
        sessionStorage.removeItem(key); expected = null; invalid = false;
        return sessionStorage.getItem(key) === null;
      } catch { return false; }
    },
  };
}

export function releaseSourceMappingProblem(row: ReleaseSourceMapping | undefined): string | null {
  if (!row || !["change", "no_code_change"].includes(row.kind)) return "sourceChooseKind";
  if (row.kind === "change") {
    const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
    if (!sha.test(row.base_commit || "")) return "sourceBaseInvalid";
    if (!sha.test(row.accepted_commit || "")) return "sourceAcceptedInvalid";
    if (row.base_commit === row.accepted_commit) return "sourceSameCommit";
    if (row.base_commit?.length !== row.accepted_commit?.length) return "sourceCommitFormatMismatch";
  }
  if (typeof row.comment !== "string" || !row.comment.trim()) return "sourceReasonRequired";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.comment) || [...row.comment].some((char) => {
    const point = char.codePointAt(0)!;
    return point >= 0xd800 && point <= 0xdfff;
  })) return "sourceReasonInvalid";
  return null;
}
