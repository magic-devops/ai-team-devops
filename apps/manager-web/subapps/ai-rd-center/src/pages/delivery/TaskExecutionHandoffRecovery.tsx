import { Alert, Button, Skeleton, Space } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSessionRevision, getWorkspaceScope } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { readTaskHandoffs } from "@/lib/executionHandoff";
import { executionHandoffCopy } from "@/i18n/execution-handoff";
import { executionOperationPending } from "./ExecutionOperationRecovery";
import { useExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { ExecutionQueueRecovery } from "./ExecutionQueueRecovery";

export function TaskQueueOriginalRecovery({ projectId, taskId, sessionId, isActive, onPending, onSaved }: {
  projectId: string; taskId: string; sessionId: string; isActive: () => boolean;
  onPending: (value: boolean) => void; onSaved: (ack: DeliveryCommandAck) => void;
}) {
  const command = useExecutionDispatchCommand(projectId, "execution.queue", taskId, sessionId, onPending);
  return <ExecutionQueueRecovery projectId={projectId} taskId={taskId} command={command} isActive={isActive} onSaved={onSaved} onResolved={() => onPending(false)} />;
}

/** Locate only. The parent latches one recovery owner outside its failed read. */
export function TaskExecutionHandoffRecovery({ projectId, taskId, sessionId, isActive, onLocated }: {
  projectId: string; taskId: string; sessionId: string; isActive?: () => boolean;
  onLocated: (executionId: string) => void;
}) {
  const { i18n } = useTranslation(), copy = executionHandoffCopy(i18n.language);
  const origin = useRef(projectSessionKey()), identity = JSON.stringify([projectId, taskId, sessionId]), live = useRef(identity);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  live.current = identity;
  const active = useRef(isActive); active.current = isActive;
  const [cursor, setCursor] = useState("");
  const current = () => mounted.current && origin.current === projectSessionKey() && live.current === identity && active.current?.() !== false;
  const query = useQuery({
    queryKey: ["delivery-task-handoffs", projectId, taskId, sessionId, getSessionRevision(), JSON.stringify(getWorkspaceScope()), cursor],
    queryFn: ({ signal }) => readTaskHandoffs(projectId, taskId, origin.current, cursor, signal),
    enabled: Boolean(projectId && taskId) && current(), retry: false, gcTime: 0, refetchOnWindowFocus: false,
  });
  const page = !query.error && current() && query.data?.project_id === projectId && query.data.task_id === taskId ? query.data : undefined;
  const pageAccess = useRef(page); pageAccess.current = page;
  const candidate = page?.items.find((h) => executionOperationPending(projectId, h.execution_id))?.execution_id || "";
  useEffect(() => { if (candidate && pageAccess.current === page && current() && executionOperationPending(projectId, candidate)) onLocated(candidate); }, [candidate, page, onLocated]);
  const stalePage = Boolean(query.error && /^HTTP (?:409|422)\b/.test(query.error.message));
  const first = () => { if (!current()) return; if (cursor) setCursor(""); else void query.refetch(); };
  return <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3" aria-label={copy.locate}>
    <strong className="text-sm">{copy.locate}</strong><p className="runtime-help">{copy.locatingHint}</p>
    {query.isPending && <><Skeleton active title={false} paragraph={{ rows: 1 }} /><p className="runtime-help">{copy.locating}</p></>}
    {query.error && <Alert role="alert" type="warning" title={copy.locateFailed} description={stalePage ? copy.cursorChanged : query.error.message === "handoffResponseInvalid" ? copy.invalid : query.error.message === "handoffScopeChanged" ? copy.scopeChanged : query.error.message}
      action={<Button size="small" disabled={query.isFetching} onClick={() => { if (!current()) return; if (stalePage) first(); else void query.refetch(); }}>{stalePage ? copy.first : copy.refresh}</Button>} />}
    {page && !candidate && <><p role="status" className="runtime-help">{copy.pageOnly}</p><Space wrap>
      <Button size="small" disabled={query.isFetching} onClick={first}>{copy.first}</Button>
      {page.next_cursor && <Button size="small" disabled={query.isFetching} onClick={() => { if (current()) setCursor(page.next_cursor!); }}>{copy.earlier}</Button>}
    </Space></>}
  </section>;
}
