import { request } from "./http";
import { assertDeliveryGeneration } from "./deliveryQuery";
import type { ScheduleAllocation } from "./deliveryScheduling";
import type { TaskAcceptance } from "./taskAcceptance";
import { safeExecutionReturn } from "./executionCommands";
import { safePortfolioReturn } from "./projectPortfolioRoute";
export * from "./deliveryProgressReads";
export * from "./deliveryProgressCommand";

export const progressStates = [
  "pending",
  "in_progress",
  "blocked",
  "awaiting_review",
  "recorded_completed",
  "verified_completed",
] as const;
export type ProgressState = (typeof progressStates)[number];
export type ProgressScope = "project" | "milestone" | "sprint";
export type ProgressRoute = {
  startsOn: string;
  endsOn: string;
  scope: ProgressScope;
  scopeId: string;
  baselineId: string;
  observationId: string;
  catalogueOpen?: boolean;
  baselineDetail?: boolean;
};
export type ProgressMetrics = {
  tasks_total: number;
  recorded_completed: number;
  verified_completed: number;
  awaiting_review: number;
  remaining: number;
  requirements_total: number;
  requirements_accepted: number;
  requirements_released: number;
  status_counts: Record<ProgressState, number>;
};
export type ProgressTask = {
  acceptance_criteria?: string[] | null;
  requirement_criteria_indices?: number[] | null;
  acceptance?: TaskAcceptance | null;
  allocations: ScheduleAllocation[] | null;
  id: string;
  title: string;
  req_id: string;
  sprint_id: string;
  milestone_id: string;
  owner_id: string;
  assigned_to: string;
  estimate: string | null;
  starts_on: string | null;
  ends_on: string | null;
  basis: string;
  status: ProgressState;
  recorded_status: string;
};
export type ProgressScopeHeader = {
  kind: ProgressScope;
  id: string;
  label: string;
};
export type ProgressRequirement = {
  id: string;
  title: string;
  milestone_id: string;
  sprint_id: string;
  stage: string;
  revision: number;
  basis: string;
  accepted: boolean;
  released: boolean;
};
export type ProgressRange = { starts_on: string; ends_on: string };
export type ProgressCoverage = {
  first_observed_at: string | null;
  last_observed_at: string | null;
  observed_days: string[];
  missing_days: string[];
  future_days: string[];
};
export type ProgressDay = {
  date: string;
  observation_id: string | null;
  observed_at: string | null;
  source: string | null;
  metrics: ProgressMetrics | null;
  baseline_remaining: number | null;
};
export type DeliveryProgressSummary = {
  project_id: string;
  version: number;
  as_of: string;
  timezone: "UTC";
  range: ProgressRange;
  coverage: ProgressCoverage;
  query_generation: number;
  current: { metrics: ProgressMetrics };
};
export function fetchDeliveryProgressSummary(
  projectId: string,
  range: Pick<ProgressRoute, "startsOn" | "endsOn">,
  signal?: AbortSignal,
  queryGeneration?: number | null,
) {
  const params = new URLSearchParams({
    starts_on: range.startsOn,
    ends_on: range.endsOn,
  });
  return request<DeliveryProgressSummary>(
    `/api/v1/delivery/progress/summary?${params}`,
    {
      signal,
      headers: { "X-Project-Id": projectId },
    },
  ).then((value) => {
    if (queryGeneration !== undefined)
      assertDeliveryGeneration(
        { project_id: projectId, query_generation: queryGeneration },
        value,
      );
    return value;
  });
}
export function defaultProgressRange(now = new Date()) {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    startsOn: new Date(end.getTime() - 29 * 86400000)
      .toISOString()
      .slice(0, 10),
    endsOn: end.toISOString().slice(0, 10),
  };
}
export function progressDateChange(
  setDraft: (
    update: (
      current: Pick<ProgressRoute, "startsOn" | "endsOn">,
    ) => Pick<ProgressRoute, "startsOn" | "endsOn">,
  ) => void,
  field: "startsOn" | "endsOn",
  event: { target: { value: string } },
) {
  const value = event.target.value;
  setDraft((current) => ({ ...current, [field]: value }));
}
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function progressRangeProblem(startsOn: string, endsOn: string) {
  if (!validDate(startsOn) || !validDate(endsOn)) return "invalidDates";
  if (startsOn > endsOn) return "dateOrder";
  return (Date.parse(`${endsOn}T00:00:00Z`) -
    Date.parse(`${startsOn}T00:00:00Z`)) /
    86400000 >=
    366
    ? "rangeLimit"
    : null;
}
export function parseProgressRoute(
  hash: string,
  now = new Date(),
): ProgressRoute {
  const p = new URLSearchParams(hash.split("?")[1]);
  const range = defaultProgressRange(now);
  const scope = p.get("progress_scope");
  return {
    startsOn: p.get("starts_on") ?? range.startsOn,
    endsOn: p.get("ends_on") ?? range.endsOn,
    scope: scope === "milestone" || scope === "sprint" ? scope : "project",
    scopeId:
      scope === "milestone" || scope === "sprint"
        ? p.get("scope_id") || ""
        : "",
    baselineId: p.get("baseline_id") || "",
    observationId: p.get("observation_id") || "",
    ...(p.get("progress_baselines") === "1" ? { catalogueOpen: true } : {}),
    ...(p.get("progress_source") === "baseline"
      ? { baselineDetail: true }
      : {}),
  };
}
export function progressHash(
  route: ProgressRoute,
  source = typeof location === "undefined" ? "" : location.hash,
) {
  const p = new URLSearchParams({
    view: "progress",
    starts_on: route.startsOn,
    ends_on: route.endsOn,
    progress_scope: route.scope,
  });
  if (route.scope !== "project" && route.scopeId)
    p.set("scope_id", route.scopeId);
  if (route.baselineId) p.set("baseline_id", route.baselineId);
  if (route.observationId) p.set("observation_id", route.observationId);
  if (route.catalogueOpen) p.set("progress_baselines", "1");
  if (route.baselineDetail) p.set("progress_source", "baseline");
  const original = new URLSearchParams(source.split("?")[1]);
  const project = original.get("project_id");
  if (project && original.getAll("project_id").length === 1)
    p.set("project_id", project);
  const back =
    safeExecutionReturn(original.get("return_to") || "") ||
    safePortfolioReturn(original.get("return_to") || "");
  if (back) p.set("return_to", back);
  return `#/dev-flow?${p}`;
}
export function preserveProgressRoute(targetHash: string, sourceHash: string) {
  const target = new URLSearchParams(targetHash.split("?")[1]);
  const source = new URLSearchParams(sourceHash.split("?")[1]);
  for (const key of [
    "starts_on",
    "ends_on",
    "progress_scope",
    "scope_id",
    "baseline_id",
    "observation_id",
  ])
    if (source.has(key) && !(key === "observation_id" && target.has("task")))
      target.set(key, source.get(key)!);
  return `#/dev-flow?${target}`;
}
export function progressSeries(days: ProgressDay[]) {
  return {
    dates: days.map((day) => day.date),
    observations: days.map((day) => day.observation_id),
    remaining: days.map((day) => day.metrics?.remaining ?? null),
    baselineRemaining: days.map((day) => day.baseline_remaining),
    states: Object.fromEntries(
      progressStates.map((state) => [
        state,
        days.map((day) => day.metrics?.status_counts[state] ?? null),
      ]),
    ) as Record<ProgressState, (number | null)[]>,
  };
}
