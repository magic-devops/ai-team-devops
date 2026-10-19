import { request } from "./http";
import type {
  ActivityTarget,
  FieldChange,
  RequirementDefinition,
  RequirementHistoryItem,
} from "./deliveryCollaboration";
import type { DeliveryStage } from "./delivery";

export type RequirementEnvelope = {
  project_id: string;
  requirement_id: string;
  version: number;
  query_generation: number;
  as_of: string;
};
export type RequirementFlowHead = {
  stage: DeliveryStage;
  revision: number;
  owner_id: string;
  due_on: string | null;
  milestone_id: string;
  blocked_reason: string;
  closed: boolean;
  legacy_completed: boolean;
  gates: { id: string; ok: boolean }[];
  record_counts: Record<RequirementRecordCollection, number>;
};
export type RequirementHead = {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2" | "P3";
  status: string;
  sprint_id: string;
  basis: string;
  flow: RequirementFlowHead;
  tasks_total: number;
  tasks_done: number;
  tasks_recorded_done: number;
  accepted: boolean;
  deployment_verified: boolean;
};
export type RequirementHeadResponse = RequirementEnvelope & {
  requirement: RequirementHead;
};
export type RequirementDefinitionResponse = RequirementEnvelope & {
  requirement_basis: string;
  definition: RequirementDefinition & { id: string };
};
export type RequirementEditable = RequirementHead & RequirementDefinition;
export type RequirementEditableResponse = Omit<
  RequirementHeadResponse,
  "requirement"
> & { requirement: RequirementEditable };
export type RequirementRecordCollection = "artifacts" | "reviews" | "releases";
export type RequirementVersionMetadata = Omit<
  RequirementHistoryItem,
  "definition"
>;
export type RequirementRecordSummary = {
  position: number;
  revision: number | null;
  kind: string | null;
  stage: string | null;
  title: string | null;
  result: string | null;
  decision: string | null;
  actor: string | null;
  at: string | null;
  stale: boolean | null;
};
export type RequirementRecordsPage = RequirementEnvelope & {
  requirement_basis: string;
  collection: RequirementRecordCollection;
  items: RequirementRecordSummary[];
  total: number;
  limit: number;
  next_cursor: string | null;
};
export type RequirementRecordDetail = RequirementEnvelope & {
  requirement_basis: string;
  collection: RequirementRecordCollection;
  position: number;
  record: Record<string, unknown>;
};
export type RequirementImpactKind =
  | "direct_task"
  | "dependent_task"
  | "execution"
  | "release_candidate"
  | "deployment";
export type RequirementImpactCounts = Record<
  RequirementImpactKind | "restricted_execution" | "restricted_deployment",
  number
>;
export type RequirementReadBudget = {
  max_tasks: number;
  max_closure_tasks: number;
  max_requirements: number;
  max_records_per_collection: number;
  max_bytes: number;
  max_item_bytes: number;
  max_dependency_depth: number;
  task_count: number | null;
  closure_task_count: number | null;
  requirement_count: number | null;
  execution_count: number | null;
  release_candidate_count: number | null;
  deployment_count: number | null;
  bytes_used: number | null;
};
export type RequirementReadReason = { code: string; message: string };
export type RequirementImpactSummary = RequirementEnvelope & {
  requirement_basis: string;
  available: boolean;
  complete: boolean;
  counts: RequirementImpactCounts | null;
  budget: RequirementReadBudget;
  reasons: RequirementReadReason[];
};
export type RequirementImpactItem = {
  id: string;
  kind: RequirementImpactKind;
  title: string | null;
  status: string | null;
  target: ActivityTarget;
};
export type RequirementImpactPage = RequirementEnvelope & {
  requirement_basis: string;
  kind: RequirementImpactKind;
  items: RequirementImpactItem[];
  total: number;
  limit: number;
  next_cursor: string | null;
};
export type RequirementImpactDetail = RequirementEnvelope & {
  requirement_basis: string;
  kind: RequirementImpactKind;
  item: RequirementImpactItem;
};
export function validRequirementImpactTarget(item: RequirementImpactItem) {
  const kind =
    item.kind === "direct_task" || item.kind === "dependent_task"
      ? "task"
      : item.kind;
  return (
    item.target.available &&
    item.target.id === item.id &&
    item.target.kind === kind
  );
}
export type BoundedRequirementChangePreview = RequirementEnvelope & {
  requirement_basis: string;
  preview_basis: string | null;
  changes: FieldChange[];
  impact: {
    counts: RequirementImpactCounts | null;
    invalidates_current_acceptance: boolean | null;
  };
  available: boolean;
  complete: boolean;
  allowed: boolean;
  budget: RequirementReadBudget;
  reasons: RequirementReadReason[];
};
export const validRequirementResourceId = (id: string, maximum = 64) =>
  typeof id === "string" &&
  !!id &&
  Array.from(id).length <= maximum &&
  id === id.trim() &&
  !/[\/\\\u0000-\u001f\u007f-\u009f]/.test(id);
function read<T>(
  projectId: string,
  requirementId: string,
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  if (
    !validRequirementResourceId(projectId) ||
    !validRequirementResourceId(requirementId)
  )
    throw new Error("explicitProject");
  const query = new URLSearchParams(params);
  return request<T>(
    `/api/v1/delivery/requirements/${encodeURIComponent(requirementId)}${path}${query.size ? `?${query}` : ""}`,
    { headers: { "X-Project-Id": projectId }, signal },
  );
}
function generation(value: number) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("queryGenerationRequired");
  return { query_generation: String(value) };
}
function page(cursor: string) {
  if (cursor.length > 4000) throw new Error("cursorInvalid");
  return { limit: "20", ...(cursor ? { cursor } : {}) };
}
export function fetchRequirementDefinition(
  projectId: string,
  id: string,
  gen: number,
  signal?: AbortSignal,
) {
  return read<RequirementDefinitionResponse>(
    projectId,
    id,
    "/definition",
    generation(gen),
    signal,
  );
}
export function fetchRequirementRecords(
  projectId: string,
  id: string,
  collection: RequirementRecordCollection,
  gen: number,
  cursor = "",
  signal?: AbortSignal,
) {
  return read<RequirementRecordsPage>(
    projectId,
    id,
    "/records",
    { ...generation(gen), collection, ...page(cursor) },
    signal,
  );
}
export function fetchRequirementRecord(
  projectId: string,
  id: string,
  collection: RequirementRecordCollection,
  position: number,
  gen: number,
  signal?: AbortSignal,
) {
  if (!Number.isSafeInteger(position) || position < 0)
    throw new Error("positionInvalid");
  return read<RequirementRecordDetail>(
    projectId,
    id,
    `/records/${position}`,
    { ...generation(gen), collection },
    signal,
  );
}
export function fetchRequirementImpact(
  projectId: string,
  id: string,
  gen?: number,
  signal?: AbortSignal,
) {
  return read<RequirementImpactSummary>(
    projectId,
    id,
    "/impact",
    gen === undefined ? {} : generation(gen),
    signal,
  );
}
export function fetchRequirementImpactPage(
  projectId: string,
  id: string,
  kind: RequirementImpactKind,
  gen: number,
  cursor = "",
  signal?: AbortSignal,
) {
  return read<RequirementImpactPage>(
    projectId,
    id,
    "/impact/items",
    { ...generation(gen), kind, ...page(cursor) },
    signal,
  );
}
export function fetchRequirementImpactItem(
  projectId: string,
  id: string,
  kind: RequirementImpactKind,
  itemId: string,
  gen: number,
  signal?: AbortSignal,
) {
  if (!validRequirementResourceId(itemId, 200))
    throw new Error("resourceIdInvalid");
  return read<RequirementImpactDetail>(
    projectId,
    id,
    `/impact/items/${encodeURIComponent(itemId)}`,
    { ...generation(gen), kind },
    signal,
  );
}
export function requirementReadMatches(
  value: (RequirementEnvelope & { requirement_basis?: string }) | undefined,
  projectId: string,
  id: string,
  gen: number,
  basis?: string,
) {
  return (
    !!value &&
    value.project_id === projectId &&
    value.requirement_id === id &&
    value.query_generation === gen &&
    (!basis || value.requirement_basis === basis)
  );
}
export function combineRequirementDefinition(
  head: RequirementHeadResponse,
  definition: RequirementDefinitionResponse,
): RequirementEditable {
  if (
    !requirementReadMatches(
      definition,
      head.project_id,
      head.requirement.id,
      head.query_generation,
      head.requirement.basis,
    ) ||
    definition.definition.id !== head.requirement.id ||
    definition.version !== head.version
  )
    throw new Error("HTTP 409: requirement_definition_changed");
  return { ...head.requirement, ...definition.definition };
}
