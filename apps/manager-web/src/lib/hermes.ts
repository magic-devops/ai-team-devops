export const DEFAULT_HERMES_BASE_URL = "http://127.0.0.1:8787";

export type HermesResource =
  | "sessions"
  | "runs"
  | "assets"
  | "tasks"
  | "requirements";

export type HermesMutableResource = HermesResource | "workspaces";
export type HermesDeletableResource = "assets";
export type HermesAutomationResource = "devices" | "schedules";
export type HermesAutomationMutableResource = "devices" | "agents" | "squads";
export type HermesAutomationPatchResource = "agents" | "squads";

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

export type HermesScheduleNode =
  | HermesRunNode
  | {
      id: string;
      title: string;
      kind: "agent";
      agent_id: string;
      prompt: string;
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

export type HermesAgentProvider = "codex" | "claude" | "opencode";

export type HermesAgentProfileData = {
  title: string;
  provider: HermesAgentProvider;
  model: string;
  instructions: string;
  timeout_seconds: number;
  [key: string]: unknown;
};

export type HermesAgentCatalogTemplate = {
  id: string;
  provider: HermesAgentProvider;
  available: boolean;
  executable: boolean;
  auth: "provider-managed";
  [key: string]: unknown;
};

export type HermesSquadMember = {
  agent_id: string;
  role: "leader" | "implementer" | "reviewer";
  instructions: string;
};

export type HermesSquadData = {
  title: string;
  members: HermesSquadMember[];
  [key: string]: unknown;
};

export type HermesTaskAgentDispatchBody = {
  expected_version: number;
  target_version: number;
  idempotency_key: string;
  dry_run: boolean;
  agent_id?: string;
  squad_id?: string;
  target_device_id?: string;
  prompt: string;
  isolation: "workspace" | "git_worktree";
  base_commit: string;
};

export type HermesScheduleTrigger =
  | { type: "interval"; interval_seconds: number; starts_at: string }
  | { type: "cron"; cron_expression: string; timezone: string; starts_at?: string }
  | { type: "webhook"; secret_ref: string; max_body_bytes: number };

export type HermesScheduleConfigureBody = {
  title: string;
  trigger: HermesScheduleTrigger;
  nodes: HermesScheduleNode[];
  enabled: boolean;
  misfire_coalesce: boolean;
  idempotency_key: string;
  expected_version?: number;
  dry_run: boolean;
};

export type HermesCollaborationAction = {
  idempotency_key: string;
  expected_version?: number;
  dry_run: boolean;
};

export type HermesChannelConfigure = HermesCollaborationAction & {
  title: string;
  members: string[];
  description: string;
  archived: boolean;
};

export type HermesThreadCreate = HermesCollaborationAction & {
  channel_id: string;
  title: string;
  body: string;
  mentions: string[];
};

export type HermesMessageSend = HermesCollaborationAction & {
  channel_id: string;
  thread_id: string;
  parent_id?: string;
  body: string;
  mentions: string[];
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

  taskDispatch(taskId: string, body: HermesRunActionBody & { nodes: HermesRunNode[]; isolation?: "workspace" | "git_worktree"; base_commit?: string; target_device_id?: string }) {
    return this.request<HermesDelivery>(`/tasks/${encodeURIComponent(taskId)}/dispatch`, { method: "POST", body: JSON.stringify(body) });
  }

  taskAgentDispatch(taskId: string, body: HermesTaskAgentDispatchBody) {
    return this.request<HermesDelivery>(`/tasks/${encodeURIComponent(taskId)}/agent-dispatch`, { method: "POST", body: JSON.stringify(body) });
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

  listAutomationResource(resource: HermesAutomationResource, query: HermesQuery = {}) {
    return this.request<HermesEntity>(`/${resource}${queryString(query)}`);
  }

  getAutomationResource(resource: HermesAutomationResource, id: string) {
    return this.request<HermesEntity>(`/${resource}/${encodeURIComponent(id)}`);
  }

  createAutomationResource<TData extends Record<string, unknown>>(resource: HermesAutomationMutableResource, body: HermesPostBody<TData>) {
    return this.request<HermesEntity<TData>>(`/${resource}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  patchAutomationResource<TData extends Record<string, unknown>>(resource: HermesAutomationPatchResource, id: string, body: HermesPatchBody<TData>) {
    return this.request<HermesEntity<TData>>(`/${resource}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  deviceRevoke(id: string, body: HermesRunActionBody) {
    return this.request(`/devices/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  devicePairing(id: string, body: HermesRunActionBody) {
    return this.request<{ device_id: string; pairing_secret?: string; workspace_id?: string }>(`/devices/${encodeURIComponent(id)}/pairing`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  scheduleConfigure(id: string, body: HermesScheduleConfigureBody) {
    return this.request<HermesEntity>(`/schedules/${encodeURIComponent(id)}/configure`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  schedulePreview(body: HermesScheduleConfigureBody, runs = 5) {
    return this.request<HermesEntity>(`/schedules/preview?runs=${runs}`, { method: "POST", body: JSON.stringify({ ...body, dry_run: true }) });
  }

  scheduleWebhookTest(id: string, body: HermesRunActionBody) {
    return this.request<HermesEntity>(`/schedules/${encodeURIComponent(id)}/webhook-test`, { method: "POST", body: JSON.stringify(body) });
  }

  scheduleAction(id: string, action: "trigger" | "pause" | "resume", body: HermesRunActionBody) {
    return this.request(`/schedules/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  scheduleHistory(id: string) {
    return this.request<HermesEntity>(`/schedules/${encodeURIComponent(id)}/history`);
  }

  agents(query: HermesQuery = {}) {
    return this.request<HermesEntity<HermesAgentProfileData>>(`/agents${queryString(query)}`);
  }

  collaborationChannels(includeArchived = false) {
    return this.request<HermesEntity>(`/collaboration/channels?include_archived=${includeArchived}`);
  }

  collaborationMembers() {
    return this.request<{ id: string }>("/collaboration/members");
  }

  collaborationConfigureChannel(id: string, body: HermesChannelConfigure) {
    return this.request<HermesEntity>(`/collaboration/channels/${encodeURIComponent(id)}/configure`, { method: "POST", body: JSON.stringify(body) });
  }

  collaborationThreads(channelId: string, query: HermesQuery & { include_archived?: boolean } = {}) {
    return this.request<HermesEntity>(`/collaboration/channels/${encodeURIComponent(channelId)}/threads${queryString(query)}`);
  }

  collaborationCreateThread(body: HermesThreadCreate) {
    return this.request<HermesEntity>("/collaboration/threads", { method: "POST", body: JSON.stringify(body) });
  }

  collaborationMessages(threadId: string, after = 0) {
    return this.request<HermesEntity>(`/collaboration/threads/${encodeURIComponent(threadId)}/messages${queryString({ after, limit: 100 })}`);
  }

  collaborationSendMessage(body: HermesMessageSend) {
    return this.request<HermesEntity>("/collaboration/messages", { method: "POST", body: JSON.stringify(body) });
  }

  collaborationEditMessage(id: string, body: HermesCollaborationAction & { body: string; mentions: string[] }) {
    return this.request<HermesEntity>(`/collaboration/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  }

  collaborationArchive(kind: "threads" | "messages", id: string, body: HermesCollaborationAction) {
    return this.request<HermesEntity>(`/collaboration/${kind}/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify(body) });
  }

  collaborationInbox() {
    return this.request<HermesEntity>("/collaboration/inbox?limit=100");
  }

  collaborationMarkRead(body: HermesCollaborationAction & { channel_id: string; thread_id?: string; cursor: number }) {
    return this.request<HermesEntity>("/collaboration/read", { method: "POST", body: JSON.stringify(body) });
  }

  agentCatalog() {
    return this.request<HermesAgentCatalogTemplate>("/agents/catalog");
  }

  squads(query: HermesQuery = {}) {
    return this.request<HermesEntity<HermesSquadData>>(`/squads${queryString(query)}`);
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
