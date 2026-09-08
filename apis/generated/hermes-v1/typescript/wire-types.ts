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
  argv?: Array<string>;
  expected_exit_code?: number;
  kind?: "command" | "approval";
  timeout_seconds?: number;
  title?: string;
}

export interface RunAction {
  expected_version: number;
  idempotency_key: string;
  dry_run?: boolean;
}

export interface TaskDispatch {
  expected_version: number;
  idempotency_key: string;
  nodes: Array<Node>;
  dry_run?: boolean;
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
