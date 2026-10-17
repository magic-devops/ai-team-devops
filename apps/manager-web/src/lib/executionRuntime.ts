import { request } from "./http";
import type { DeliveryWorkspace } from "./delivery";
import { projectHeaders, projectSessionKey } from "./projectPortfolio";

export type ExecutionControlAction =
  | "execution.start"
  | "execution.retry"
  | "execution.cancel"
  | "execution.approval";
export type ExecutionOutputStream = "stdout" | "stderr";
export type ExecutionControlReason = { code: string; message: string };
export type ExecutionControlPermission = {
  allowed: boolean;
  reasons: ExecutionControlReason[];
};
export type ExecutionStop = {
  id: string;
  state: "requested" | "confirmed" | "unknown" | "not_started";
  node_id: string | null;
  attempt: number;
  reason: string;
  requested_at: string | null;
  confirmed_at: string | null;
  evidence: string;
};
export type ExecutionRuntimeNode = {
  id: string;
  title: string;
  kind: "command" | "agent" | "approval";
  is_test: boolean;
  status: string;
  available_attempts: number[];
  result_attempt: number | null;
  reused_result: boolean;
};
export type ExecutionRuntime = {
  project_id: string;
  execution_id: string;
  run_id: string;
  run_version: number;
  attempt: number;
  status: string;
  runtime_status: string | null;
  stale: boolean;
  active_node_id: string | null;
  observed_at: string;
  recovery_requires_review: boolean;
  stop: ExecutionStop | null;
  approval: null | {
    id: string;
    version: number;
    node_id: string;
    attempt: number;
    status: string;
    title: string;
  };
  nodes: ExecutionRuntimeNode[];
  controls: Record<
    "start" | "retry" | "cancel" | "approval" | "approval_reject",
    ExecutionControlPermission
  >;
};
export type ExecutionOutputChunk = {
  seq: number;
  source_seq: number;
  node_id: string;
  attempt: number;
  stream: ExecutionOutputStream;
  text: string;
  observed_at: string;
  truncated: boolean;
};
export type ExecutionNodeOutput = {
  project_id: string;
  execution_id: string;
  run_id: string;
  node_id: string;
  attempt: number;
  stream: ExecutionOutputStream;
  source: "live_capture" | "completed_node_result" | "unavailable";
  availability:
    | "available"
    | "missing"
    | "restricted"
    | "unavailable"
    | "pending";
  available_attempts: number[];
  chunks: ExecutionOutputChunk[];
  next_cursor: string | null;
  more: boolean;
  complete: boolean;
  truncated: boolean;
  sanitized: boolean;
  gaps: { after_seq: number; before_seq: number | null; reason: string }[];
};
export type ExecutionControlPayload = {
  id: string;
  run_id: string;
  run_version: number;
  attempt: number;
  control_basis: string;
  reason: string;
  approval_id?: string;
  approval_version?: number;
  decision?: "approve" | "reject";
};
export type ExecutionControlPreview = {
  project_id: string;
  execution_id: string;
  version: number;
  action: ExecutionControlAction;
  allowed: boolean;
  reasons: ExecutionControlReason[];
  payload: ExecutionControlPayload;
};
export type ExecutionControlIntent = {
  projectId: string;
  executionId: string;
  action: ExecutionControlAction;
  version: number;
  key: string;
  payload: ExecutionControlPayload;
  scope: string;
};
export function parseExecutionSelection(hash: string) {
  const params = new URLSearchParams(hash.split("?")[1]);
  const raw = params.get("execution_attempt");
  return {
    nodeId: params.has("execution_node")
      ? params.get("execution_node")!
      : undefined,
    attempt:
      raw === null
        ? undefined
        : /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw))
          ? Number(raw)
          : NaN,
    stream: params.has("execution_stream")
      ? params.get("execution_stream")!
      : undefined,
  };
}

const identity = (value: string) => {
  if (!value || value.length > 100 || /[\s\u0000-\u001f\u007f]/.test(value))
    throw new Error("invalidIdentity");
  return encodeURIComponent(value);
};
export const assertExecutionSession = (scope: string) => {
  if (scope !== projectSessionKey()) throw new Error("scopeChanged");
};
const executionPath = (executionId: string) =>
  `/api/v1/delivery/executions/${identity(executionId)}`;
export async function fetchExecutionRuntime(
  projectId: string,
  executionId: string,
  signal?: AbortSignal,
): Promise<ExecutionRuntime> {
  const scope = projectSessionKey();
  const data = await request<ExecutionRuntime>(
    `${executionPath(executionId)}/runtime`,
    { headers: projectHeaders(projectId), signal },
  );
  assertExecutionSession(scope);
  if (data.project_id !== projectId || data.execution_id !== executionId)
    throw new Error("scopeChanged");
  return data;
}
export async function previewExecutionControl(
  projectId: string,
  executionId: string,
  action: ExecutionControlAction,
  reason: string,
  approval?: { id: string; decision: "approve" | "reject" },
  signal?: AbortSignal,
): Promise<ExecutionControlPreview> {
  if (!reason.trim() || reason.trim().length > 2000)
    throw new Error("reasonRequired");
  const scope = projectSessionKey();
  const data = await request<ExecutionControlPreview>(
    "/api/v1/delivery/execution-control-preview",
    {
      method: "POST",
      headers: projectHeaders(projectId),
      signal,
      body: JSON.stringify({
        id: executionId,
        action,
        reason: reason.trim(),
        ...(approval
          ? { approval_id: approval.id, decision: approval.decision }
          : {}),
      }),
    },
  );
  assertExecutionSession(scope);
  if (
    data.project_id !== projectId ||
    data.execution_id !== executionId ||
    data.action !== action ||
    data.payload.id !== executionId ||
    data.payload.reason !== reason.trim() ||
    (approval &&
      (data.payload.approval_id !== approval.id ||
        data.payload.decision !== approval.decision))
  )
    throw new Error("scopeChanged");
  return data;
}
export function prepareExecutionControl(
  projectId: string,
  executionId: string,
  preview: ExecutionControlPreview,
  key: string,
): ExecutionControlIntent {
  if (
    !preview.allowed ||
    preview.project_id !== projectId ||
    preview.execution_id !== executionId ||
    preview.payload.id !== executionId ||
    !preview.payload.reason.trim() ||
    !key
  )
    throw new Error("previewRequired");
  return {
    projectId,
    executionId,
    action: preview.action,
    version: preview.version,
    key,
    payload: structuredClone(preview.payload),
    scope: projectSessionKey(),
  };
}
export async function submitExecutionControl(
  intent: ExecutionControlIntent,
): Promise<DeliveryWorkspace> {
  assertExecutionSession(intent.scope);
  const data = await request<DeliveryWorkspace>("/api/v1/delivery/commands", {
    method: "POST",
    headers: projectHeaders(intent.projectId),
    body: JSON.stringify({
      action: intent.action,
      payload: intent.payload,
      expected_version: intent.version,
      idempotency_key: intent.key,
    }),
  });
  assertExecutionSession(intent.scope);
  if (data.project.id !== intent.projectId) throw new Error("scopeChanged");
  return data;
}
export async function fetchExecutionNodeOutput(
  projectId: string,
  executionId: string,
  nodeId: string,
  attempt: number,
  stream: ExecutionOutputStream,
  cursor?: string,
  signal?: AbortSignal,
): Promise<ExecutionNodeOutput> {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !["stdout", "stderr"].includes(stream)
  )
    throw new Error("invalidOutputSelection");
  const scope = projectSessionKey();
  const params = new URLSearchParams({
    attempt: String(attempt),
    stream,
    limit: "50",
  });
  if (cursor) params.set("cursor", cursor);
  const data = await request<ExecutionNodeOutput>(
    `${executionPath(executionId)}/nodes/${identity(nodeId)}/output?${params}`,
    { headers: projectHeaders(projectId), signal },
  );
  assertExecutionSession(scope);
  if (
    data.project_id !== projectId ||
    data.execution_id !== executionId ||
    data.node_id !== nodeId ||
    data.attempt !== attempt ||
    data.stream !== stream
  )
    throw new Error("scopeChanged");
  if (
    data.chunks?.some(
      (chunk) =>
        chunk.node_id !== nodeId ||
        chunk.attempt !== attempt ||
        chunk.stream !== stream,
    )
  )
    throw new Error("scopeChanged");
  return data;
}
export function mergeExecutionOutput(
  current: ExecutionOutputChunk[],
  incoming: ExecutionOutputChunk[],
): { chunks: ExecutionOutputChunk[]; omitted: number } {
  const chunks = new Map(current.map((chunk) => [chunk.seq, chunk]));
  for (const chunk of incoming) {
    const old = chunks.get(chunk.seq);
    if (old && JSON.stringify(old) !== JSON.stringify(chunk))
      throw new Error("outputSequenceChanged");
    chunks.set(chunk.seq, chunk);
  }
  const ordered = [...chunks.values()].sort((a, b) => a.seq - b.seq);
  return {
    chunks: ordered.slice(-2000),
    omitted: Math.max(0, ordered.length - 2000),
  };
}
export function executionRuntimeProblem(problem: unknown) {
  const raw =
    problem instanceof Error ? problem.message : String(problem ?? "");
  let code = "",
    message = raw;
  try {
    const parsed = JSON.parse(raw.replace(/^HTTP \d+:\s*/, ""));
    const detail = parsed.detail ?? parsed;
    if (typeof detail === "string") message = detail;
    else {
      code = detail.code || "";
      message = detail.message || raw;
    }
  } catch {
    /* Preserve a local or transport failure. */
  }
  return {
    code,
    message,
    conflict: /^HTTP 409:/.test(raw),
    unknown:
      !/^HTTP (400|401|403|404|409|422):/.test(raw) &&
      !["scopeChanged", "previewRequired", "reasonRequired"].includes(raw),
  };
}
