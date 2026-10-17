import { prepareDeliveryIntent, type DeliveryIntent } from "./delivery";
import { planError } from "./deliveryTaskPlan";
import { request } from "./http";
export type ScheduleUnit = "hours" | "slots";
export type ScheduleAllocation = {
  member_id: string;
  starts_on: string;
  ends_on: string;
  quantity_per_day: number;
  weekdays: number[];
  unit: ScheduleUnit | null;
};
export type ScheduleAllocationInput = Omit<ScheduleAllocation, "unit">;
export type ScheduleAllocationDraft = Omit<
  ScheduleAllocationInput,
  "quantity_per_day"
> & { quantity_per_day: number | null };
export type MemberCalendar = {
  unit: ScheduleUnit;
  weekly: (number | null)[];
  exceptions: { date: string; available: number | null; note: string }[];
};
export type ScheduleCell = {
  date: string;
  available: number | null;
  active_load: number;
  total_reserved: number;
  overload: number | null;
  unavailable: boolean;
  unregistered_count: number;
  incomplete: boolean;
  contributions: {
    task_id: string;
    title: string;
    quantity: number;
    active: boolean;
  }[];
};
export type ScheduleResource = {
  id: string;
  name: string;
  kind: "human" | "agent" | "tool" | null;
  active: boolean;
  unit: ScheduleUnit | null;
  calendar: MemberCalendar | null;
  cells: ScheduleCell[];
};
export type ScheduleTask = {
  id: string;
  title: string;
  req_id: string;
  requirement_title: string;
  owner_id: string;
  owner_name: string;
  owner_active: boolean;
  status: string;
  delivery_status: string;
  verified: boolean;
  milestone_id: string;
  sprint_id: string;
  task_basis: string;
  starts_on: string | null;
  ends_on: string | null;
  depends_on: string[];
  dependency_blocked: string[];
  allocations: ScheduleAllocation[];
  issues: {
    code: string;
    message: string;
    member_id: string;
    task_id: string;
  }[];
};
export type DeliverySchedule = {
  project_id: string;
  version: number;
  planning_basis: string;
  as_of: string;
  timezone: "UTC";
  range: { starts_on: string; ends_on: string };
  permissions: { write: boolean; approve: boolean; configure: boolean };
  resources: ScheduleResource[];
  tasks: ScheduleTask[];
  milestones: { id: string; title: string }[];
  sprints: { id: string; title: string }[];
  summary: {
    tasks_total: number;
    active_tasks: number;
    verified_tasks: number;
    unscheduled_tasks: number;
    incomplete_tasks: number;
    overloaded_cells: number;
    unavailable_cells: number;
    unknown_capacity_cells: number;
    issues_by_code: Record<string, number>;
  };
};
export type ScheduleTaskChange = {
  task_id: string;
  starts_on?: string | null;
  ends_on?: string | null;
  allocations?: ScheduleAllocationInput[];
};
export type SchedulePreview = {
  project_id: string;
  version: number;
  planning_basis: string;
  changes: {
    task_id: string;
    title: string;
    before: {
      starts_on: string | null;
      ends_on: string | null;
      allocations: ScheduleAllocation[];
    };
    after: {
      starts_on: string | null;
      ends_on: string | null;
      allocations: ScheduleAllocation[];
    };
    fields: string[];
  }[];
  affected_task_ids: string[];
};
export type SchedulingRoute = {
  view: "team" | "timeline";
  teamMode: "members" | "capacity";
  timelineMode: "milestones" | "dependencies";
  startsOn: string;
  endsOn: string;
  memberId: string;
  milestoneId: string;
  sprintId: string;
  issue: string;
  search: string;
  dayMemberId: string;
  day: string;
  editTaskId: string;
};
export type SchedulingSession = {
  projectId: string;
  version: number;
  basis: string;
  snapshot: DeliverySchedule;
  intent: DeliveryIntent;
} & (
  | {
      kind: "tasks";
      changes: (Omit<ScheduleTaskChange, "allocations"> & {
        allocations?: ScheduleAllocationDraft[];
      })[];
    }
  | {
      kind: "calendar";
      memberId: string;
      weekly: (number | null)[];
      exceptions: MemberCalendar["exceptions"];
    }
);

export function defaultSchedulingRange(now = new Date()) {
  const startsOn = now.toISOString().slice(0, 10);
  return {
    startsOn,
    endsOn: new Date(Date.parse(`${startsOn}T00:00:00Z`) + 13 * 86400000)
      .toISOString()
      .slice(0, 10),
  };
}
export function schedulingRangeProblem(
  startsOn: string,
  endsOn: string,
): string | null {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith("0000-") &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(startsOn) || !valid(endsOn)) return "invalidDates";
  if (startsOn > endsOn) return "dateOrder";
  return (Date.parse(`${endsOn}T00:00:00Z`) -
    Date.parse(`${startsOn}T00:00:00Z`)) /
    86400000 >=
    92
    ? "rangeLimit"
    : null;
}
const scheduleParams = [
  "team_view",
  "timeline_view",
  "starts_on",
  "ends_on",
  "member_id",
  "milestone_id",
  "sprint_id",
  "schedule_issue",
  "schedule_q",
  "schedule_day_member",
  "schedule_day",
  "schedule_edit",
];
export function parseSchedulingRoute(
  hash: string,
  now = new Date(),
): SchedulingRoute {
  const params = new URLSearchParams(hash.split("?")[1]);
  const range = defaultSchedulingRange(now);
  return {
    view: params.get("view") === "team" ? "team" : "timeline",
    teamMode: params.get("team_view") === "capacity" ? "capacity" : "members",
    timelineMode:
      params.get("timeline_view") === "dependencies"
        ? "dependencies"
        : "milestones",
    startsOn: params.get("starts_on") ?? range.startsOn,
    endsOn: params.get("ends_on") ?? range.endsOn,
    memberId: params.get("member_id") || "",
    milestoneId: params.get("milestone_id") || "",
    sprintId: params.get("sprint_id") || "",
    issue: params.get("schedule_issue") || "",
    search: params.get("schedule_q") || "",
    dayMemberId: params.get("schedule_day_member") || "",
    day: params.get("schedule_day") || "",
    editTaskId: params.get("schedule_edit") || "",
  };
}
export function schedulingHash(route: SchedulingRoute, source = ""): string {
  const params = new URLSearchParams(source.split("?")[1]);
  params.set("view", route.view);
  const values = [
    route.teamMode,
    route.timelineMode,
    route.startsOn,
    route.endsOn,
    route.memberId,
    route.milestoneId,
    route.sprintId,
    route.issue,
    route.search,
    route.dayMemberId,
    route.day,
    route.editTaskId,
  ];
  scheduleParams.forEach((key, index) =>
    values[index] ? params.set(key, values[index]) : params.delete(key),
  );
  return `#/dev-flow?${params}`;
}
export function preserveSchedulingRoute(
  target: string,
  source: string,
): string {
  const from = new URLSearchParams(source.split("?")[1]);
  const to = new URLSearchParams(target.split("?")[1]);
  if (
    !["team", "timeline"].includes(to.get("view") || "") ||
    !["team", "timeline"].includes(from.get("view") || "")
  )
    return target;
  for (const key of scheduleParams)
    if (!to.has(key) && from.has(key)) to.set(key, from.get(key)!);
  return `#/dev-flow?${to}`;
}
export async function fetchDeliverySchedule(
  projectId: string,
  range: { startsOn: string; endsOn: string },
  signal?: AbortSignal,
): Promise<DeliverySchedule> {
  if (!projectId || projectId !== projectId.trim())
    throw new Error("Explicit project required");
  if (schedulingRangeProblem(range.startsOn, range.endsOn))
    throw new Error("Invalid scheduling range");
  const params = new URLSearchParams({
    starts_on: range.startsOn,
    ends_on: range.endsOn,
  });
  return request<DeliverySchedule>(`/api/v1/delivery/schedule?${params}`, {
    headers: { "X-Project-Id": projectId },
    signal,
  });
}
export async function previewDeliverySchedule(
  session: SchedulingSession,
  signal?: AbortSignal,
): Promise<SchedulePreview> {
  if (session.kind !== "tasks")
    throw new Error("Task scheduling preview required");
  return request<SchedulePreview>("/api/v1/delivery/schedule-preview", {
    method: "POST",
    headers: { "X-Project-Id": session.projectId },
    body: JSON.stringify(schedulingPayload(session)),
    signal,
  });
}
function pinnedScheduling(data: DeliverySchedule, key: string) {
  return {
    projectId: data.project_id,
    version: data.version,
    basis: data.planning_basis,
    snapshot: structuredClone(data),
    intent: { version: data.version, key },
  };
}
export function openSchedulingTasks(
  data: DeliverySchedule,
  ids: string[],
  key: string,
): SchedulingSession {
  if (!ids.length || ids.length > 200 || new Set(ids).size !== ids.length)
    throw new Error("Select unique current tasks");
  const changes = ids.map((id) => {
    const task = data.tasks.find((item) => item.id === id);
    if (!task) throw new Error("Current task unavailable");
    return {
      task_id: id,
      starts_on: task.starts_on,
      ends_on: task.ends_on,
      allocations: task.allocations.map(({ unit: _, ...allocation }) =>
        structuredClone(allocation),
      ),
    };
  });
  return { ...pinnedScheduling(data, key), kind: "tasks", changes };
}
export function openMemberCalendar(
  data: DeliverySchedule,
  id: string,
  key: string,
): SchedulingSession {
  const resource = data.resources.find((item) => item.id === id);
  if (!resource?.kind || !resource.active || !resource.unit)
    throw new Error("Current active resource unavailable");
  return {
    ...pinnedScheduling(data, key),
    kind: "calendar",
    memberId: id,
    weekly: [
      ...(resource.calendar?.weekly || Array<number | null>(7).fill(null)),
    ],
    exceptions: structuredClone(resource.calendar?.exceptions || []),
  };
}
export function schedulingPayload(
  session: SchedulingSession,
): Record<string, unknown> {
  return session.kind === "calendar"
    ? {
        member_id: session.memberId,
        planning_basis: session.basis,
        weekly: [...session.weekly],
        exceptions: session.exceptions.map((item) => ({
          ...item,
          note: item.note.trim(),
        })),
      }
    : {
        planning_basis: session.basis,
        changes: structuredClone(session.changes),
      };
}
export function prepareSchedulingCommand(session: SchedulingSession) {
  const action =
    session.kind === "calendar"
      ? ("member.calendar.save" as const)
      : ("tasks.schedule" as const);
  const payload = schedulingPayload(session);
  const intent = prepareDeliveryIntent(session.intent, action, payload);
  return {
    session: { ...session, intent },
    action,
    payload,
    version: session.version,
    key: intent.key,
  };
}
export function adoptSchedulingBasis(
  session: SchedulingSession,
  data: DeliverySchedule,
  key: string,
): SchedulingSession {
  if (session.projectId !== data.project_id)
    throw new Error("Scheduling project changed");
  if (session.kind === "tasks")
    openSchedulingTasks(
      data,
      session.changes.map((item) => item.task_id),
      key,
    );
  else openMemberCalendar(data, session.memberId, key);
  return { ...structuredClone(session), ...pinnedScheduling(data, key) };
}
export function schedulingError(error: unknown) {
  const parsed = planError(error);
  const raw = error instanceof Error ? error.message : String(error);
  return {
    ...parsed,
    conflict:
      parsed.conflict ||
      (raw.startsWith("HTTP 409") && parsed.code === "planning_basis_changed"),
  };
}
export function filterSchedulingTasks(
  tasks: ScheduleTask[],
  route: SchedulingRoute,
) {
  const term = route.search.trim().toLocaleLowerCase();
  return tasks.filter(
    (task) =>
      (!route.memberId ||
        task.owner_id === route.memberId ||
        task.allocations.some((item) => item.member_id === route.memberId)) &&
      (!route.milestoneId || task.milestone_id === route.milestoneId) &&
      (!route.sprintId || task.sprint_id === route.sprintId) &&
      (!route.issue ||
        task.issues.some((issue) => issue.code === route.issue)) &&
      (!term ||
        `${task.id} ${task.title} ${task.requirement_title}`
          .toLocaleLowerCase()
          .includes(term)),
  );
}

export function allocationSummary(
  allocations: ScheduleAllocation[] | null | undefined,
  resources: Pick<ScheduleResource, "id" | "name">[],
  translate: (key: string) => string,
): string {
  if (allocations == null)
    return translate("deliverySchedule.unknownReservations");
  if (!allocations.length) return translate("deliverySchedule.noReservations");
  return allocations
    .map(
      (item) =>
        `${resources.find((resource) => resource.id === item.member_id)?.name || item.member_id} · ${item.quantity_per_day} ${translate(`deliverySchedule.units.${item.unit === "hours" ? "hoursPerDay" : item.unit === "slots" ? "slotsPerDay" : "unknown"}`)} · ${item.starts_on} → ${item.ends_on} · ${item.weekdays.map((day) => translate(`deliverySchedule.weekdaysLabels.${day}`)).join(" / ")}`,
    )
    .join("\n");
}
