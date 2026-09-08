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

export interface RunAction {
  expected_version: number;
  idempotency_key: string;
  dry_run?: boolean;
}

export interface ValidationError {
  loc: Array<string | number>;
  msg: string;
  type: string;
  ctx?: Record<string, unknown>;
  input?: unknown;
}
