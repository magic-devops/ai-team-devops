export type AssistanceSource = "ai" | "rules";
export const prototypeModes = ["wireframe", "user_journey", "ia"] as const;
export type PrototypeMode = (typeof prototypeModes)[number];
export type AssistanceGeneration = {
  id: string;
  action?: string;
  source: AssistanceSource;
  model?: string;
  provider?: string;
  usage?: Record<string, number>;
  basis?: string;
  requirement_revision?: number;
  created_at?: string;
  stale?: boolean;
};
export type AssistancePreview = {
  generation?: AssistanceGeneration;
  expected_version?: number;
  content?: string;
  markdown?: string;
  score?: number;
  suggestions?: string[];
  suggested_acceptance_criteria?: string[];
  risks?: Array<{ message?: string; level?: string; code?: string }>;
  [key: string]: unknown;
};
export type IntakeRow = {
  key: string;
  selected: boolean;
  title: string;
  description?: string;
  priority?: string;
  acceptance_criteria?: string[];
  tags?: string[];
  assigned_agent?: string;
  dev_tool?: string;
  acceptance_text?: string;
  tags_text?: string;
};
export type AssistanceIntent = { signature: string; key: string };
export function formatAssistanceDate(value: string | number | undefined, locale = "zh-CN") {
  if (value == null) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
export function assistanceIntent(
  previous: AssistanceIntent | undefined,
  scope: string,
  action: string,
  body: unknown,
  regenerate = false,
  makeKey: () => string = () => crypto.randomUUID(),
): AssistanceIntent {
  const signature = JSON.stringify([scope, action, body]);
  return {
    signature,
    key:
      !regenerate && previous?.signature === signature
        ? previous.key
        : makeKey(),
  };
}
export function assistanceError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let message = raw;
  let code = "";
  try {
    const data = JSON.parse(raw.replace(/^HTTP \d+:\s*/, ""));
    const detail = data.detail ?? data;
    if (typeof detail === "string") message = detail;
    else {
      message = detail.message || detail.error || raw;
      code = detail.code || "";
    }
  } catch {
    /* Plain network errors already contain a readable message. */
  }
  const stale = /basis|revision|stale/.test(code);
  const conflict =
    /^HTTP 409:/.test(raw) &&
    !/progress|inflight|idempotency|key_mismatch/.test(code);
  return { message, conflict, stale };
}
export function canAdoptAssistanceVersion(
  generation: AssistanceGeneration,
  currentBasis?: string,
) {
  return (
    !generation.stale &&
    (!generation.basis || generation.basis === currentBasis)
  );
}
export function assistanceApplyBody(
  generation: AssistanceGeneration,
  version: number,
  key: string,
  body: Record<string, unknown>,
) {
  return {
    ...body,
    generation_id: generation.id,
    requirement_basis: generation.basis,
    expected_version: version,
    idempotency_key: key,
  };
}
export function selectedIntakeItems(rows: IntakeRow[]) {
  return rows
    .filter((row) => row.selected)
    .map(
      ({
        key: _key,
        selected: _selected,
        acceptance_text,
        tags_text,
        ...item
      }) => ({
        ...item,
        title: item.title.trim(),
        description: item.description?.trim() || "",
        priority: item.priority || "P2",
        acceptance_criteria:
          acceptance_text != null
            ? acceptance_text
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean)
            : item.acceptance_criteria || [],
        tags:
          tags_text != null
            ? tags_text
                .split(/[,，]/)
                .map((value) => value.trim())
                .filter(Boolean)
            : item.tags || [],
        assigned_agent: item.assigned_agent || "",
        dev_tool: item.dev_tool || "",
      }),
    );
}
export type WorkflowReviewDetail = {
  status?: string;
  phase?: string;
  decision?: string;
  type?: string;
  instance?: {
    status?: string;
    phase?: string;
    decision?: string;
    type?: string;
  };
  permissions?: { read?: boolean; write?: boolean; approve?: boolean };
  review?: {
    source?: string;
    status?: string;
    error?: string;
    content?: string;
    model?: string;
    provider?: string;
    usage?: Record<string, number>;
    truncated?: boolean;
    input_chars?: number;
    reviewed_chars?: number;
  };
  decision_record?: {
    decision?: string;
    comment?: string;
    actor_id?: string;
    at?: string | number;
  };
  result?: {
    review?: WorkflowReviewDetail["review"];
    decision_record?: WorkflowReviewDetail["decision_record"];
    tasks?: string[];
    completed?: string[];
    pending_phase?: string;
  };
};
export function canDecideWorkflow(detail: WorkflowReviewDetail | undefined) {
  return Boolean(
    (detail?.type || detail?.instance?.type) === "code_review" &&
    detail?.permissions?.approve &&
    ["awaiting_human", "timeout_pending"].includes(
      detail.status || detail.instance?.status || "",
    ),
  );
}
export type WorkflowHumanAction =
  | "approve"
  | "request_changes"
  | "reject"
  | "pause"
  | "resume"
  | "complete_task"
  | "complete_review"
  | "reassign"
  | "resolve";
export function workflowHumanActions(
  detail: WorkflowReviewDetail | undefined,
): WorkflowHumanAction[] {
  if (
    !detail ||
    ["completed", "failed", "cancelled"].includes(
      detail.status || detail.instance?.status || "",
    ) ||
    !detail.permissions?.write
  )
    return [];
  const type = detail.type || detail.instance?.type;
  const currentPhase = detail.phase || detail.instance?.phase;
  const phase =
    currentPhase === "timeout_pending"
      ? detail.result?.pending_phase || currentPhase
      : currentPhase;
  if (type === "code_review")
    return canDecideWorkflow(detail)
      ? ["approve", "request_changes", "reject"]
      : [];
  if (
    type === "bug_triage" &&
    ["assigned", "timeout_pending"].includes(phase || "")
  )
    return detail.permissions.approve ? ["reassign", "resolve"] : ["reassign"];
  if (type === "sprint_lifecycle") {
    if (phase === "paused") return ["resume"];
    if (!["in_progress", "reviewing", "timeout_pending"].includes(phase || ""))
      return [];
    const result: WorkflowHumanAction[] = ["pause"];
    if (detail.permissions.approve) {
      const tasks = detail.result?.tasks || [];
      const completed = detail.result?.completed || [];
      if (tasks.some((task) => !completed.includes(task)))
        result.push("complete_task");
      else result.push("complete_review");
    }
    return result;
  }
  return [];
}
export function workflowDecisionBody(
  decision: "approve" | "request_changes" | "reject",
  comment: string,
  key: string,
) {
  if (!comment.trim()) throw new Error("A review comment is required");
  return {
    signal: decision,
    payload: { comment: comment.trim(), signal_id: key },
  };
}
export function workflowHumanActionBody(
  signal: WorkflowHumanAction,
  comment: string,
  key: string,
  fields: { task_id?: string; assignee?: string } = {},
) {
  if (!comment.trim()) throw new Error("A review comment is required");
  const payload: Record<string, string> = {
    comment: comment.trim(),
    signal_id: key,
  };
  if (signal === "complete_task") {
    if (!fields.task_id) throw new Error("A workflow task is required");
    payload.task_id = fields.task_id;
  }
  if (signal === "reassign") {
    if (!fields.assignee?.trim()) throw new Error("An assignee is required");
    payload.assignee = fields.assignee.trim();
  }
  return { signal, payload };
}
