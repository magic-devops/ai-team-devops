import { Alert, Button, Skeleton, Tag } from "antd";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { executionHandoffCopy } from "@/i18n/execution-handoff";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { invalidateDeliveryQueries } from "@/lib/deliveryQuery";
import { useExecutionHandoffQuery, type ExecutionHandoff, type ExecutionHandoffRead } from "@/lib/executionHandoff";

export function handoffControlsId(projectId: string, executionId: string, sessionId: string) {
  return `execution-controls-${encodeURIComponent(JSON.stringify([projectId, executionId, sessionId]))}`;
}
export function ExecutionHandoffStatus({ projectId, executionId, taskId, sessionId, isActive, read, controlsAvailable = false, onPlanned }: {
  projectId: string; executionId: string; taskId: string; sessionId: string;
  isActive?: () => boolean; read?: ExecutionHandoffRead; controlsAvailable?: boolean;
  onPlanned?: (handoff: ExecutionHandoff) => void;
}) {
  const { i18n } = useTranslation(), copy = executionHandoffCopy(i18n.language);
  const own = useExecutionHandoffQuery(projectId, executionId, taskId, sessionId, !read, isActive), state = read || own;
  const qc = useQueryClient(), handled = useRef("");
  const origin = projectSessionKey(), h = state.value?.handoff;
  const plannedIdentity = h?.state === "planned" ? JSON.stringify([origin, projectId, executionId, taskId, sessionId, h.id, h.revision]) : "";
  useEffect(() => {
    if (!plannedIdentity || handled.current === plannedIdentity || origin !== projectSessionKey() || isActive?.() === false || !h) return;
    handled.current = plannedIdentity;
    // A technical revision invalidates reads. It is not a business command ACK.
    void invalidateDeliveryQueries(qc, projectId);
    onPlanned?.(h);
  }, [plannedIdentity, qc, projectId, h, isActive, onPlanned, origin]);
  if (state.error) {
    const message = state.error.message === "handoffScopeChanged" ? copy.scopeChanged : state.error.message === "handoffResponseInvalid" ? copy.invalid : state.error.message;
    return <Alert role="alert" showIcon type="warning" title={copy.failed} description={message}
      action={<Button size="small" disabled={state.isFetching} onClick={() => void state.refetch()}>{copy.refresh}</Button>} />;
  }
  if (!h) return <section aria-label={copy.title} aria-busy="true"><Skeleton active title={false} paragraph={{ rows: 1 }} /><p className="runtime-help">{copy.loading}</p></section>;
  const hint = h.state === "planned" ? copy.plannedHint : h.state === "blocked" ? copy.blockedHint : h.state === "cancelled" ? copy.cancelledHint : h.state === "retry_wait" ? copy.retryWait : copy.preparing;
  const controls = controlsAvailable && ["planned", "blocked"].includes(h.state);
  return <section aria-label={copy.title} className="min-w-0 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="status" aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-2"><strong className="text-sm">{copy.title}</strong><Tag color={h.state === "blocked" ? "warning" : h.state === "planned" ? "blue" : undefined}>{copy.states[h.state]}</Tag></div>
      <Button size="small" disabled={state.isFetching} onClick={() => {
        if (origin !== projectSessionKey() || isActive?.() === false) return;
        if (controls) { const target = document.getElementById(handoffControlsId(projectId, executionId, sessionId)); target?.focus(); target?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
        else void state.refetch();
      }}>{controls ? copy.controls : copy.refresh}</Button>
    </div>
    <p className="runtime-help">{hint}</p>
    {h.error && <p role="alert" className="break-words text-sm">{h.error.message}</p>}
    <p className="text-xs text-[var(--muted)]">{copy.observed} · <time dateTime={h.updated_at}>{new Date(h.updated_at).toLocaleString()}</time>{h.next_attempt_at && <> · {copy.nextAttempt} · <time dateTime={h.next_attempt_at}>{new Date(h.next_attempt_at).toLocaleString()}</time></>}</p>
    {state.autoPaused && <p role="status" className="runtime-help">{copy.paused}</p>}
    <details className="runtime-help"><summary>{copy.details}</summary><p className="break-all">{copy.request} · {h.id} · {copy.attempt} · {h.attempt}</p><p className="break-all">{projectId} / {taskId} / {executionId} / {h.workspace_id}</p></details>
  </section>;
}
