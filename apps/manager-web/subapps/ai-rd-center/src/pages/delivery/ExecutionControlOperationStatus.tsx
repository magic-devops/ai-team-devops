import { Alert, Button, Skeleton, Space, Tag } from "antd";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { invalidateDeliveryQueries } from "@/lib/deliveryQuery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { executionControlOperationsCopy } from "@/i18n/execution-control-operations";
import type { ControlOperation, ExecutionControlOperationsRead } from "@/lib/executionControlOperations";
import { executionRuntimeProblem } from "@/lib/executionRuntime";

/** Read-only status. A close request is handed to the existing single command owner. */
export function ExecutionControlOperationStatus({ read, isActive, controlsAvailable = true, onCloseRequested, onFactsRequested }: {
  read: ExecutionControlOperationsRead; isActive?: () => boolean;
  controlsAvailable?: boolean;
  onCloseRequested?: (operation: ControlOperation) => void; onFactsRequested?: () => void;
}) {
  const { i18n } = useTranslation(), copy = executionControlOperationsCopy(i18n?.language), qc = useQueryClient();
  const origin = useRef(projectSessionKey()), observed = useRef("");
  const operation = read.operation, current = () => origin.current === projectSessionKey() && isActive?.() !== false;
  const pages = <Space wrap>{(read.selected || read.cursor) && <Button size="small" onClick={() => { if (current()) read.first(); }}>{read.selected ? copy.back : copy.first}</Button>}{read.nextCursor && <Button size="small" onClick={() => { if (current()) read.earlier(); }}>{copy.earlier}</Button>}</Space>;
  useEffect(() => {
    if (!operation || !read.isReadable() || !current() || !["awaiting_executor", "applied", "closed"].includes(operation.state)) return;
    const key = `${operation.id}:${operation.revision}:${operation.state}`; if (observed.current === key) return;
    observed.current = key; void invalidateDeliveryQueries(qc, read.projectId); onFactsRequested?.();
  }, [operation?.id, operation?.revision, operation?.state, read.readable]);
  const stale = Boolean(read.cursor && read.error && /^HTTP (?:409|422)\b/.test(read.error.message));
  if (read.error || !read.readable) return <section className="space-y-2" aria-label={copy.title}>
    {read.error ? <Alert role="alert" type="warning" title={copy.unavailable}
      description={<>{read.accepted && <p>{copy.unknownAccepted}</p>}{stale ? copy.cursorChanged : read.error.message === "controlOperationInvalid" ? copy.invalid : read.error.message === "controlOperationScopeChanged" ? copy.scopeChanged : executionRuntimeProblem(read.error).message}</>}
      action={<Button size="small" loading={read.isFetching} onClick={() => { if (current()) { if (stale) read.first(); else void read.refresh(); } }}>{stale ? copy.first : copy.refresh}</Button>} /> :
      <><Skeleton active title={false} paragraph={{ rows: 1 }} /><p className="runtime-help">{read.accepted ? copy.acceptedHint : copy.loading}</p></>}
  </section>;
  if (!operation) return read.nextCursor || read.cursor || read.selected ? pages : null;
  const hint = operation.outcome === "needs_review" ? copy.reviewHint : operation.state === "closed" ? copy.closedHint : operation.state === "applied" ? copy.appliedHint : operation.state === "awaiting_executor" ? copy.awaitingHint : copy.acceptedHint;
  return <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3" aria-label={copy.title}>
    <Space wrap><strong className="text-sm">{copy.actions[operation.action]}</strong><Tag color={operation.state === "blocked" ? "warning" : ["applied", "closed"].includes(operation.state) ? "default" : "processing"}>{copy.states[operation.state]}</Tag></Space>
    <p role="status" className="runtime-help">{hint}</p>
    {operation.launch && <div><Tag>{copy.launchStates[operation.launch.state]}</Tag>{operation.launch.state === "claimed" && <p className="runtime-help">{copy.claimedHint}</p>}</div>}
    {operation.error && <Alert type="warning" title={operation.error.message} />}
    {read.paused && <p role="status" className="runtime-help">{copy.paused}</p>}
    <Space wrap><Button size="small" loading={read.isFetching} onClick={() => { if (current()) void read.refresh(); }}>{copy.refresh}</Button>
      {operation.permissions.can_close && onCloseRequested && <Button size="small" danger disabled={!controlsAvailable} onClick={() => { if (controlsAvailable && current() && read.isReadable() && read.operation?.id === operation.id) onCloseRequested(operation); }}>{copy.close}</Button>}
    </Space>
    {read.items.length > 1 && <details className="runtime-help"><summary>{copy.history} · {read.items.length}</summary><ul className="space-y-1">
      {read.items.map((item) => <li key={item.id}><Button type="link" size="small" className="!h-auto !whitespace-normal !text-left" onClick={() => { if (current()) read.select(item); }}>{copy.actions[item.action]} · {copy.states[item.state]} · {item.accepted_at}</Button></li>)}
    </ul></details>}
    {pages}
    <details className="runtime-help"><summary>{copy.details}</summary><dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
      <dt>{copy.target}</dt><dd>{operation.id}</dd><dt>{copy.digest}</dt><dd>{operation.request_digest}</dd><dt>{copy.updated}</dt><dd>{operation.updated_at}</dd><dt>{copy.attempt}</dt><dd>{operation.attempt}</dd>
    </dl></details>
  </section>;
}
