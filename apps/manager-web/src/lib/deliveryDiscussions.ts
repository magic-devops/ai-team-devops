import { request } from "./http";
import { getSessionRevision, USER_KEY } from "./authStorage";
export type DiscussionKind = "requirement" | "task" | "issue";
export type DiscussionScope = { kind: DiscussionKind; id: string };
export type DiscussionState = "all" | "open" | "resolved" | "archived";
export type DiscussionActor = { id: string; name: string };
export type DiscussionReferenceSelection = {
  kind: DiscussionKind | "execution";
  id: string;
  field: "title" | "description" | "acceptance_criteria" | "summary";
  criterion_index?: number | null;
  source_content_basis: string;
};
export type DiscussionReference = Partial<
  Omit<
    DiscussionReferenceSelection,
    "kind" | "id" | "field" | "source_content_basis"
  >
> & {
  kind: DiscussionKind | "execution";
  id: string;
  status: "available" | "unavailable";
  field?: DiscussionReferenceSelection["field"] | null;
  source_content_basis?: string | null;
  text?: string | null;
  runtime?: {
    workspace_id: string;
    run_id: string;
    attempt: number;
    executor_id: string | null;
  } | null;
};
export type DiscussionResolution = {
  event_id: string;
  message_id: string;
  message_revision: number;
  note: string;
};
export type DiscussionSourceReference = {
  thread_id: string;
  expected_thread_version: number;
  resolution_event_id: string;
  message_id: string;
  message_revision: number;
};
export type DiscussionSubject = DiscussionScope & {
  missing: boolean;
  title: string | null;
  current_requirement_id: string | null;
};
export type DiscussionThread = {
  id: string;
  subject: DiscussionSubject;
  title: string;
  state: Exclude<DiscussionState, "all">;
  version: number;
  created_seq: number;
  created_by: DiscussionActor;
  created_at: string;
  last_activity_at: string;
  current_resolution: DiscussionResolution | null;
};
export type DiscussionMessage = {
  id: string;
  thread_id: string;
  parent_message_id: string | null;
  author: DiscussionActor;
  created_seq: number;
  created_at: string;
  revision: number;
  state: "active" | "withdrawn";
  body: string | null;
  reason: string | null;
  refs: DiscussionReference[];
  edited_at: string | null;
  can_edit: boolean;
  can_withdraw: boolean;
};
export type DiscussionMessageVersion = {
  revision: number;
  state: "active" | "withdrawn";
  body: string | null;
  reason: string | null;
  refs: DiscussionReference[];
  editor: DiscussionActor;
  created_at: string;
};
export type DiscussionWindow<T> = {
  project_id: string;
  discussion_stamp: string;
  as_of: string;
  items: T[];
  total: number;
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};
export type DiscussionPage = DiscussionWindow<DiscussionThread> & {
  scope: {
    subject_kind: DiscussionKind | null;
    subject_id: string | null;
    state: DiscussionState;
  };
};
export type DiscussionDetail = {
  project_id: string;
  discussion_stamp: string;
  as_of: string;
  thread: DiscussionThread;
  permissions: { write: boolean; configure: boolean };
  capabilities: {
    reply: boolean;
    resolve: boolean;
    reopen: boolean;
    archive: boolean;
    restore: boolean;
  };
};
export type DiscussionMessagePage = DiscussionWindow<DiscussionMessage> & {
  thread_id: string;
  thread_version: number;
};
export type DiscussionVersionPage = Omit<
  DiscussionWindow<DiscussionMessageVersion>,
  "discussion_stamp"
> & { thread_id: string; message_id: string; upper_revision: number };
export type DiscussionAck = {
  project_id: string;
  thread_id: string;
  thread_version: number;
  event_id: string;
  message_id: string | null;
  message_revision: number | null;
  link_id: string | null;
  replayed: boolean;
};
export type DiscussionSourceLink = {
  id: string;
  relation: "reference" | "adopted";
  source_kind: "discussion_resolution";
  source_id: string;
  thread_id: string;
  thread_version: number;
  resolution_event_id: string;
  message_id: string;
  message_revision: number;
  source_snapshot: {
    thread: {
      id: string;
      title: string;
      version: number;
      subject: DiscussionScope;
    };
    resolution: DiscussionResolution;
    message: {
      id: string;
      revision: number;
      body: string | null;
      author: DiscussionActor;
      refs: DiscussionReference[];
    };
  };
  source_digest: string;
  target_kind: DiscussionKind;
  target_id: string;
  target_missing: boolean;
  target_title: string | null;
  business_event_id: string | null;
  applied_by: DiscussionActor;
  applied_fields: string[];
  created_at: string;
  source_changed: boolean;
};
export type DiscussionLegacySource = {
  kind: "issue" | "diagnosis" | "plan";
  id: string | null;
  label: string;
  target: {
    project_id: string;
    view: string;
    detail: string;
    requirement_id?: string;
    task_id?: string;
    issue_id?: string;
  } | null;
  unavailable: boolean;
};
export type DiscussionSourcePage = DiscussionWindow<DiscussionSourceLink> & {
  legacy_sources: DiscussionLegacySource[];
};
export type DiscussionAdoption = {
  reference: DiscussionSourceReference;
  thread: DiscussionThread;
  message: DiscussionMessage;
  field: "description" | "acceptance_criteria";
};
export function discussionSource(
  thread: DiscussionThread,
  message: DiscussionMessage,
): DiscussionSourceReference {
  const resolution = thread.current_resolution;
  if (
    thread.state !== "resolved" ||
    !resolution ||
    resolution.message_id !== message.id ||
    resolution.message_revision !== message.revision ||
    message.state !== "active" ||
    message.thread_id !== thread.id ||
    thread.subject.missing
  )
    throw new Error("discussion_source_changed");
  return {
    thread_id: thread.id,
    expected_thread_version: thread.version,
    resolution_event_id: resolution.event_id,
    message_id: message.id,
    message_revision: message.revision,
  };
}
export function discussionFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const status = Number(raw.match(/^HTTP (\d{3}):/)?.[1] || 0);
  let code = "",
    message = raw;
  try {
    const detail = JSON.parse(raw.replace(/^HTTP \d+:\s*/, "")).detail;
    code = typeof detail === "object" ? detail.code || "" : "";
    message =
      typeof detail === "object" ? detail.message || raw : detail || raw;
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
    stale: code === "discussion_cursor_stale",
    unknown: !status || status >= 500,
  };
}
const id = (value: string) => {
  if (
    !value ||
    value !== value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error("discussion_scope_changed");
  return value;
};
const segment = (value: string) => encodeURIComponent(id(value));
async function read<T extends { project_id: string }>(
  projectId: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const value = await request<T>(`/api/v1/delivery${path}`, {
    headers: { "X-Project-Id": id(projectId) },
    signal,
  });
  if (value.project_id !== projectId)
    throw new Error("discussion_scope_changed");
  return value;
}
const windowParams = (cursor = "") => {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  return params;
};
export async function fetchDiscussionPage(
  projectId: string,
  scope: DiscussionScope | undefined,
  state: DiscussionState = "all",
  cursor = "",
  signal?: AbortSignal,
) {
  const params = windowParams(cursor);
  params.set("state", state);
  if (scope) {
    params.set("subject_kind", scope.kind);
    params.set("subject_id", id(scope.id));
  }
  const value = await read<DiscussionPage>(
    projectId,
    `/discussions?${params}`,
    signal,
  );
  if (
    value.scope.subject_kind !== (scope?.kind || null) ||
    value.scope.subject_id !== (scope?.id || null) ||
    value.scope.state !== state
  )
    throw new Error("discussion_scope_changed");
  return value;
}
export async function fetchDiscussion(
  projectId: string,
  threadId: string,
  signal?: AbortSignal,
) {
  const value = await read<DiscussionDetail>(
    projectId,
    `/discussions/${segment(threadId)}`,
    signal,
  );
  if (value.thread.id !== threadId) throw new Error("discussion_scope_changed");
  return value;
}
export async function fetchDiscussionMessages(
  projectId: string,
  threadId: string,
  cursor = "",
  signal?: AbortSignal,
) {
  const value = await read<DiscussionMessagePage>(
    projectId,
    `/discussions/${segment(threadId)}/messages?${windowParams(cursor)}`,
    signal,
  );
  if (value.thread_id !== threadId) throw new Error("discussion_scope_changed");
  return value;
}
export async function fetchDiscussionMessage(
  projectId: string,
  threadId: string,
  messageId: string,
  signal?: AbortSignal,
) {
  const value = await read<{
    project_id: string;
    thread_id: string;
    thread_version: number;
    message: DiscussionMessage;
  }>(
    projectId,
    `/discussions/${segment(threadId)}/messages/${segment(messageId)}`,
    signal,
  );
  if (
    value.thread_id !== threadId ||
    value.message.id !== messageId ||
    value.message.thread_id !== threadId
  )
    throw new Error("discussion_scope_changed");
  return value;
}
export async function fetchDiscussionVersions(
  projectId: string,
  threadId: string,
  messageId: string,
  cursor = "",
  signal?: AbortSignal,
) {
  const value = await read<DiscussionVersionPage>(
    projectId,
    `/discussions/${segment(threadId)}/messages/${segment(messageId)}/versions?${windowParams(cursor)}`,
    signal,
  );
  if (value.thread_id !== threadId || value.message_id !== messageId)
    throw new Error("discussion_scope_changed");
  return value;
}
export async function fetchDiscussionVersion(
  projectId: string,
  threadId: string,
  messageId: string,
  revision: number,
  signal?: AbortSignal,
) {
  const value = await read<{
    project_id: string;
    thread_id: string;
    message_id: string;
    version: DiscussionMessageVersion;
  }>(
    projectId,
    `/discussions/${segment(threadId)}/messages/${segment(messageId)}/versions/${revision}`,
    signal,
  );
  if (
    value.thread_id !== threadId ||
    value.message_id !== messageId ||
    value.version.revision !== revision
  )
    throw new Error("discussion_scope_changed");
  return value;
}
export function fetchDiscussionSources(
  projectId: string,
  target: DiscussionScope,
  cursor = "",
  signal?: AbortSignal,
) {
  const params = windowParams(cursor);
  params.set("target_kind", target.kind);
  params.set("target_id", id(target.id));
  return read<DiscussionSourcePage>(projectId, `/sources?${params}`, signal);
}
export function fetchDiscussionLinks(
  projectId: string,
  threadId: string,
  cursor = "",
  resolutionEventId = "",
  signal?: AbortSignal,
) {
  const params = windowParams(cursor);
  if (resolutionEventId) params.set("resolution_event_id", resolutionEventId);
  return read<DiscussionSourcePage>(
    projectId,
    `/discussions/${segment(threadId)}/links?${params}`,
    signal,
  );
}
export async function fetchDiscussionReference(
  projectId: string,
  selection: Omit<DiscussionReferenceSelection, "source_content_basis">,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ field: selection.field });
  if (selection.criterion_index != null)
    params.set("criterion_index", String(selection.criterion_index));
  const value = await read<{
    project_id: string;
    reference: DiscussionReference;
    target_content_basis: string | null;
  }>(
    projectId,
    `/discussion-references/${selection.kind}/${segment(selection.id)}?${params}`,
    signal,
  );
  if (
    value.reference.kind !== selection.kind ||
    value.reference.id !== selection.id ||
    (value.reference.status === "available" &&
      (value.reference.field !== selection.field ||
        (value.reference.criterion_index ?? null) !==
          (selection.criterion_index ?? null) ||
        !value.reference.source_content_basis ||
        !/^[a-f0-9]{64}$/.test(value.reference.source_content_basis)))
  )
    throw new Error("discussion_scope_changed");
  return value;
}
export type DiscussionOperation =
  | "create"
  | "reply"
  | "edit"
  | "withdraw"
  | "resolve"
  | "reopen"
  | "archive"
  | "restore"
  | "link";
export type DiscussionCommand = {
  operation: DiscussionOperation;
  threadId?: string;
  messageId?: string;
  body: Record<string, unknown>;
};
export type DiscussionPending = {
  signature: string;
  key: string;
  command: DiscussionCommand;
  draftRevision: number;
};
export function prepareDiscussionCommand(
  command: DiscussionCommand,
  draftRevision: number,
  previous?: DiscussionPending,
): DiscussionPending {
  const signature = JSON.stringify(command);
  return {
    signature,
    key: previous?.signature === signature ? previous.key : crypto.randomUUID(),
    command: structuredClone(command),
    draftRevision,
  };
}
export async function submitDiscussionCommand(
  projectId: string,
  pending: DiscussionPending,
) {
  const { operation, threadId, messageId, body } = pending.command;
  let path = "/discussions";
  if (operation !== "create") {
    path += `/${segment(threadId || "")}`;
    if (operation === "reply") path += "/messages";
    else if (operation === "edit" || operation === "withdraw") {
      path += `/messages/${segment(messageId || "")}`;
      if (operation === "withdraw") path += "/withdraw";
    } else path += `/${operation === "link" ? "links" : operation}`;
  }
  const ack = await request<DiscussionAck>(`/api/v1/delivery${path}`, {
    method: operation === "edit" ? "PATCH" : "POST",
    headers: { "X-Project-Id": id(projectId) },
    body: JSON.stringify({ ...body, idempotency_key: pending.key }),
  });
  if (
    ack.project_id !== projectId ||
    (threadId && ack.thread_id !== threadId) ||
    !ack.thread_id
  )
    throw new Error("discussion_scope_changed");
  return ack;
}
export type DiscussionDraft = {
  schema: 1;
  revision: number;
  title: string;
  body: string;
  refs: DiscussionReferenceSelection[];
  parent_message_id: string | null;
  pending?: DiscussionPending;
  unknown?: boolean;
  base_revision?: number;
};
export function discussionDraftKey(
  projectId: string,
  subject: DiscussionScope | undefined,
  threadId = "",
  messageId = "",
  mode = "new",
): string | null {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    const revision = getSessionRevision();
    if (!user?.id || !user?.tenant_id || !revision) return null;
    return `sop.discussion.draft:${JSON.stringify([user.tenant_id, user.id, revision, projectId, subject?.kind, subject?.id, threadId, messageId, mode])}`;
  } catch {
    return null;
  }
}
export function restoreDiscussionDraft(
  key: string | null,
): DiscussionDraft | null {
  if (!key) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value?.schema === 1 &&
      Number.isSafeInteger(value.revision) &&
      typeof value.body === "string" &&
      value.body.length <= 8000 &&
      typeof value.title === "string" &&
      value.title.length <= 160 &&
      Array.isArray(value.refs) &&
      value.refs.length <= 8
      ? value
      : null;
  } catch {
    return null;
  }
}
export function storeDiscussionDraft(
  key: string | null,
  draft: DiscussionDraft,
): boolean {
  if (!key) return false;
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export type DiscussionRoute = {
  thread: string;
  message: string;
  state: DiscussionState;
  cursor: string;
  page: number;
  messageCursor: string;
  messagePage: number;
};
export function parseDiscussionRoute(hash: string): DiscussionRoute {
  const params = new URLSearchParams(hash.split("?")[1]);
  const clean = (key: string, max = 2000) => {
    const value = params.get(key) || "";
    return value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
      ? value
      : "";
  };
  const page = (key: string) =>
    /^\d{1,6}$/.test(params.get(key) || "")
      ? Math.max(1, Number(params.get(key)))
      : 1;
  const state = clean("discussion_state");
  return {
    thread: clean("discussion_thread", 200),
    message: clean("discussion_message", 200),
    state: ["all", "open", "resolved", "archived"].includes(state)
      ? (state as DiscussionState)
      : "all",
    cursor: clean("discussion_cursor"),
    page: page("discussion_page"),
    messageCursor: clean("discussion_message_cursor"),
    messagePage: page("discussion_message_page"),
  };
}
export function discussionHash(hash: string, patch: Partial<DiscussionRoute>) {
  const params = new URLSearchParams(hash.split("?")[1]);
  const keys: Record<keyof DiscussionRoute, string> = {
    thread: "discussion_thread",
    message: "discussion_message",
    state: "discussion_state",
    cursor: "discussion_cursor",
    page: "discussion_page",
    messageCursor: "discussion_message_cursor",
    messagePage: "discussion_message_page",
  };
  if (patch.state && patch.state !== parseDiscussionRoute(hash).state) {
    params.delete(keys.cursor);
    params.delete(keys.page);
  }
  if (
    patch.thread !== undefined &&
    patch.thread !== parseDiscussionRoute(hash).thread
  ) {
    params.delete(keys.message);
    params.delete(keys.messageCursor);
    params.delete(keys.messagePage);
    params.delete("discussion_revision");
  }
  if (
    patch.message !== undefined &&
    patch.message !== parseDiscussionRoute(hash).message
  )
    params.delete("discussion_revision");
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(keys[key as keyof DiscussionRoute], String(value));
    else params.delete(keys[key as keyof DiscussionRoute]);
  }
  return `${hash.split("?")[0] || "#/dev-flow"}?${params}`;
}

export function clearSubmittedDiscussionDraft(
  draft: DiscussionDraft,
  pending: DiscussionPending,
): DiscussionDraft {
  if (draft.pending?.key !== pending.key) return draft;
  const clear =
    ["create", "reply", "edit"].includes(pending.command.operation) &&
    draft.revision === pending.draftRevision;
  return {
    ...draft,
    ...(clear
      ? { body: "", title: "", refs: [], parent_message_id: null }
      : {}),
    pending: undefined,
    unknown: false,
  };
}
