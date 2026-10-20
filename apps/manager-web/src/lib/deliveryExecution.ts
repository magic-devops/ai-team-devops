import { request } from "./http";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryTaskData,
} from "./delivery";
import type {
  ExecutionCommand,
  ExecutionCommandDraft,
} from "./executionCommands";
import { commandNodes } from "./executionCommands";
import type {
  ExecutorSnapshot,
  TeamRuntimeBindings,
} from "./deliveryTeamRuntime";

export type ExecutionProvider = {
  id: "codex" | "claude" | "opencode";
  executable_present: boolean;
  version: string | null;
  auth: "unknown";
};
export type ExecutionPolicy = {
  allowed_runtimes: ("command" | "agent")[];
  allowed_providers: ExecutionProvider["id"][];
};
export type ExecutionTarget = {
  id: string;
  kind: "local" | "device";
  name: string;
  version: number;
  basis: string;
  paired: boolean | null;
  online: boolean | null;
  last_seen_at: string | null;
  expires_at: string | null;
  worker_id: string | null;
  capability_digest: string;
  runtime_capabilities: ("command" | "agent")[];
  providers: ExecutionProvider[];
  policy: ExecutionPolicy;
  can_execute: boolean;
  reason_codes: string[];
};
export type ExecutionAgent = {
  id: string;
  version: number;
  title: string;
  provider: ExecutionProvider["id"];
};
export type ExecutionWorkspace = {
  id: string;
  name: string;
  version: number;
  agents: ExecutionAgent[];
  local: ExecutionTarget;
  devices: ExecutionTarget[];
};
export type DeliveryTargets = {
  project_id: string;
  as_of: string;
  runtime_configured: boolean;
  can_execute: boolean;
  can_configure_policy: boolean;
  workspaces: ExecutionWorkspace[];
};
export type ExecutionPayload = {
  executor_member_id: string;
  executor_binding_basis: string;
  task_id: string;
  task_basis: string;
  workspace_id: string;
  target_kind: "local" | "device";
  target_basis: string;
  target_device_id: string;
  agent_id: string;
  agent_version: number;
  nodes: (
    | ExecutionCommand
    | {
        id: string;
        title: string;
        kind: "approval";
        argv: [];
        agent_id: "";
        prompt: "";
      }
  )[];
  test_nodes: ExecutionCommand[];
  test_node_ids: string[];
};
export type ExecutionPreview = {
  executor_snapshot: ExecutorSnapshot | null;
  project_id: string;
  version: number;
  task_basis: string;
  plan_basis: string;
  workspace_id: string;
  workspace_version: number;
  snapshot: {
    task_id: string;
    title: string;
    description: string;
    assigned_to: string;
    task_acceptance_criteria: string[];
    requirement: null | {
      id: string;
      title: string;
      description: string;
      revision: number;
      acceptance_criteria: string[];
      criteria_indices: number[];
    };
    owner: null | { id: string; name: string | null; kind: "human" | "agent" | "tool" | null; active: boolean };
    dependency_basis: Record<string, string>;
    acceptance_criteria: string[];
  };
  target: ExecutionTarget;
  agent: ExecutionAgent | null;
  nodes: {
    id: string;
    title: string;
    kind: "command" | "approval" | "agent";
    argv: string[];
    expected_exit_code: number;
    timeout_seconds: number;
    agent_id: string;
    prompt: string;
  }[];
  test_node_ids: string[];
};
export type ExecutionNodeResult = {
  succeeded: boolean | null;
  exit_code: number | null;
  expected_exit_code: number | null;
  error: string | null;
  stdout: string | null;
  stderr: string | null;
  duration_ms: number | null;
  attempt: number | null;
  skipped: boolean;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  output_source: "completed_node_result";
  agent: null | {
    provider: string;
    agent_id: string;
    profile_version: number | null;
    completed: boolean;
    usage: Record<string, unknown> | null;
    usage_truncated: boolean;
    message: string;
    error: string;
    event_count: number;
  };
};
export type ExecutionEvent = {
  id: string;
  seq: number;
  at: string;
  type: string;
  node_id: string | null;
  status: string | null;
  message: string;
  attempt: number | null;
  result: ExecutionNodeResult | null;
};
export type ExecutionObservations = {
  executor_snapshot: ExecutorSnapshot | null;
  executor_binding_invalidated: boolean;
  project_id: string;
  execution_id: string;
  run_id: string;
  run_version: number;
  attempt: number;
  status: string;
  stale: boolean;
  observed_at: string;
  events: ExecutionEvent[];
  next_cursor: string | null;
  more: boolean;
  nodes: {
    id: string;
    title: string;
    kind: "command" | "approval" | "agent";
    is_test: boolean;
    status: "pending" | "running" | "passed" | "failed" | "skipped";
    result: ExecutionNodeResult | null;
  }[];
  tests: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    status: "not_configured" | "pending" | "passed" | "failed";
  };
  permissions: {
    can_start: boolean;
    can_cancel: boolean;
    can_review: boolean;
    can_sync: boolean;
  };
  log_streaming: false;
};
const scope = (projectId: string) => {
  if (!projectId || projectId !== projectId.trim())
    throw new Error("Explicit project required");
  return { "X-Project-Id": projectId };
};
export function fetchDeliveryTargets(projectId: string, signal?: AbortSignal) {
  return request<DeliveryTargets>("/api/v1/delivery/execution-targets", {
    headers: scope(projectId),
    signal,
  });
}
export function previewDeliveryExecution(
  projectId: string,
  payload: ExecutionPayload,
  signal?: AbortSignal,
) {
  return request<ExecutionPreview>("/api/v1/delivery/execution-preview", {
    method: "POST",
    headers: scope(projectId),
    body: JSON.stringify(payload),
    signal,
  });
}
export function fetchExecutionObservations(
  projectId: string,
  executionId: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(executionId))
    throw new Error("Invalid execution ID");
  const params = new URLSearchParams({ limit: "100" });
  if (cursor) params.set("cursor", cursor);
  return request<ExecutionObservations>(
    `/api/v1/delivery/executions/${encodeURIComponent(executionId)}/observations?${params}`,
    { headers: scope(projectId), signal },
  );
}
export type ExecutionDraftSession = {
  executorMemberId: string;
  executorBindingBasis: string;
  projectId: string;
  taskId: string;
  taskBasis: string;
  intent: DeliveryIntent;
  mode: "agent" | "command";
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  target: ExecutionTarget | null;
  commands: ExecutionCommandDraft[];
  approvalBeforeRun: boolean;
  approvalTitle?: string;
  preview: ExecutionPreview | null;
};
export function openExecutionDraft(
  data: DeliveryTaskData,
  taskId: string,
  key: string,
): ExecutionDraftSession {
  const task = data.task.id === taskId ? data.task : undefined;
  if (!task || !task.basis) throw new Error("Task unavailable");
  return {
    executorMemberId: "",
    executorBindingBasis: "",
    projectId: data.project.id,
    taskId,
    taskBasis: task.basis,
    intent: { version: data.version, key },
    mode: "agent",
    workspaceId: "",
    agentId: "",
    agentVersion: 1,
    target: null,
    commands: [],
    approvalBeforeRun: false,
    preview: null,
  };
}
export function executionPayload(
  session: ExecutionDraftSession,
): ExecutionPayload {
  if (
    Boolean(session.executorMemberId) !==
      Boolean(session.executorBindingBasis) ||
    (session.executorMemberId && session.mode !== "agent")
  )
    throw new Error("executorAssociationInvalid");
  if (!session.workspaceId || !session.target || !session.target.can_execute)
    throw new Error("targetRequired");
  if (session.mode === "agent" && !session.agentId)
    throw new Error("agentRequired");
  const nodes = session.commands.length ? commandNodes(session.commands) : [];
  if (session.mode === "command" && !nodes.length)
    throw new Error("commandCount");
  const plan: ExecutionPayload["nodes"] = [...nodes];
  if (session.mode === "command" && session.approvalBeforeRun) {
    if (session.target.kind !== "local")
      throw new Error("target_approval_unsupported");
    if (nodes.length >= 32) throw new Error("approvalNodeLimit");
    let id = "confirm_before_run",
      suffix = 2;
    while (nodes.some((node) => node.id === id))
      id = `confirm_before_run_${suffix++}`;
    plan.unshift({
      id,
      title: session.approvalTitle || "Confirm before execution",
      kind: "approval",
      argv: [],
      agent_id: "",
      prompt: "",
    });
  }
  return {
    executor_member_id: session.executorMemberId,
    executor_binding_basis: session.executorBindingBasis,
    task_id: session.taskId,
    task_basis: session.taskBasis,
    workspace_id: session.workspaceId,
    target_kind: session.target.kind,
    target_basis: session.target.basis,
    target_device_id: session.target.kind === "device" ? session.target.id : "",
    agent_id: session.mode === "agent" ? session.agentId : "",
    agent_version: session.agentVersion,
    nodes: session.mode === "command" ? plan : [],
    test_nodes: session.mode === "agent" ? nodes : [],
    test_node_ids:
      session.mode === "command"
        ? session.commands.filter((row) => row.test).map((row) => row.id)
        : [],
  };
}
export function prepareExecution(session: ExecutionDraftSession) {
  const payload = executionPayload(session);
  const intent = prepareDeliveryIntent(
    session.intent,
    "execution.queue",
    payload,
  );
  return {
    session: { ...session, intent },
    payload,
    version: intent.version,
    key: intent.key,
  };
}
export function executionTargetProblems(
  target: ExecutionTarget,
  mode: "agent" | "command",
  provider?: ExecutionProvider["id"],
  hasTests = false,
) {
  const reasons = new Set(target.reason_codes);
  if (
    !target.runtime_capabilities.includes(mode) ||
    !target.policy.allowed_runtimes.includes(mode)
  )
    reasons.add("runtime_not_allowed");
  if (mode === "agent" && provider) {
    if (!target.policy.allowed_providers.includes(provider))
      reasons.add("provider_not_allowed");
    if (
      !target.providers.some(
        (item) => item.id === provider && item.executable_present,
      )
    )
      reasons.add("provider_unavailable");
  }
  if (
    mode === "agent" &&
    hasTests &&
    (!target.runtime_capabilities.includes("command") ||
      !target.policy.allowed_runtimes.includes("command"))
  )
    reasons.add("runtime_not_allowed");
  return [...reasons];
}
export function adoptExecutionDraft(
  session: ExecutionDraftSession,
  data: DeliveryTaskData,
  targets: DeliveryTargets,
  key: string,
  bindings?: TeamRuntimeBindings,
): ExecutionDraftSession {
  if (
    session.projectId !== data.project.id ||
    targets.project_id !== data.project.id
  )
    throw new Error("Scope changed");
  const task = data.task.id === session.taskId ? data.task : undefined;
  if (session.executorMemberId) {
    if (!bindings || bindings.project_id !== data.project.id)
      throw new Error("executorCatalogueRequired");
    const member = bindings.members.find(
      (row) => row.member_id === session.executorMemberId,
    );
    if (!member?.binding || member.status !== "current")
      throw new Error("executorUnavailable");
    const boundWorkspace = targets.workspaces.find(
      (item) => item.id === member.binding!.workspace_id,
    );
    const boundAgent = boundWorkspace?.agents.find(
      (item) =>
        item.id === member.binding!.agent_id &&
        item.version === member.binding!.agent_version,
    );
    if (!task?.execution_gate.eligible || !boundWorkspace || !boundAgent)
      throw new Error("executorUnavailable");
    const sameConfiguration =
      session.workspaceId === boundWorkspace.id &&
      session.agentId === boundAgent.id &&
      session.agentVersion === boundAgent.version;
    const currentTarget =
      sameConfiguration &&
      [boundWorkspace.local, ...boundWorkspace.devices].find(
        (item) =>
          item.id === session.target?.id && item.kind === session.target?.kind,
      );
    const target =
      currentTarget &&
      currentTarget.can_execute &&
      !executionTargetProblems(
        currentTarget,
        "agent",
        boundAgent.provider,
        Boolean(session.commands.length),
      ).length
        ? structuredClone(currentTarget)
        : null;
    return {
      ...session,
      mode: "agent",
      taskBasis: task.basis,
      executorBindingBasis: member.binding_basis,
      workspaceId: boundWorkspace.id,
      agentId: boundAgent.id,
      agentVersion: boundAgent.version,
      target,
      intent: { version: data.version, key },
      commands: structuredClone(session.commands),
      preview: null,
    };
  }
  const workspace = targets.workspaces.find(
    (item) => item.id === session.workspaceId,
  );
  const target =
    workspace &&
    [workspace.local, ...workspace.devices].find(
      (item) =>
        item.id === session.target?.id && item.kind === session.target?.kind,
    );
  const agent = workspace?.agents.find((item) => item.id === session.agentId);
  if (
    !task ||
    !task.execution_gate.eligible ||
    !workspace ||
    !target ||
    !target.can_execute ||
    (target.kind === "device" && (!target.online || !target.paired)) ||
    (session.mode === "agent" && !agent)
  )
    throw new Error("Target or task unavailable");
  if (
    executionTargetProblems(
      target,
      session.mode,
      agent?.provider,
      Boolean(session.commands.length),
    ).length
  )
    throw new Error("Target capability or permission changed");
  return {
    ...session,
    taskBasis: task.basis,
    intent: { version: data.version, key },
    target: structuredClone(target),
    agentVersion: agent?.version || 1,
    commands: structuredClone(session.commands),
    preview: null,
  };
}
export function mergeExecutionEvents(
  current: ExecutionEvent[],
  incoming: ExecutionEvent[],
) {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.seq - b.seq).slice(-500);
}
