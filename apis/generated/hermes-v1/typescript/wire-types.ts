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
  target_device_id?: string;
}

export interface ChannelConfigure {
  idempotency_key: string;
  members: Array<string>;
  title: string;
  archived?: boolean;
  description?: string;
  dry_run?: boolean;
  expected_version?: number | null;
}

export interface CollaborationAction {
  idempotency_key: string;
  dry_run?: boolean;
  expected_version?: number | null;
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

export interface MarkRead {
  channel_id: string;
  cursor: number;
  idempotency_key: string;
  dry_run?: boolean;
  expected_version?: number | null;
  thread_id?: string;
}

export interface MessageEdit {
  body: string;
  idempotency_key: string;
  dry_run?: boolean;
  expected_version?: number | null;
  mentions?: Array<string>;
}

export interface MessageSend {
  body: string;
  channel_id: string;
  idempotency_key: string;
  thread_id: string;
  dry_run?: boolean;
  expected_version?: number | null;
  mentions?: Array<string>;
  parent_id?: string;
  recipients?: Array<string>;
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
  runtime_capabilities?: Array<string>;
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
  nodes: Array<Node>;
  title: string;
  trigger: ScheduleTrigger;
  dry_run?: boolean;
  enabled?: boolean;
  expected_version?: number | null;
  misfire_coalesce?: boolean;
}

export interface ScheduleTrigger {
  cron_expression?: string;
  interval_seconds?: number | null;
  max_body_bytes?: number;
  secret_ref?: string;
  starts_at?: string | null;
  timezone?: string;
  type?: "interval" | "cron" | "webhook";
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

export interface ThreadCreate {
  channel_id: string;
  idempotency_key: string;
  title: string;
  body?: string;
  dry_run?: boolean;
  expected_version?: number | null;
  mentions?: Array<string>;
  recipients?: Array<string>;
}

export interface ValidationError {
  loc: Array<string | number>;
  msg: string;
  type: string;
  ctx?: Record<string, unknown>;
  input?: unknown;
}
