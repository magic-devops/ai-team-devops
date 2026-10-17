import { request } from "./http";
import type { DeliveryInboxTarget } from "./delivery";
import type { ScheduleAllocation } from "./deliveryScheduling";
import type { TaskAcceptance } from "./taskAcceptance";

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
  estimate: string;
  starts_on: string | null;
  ends_on: string | null;
  basis: string;
  status: ProgressState;
  recorded_status: string;
};
export type ProgressFacts = {
  scope: { kind: ProgressScope; id: string; label: string };
  tasks: ProgressTask[];
  requirements: {
    id: string;
    title: string;
    milestone_id: string;
    sprint_id: string;
    stage: string;
    revision: number;
    basis: string;
    accepted: boolean;
    released: boolean;
  }[];
  task_ids: string[];
  basis: string;
  metrics: ProgressMetrics;
};
export type ProgressScopeOption = {
  id: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
};
export type ProgressDay = {
  date: string;
  observation_id: string | null;
  observed_at: string | null;
  source: string | null;
  metrics: ProgressMetrics | null;
  baseline_remaining: number | null;
};
export type ProgressBaseline = {
  id: string;
  title: string;
  scope: ProgressFacts["scope"];
  starts_on: string | null;
  ends_on: string | null;
  note: string;
  created_at: string;
  created_by: string;
  source_version: number;
  task_ids: string[];
  basis: string;
  tasks: ProgressTask[];
  requirements: ProgressFacts["requirements"];
  metrics: ProgressMetrics;
};
export type ProgressComparison = {
  incomplete_plan_fields: string[];
  incomplete_task_ids: string[];
  added: ProgressTask[];
  removed: ProgressTask[];
  changed: {
    id: string;
    before: ProgressTask;
    after: ProgressTask;
    fields: string[];
  }[];
  unchanged_count: number;
};
export type DeliveryProgress = {
  project_id: string;
  version: number;
  as_of: string;
  timezone: "UTC";
  scope: ProgressFacts["scope"];
  range: { starts_on: string; ends_on: string };
  scopes: { milestones: ProgressScopeOption[]; sprints: ProgressScopeOption[] };
  current: ProgressFacts;
  coverage: {
    first_observed_at: string | null;
    last_observed_at: string | null;
    observed_days: string[];
    missing_days: string[];
    future_days: string[];
  };
  days: ProgressDay[];
  baselines: Omit<ProgressBaseline, "tasks" | "requirements">[];
  baseline: ProgressBaseline | null;
  comparison: ProgressComparison | null;
  ideal: { date: string; remaining: number }[];
};
export type ProgressObservation = {
  id: string;
  observed_at: string;
  observed_day: string;
  source: string;
  actor: string;
  source_version: number;
  scope: ProgressFacts["scope"];
  current: ProgressFacts;
};
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
  };
}
export function progressHash(route: ProgressRoute) {
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
export function currentProgressTaskTarget(
  id: string,
  tasks: { id: string; req_id: string }[],
): DeliveryInboxTarget | null {
  const task = tasks.find((item) => item.id === id);
  return task
    ? {
        view: "progress",
        requirement_id: task.req_id,
        detail: "tasks",
        task_id: task.id,
      }
    : null;
}
function scopeParams(route: Pick<ProgressRoute, "scope" | "scopeId">) {
  const params = new URLSearchParams({ scope: route.scope });
  if (route.scope !== "project") params.set("scope_id", route.scopeId);
  return params;
}
export function fetchDeliveryProgress(
  projectId: string,
  route: ProgressRoute,
  signal?: AbortSignal,
) {
  const params = scopeParams(route);
  params.set("starts_on", route.startsOn);
  params.set("ends_on", route.endsOn);
  if (route.baselineId) params.set("baseline_id", route.baselineId);
  return request<DeliveryProgress>(`/api/v1/delivery/progress?${params}`, {
    signal,
    headers: { "X-Project-Id": projectId },
  });
}
export function fetchProgressObservation(
  projectId: string,
  id: string,
  route: Pick<ProgressRoute, "scope" | "scopeId">,
  signal?: AbortSignal,
) {
  return request<ProgressObservation>(
    `/api/v1/delivery/progress/observations/${encodeURIComponent(id)}?${scopeParams(route)}`,
    { signal, headers: { "X-Project-Id": projectId } },
  );
}
export function fetchProgressBaseline(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  return request<{
    baseline: ProgressBaseline;
    comparison: ProgressComparison;
  }>(`/api/v1/delivery/progress/baselines/${encodeURIComponent(id)}`, {
    signal,
    headers: { "X-Project-Id": projectId },
  });
}
