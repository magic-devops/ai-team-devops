import { request } from "./http";
import { getSessionRevision, USER_KEY } from "./authStorage";
import { safeIssueOriginReturn } from "./issueOriginRoute";
export type EventState = "pending" | "processed" | "failed";
export type EventProducer = { kind: "user"; id: string };
export type EventFailure = {
  code: string;
  message: string;
  retryable: boolean;
};
export type EventEffect = {
  kind:
    | "fact_recorded"
    | "task_updated"
    | "task_delivery_submitted"
    | "issue_created"
    | "record_upserted"
    | "record_deleted"
    | "asset_materialized";
  target_kind: "task" | "issue" | "requirement" | "sprint" | "asset" | "task_submission" | null;
  target_id: string | null;
};
export type EventProcessing = {
  state: EventState;
  revision: number;
  handler: string | null;
  operation_id: string | null;
  attempts: number;
  updated_at: string;
  processed_at: string | null;
  reason_code: string | null;
  retryable: boolean;
  result: EventEffect | null;
};
export type EventSummary = {
  id: string;
  event_id: string;
  digest: string;
  type: string;
  subject: string;
  source: string;
  producer: EventProducer;
  stored_at: string;
  processing: EventProcessing;
};
export type EventPermissions = { read: boolean; configure: boolean };
export type EventPageBase = {
  project_id: string;
  as_of: string;
  total: number;
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};
export type EventReceiptPage = EventPageBase & {
  items: EventSummary[];
  permissions: EventPermissions;
};
export type EventAttempt = {
  id: string;
  seq: number;
  actor: EventProducer;
  action: "initial" | "retry" | "recover";
  created_at: string;
  from_state: EventState;
  to_state: EventState;
  error: EventFailure | null;
  result: EventEffect | null;
};
export type EventAttemptPage = EventPageBase & {
  receipt_id: string;
  items: EventAttempt[];
};
export type EventReceiptDetail = {
  project_id: string;
  as_of: string;
  event: EventSummary;
  event_json: string;
  attempts: EventAttemptPage;
  permissions: EventPermissions;
  capabilities: { retry: boolean; retry_reason_code: string | null };
};
export type EventRetryAck = {
  project_id: string;
  receipt_id: string;
  event_id: string;
  digest: string;
  processing: EventProcessing;
  attempt_id: string;
  replayed: boolean;
};
export type EventQuery = {
  state?: "all" | EventState;
  type?: string;
  producer?: string;
  cursor?: string;
};
const id = (value: string) => {
  if (
    !value ||
    value !== value.trim() ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("event_scope_changed");
  return value;
};
async function read<T extends { project_id: string }>(
  projectId: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const result = await request<T>("/api/v1/events" + path, {
    headers: { "X-Project-Id": id(projectId) },
    signal,
  });
  if (result.project_id !== projectId) throw new Error("event_scope_changed");
  return result;
}
export function fetchEventPage(
  projectId: string,
  query: EventQuery = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ state: query.state || "all" });
  if (query.type) params.set("type", query.type);
  if (query.producer) params.set("producer_id", query.producer);
  params.set("limit", "20");
  if (query.cursor) params.set("cursor", query.cursor);
  return read<EventReceiptPage>(projectId, "?" + params, signal);
}
export async function fetchEventReceipt(
  projectId: string,
  receiptId: string,
  signal?: AbortSignal,
) {
  const value = await read<EventReceiptDetail>(
    projectId,
    "/" + encodeURIComponent(id(receiptId)),
    signal,
  );
  if (value.event.id !== receiptId) throw new Error("event_scope_changed");
  if (
    value.attempts &&
    (value.attempts.project_id !== projectId ||
      value.attempts.receipt_id !== receiptId)
  )
    throw new Error("event_scope_changed");
  return value;
}
export async function fetchEventAttempts(
  projectId: string,
  receiptId: string,
  cursor = "",
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  const value = await read<EventAttemptPage>(
    projectId,
    "/" + encodeURIComponent(id(receiptId)) + "/attempts?" + params,
    signal,
  );
  if (value.receipt_id !== receiptId) throw new Error("event_scope_changed");
  return value;
}
export type EventRetryCommand = {
  receiptId: string;
  eventId: string;
  digest: string;
  key: string;
  signature: string;
  body: { expected_revision: number; reason: string };
};
export function prepareEventRetry(
  event: Pick<EventSummary, "id" | "event_id" | "digest" | "processing">,
  reason: string,
  previous?: EventRetryCommand,
): EventRetryCommand {
  const body = {
    expected_revision: event.processing.revision,
    reason: reason.trim(),
  };
  if (
    !body.reason ||
    body.reason.length > 2000 ||
    !Number.isSafeInteger(body.expected_revision) ||
    body.expected_revision < 1
  )
    throw new Error("event_retry_invalid");
  const signature = JSON.stringify([
    event.id,
    event.event_id,
    event.digest,
    body,
  ]);
  return {
    receiptId: event.id,
    eventId: event.event_id,
    digest: event.digest,
    key: previous?.signature === signature ? previous.key : crypto.randomUUID(),
    signature,
    body,
  };
}
export async function retryEventReceipt(
  projectId: string,
  command: EventRetryCommand,
) {
  const ack = await request<EventRetryAck>(
    "/api/v1/events/" + encodeURIComponent(id(command.receiptId)) + ":retry",
    {
      method: "POST",
      headers: { "X-Project-Id": id(projectId) },
      body: JSON.stringify({ ...command.body, idempotency_key: command.key }),
    },
  );
  if (
    ack.project_id !== projectId ||
    ack.receipt_id !== command.receiptId ||
    ack.event_id !== command.eventId ||
    ack.digest !== command.digest
  )
    throw new Error("event_scope_changed");
  return ack;
}
export function eventProblem(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const status = Number(raw.match(/^HTTP (\d{3}):/)?.[1] || 0);
  let code = "",
    message = raw;
  try {
    const detail = JSON.parse(raw.replace(/^HTTP \d+:\s*/, "")).detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      code = detail.code || "";
      message = detail.message || raw;
    } else if (typeof detail === "string") message = detail;
  } catch {
    /* Keep transport failures readable. */
  }
  return {
    status,
    code,
    message,
    conflict: status === 409,
    forbidden: status === 403,
    missing: status === 404,
    cursor: code === "event_cursor_stale" || code === "event_cursor_invalid",
    unknown: !status || status >= 500,
  };
}
export type EventRoute = {
  state: "all" | EventState;
  type: string;
  producer: string;
  cursor: string;
  page: number;
  receipt: string;
  attemptCursor: string;
  attemptPage: number;
};
const routeKeys: Record<keyof EventRoute, string> = {
  state: "event_state",
  type: "event_type",
  producer: "event_producer",
  cursor: "event_cursor",
  page: "event_page",
  receipt: "event_receipt",
  attemptCursor: "event_attempt_cursor",
  attemptPage: "event_attempt_page",
};
export const currentEventHash = () =>
  typeof location === "undefined" ? "" : location.hash;
export function parseEventRoute(hash: string): EventRoute {
  const params = new URLSearchParams(hash.split("?")[1]);
  const clean = (key: string, max = 4096) => {
    const value = params.get(key) || "";
    return value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
      ? value
      : "";
  };
  const page = (key: string) =>
    /^\d{1,6}$/.test(params.get(key) || "")
      ? Math.max(1, Number(params.get(key)))
      : 1;
  const state = clean(routeKeys.state);
  return {
    state: ["all", "pending", "processed", "failed"].includes(state)
      ? (state as EventRoute["state"])
      : "all",
    type: clean(routeKeys.type, 160),
    producer: clean(routeKeys.producer, 128),
    cursor: clean(routeKeys.cursor),
    page: page(routeKeys.page),
    receipt: clean(routeKeys.receipt, 128),
    attemptCursor: clean(routeKeys.attemptCursor),
    attemptPage: page(routeKeys.attemptPage),
  };
}
export function eventHash(
  projectId: string,
  patch: Partial<EventRoute>,
  source = currentEventHash(),
) {
  const sourceParams = new URLSearchParams(source.split("?")[1]);
  const params = new URLSearchParams({ project_id: projectId });
  const issueReturn = safeIssueOriginReturn(
    sourceParams.get("issue_return") || "",
    projectId,
  );
  if (issueReturn) params.set("issue_return", issueReturn);
  for (const key of Object.values(routeKeys)) {
    const value = sourceParams.get(key);
    if (value) params.set(key, value);
  }
  const before = parseEventRoute(source);
  if (
    (["state", "type", "producer"] as const).some(
      (key) => patch[key] !== undefined && patch[key] !== before[key],
    )
  ) {
    params.delete(routeKeys.cursor);
    params.delete(routeKeys.page);
  }
  if (patch.receipt !== undefined && patch.receipt !== before.receipt) {
    params.delete(routeKeys.attemptCursor);
    params.delete(routeKeys.attemptPage);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value && !(key === "state" && value === "all"))
      params.set(routeKeys[key as keyof EventRoute], String(value));
    else params.delete(routeKeys[key as keyof EventRoute]);
  }
  return "#/intelligence/events?" + params;
}
export function safeEventReturn(
  hash: string,
  projectId: string,
): string | null {
  if (
    !projectId ||
    hash.length > 12000 ||
    !/^#\/intelligence\/events(?:\?|$)/.test(hash) ||
    /[\u0000-\u001f\u007f\\]/.test(hash)
  )
    return null;
  const params = new URLSearchParams(hash.split("?")[1]);
  if (
    params.getAll("project_id").length !== 1 ||
    params.get("project_id") !== projectId
  )
    return null;
  const allowed = new Set([
    "project_id",
    "issue_return",
    ...Object.values(routeKeys),
  ]);
  for (const [key, value] of params) {
    if (
      !allowed.has(key) ||
      (key === "issue_return" && !safeIssueOriginReturn(value, projectId)) ||
      params.getAll(key).length !== 1 ||
      value.length > 4096 ||
      /[\u0000-\u001f\u007f\\]/.test(value)
    )
      return null;
  }
  return hash;
}
export type EventRetryDraft = {
  schema: 1;
  reason: string;
  conflict?: boolean;
  basis?: { eventId: string; digest: string; revision: number };
  pending?: EventRetryCommand;
  unknown?: boolean;
};
export function eventRetryDraftKey(
  projectId: string,
  receiptId: string,
): string | null {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || "null"),
      revision = getSessionRevision();
    if (!user?.id || !user?.tenant_id || !revision) return null;
    return (
      "sop.event-retry.v1:" +
      JSON.stringify([user.tenant_id, user.id, revision, projectId, receiptId])
    );
  } catch {
    return null;
  }
}
export function restoreEventRetryDraft(
  key: string | null,
  receiptId: string,
): EventRetryDraft | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 16000) return null;
    const value = JSON.parse(raw);
    if (
      value?.schema !== 1 ||
      typeof value.reason !== "string" ||
      value.reason.length > 2000
    )
      return null;
    if (
      value.basis &&
      (!Number.isSafeInteger(value.basis.revision) ||
        value.basis.revision < 1 ||
        typeof value.basis.eventId !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.basis.digest))
    )
      return null;
    if (value.pending) {
      const pending = value.pending;
      if (
        pending.receiptId !== receiptId ||
        typeof pending.eventId !== "string" ||
        typeof pending.key !== "string" ||
        pending.key.length > 128 ||
        !/^[a-f0-9]{64}$/.test(pending.digest) ||
        !Number.isSafeInteger(pending.body?.expected_revision) ||
        pending.body.expected_revision < 1 ||
        typeof pending.body.reason !== "string" ||
        !pending.body.reason.trim() ||
        pending.body.reason.length > 2000
      )
        return null;
    }
    return value;
  } catch {
    return null;
  }
}
export function storeEventRetryDraft(
  key: string | null,
  draft: EventRetryDraft,
) {
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* A full or unavailable storage leaves the current in-memory draft intact. */
  }
}
