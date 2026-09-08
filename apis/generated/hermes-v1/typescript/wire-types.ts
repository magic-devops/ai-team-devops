export interface AgentDispatch {
  expected_version: number;
  idempotency_key: string;
  target_version: number;
  agent_id?: string;
  base_commit?: string;
  dry_run?: boolean;
  isolation?: "workspace" | "git_worktree";
  prompt?: string;
  squad_id?: string;
}

export interface Decision {
  decision: "approve" | "reject";
  expected_version: number;
  idempotency_key: string;
  dry_run?: boolean;
}

export interface Envelope {
  actions: Array<Record<string, unknown>>;
  agent_consumption: Record<string, unknown>;
  audit: Record<string, unknown>;
  cli: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  ok: boolean;
  permissions: Array<string>;
  scope: Record<string, unknown>;
  summary: Record<string, unknown>;
  trace_id: string;
}

export interface HTTPValidationError {
  detail?: Array<ValidationError>;
}

export interface Mutation {
  idempotency_key: string;
  data?: Record<string, unknown>;
  expected_version?: number | null;
}

export interface Node {
  id: string;
  agent_id?: string;
  argv?: Array<string>;
  expected_exit_code?: number;
  kind?: "command" | "approval" | "agent";
  prompt?: string;
  timeout_seconds?: number;
  title?: string;
}

export interface PairRedeem {
  device_id: string;
  secret: string;
}

export interface RemoteClaim {
  idempotency_key: string;
  worker_version?: string;
}

export interface RemoteHeartbeat {
  idempotency_key: string;
  owner: string;
  run_id: string;
}

export interface RemoteResult {
  idempotency_key: string;
  node_id: string;
  owner: string;
  run_id: string;
  result?: Record<string, unknown>;
}

export interface RunAction {
  expected_version: number;
  idempotency_key: string;
  dry_run?: boolean;
}

export interface ScheduleConfigure {
  idempotency_key: string;
  interval_seconds: number;
  nodes: Array<Node>;
  starts_at: string;
  title: string;
  dry_run?: boolean;
  enabled?: boolean;
  expected_version?: number | null;
  misfire_coalesce?: boolean;
}

export interface TaskDispatch {
  expected_version: number;
  idempotency_key: string;
  nodes: Array<Node>;
  base_commit?: string;
  dry_run?: boolean;
  isolation?: "workspace" | "git_worktree";
  target_device_id?: string;
}

export interface TaskReview {
  comment: string;
  decision: "accept" | "request_changes";
  expected_version: number;
  idempotency_key: string;
  run_id: string;
  run_version: number;
  dry_run?: boolean;
}

export interface ValidationError {
  loc: Array<string | number>;
  msg: string;
  type: string;
  ctx?: Record<string, unknown>;
  input?: unknown;
}
