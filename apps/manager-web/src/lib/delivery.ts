import { request } from "./http";
import type { TaskPlanning } from "./deliveryTaskPlan";

export const deliveryStages = [
  "intake",
  "product",
  "ux",
  "architecture",
  "planning",
  "development",
  "testing",
  "acceptance",
  "release",
  "operations",
] as const;
export type DeliveryStage = (typeof deliveryStages)[number];
export type DeliveryMember = {
  id: string;
  name: string;
  kind: "human" | "agent" | "tool";
  role: string;
  tool: string;
  active: boolean;
};
export type DeliveryEvidence = {
  id: string;
  kind: string;
  title: string;
  content: string;
  url: string;
  result: string;
  revision: number;
  at: string;
  actor: string;
  source: string;
  stale?: boolean;
  task_id?: string;
  execution_id?: string;
  run_id?: string;
};
export type DeliveryRelease = {
  id: string;
  version: string;
  environment: string;
  artifact_url: string;
  rollback_plan: string;
  verification: string;
  revision: number;
  at: string;
};
export type DeliveryRequirement = {
  basis: string;
  id: string;
  title: string;
  description: string;
  priority: string;
  acceptance_criteria: string[];
  tasks_total: number;
  tasks_done: number;
  flow: {
    stage: DeliveryStage;
    revision: number;
    owner_id: string;
    due_on: string | null;
    milestone_id: string;
    blocked_reason: string;
    closed: boolean;
    source_issue_id?: string;
    legacy_completed?: boolean;
    artifacts: DeliveryEvidence[];
    releases: DeliveryRelease[];
    gates: { id: string; ok: boolean }[];
    reviews: {
      stage: string;
      revision: number;
      comment: string;
      actor: string;
      at: string;
      decision: string;
    }[];
  };
};
export type DeliveryTask = {
  basis: string;
  id: string;
  req_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  owner_id: string;
  assigned_to: string;
  estimate: string;
  execution_id?: string;
  planning?: TaskPlanning;
  dependency_blocked?: string[];
};
export type DeliveryExecution = {
  id: string;
  task_id: string;
  workspace_id: string;
  agent_id: string;
  status: string;
  run_id: string;
  run_version: number;
  progress: number;
  created_at: string;
  observed_at?: string;
  stale: boolean;
  issue_id?: string;
  test_node_ids: string[];
  snapshot: { title: string; revision: number; acceptance_criteria: string[] };
  results: Record<
    string,
    {
      succeeded?: boolean;
      exit_code?: number;
      error?: string;
      stdout?: string;
      stderr?: string;
    }
  >;
  review?: { decision: string; comment: string; actor: string; at: string };
};
export type DeliveryTargets = {
  can_execute: boolean;
  workspaces: {
    id: string;
    name: string;
    agents: { id: string; title: string; version: number; provider: string }[];
    devices: { id: string; name: string }[];
  }[];
  providers: { id: string; available: boolean }[];
};
export function fetchDeliveryTargets(projectId: string) {
  return request<DeliveryTargets>("/api/v1/delivery/execution-targets", {
    headers: { "X-Project-Id": projectId },
  });
}
export type DeliveryMilestone = {
  id: string;
  title: string;
  owner_id: string;
  starts_on: string | null;
  ends_on: string | null;
};
export type DeliveryResource = {
  id?: string;
  kind: "repository" | "document" | "design" | "other";
  title: string;
  url: string;
  description?: string;
  ref?: string;
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
};
export type DeliveryInboxTarget = {
  view: string;
  requirement_id: string;
  detail: string;
  task_id?: string;
  issue_id?: string;
};
export type DeliveryInboxItem = {
  id: string;
  kind: "requirement" | "task" | "issue";
  resource_id: string;
  title: string;
  requirement_id: string;
  task_id: string;
  status: string;
  stage: string;
  owner_id: string;
  due_on: string | null;
  priority: string;
  categories: ("work" | "approval" | "acceptance" | "blocked")[];
  blocked_reasons: string[];
  overdue: boolean;
  target: DeliveryInboxTarget;
};
export type DeliveryInbox = {
  project_id: string;
  version: number;
  scope: "mine" | "team";
  current_user_id: string;
  as_of: string;
  counts: {
    work: number;
    approval: number;
    acceptance: number;
    blocked: number;
    overdue: number;
    total: number;
  };
  items: DeliveryInboxItem[];
};
export function fetchDeliveryInbox(
  projectId: string,
  scope: "mine" | "team",
  signal?: AbortSignal,
) {
  return request<DeliveryInbox>(`/api/v1/delivery/inbox?scope=${scope}`, {
    signal,
    headers: { "X-Project-Id": projectId },
  });
}
export type DeliveryWorkspace = {
  planning_basis: string;
  version: number;
  project: {
    id: string;
    name: string;
    description: string;
    status?: string;
    goal?: string;
    owner_id?: string;
    starts_on?: string;
    ends_on?: string;
  };
  permissions: { write: boolean; approve: boolean; configure: boolean };
  requirements: DeliveryRequirement[];
  tasks: DeliveryTask[];
  members: DeliveryMember[];
  milestones: DeliveryMilestone[];
  resources?: DeliveryResource[];
  issues: {
    id: string;
    title: string;
    severity: string;
    status: string;
    task_id: string;
  }[];
  summary: {
    requirements: number;
    tasks: number;
    tasks_done: number;
    blocked: number;
    accepted: number;
    released: number;
    open_issues: number;
    acceptance_rate: number;
  };
  activity: {
    id: string;
    actor: string;
    action: string;
    resource_id: string;
    created_at: string;
    data: { input: Record<string, unknown> };
  }[];
  history: {
    at: string;
    requirements: number;
    accepted: number;
    released: number;
  }[];
  stages: { id: DeliveryStage; artifact: string; route: string }[];
  executions?: DeliveryExecution[];
};
export type DeliveryAction =
  | "project.update"
  | "progress.record"
  | "baseline.create"
  | "resource.save"
  | "resource.archive"
  | "member.save"
  | "milestone.save"
  | "requirement.create"
  | "requirement.update"
  | "task.create"
  | "task.update"
  | "task.manual_review"
  | "member.calendar.save"
  | "tasks.schedule"
  | "tasks.plan"
  | "artifact.add"
  | "stage.advance"
  | "stage.reopen"
  | "issue.promote"
  | "release.save"
  | "execution.queue"
  | "execution.sync"
  | "execution.cancel"
  | "execution.review";
export type DeliveryIntent = {
  version: number;
  signature?: string;
  key: string;
};
export function prepareDeliveryIntent(
  intent: DeliveryIntent,
  action: DeliveryAction,
  payload: Record<string, unknown>,
): DeliveryIntent {
  const signature = JSON.stringify([action, payload]);
  return {
    version: intent.version,
    signature,
    key:
      intent.signature && intent.signature !== signature
        ? crypto.randomUUID()
        : intent.key,
  };
}
export function dailyDeliveryHistory(history: DeliveryWorkspace["history"]) {
  const days = new Map<string, DeliveryWorkspace["history"][number]>();
  for (const point of history)
    days.set(new Date(point.at).toLocaleDateString("en-CA"), point);
  return [...days.values()].slice(-12);
}
export function fetchDelivery(projectId: string, signal?: AbortSignal) {
  return request<DeliveryWorkspace>("/api/v1/delivery/workspace", {
    signal,
    headers: { "X-Project-Id": projectId },
  });
}
export function saveDelivery(
  projectId: string,
  action: DeliveryAction,
  payload: Record<string, unknown>,
  version: number,
  key: string,
) {
  return request<DeliveryWorkspace>("/api/v1/delivery/commands", {
    method: "POST",
    headers: { "X-Project-Id": projectId },
    body: JSON.stringify({
      action,
      payload,
      expected_version: version,
      idempotency_key: key,
    }),
  });
}
export function filterRequirements(
  items: DeliveryRequirement[],
  search: string,
  stage: string,
  owner: string,
) {
  const term = search.trim().toLocaleLowerCase();
  return items.filter(
    (r) =>
      (!term ||
        `${r.id} ${r.title} ${r.description}`
          .toLocaleLowerCase()
          .includes(term)) &&
      (!stage || r.flow.stage === stage) &&
      (!owner || r.flow.owner_id === owner),
  );
}
export function requirementProgress(r: DeliveryRequirement) {
  return r.tasks_total ? Math.round((r.tasks_done / r.tasks_total) * 100) : 0;
}
export function safeEvidenceUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
