import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSessionRevision, getWorkspaceScope } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { request } from "./http";
import type { DeliveryCommandAck } from "./delivery";
import type { ExecutionControlAction } from "./executionRuntime";

export const controlOperationStates = ["accepted", "applying", "retry_wait", "blocked", "awaiting_executor", "applied", "closed"] as const;
export type ControlOperation = {
  id: string; execution_id: string; task_id: string; workspace_id: string;
  action: ExecutionControlAction | "execution.control.close"; request_digest: string;
  state: typeof controlOperationStates[number]; revision: number; attempt: number;
  accepted_at: string; updated_at: string; next_attempt_at: string | null;
  error: { code: string; message: string } | null; run_id: string | null; run_attempt: number | null;
  outcome: "applied" | "closed" | "needs_review" | null;
  launch: { id: string; state: "ready" | "claimed" | "revoked"; claimed_at: string | null } | null;
  target_operation_id: string | null; permissions: { can_close: boolean };
};
export type ControlOperationPage = { project_id: string; execution_id: string; task_id: string; version: number; items: ControlOperation[]; total: number; limit: number; next_cursor: string | null; as_of: string };
export type ControlOperationDetail = { project_id: string; execution_id: string; task_id: string; version: number; operation: ControlOperation };
export type ControlAcceptance = { control_operation_id: string; request_digest: string };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = (value: unknown): value is string => typeof value === "string" && Boolean(value) && value.length <= 100 && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value);
const integer = (value: unknown, minimum = 0) => Number.isSafeInteger(value) && Number(value) >= minimum;
const time = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const cursorValid = (value: unknown): value is string => typeof value === "string" && value.length <= 4000 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
const actions = ["execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close"];
export function controlOperationPending(state: ControlOperation["state"]) { return !["applied", "closed"].includes(state); }
export function validControlAcceptance(value: unknown): value is ControlAcceptance {
  return record(value) && Object.keys(value).length === 2 && id(value.control_operation_id) && typeof value.request_digest === "string" && /^[a-f0-9]{64}$/.test(value.request_digest);
}
export function validControlOperation(value: unknown, executionId: string, taskId: string, workspaceId: string): value is ControlOperation {
  if (!record(value) || !id(value.id) || value.execution_id !== executionId || value.task_id !== taskId || value.workspace_id !== workspaceId ||
    !actions.includes(String(value.action)) || typeof value.request_digest !== "string" || !/^[a-f0-9]{64}$/.test(value.request_digest) ||
    !controlOperationStates.includes(value.state as ControlOperation["state"]) || !integer(value.revision, 1) || !integer(value.attempt) ||
    !time(value.accepted_at) || !time(value.updated_at) || !(value.next_attempt_at === null || time(value.next_attempt_at)) ||
    !(value.run_id === null || id(value.run_id)) || !(value.run_attempt === null || integer(value.run_attempt, 1)) ||
    !(value.outcome === null || typeof value.outcome === "string" && ["applied", "closed", "needs_review"].includes(value.outcome)) ||
    !(value.target_operation_id === null || id(value.target_operation_id)) || !record(value.permissions) || typeof value.permissions.can_close !== "boolean") return false;
  if (value.action === "execution.control.close" ? !id(value.target_operation_id) || value.target_operation_id === value.id || value.permissions.can_close : value.target_operation_id !== null) return false;
  if (value.permissions.can_close && !["accepted", "applying", "retry_wait", "blocked"].includes(String(value.state))) return false;
  if (!(value.error === null || record(value.error) && typeof value.error.code === "string" && Boolean(value.error.code) && value.error.code.length <= 100 &&
    !/[\u0000-\u001f\u007f]/.test(value.error.code) && typeof value.error.message === "string" && Boolean(value.error.message) && value.error.message.length <= 1000 && !value.error.message.includes("\0"))) return false;
  return value.launch === null || record(value.launch) && Object.keys(value.launch).length === 3 && id(value.launch.id) && id(value.run_id) && integer(value.run_attempt, 1) &&
    ["ready", "claimed", "revoked"].includes(String(value.launch.state)) && (value.launch.claimed_at === null || time(value.launch.claimed_at));
}
const inScope = (origin: string) => { if (origin !== projectSessionKey()) throw new Error("controlOperationScopeChanged"); };
export async function readControlOperations(projectId: string, executionId: string, taskId: string, workspaceId: string, origin: string, cursor = "", signal?: AbortSignal): Promise<ControlOperationPage> {
  inScope(origin); if (![projectId, executionId, taskId, workspaceId].every(id) || !cursorValid(cursor)) throw new Error("controlOperationInvalid");
  const params = new URLSearchParams({ limit: "20" }); if (cursor) params.set("cursor", cursor);
  const value = await request<unknown>(`/api/v1/delivery/executions/${encodeURIComponent(executionId)}/control-operations?${params}`, { headers: { "X-Project-Id": projectId }, signal });
  inScope(origin);
  if (!record(value) || value.project_id !== projectId || value.execution_id !== executionId || value.task_id !== taskId || !integer(value.version) ||
    value.limit !== 20 || !integer(value.total) || !time(value.as_of) || !Array.isArray(value.items) || value.items.length > 20 || Number(value.total) < value.items.length ||
    !(value.next_cursor === null || cursorValid(value.next_cursor) && Boolean(value.next_cursor) && value.next_cursor !== cursor) ||
    !value.items.every((item) => validControlOperation(item, executionId, taskId, workspaceId)) || new Set(value.items.map((item) => item.id)).size !== value.items.length) throw new Error("controlOperationInvalid");
  return value as unknown as ControlOperationPage;
}
export async function readControlOperation(projectId: string, executionId: string, taskId: string, workspaceId: string, operationId: string, origin: string, digest?: string, signal?: AbortSignal): Promise<ControlOperationDetail> {
  inScope(origin); if (![projectId, executionId, taskId, workspaceId, operationId].every(id)) throw new Error("controlOperationInvalid");
  const value = await request<unknown>(`/api/v1/delivery/executions/${encodeURIComponent(executionId)}/control-operations/${encodeURIComponent(operationId)}`, { headers: { "X-Project-Id": projectId }, signal });
  inScope(origin);
  if (!record(value) || value.project_id !== projectId || value.execution_id !== executionId || value.task_id !== taskId || !integer(value.version) ||
    !validControlOperation(value.operation, executionId, taskId, workspaceId) || value.operation.id !== operationId || digest && value.operation.request_digest !== digest) throw new Error("controlOperationInvalid");
  return value as unknown as ControlOperationDetail;
}
export function useExecutionControlOperations(projectId: string, executionId: string, taskId: string, workspaceId: string, sessionId: string, isActive?: () => boolean) {
  const origin = useRef(projectSessionKey()), scope = JSON.stringify([projectId, executionId, taskId, workspaceId, sessionId]), live = useRef(scope), active = useRef(isActive);
  live.current = scope; active.current = isActive;
  const current = () => live.current === scope && origin.current === projectSessionKey() && active.current?.() !== false;
  const params = new URLSearchParams(typeof location === "undefined" ? "" : location.hash.split("?")[1]);
  const routeId = params.getAll("control_operation_id").length === 1 && params.get("execution_id") === executionId && (!params.has("project_id") || params.get("project_id") === projectId) && id(params.get("control_operation_id")) ? params.get("control_operation_id")! : "";
  const [accepted, setAccepted] = useState<ControlAcceptance | null>(null), acceptedLive = useRef(accepted); acceptedLive.current = accepted;
  const [cursor, setCursor] = useState("");
  // null explicitly returns to the first page even when the opening link selected a C.
  const [selection, setSelection] = useState<ControlAcceptance | null>();
  const selectedId = accepted?.control_operation_id || selection?.control_operation_id || (selection === null ? "" : routeId);
  const selectedDigest = accepted?.request_digest || selection?.request_digest;
  const sessionScope = JSON.stringify([getSessionRevision(), getWorkspaceScope()]);
  const polls = useRef(0);
  const list = useQuery({ queryKey: ["delivery-control-operations", projectId, executionId, taskId, workspaceId, sessionId, sessionScope, cursor],
    queryFn: async ({ signal }) => { const value = await readControlOperations(projectId, executionId, taskId, workspaceId, origin.current, cursor, signal); if (current()) polls.current++; return value; },
    enabled: current() && !selectedId, retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchIntervalInBackground: false,
    refetchInterval: (query) => current() && !cursor && !query.state.error && query.state.data?.items.some((item) => controlOperationPending(item.state)) && polls.current < 60 ? 4000 : false });
  const detail = useQuery({ queryKey: ["delivery-control-operation", projectId, executionId, taskId, workspaceId, sessionId, sessionScope, selectedId, selectedDigest || ""],
    queryFn: async ({ signal }) => { const value = await readControlOperation(projectId, executionId, taskId, workspaceId, selectedId, origin.current, selectedDigest, signal); if (current()) polls.current++; return value; },
    enabled: current() && Boolean(selectedId), retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchIntervalInBackground: false,
    refetchInterval: (query) => current() && !query.state.error && query.state.data && controlOperationPending(query.state.data.operation.state) && polls.current < 60 ? 4000 : false });
  const query = selectedId ? detail : list, error = query.error;
  const page = !selectedId && !error && current() && list.data?.project_id === projectId && list.data.execution_id === executionId && list.data.task_id === taskId ? list.data : undefined;
  const exact = selectedId && !error && current() && detail.data?.project_id === projectId && detail.data.execution_id === executionId && detail.data.task_id === taskId &&
    detail.data.operation.id === selectedId && (!selectedDigest || detail.data.operation.request_digest === selectedDigest) ? detail.data : undefined;
  const pending = page?.items.filter((item) => controlOperationPending(item.state)) || [];
  const latest = (items: ControlOperation[]) => [...items].sort((a, b) => b.accepted_at.localeCompare(a.accepted_at) || b.id.localeCompare(a.id))[0];
  const operation = exact?.operation || latest(pending) || latest(page?.items || []) || null;
  return { projectId, executionId, taskId, workspaceId, readable: Boolean(page || exact), operation, version: exact?.version ?? page?.version, pending: Boolean(operation && controlOperationPending(operation.state)),
    accepted: acceptedLive.current, items: page?.items || [], selected: Boolean(selectedId), error, isPending: query.isPending, isFetching: query.isFetching, paused: polls.current >= 60, nextCursor: page?.next_cursor || null, cursor,
    isReadable: () => current() && Boolean(page || exact) && (!acceptedLive.current || exact?.operation.id === acceptedLive.current.control_operation_id),
    hasPending: () => Boolean(acceptedLive.current && acceptedLive.current.control_operation_id !== operation?.id || operation && controlOperationPending(operation.state)),
    refresh: () => { if (current()) { polls.current = 0; return query.refetch(); } },
    earlier: () => { if (current() && page?.next_cursor) { polls.current = 0; setCursor(page.next_cursor); } },
    first: () => { if (current()) { polls.current = 0; acceptedLive.current = null; setAccepted(null); setSelection(null); if (cursor) setCursor(""); else if (!selectedId) void list.refetch(); } },
    accept: (ack: DeliveryCommandAck) => { if (current() && ack.project_id === projectId && ack.resource.id === executionId && validControlAcceptance(ack.result)) { acceptedLive.current = ack.result; setAccepted(ack.result); polls.current = 0; } },
    select: (operation: ControlOperation) => { if (current() && page?.items.some((item) => item.id === operation.id && item.request_digest === operation.request_digest)) { acceptedLive.current = null; setAccepted(null); setSelection({ control_operation_id: operation.id, request_digest: operation.request_digest }); polls.current = 0; } },
    readExact: (operation: ControlOperation) => { if (!current()) return Promise.reject(new Error("controlOperationScopeChanged")); return readControlOperation(projectId, executionId, taskId, workspaceId, operation.id, origin.current, operation.request_digest); },
  };
}
export type ExecutionControlOperationsRead = ReturnType<typeof useExecutionControlOperations>;
