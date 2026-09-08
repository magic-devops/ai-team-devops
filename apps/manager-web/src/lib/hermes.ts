export const DEFAULT_HERMES_BASE_URL = "http://127.0.0.1:8787";

export type HermesResource =
  | "sessions"
  | "runs"
  | "assets"
  | "tasks"
  | "requirements";

export type HermesMutableResource = HermesResource | "workspaces";
export type HermesDeletableResource = "assets";

export type HermesEntity<TData extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  kind: string;
  version: number;
  status: string;
  data: TData;
  created_at: string;
  updated_at: string;
};

export type HermesScope = {
  workspace_id?: string;
  base?: string;
  resource?: string;
};

export type HermesAudit = {
  actor?: string;
  action?: string;
  at?: string;
  [key: string]: unknown;
};

export type HermesApiResponse<TItem = HermesEntity> = {
  ok: boolean;
  scope?: HermesScope;
  summary?: Record<string, unknown>;
  items: TItem[];
  actions?: Array<Record<string, unknown>>;
  permissions?: string[];
  audit?: HermesAudit;
  agent_consumption?: Record<string, unknown>;
  cli?: Record<string, unknown>;
  trace_id?: string;
  error?: { code?: string; message?: string; detail?: unknown } | string;
};

export type HermesQuery = {
  q?: string;
  status?: string;
  kind?: string;
  limit?: number;
  cursor?: string;
  after?: number;
};

export type HermesRunNode = {
  id: string;
  title: string;
  kind: "command" | "approval";
  argv: string[];
  expected_exit_code: number;
  timeout_seconds: number;
};

export type HermesRunData = {
  title: string;
  session_id?: string;
  workspace_root?: string;
  nodes: HermesRunNode[];
  [key: string]: unknown;
};

export type HermesConnection = {
  baseUrl: string;
  token: string;
  workspaceId?: string;
};

export type HermesPostBody<TData extends Record<string, unknown>> = {
  data: TData;
  idempotency_key: string;
};

export type HermesPatchBody<TData extends Record<string, unknown>> = HermesPostBody<TData> & {
  expected_version: number;
};

export type HermesRunActionBody = {
  idempotency_key: string;
  expected_version: number;
  dry_run: boolean;
};

export type HermesDelivery = {
  id: string;
  task: HermesEntity;
  run?: HermesEntity;
  plan?: HermesRunData;
  phase?: string;
  review?: { decision: string; comment: string; actor: string; evidence_sha256: string; trace_id: string };
  acceptance_criteria?: string;
};

export type HermesApprovalDecisionBody = {
  decision: "approve" | "reject";
  idempotency_key: string;
  expected_version: number;
};

export class HermesUnavailableError extends Error {
  status?: number;
  traceId?: string;

  constructor(message: string, options: { status?: number; traceId?: string } = {}) {
    super(message);
    this.name = "HermesUnavailableError";
    this.status = options.status;
    this.traceId = options.traceId;
  }
}

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl || DEFAULT_HERMES_BASE_URL).replace(/\/+$/, "");
}

function queryString(query: HermesQuery = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function normalizeResponse<T>(body: unknown): HermesApiResponse<T> {
  const record = body && typeof body === "object" ? (body as Partial<HermesApiResponse<T>>) : {};
  return {
    ok: Boolean(record.ok),
    scope: record.scope,
    summary: record.summary,
    items: Array.isArray(record.items) ? record.items : [],
    actions: Array.isArray(record.actions) ? record.actions : [],
    permissions: Array.isArray(record.permissions) ? record.permissions.map(String) : [],
    audit: record.audit && !Array.isArray(record.audit) ? record.audit : {},
    agent_consumption: record.agent_consumption,
    cli: record.cli,
    trace_id: record.trace_id,
    error: record.error,
  };
}

function errorMessage(body: HermesApiResponse<unknown> | string, fallback: string) {
  if (typeof body === "string") return body || fallback;
  if (typeof body.error === "string") return body.error;
  if (body.error?.message) return body.error.message;
  return fallback;
}

export class HermesClient {
  private connection: HermesConnection;

  constructor(connection: HermesConnection) {
    this.connection = { ...connection, baseUrl: normalizeBaseUrl(connection.baseUrl) };
  }

  taskDelivery(taskId: string) {
    return this.request<HermesDelivery>(`/tasks/${encodeURIComponent(taskId)}/delivery`);
  }

  repository() {
    return this.request<{ id: string; root: string; head_commit: string; branch: string; dirty: boolean }>(`/workspaces/${encodeURIComponent(this.connection.workspaceId || "")}/repository`);
  }

  runChanges(runId: string) {
    return this.request(`/runs/${encodeURIComponent(runId)}/changes`);
  }

  taskDispatch(taskId: string, body: HermesRunActionBody & { nodes: HermesRunNode[]; isolation?: "workspace" | "git_worktree"; base_commit?: string }) {
    return this.request<HermesDelivery>(`/tasks/${encodeURIComponent(taskId)}/dispatch`, { method: "POST", body: JSON.stringify(body) });
  }

  taskReview(taskId: string, body: HermesRunActionBody & { run_id: string; run_version: number; decision: "accept" | "request_changes"; comment: string }) {
    return this.request<HermesDelivery>(`/tasks/${encodeURIComponent(taskId)}/review`, { method: "POST", body: JSON.stringify(body) });
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.connection.token) headers.Authorization = `Bearer ${this.connection.token}`;
    if (this.connection.workspaceId) headers["X-Workspace-Id"] = this.connection.workspaceId;
    return headers;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<HermesApiResponse<T>> {
    if (!this.connection.baseUrl || !this.connection.token && path !== "/health") {
      throw new HermesUnavailableError("Hermes core is not connected. Configure a base URL and Bearer token.");
    }
    let base: URL;
    try {
      base = new URL(this.connection.baseUrl);
    } catch {
      throw new HermesUnavailableError("Invalid Hermes endpoint URL.");
    }
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
      (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) {
      throw new HermesUnavailableError("Remote connections require HTTPS. Only loopback HTTP is allowed.");
    }
    const endpoint = this.connection.baseUrl.replace(/\/api\/hermes\/v1$/, "");
    let response: Response;
    try {
      response = await fetch(`${endpoint}/api/hermes/v1${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { ...this.headers(), ...(init.headers || {}) },
      });
    } catch (error) {
      throw new HermesUnavailableError(error instanceof Error ? error.message : "Hermes core is unavailable.");
    }
    const text = await response.text();
    const body = text
      ? (() => {
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return text;
          }
        })()
      : {};
    const parsed = normalizeResponse<T>(body);
    const isRuntimeProbe = path === "/system/readiness" || path === "/system/diagnostics";
    if (response.ok && isRuntimeProbe &&
      (!body || typeof body !== "object" || !("ok" in body) || typeof body.ok !== "boolean" ||
        !("items" in body) || !Array.isArray(body.items))) {
      throw new HermesUnavailableError("Invalid Hermes runtime diagnostics response.", { status: response.status });
    }
    if (!response.ok || !parsed.ok && !isRuntimeProbe) {
      throw new HermesUnavailableError(errorMessage(typeof body === "string" ? body : parsed, response.statusText), {
        status: response.status,
        traceId: parsed.trace_id,
      });
    }
    return parsed;
  }

  health() {
    return this.request("/health");
  }

  actions() {
    return this.request("/actions");
  }

  readiness() {
    return this.request("/system/readiness");
  }

  diagnostics() {
    return this.request<{ id: string; status: string; detail: string }>("/system/diagnostics");
  }

  sync(after = 0) {
    return this.request(`/sync${queryString({ after })}`);
  }

  workspaces(query: HermesQuery = {}) {
    return this.request<HermesEntity<{ name?: string; root?: string }>>(`/workspaces${queryString(query)}`);
  }

  createWorkspace(body: HermesPostBody<{ name: string; root: string }>) {
    return this.request<HermesEntity<{ name?: string; root?: string }>>("/workspaces", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  list(resource: HermesResource, query: HermesQuery = {}) {
    return this.request<HermesEntity>(`/${resource}${queryString(query)}`);
  }

  get(resource: HermesMutableResource, id: string) {
    return this.request<HermesEntity>(`/${resource}/${encodeURIComponent(id)}`);
  }

  create<TData extends Record<string, unknown>>(resource: HermesMutableResource, body: HermesPostBody<TData>) {
    return this.request<HermesEntity<TData>>(`/${resource}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  patch<TData extends Record<string, unknown>>(resource: HermesMutableResource, id: string, body: HermesPatchBody<TData>) {
    return this.request<HermesEntity<TData>>(`/${resource}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  delete(resource: HermesDeletableResource, id: string) {
    return this.request(`/${resource}/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  runEvents(id: string, after = 0) {
    return this.request(`/runs/${encodeURIComponent(id)}/events${queryString({ after })}`);
  }

  runAction(id: string, action: "start" | "cancel" | "retry" | "replay" | "export", body: HermesRunActionBody) {
    return this.request(`/runs/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  approvals(query: HermesQuery = {}) {
    return this.request<HermesEntity>(`/approvals${queryString(query)}`);
  }

  approvalDecision(id: string, body: HermesApprovalDecisionBody) {
    return this.request(`/approvals/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

export function createHermesClient(connection: HermesConnection) {
  return new HermesClient(connection);
}
