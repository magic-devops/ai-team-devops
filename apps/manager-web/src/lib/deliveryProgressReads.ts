import { request } from "./http";
import { assertDeliveryGeneration } from "./deliveryQuery";
import { projectSessionKey } from "./projectPortfolio";
import type {
  ProgressCoverage,
  ProgressDay,
  ProgressRange,
  ProgressScopeHeader,
  ProgressRequirement,
  ProgressMetrics,
  ProgressRoute,
  ProgressScope,
  ProgressTask,
} from "./deliveryProgress";

export type ProgressReason = { code: string; message: string };
export type ProgressBudget = {
  max_dependency_depth: number;
  max_tasks: number;
  max_closure_tasks: number;
  max_requirements: number;
  max_bytes: number;
  max_item_bytes: number;
  task_count: number | null;
  closure_task_count: number | null;
  requirement_count: number | null;
  bytes_used: number | null;
};
export type ProgressBaselineHeader = {
  id: string;
  title: string;
  scope: ProgressScopeHeader;
  basis: string;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  created_by: string;
  source_version: number;
  note: string;
  task_count: number | null;
  requirement_count: number | null;
  metrics: ProgressMetrics | null;
  available: boolean;
  reasons: ProgressReason[];
};
export type ProgressSeries = {
  project_id: string;
  version: number;
  as_of: string;
  timezone: "UTC";
  scope: ProgressScopeHeader;
  range: ProgressRange;
  coverage: ProgressCoverage;
  days: ProgressDay[];
  ideal: { date: string; remaining: number }[];
  query_generation: number;
  current: { scope: ProgressScopeHeader; metrics: ProgressMetrics };
  baseline: ProgressBaselineHeader | null;
};
export type ProgressObservationHeader = {
  id: string;
  observed_at: string;
  observed_day: string;
  source: string;
  actor: string;
  source_version: number | null;
  snapshot_basis: string;
  scope: ProgressScopeHeader;
  metrics: ProgressMetrics | null;
  task_count: number | null;
  requirement_count: number | null;
  available: boolean;
  reasons: ProgressReason[];
};
export type ProgressObservationRead = {
  project_id: string;
  as_of: string;
  observation: ProgressObservationHeader;
};
export type ProgressBaselineRead = {
  project_id: string;
  as_of: string;
  baseline: ProgressBaselineHeader;
};
export type ProgressBaselinePage = {
  project_id: string;
  as_of: string;
  scope: ProgressScopeHeader;
  items: ProgressBaselineHeader[];
  total: number;
  limit: number;
  next_cursor: string | null;
};
export type ProgressSourceKind = "observation" | "baseline";
export type ProgressCollection = "tasks" | "requirements";
export type ProgressTaskSummary = Pick<
  ProgressTask,
  | "id"
  | "title"
  | "req_id"
  | "sprint_id"
  | "milestone_id"
  | "owner_id"
  | "assigned_to"
  | "starts_on"
  | "ends_on"
  | "basis"
  | "status"
  | "recorded_status"
> & { estimate: string | null };
export type ProgressSnapshotEnvelope = {
  project_id: string;
  as_of: string;
  source_kind: ProgressSourceKind;
  source_id: string;
  snapshot_basis: string;
  scope: ProgressScopeHeader;
  collection: ProgressCollection;
};
export type ProgressSnapshotPage = ProgressSnapshotEnvelope & {
  items: Array<ProgressTaskSummary | ProgressRequirement>;
  total: number;
  limit: number;
  next_cursor: string | null;
};
export type ProgressSnapshotItem = ProgressSnapshotEnvelope & {
  item: ProgressTask | ProgressRequirement;
};
export type ProgressComparisonKind =
  | "added"
  | "removed"
  | "changed"
  | "incomplete";
export type ProgressComparisonEnvelope = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  baseline_id: string;
  baseline_basis: string;
  scope: ProgressScopeHeader;
  current_scope_available: boolean;
};
export type ProgressComparisonSummary = ProgressComparisonEnvelope & {
  available: boolean;
  complete: boolean;
  counts: Record<ProgressComparisonKind | "unchanged", number> | null;
  incomplete_plan_fields: string[];
  budget: ProgressBudget;
  reasons: ProgressReason[];
};
export type ProgressDifferenceRow = {
  id: string;
  title: string;
  before_title: string | null;
  after_title: string | null;
  fields: string[];
  incomplete_fields: string[];
};
export type ProgressComparisonPage = ProgressComparisonEnvelope & {
  kind: ProgressComparisonKind;
  items: ProgressDifferenceRow[];
  total: number;
  limit: number;
  next_cursor: string | null;
};
export type ProgressComparisonDetail = ProgressComparisonEnvelope & {
  kind: ProgressComparisonKind;
  item: {
    id: string;
    fields: string[];
    incomplete_fields: string[];
    before: ProgressTask | null;
    after: ProgressTask | null;
  };
};
export type ProgressFreezeProof = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  scope: ProgressScopeHeader;
  available: boolean;
  complete: boolean;
  basis: string | null;
  task_ids: string[] | null;
  metrics: ProgressMetrics | null;
  budget: ProgressBudget;
  reasons: ProgressReason[];
};
type ScopeInput = { scope: ProgressScope; scopeId: string };
type PageInput = { limit?: number; cursor?: string };
const identity = (value: string) => {
  if (
    !value ||
    value !== value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("progressScopeChanged");
  return value;
};
const scopeParams = (scope: ScopeInput) => {
  const params = new URLSearchParams({ scope: scope.scope });
  if (scope.scope !== "project")
    params.set("scope_id", identity(scope.scopeId));
  return params;
};
function pageParams(params: URLSearchParams, page: PageInput) {
  const limit = page.limit ?? 20;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (page.cursor?.length || 0) > 4000
  )
    throw new Error("progressPageInvalid");
  params.set("limit", String(limit));
  if (page.cursor) params.set("cursor", page.cursor);
  return params;
}
async function read<T extends { project_id: string }>(
  projectId: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const value = await request<T>("/api/v1/delivery/progress" + path, {
    signal,
    headers: { "X-Project-Id": identity(projectId) },
  });
  if (value.project_id !== projectId) throw new Error("progressScopeChanged");
  return value;
}
const assertScope = (scope: ScopeInput, value: ProgressScopeHeader) => {
  if (
    scope.scope !== value.kind ||
    (scope.scope !== "project" && scope.scopeId !== value.id)
  )
    throw new Error("progressScopeChanged");
};
export async function fetchDeliveryProgress(
  projectId: string,
  route: ProgressRoute,
  signal?: AbortSignal,
) {
  const params = scopeParams(route);
  params.set("starts_on", route.startsOn);
  params.set("ends_on", route.endsOn);
  if (route.baselineId) params.set("baseline_id", identity(route.baselineId));
  const value = await read<ProgressSeries>(projectId, "?" + params, signal);
  assertScope(route, value.scope);
  if ((value.baseline?.id || "") !== route.baselineId)
    throw new Error("progressScopeChanged");
  return value;
}
export async function fetchProgressObservation(
  projectId: string,
  id: string,
  scope: ScopeInput,
  signal?: AbortSignal,
) {
  const value = await read<ProgressObservationRead>(
    projectId,
    `/observations/${encodeURIComponent(identity(id))}?${scopeParams(scope)}`,
    signal,
  );
  if (value.observation.id !== id) throw new Error("progressScopeChanged");
  assertScope(scope, value.observation.scope);
  return value;
}
export async function fetchProgressBaseline(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  const value = await read<ProgressBaselineRead>(
    projectId,
    `/baselines/${encodeURIComponent(identity(id))}`,
    signal,
  );
  if (value.baseline.id !== id) throw new Error("progressScopeChanged");
  return value;
}
export async function fetchProgressBaselines(
  projectId: string,
  scope: ScopeInput,
  page: PageInput = {},
  signal?: AbortSignal,
) {
  const value = await read<ProgressBaselinePage>(
    projectId,
    `/baselines?${pageParams(scopeParams(scope), page)}`,
    signal,
  );
  assertScope(scope, value.scope);
  return value;
}
function sourcePath(
  kind: ProgressSourceKind,
  id: string,
  collection: ProgressCollection,
  scope: ScopeInput,
  page?: PageInput,
  itemId?: string,
) {
  const params =
    kind === "observation" ? scopeParams(scope) : new URLSearchParams();
  if (page) pageParams(params, page);
  return `/${kind === "observation" ? "observations" : "baselines"}/${encodeURIComponent(identity(id))}/${collection}${itemId ? "/" + encodeURIComponent(identity(itemId)) : ""}${params.size ? "?" + params : ""}`;
}
function assertSnapshot(
  value: ProgressSnapshotEnvelope,
  kind: ProgressSourceKind,
  id: string,
  collection: ProgressCollection,
  scope: ScopeInput,
) {
  if (
    value.source_kind !== kind ||
    value.source_id !== id ||
    value.collection !== collection
  )
    throw new Error("progressScopeChanged");
  assertScope(scope, value.scope);
}
export async function fetchProgressSnapshotPage(
  projectId: string,
  kind: ProgressSourceKind,
  id: string,
  collection: ProgressCollection,
  scope: ScopeInput,
  page: PageInput = {},
  signal?: AbortSignal,
) {
  const value = await read<ProgressSnapshotPage>(
    projectId,
    sourcePath(kind, id, collection, scope, page),
    signal,
  );
  assertSnapshot(value, kind, id, collection, scope);
  return value;
}
export async function fetchProgressSnapshotItem(
  projectId: string,
  kind: ProgressSourceKind,
  id: string,
  collection: ProgressCollection,
  itemId: string,
  scope: ScopeInput,
  signal?: AbortSignal,
) {
  const value = await read<ProgressSnapshotItem>(
    projectId,
    sourcePath(kind, id, collection, scope, undefined, itemId),
    signal,
  );
  assertSnapshot(value, kind, id, collection, scope);
  if (value.item.id !== itemId) throw new Error("progressScopeChanged");
  return value;
}
function comparisonParams(
  kind?: ProgressComparisonKind,
  generation?: number,
  page?: PageInput,
) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (generation != null) {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new Error("progressScopeChanged");
    params.set("query_generation", String(generation));
  }
  if (page) pageParams(params, page);
  return params;
}
function assertComparison(
  projectId: string,
  baselineId: string,
  generation: number | undefined,
  value: ProgressComparisonEnvelope,
) {
  if (value.baseline_id !== baselineId) throw new Error("progressScopeChanged");
  if (generation !== undefined)
    assertDeliveryGeneration(
      { project_id: projectId, query_generation: generation },
      value,
    );
}
export async function fetchProgressComparison(
  projectId: string,
  baselineId: string,
  signal?: AbortSignal,
  generation?: number,
) {
  const params = comparisonParams(undefined, generation);
  const value = await read<ProgressComparisonSummary>(
    projectId,
    `/baselines/${encodeURIComponent(identity(baselineId))}/comparison${params.size ? "?" + params : ""}`,
    signal,
  );
  assertComparison(projectId, baselineId, generation, value);
  return value;
}
export async function fetchProgressComparisonPage(
  projectId: string,
  baselineId: string,
  kind: ProgressComparisonKind,
  generation: number,
  page: PageInput = {},
  signal?: AbortSignal,
) {
  const value = await read<ProgressComparisonPage>(
    projectId,
    `/baselines/${encodeURIComponent(identity(baselineId))}/comparison/items?${comparisonParams(kind, generation, page)}`,
    signal,
  );
  assertComparison(projectId, baselineId, generation, value);
  if (value.kind !== kind) throw new Error("progressScopeChanged");
  return value;
}
export async function fetchProgressComparisonItem(
  projectId: string,
  baselineId: string,
  kind: ProgressComparisonKind,
  itemId: string,
  generation: number,
  signal?: AbortSignal,
) {
  const value = await read<ProgressComparisonDetail>(
    projectId,
    `/baselines/${encodeURIComponent(identity(baselineId))}/comparison/items/${encodeURIComponent(identity(itemId))}?${comparisonParams(kind, generation)}`,
    signal,
  );
  assertComparison(projectId, baselineId, generation, value);
  if (value.kind !== kind || value.item.id !== itemId)
    throw new Error("progressScopeChanged");
  return value;
}
export async function fetchProgressFreezeProof(
  projectId: string,
  scope: ScopeInput,
  signal?: AbortSignal,
) {
  const value = await read<ProgressFreezeProof>(
    projectId,
    `/freeze-proof?${scopeParams(scope)}`,
    signal,
  );
  assertScope(scope, value.scope);
  return value;
}
export function progressReadDenied(cause: unknown) {
  return /^HTTP (403|404):/.test(
    cause instanceof Error ? cause.message : String(cause),
  );
}

export function beginProgressExactRead() {
  const owner = projectSessionKey(),
    hash = typeof location === "undefined" ? "" : location.hash;
  let live = true;
  const invalidate = () => {
    live = false;
  };
  const events = ["hashchange", "popstate", "sop-session", "storage"];
  if (typeof window !== "undefined")
    for (const event of events) window.addEventListener(event, invalidate);
  return {
    current: () =>
      live &&
      owner === projectSessionKey() &&
      hash === (typeof location === "undefined" ? "" : location.hash),
    finish: () => {
      if (typeof window !== "undefined")
        for (const event of events)
          window.removeEventListener(event, invalidate);
    },
  };
}
