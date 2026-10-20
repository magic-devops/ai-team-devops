import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { request } from "./http";
import { projectSessionKey } from "./projectPortfolio";
import { getSessionRevision, getWorkspaceScope } from "./authStorage";

export const handoffStates = ["accepted", "dispatching", "retry_wait", "blocked", "planned", "cancelled"] as const;
export type ExecutionHandoff = {
  id: string; execution_id: string; task_id: string; workspace_id: string;
  state: typeof handoffStates[number]; revision: number; attempt: number;
  accepted_at: string; updated_at: string; next_attempt_at: string | null;
  error: { code: string; message: string } | null;
  run_id: string | null; runtime_task_id: string | null;
};
export type ExecutionHandoffResponse = { project_id: string; execution_id: string; task_id: string; handoff: ExecutionHandoff };
export type TaskHandoffPage = { project_id: string; task_id: string; items: ExecutionHandoff[]; total: number; next_cursor: string | null; limit: number; as_of: string };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100 && !/[\s\u0000-\u001f\u007f]/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value));
export function handoffPending(state: ExecutionHandoff["state"]) { return ["accepted", "dispatching", "retry_wait"].includes(state); }
export function handoffAccessFailure(error: unknown) { return error instanceof Error && (/^HTTP (?:401|403|404)\b/.test(error.message) || error.message === "handoffScopeChanged"); }
export function validExecutionHandoff(projectId: string, executionId: string, taskId: string, value: unknown): value is ExecutionHandoffResponse {
  if (!record(value) || value.project_id !== projectId || value.execution_id !== executionId || value.task_id !== taskId || !record(value.handoff)) return false;
  const h = value.handoff;
  if (!identity(h.id) || h.execution_id !== executionId || h.task_id !== taskId || !identity(h.workspace_id) ||
    !handoffStates.includes(h.state as ExecutionHandoff["state"]) || !Number.isSafeInteger(h.revision) || Number(h.revision) < 1 ||
    !Number.isSafeInteger(h.attempt) || Number(h.attempt) < 0 || !timestamp(h.accepted_at) || !timestamp(h.updated_at) ||
    !(h.next_attempt_at === null || timestamp(h.next_attempt_at)) ||
    !(h.error === null || record(h.error) && typeof h.error.code === "string" && h.error.code.length > 0 && h.error.code.length <= 100 &&
      typeof h.error.message === "string" && h.error.message.length > 0 && h.error.message.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(h.error.code) && !h.error.message.includes("\0"))) return false;
  return h.state === "planned" ? identity(h.run_id) && identity(h.runtime_task_id) : h.run_id === null && h.runtime_task_id === null;
}
export async function readExecutionHandoff(projectId: string, executionId: string, taskId: string, origin: string, signal?: AbortSignal) {
  if (![projectId, executionId, taskId].every(identity) || origin !== projectSessionKey()) throw new Error("handoffScopeChanged");
  const value = await request<unknown>(`/api/v1/delivery/executions/${encodeURIComponent(executionId)}/handoff`, { headers: { "X-Project-Id": projectId }, signal });
  if (origin !== projectSessionKey()) throw new Error("handoffScopeChanged");
  if (!validExecutionHandoff(projectId, executionId, taskId, value)) throw new Error("handoffResponseInvalid");
  return value;
}
export async function readTaskHandoffs(projectId: string, taskId: string, origin: string, cursor = "", signal?: AbortSignal): Promise<TaskHandoffPage> {
  if (![projectId, taskId].every(identity) || cursor.length > 4000 || /[\u0000-\u001f\u007f]/.test(cursor) || origin !== projectSessionKey()) throw new Error("handoffScopeChanged");
  const params = new URLSearchParams({ limit: "20" }); if (cursor) params.set("cursor", cursor);
  const value = await request<unknown>(`/api/v1/delivery/tasks/${encodeURIComponent(taskId)}/execution-handoffs?${params}`, { headers: { "X-Project-Id": projectId }, signal });
  if (origin !== projectSessionKey()) throw new Error("handoffScopeChanged");
  if (!record(value) || value.project_id !== projectId || value.task_id !== taskId || value.limit !== 20 || !timestamp(value.as_of) ||
    !Array.isArray(value.items) || value.items.length > 20 || !Number.isSafeInteger(value.total) || Number(value.total) < value.items.length ||
    !(value.next_cursor === null || typeof value.next_cursor === "string" && value.next_cursor.length > 0 && value.next_cursor.length <= 4000 &&
      !/[\u0000-\u001f\u007f]/.test(value.next_cursor) && value.next_cursor !== cursor)) throw new Error("handoffResponseInvalid");
  const ids = new Set<string>(), executions = new Set<string>();
  for (const h of value.items) {
    if (!record(h) || !identity(h.execution_id)) throw new Error("handoffResponseInvalid");
    const candidate = { project_id: projectId, execution_id: h.execution_id, task_id: taskId, handoff: h };
    if (!validExecutionHandoff(projectId, h.execution_id, taskId, candidate) || ids.has(candidate.handoff.id) || executions.has(candidate.handoff.execution_id)) throw new Error("handoffResponseInvalid");
    ids.add(candidate.handoff.id); executions.add(candidate.handoff.execution_id);
  }
  return value as unknown as TaskHandoffPage;
}
export function useExecutionHandoffQuery(projectId: string, executionId: string, taskId: string, sessionId: string, required: boolean, isActive?: () => boolean) {
  const origin = projectSessionKey(), scope = JSON.stringify([projectId, executionId, taskId, sessionId, origin]);
  const sessionScope = JSON.stringify([getSessionRevision(), getWorkspaceScope()]);
  const polls = useRef({ scope, count: 0 }), active = useRef(isActive); active.current = isActive;
  if (polls.current.scope !== scope) polls.current = { scope, count: 0 };
  const tracker = polls.current;
  const query = useQuery({
    queryKey: ["delivery-execution-handoff", projectId, executionId, taskId, sessionId, sessionScope],
    queryFn: async ({ signal }) => { const value = await readExecutionHandoff(projectId, executionId, taskId, origin, signal); if (polls.current === tracker) tracker.count++; return value; },
    enabled: required && isActive?.() !== false, retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchIntervalInBackground: false,
    refetchInterval: (current) => required && origin === projectSessionKey() && active.current?.() !== false && !current.state.error &&
      current.state.data && handoffPending(current.state.data.handoff.state) && polls.current.count < 60 ? 4000 : false,
  });
  const value = required && !query.error && origin === projectSessionKey() && validExecutionHandoff(projectId, executionId, taskId, query.data) ? query.data : undefined;
  return { required, value, readable: !required || Boolean(value), error: required ? query.error : null,
    isPending: required && query.isPending, isFetching: query.isFetching, autoPaused: Boolean(value && handoffPending(value.handoff.state) && polls.current.count >= 60),
    refetch: () => { if (origin === projectSessionKey() && polls.current.scope === scope && active.current?.() !== false) { polls.current.count = 0; return query.refetch(); } },
  };
}
export type ExecutionHandoffRead = ReturnType<typeof useExecutionHandoffQuery>;
