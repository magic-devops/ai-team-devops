import { request } from "./http";
import type { QueryClient } from "@tanstack/react-query";
import type {
  DeliveryExecution,
  DeliveryMember,
  DeliveryMilestone,
  DeliveryRequirement,
  DeliveryResource,
  DeliveryStage,
  DeliveryTask,
  DeliveryWorkspace,
} from "./delivery";

export type DeliveryCommandAck = {
  project_id: string;
  action: string;
  resource: { kind: string; id: string };
  result: Record<string, unknown> | null;
  affected_refs: { kind: string; id: string }[];
  applied_version: number;
  version: number;
  query_generation: number | null;
  replayed: boolean;
};
export type DeliveryContext = {
  project_id: string;
  version: number;
  query_generation: number | null;
  query_state: {
    status: "ready" | "rebuild_required";
    schema_version: number;
    computed_at: string | null;
  };
  project: DeliveryWorkspace["project"];
  permissions: DeliveryWorkspace["permissions"] & { query_rebuild: boolean };
  stages: DeliveryWorkspace["stages"];
  summary: DeliveryWorkspace["summary"] | null;
  metrics: {
    requirement_stage_counts?: Record<string, number>;
    [key: string]: unknown;
  } | null;
};
export type RequirementSummary = Pick<
  DeliveryRequirement,
  "id" | "title" | "priority" | "basis" | "tasks_total" | "tasks_done"
> & {
  flow: Omit<
    DeliveryRequirement["flow"],
    "artifacts" | "releases" | "gates" | "reviews"
  >;
};
export type TaskSummary = Pick<
  DeliveryTask,
  | "id"
  | "req_id"
  | "title"
  | "priority"
  | "owner_id"
  | "assigned_to"
  | "owner_active"
  | "estimate"
  | "status"
  | "recorded_status"
  | "delivery_status"
  | "verified"
  | "basis"
  | "execution_id"
  | "dependency_blocked"
> & {
  planning?: Pick<
    NonNullable<DeliveryTask["planning"]>,
    "starts_on" | "ends_on" | "blocked_reason"
  >;
};
export type IssueSummary = DeliveryWorkspace["issues"][number] & {
  linked_requirement_id?: string | null;
};
export type DeliveryPage<T> = {
  project_id: string;
  version: number;
  query_generation: number;
  as_of: string;
  items: T[];
  total: number;
  next_cursor: string | null;
  limit: number;
  facets?: { stages: Record<string, number> };
};
export type DeliveryReferenceKind =
  | "member"
  | "milestone"
  | "resource"
  | "sprint"
  | "requirement"
  | "task"
  | "execution";
export type DeliveryReference<T = Record<string, unknown>> = {
  kind: DeliveryReferenceKind;
  id: string;
  label: string;
  task_count: number;
  data: T;
};
export type MilestoneSummary = DeliveryMilestone & {
  requirement_count?: number;
  accepted_requirement_count?: number;
  task_count?: number;
  verified_task_count?: number;
};
export type DeliveryDisplayContext = DeliveryContext & {
  members: DeliveryMember[];
  milestones: MilestoneSummary[];
  resources: DeliveryResource[];
  referenceTotals: {
    members: number;
    milestones: number;
    activeResources: number;
  };
};
export type RequirementDetail = {
  project_id: string;
  version: number;
  query_generation: number;
  requirement: DeliveryRequirement;
};
export type TaskDetail = {
  project_id: string;
  version: number;
  query_generation: number;
  planning_basis: string;
  task: DeliveryTask;
  requirement: { id: string; title: string } | null;
};
export type DeliveryTaskData = {
  project: DeliveryContext["project"];
  permissions: DeliveryContext["permissions"];
  version: number;
  query_generation: number;
  planning_basis: string;
  task: DeliveryTask;
  requirement: DeliveryRequirement | null;
  members: DeliveryMember[];
  dependencies: TaskSummary[];
};
export type DeliveryListQuery = {
  q?: string;
  stage?: string;
  priority?: string;
  owner_id?: string;
  milestone_id?: string;
  requirement_id?: string;
  task_id?: string;
  status?: string;
  severity?: string;
  source?: string;
  cursor?: string;
  limit?: number;
  sort?: string;
};
const scoped = (projectId: string) => {
  if (!projectId || projectId !== projectId.trim())
    throw new Error("Explicit project required");
  return { "X-Project-Id": projectId };
};
function paramsOf(input: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== "" && value !== null)
      params.set(key, String(value));
  return params;
}
export function fetchDeliveryContext(projectId: string, signal?: AbortSignal) {
  return request<DeliveryContext>("/api/v1/delivery/context", {
    headers: scoped(projectId),
    signal,
  });
}
export function rebuildDeliveryQuery(projectId: string) {
  return request<
    Pick<
      DeliveryContext,
      "project_id" | "version" | "query_generation" | "query_state"
    >
  >("/api/v1/delivery/query/rebuild", {
    method: "POST",
    headers: scoped(projectId),
  });
}
function page<T>(
  kind: string,
  projectId: string,
  query: DeliveryListQuery,
  signal?: AbortSignal,
  queryGeneration?: number | null,
) {
  const allowed =
    kind === "requirements"
      ? [
          "q",
          "stage",
          "priority",
          "owner_id",
          "milestone_id",
          "cursor",
          "limit",
          "sort",
        ]
      : kind === "tasks"
        ? [
            "requirement_id",
            "q",
            "status",
            "priority",
            "owner_id",
            "milestone_id",
            "cursor",
            "limit",
            "sort",
          ]
        : [
            "requirement_id",
            "task_id",
            "q",
            "status",
            "severity",
            "source",
            "cursor",
            "limit",
          ];
  const filters = Object.fromEntries(
    allowed
      .filter((key) => key in query)
      .map((key) => [key, query[key as keyof DeliveryListQuery]]),
  );
  return request<DeliveryPage<T>>(
    `/api/v1/delivery/${kind}?${paramsOf(filters)}`,
    { headers: scoped(projectId), signal },
  ).then((value) => {
    if (queryGeneration !== undefined)
      assertDeliveryGeneration(
        { project_id: projectId, query_generation: queryGeneration },
        value,
      );
    return value;
  });
}
export const fetchRequirementPage = (
  projectId: string,
  query: DeliveryListQuery = {},
  signal?: AbortSignal,
  queryGeneration?: number | null,
) =>
  page<RequirementSummary>(
    "requirements",
    projectId,
    query,
    signal,
    queryGeneration,
  );
export const fetchTaskPage = (
  projectId: string,
  query: DeliveryListQuery = {},
  signal?: AbortSignal,
  queryGeneration?: number | null,
) => page<TaskSummary>("tasks", projectId, query, signal, queryGeneration);
export const fetchIssuePage = (
  projectId: string,
  query: DeliveryListQuery = {},
  signal?: AbortSignal,
  queryGeneration?: number | null,
) => page<IssueSummary>("issues", projectId, query, signal, queryGeneration);
export function fetchRequirementDetail(
  projectId: string,
  id: string,
  signal?: AbortSignal,
  queryGeneration?: number | null,
) {
  return request<RequirementDetail>(
    `/api/v1/delivery/requirements/${encodeURIComponent(id)}`,
    { headers: scoped(projectId), signal },
  ).then((value) => {
    if (queryGeneration !== undefined)
      assertDeliveryGeneration(
        { project_id: projectId, query_generation: queryGeneration },
        value,
      );
    return value;
  });
}
export function fetchTaskDetail(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  return request<TaskDetail>(
    `/api/v1/delivery/tasks/${encodeURIComponent(id)}`,
    { headers: scoped(projectId), signal },
  );
}
export function fetchExecutionDetail(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  return request<{
    project_id: string;
    version: number;
    query_generation: number;
    execution: DeliveryExecution;
  }>(`/api/v1/delivery/executions/${encodeURIComponent(id)}`, {
    headers: scoped(projectId),
    signal,
  });
}
export function fetchDeliveryReferences<T = Record<string, unknown>>(
  projectId: string,
  kind: DeliveryReferenceKind,
  options: {
    q?: string;
    ids?: string[];
    requirement_id?: string;
    task_id?: string;
    cursor?: string;
    limit?: number;
    member_kind?: string;
    member_active?: boolean;
    archived?: boolean;
    sort?: string;
    resource_kind?: string;
  } = {},
  signal?: AbortSignal,
  queryGeneration?: number | null,
) {
  return request<DeliveryPage<DeliveryReference<T>>>(
    `/api/v1/delivery/references?${paramsOf({ ...options, ids: options.ids?.join(","), kind })}`,
    { headers: scoped(projectId), signal },
  ).then((value) => {
    if (queryGeneration !== undefined)
      assertDeliveryGeneration(
        { project_id: projectId, query_generation: queryGeneration },
        value,
      );
    return value;
  });
}
export async function fetchDeliveryDisplayContext(
  projectId: string,
  signal?: AbortSignal,
): Promise<DeliveryDisplayContext> {
  const context = await fetchDeliveryContext(projectId, signal);
  if (context.query_state.status !== "ready")
    return {
      ...context,
      members: [],
      milestones: [],
      resources: [],
      referenceTotals: { members: 0, milestones: 0, activeResources: 0 },
    };
  const [members, milestones, resources] = await Promise.all([
    fetchDeliveryReferences<DeliveryMember>(
      projectId,
      "member",
      { limit: 50 },
      signal,
    ),
    fetchDeliveryReferences<MilestoneSummary>(
      projectId,
      "milestone",
      { limit: 3, sort: "ends_asc" },
      signal,
    ),
    fetchDeliveryReferences<DeliveryResource>(
      projectId,
      "resource",
      { limit: 2, archived: false },
      signal,
    ),
  ]);
  assertDeliveryGeneration(context, members, milestones, resources);
  return {
    ...context,
    members: members.items.map((item) => item.data),
    milestones: milestones.items.map((item) => item.data),
    resources: resources.items.map((item) => item.data),
    referenceTotals: {
      members: members.total,
      milestones: milestones.total,
      activeResources: resources.total,
    },
  };
}
export async function fetchDeliveryTaskData(
  projectId: string,
  taskId: string,
  signal?: AbortSignal,
  queryGeneration?: number | null,
): Promise<DeliveryTaskData> {
  const [detail, context] = await Promise.all([
    fetchTaskDetail(projectId, taskId, signal),
    fetchDeliveryContext(projectId, signal),
  ]);
  const task = detail.task;
  if (queryGeneration !== undefined)
    assertDeliveryGeneration(
      { project_id: projectId, query_generation: queryGeneration },
      detail,
      context,
    );
  const [requirement, members, dependencies] = await Promise.all([
    detail.requirement
      ? fetchRequirementDetail(projectId, task.req_id, signal)
      : Promise.resolve(null),
    fetchDeliveryReferences<DeliveryMember>(
      projectId,
      "member",
      {
        ids: [
          ...new Set(
            [
              task.owner_id,
              ...(task.planning?.allocations || []).map(
                (item) => item.member_id,
              ),
            ].filter(Boolean),
          ),
        ],
        limit: 50,
      },
      signal,
    ),
    task.planning?.depends_on?.length
      ? fetchDeliveryReferences<TaskSummary>(
          projectId,
          "task",
          { ids: task.planning.depends_on, limit: 100 },
          signal,
        )
      : Promise.resolve({ items: [] }),
  ]);
  assertDeliveryGeneration(
    detail,
    context,
    requirement,
    members,
    "project_id" in dependencies ? dependencies : null,
  );
  return {
    project: context.project,
    permissions: context.permissions,
    version: detail.version,
    query_generation: detail.query_generation,
    planning_basis: detail.planning_basis,
    task,
    requirement: requirement?.requirement || null,
    members: members.items.map((item) => item.data),
    dependencies: dependencies.items.map((item) => item.data),
  };
}
export function assertDeliveryGeneration(
  first: { project_id: string; query_generation: number | null },
  ...others: ({ project_id: string; query_generation: number | null } | null)[]
) {
  if (
    others.some(
      (item) =>
        item &&
        (item.project_id !== first.project_id ||
          item.query_generation !== first.query_generation),
    )
  )
    throw new Error(
      'HTTP 409: {"detail":{"code":"delivery_query_cursor_stale"}}',
    );
}
export function deliveryQueryFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return {
    message,
    stale: message.includes("delivery_query_cursor_stale"),
    rebuild: message.includes("delivery_query_rebuild_required"),
    missing: /^HTTP 404\b/.test(message),
    denied: /^HTTP 403\b/.test(message),
  };
}
export function invalidateDeliveryQueries(
  client: QueryClient,
  projectId: string,
) {
  return client.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        typeof key[0] === "string" &&
        (key[0].startsWith("delivery") ||
          ["tasks", "tasksSummary", "taskDependencies"].includes(key[0])) &&
        (key.includes(projectId) || !key[0].startsWith("delivery"))
      );
    },
  });
}
export function requirementSummaryProgress(
  requirement: Pick<RequirementSummary, "tasks_total" | "tasks_done">,
) {
  return requirement.tasks_total
    ? Math.round((requirement.tasks_done / requirement.tasks_total) * 100)
    : 0;
}
export type RequirementStage = DeliveryStage;
