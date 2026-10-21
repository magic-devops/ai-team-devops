import { Alert, Button, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import type { DeliveryCommandState, DeliveryOriginal } from "@/lib/deliveryCommandController";
import type { TaskExternalKind } from "@/lib/taskExternalCommand";
import { useSubmissionCommand } from "@/lib/deliveryTaskSubmission";
import { useWorkOrderCommand } from "@/lib/externalWorkOrderCommand";
import { executionRuntimeProblem } from "@/lib/executionRuntime";
import { taskSubmissionCopy, taskSubmissionReason } from "@/i18n/task-submission";
import { externalWorkOrderActionLabel, externalWorkOrderReason } from "@/i18n/external-work-orders";
import { deliveryOperationRecoveryCopy } from "@/i18n/delivery-operation-recovery";

type RecoveryCommand<T extends DeliveryOriginal> = {
  state: DeliveryCommandState<T>; current: () => boolean; snapshot: () => DeliveryCommandState<T>;
  replay: () => Promise<DeliveryCommandAck | undefined>; reset: () => void;
};
/** Only the retained original and its receipt authorize recovery; current GETs are not prerequisites. */
export function TaskExternalRecovery<T extends DeliveryOriginal>({ projectId, taskId, kind, command, onSaved, onResolved, isActive, busy = false }: {
  projectId: string; taskId: string; kind: TaskExternalKind; command: RecoveryCommand<T>; onSaved: (ack: DeliveryCommandAck, original: T) => void;
  onResolved?: () => void; isActive?: () => boolean; busy?: boolean;
}) {
  const { i18n } = useTranslation(), copy = deliveryOperationRecoveryCopy(i18n?.language), state = command.state;
  const pending = useRef(false), mounted = useRef(true), [working, setWorking] = useState(false), [error, setError] = useState("");
  const identity = JSON.stringify([projectId, taskId, kind]), live = useRef(identity); live.current = identity;
  const access = useRef(isActive); access.current = isActive;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && live.current === identity && access.current?.() !== false && command.current();
  const finish = () => {
    if (busy || !current()) return;
    const saved = command.snapshot(); if (saved.phase !== "succeeded" || !saved.original || saved.ack?.project_id !== projectId) return;
    command.reset(); if (command.snapshot().phase !== "idle") return;
    try { onSaved(saved.ack, saved.original); } catch { setError(copy.refreshFailed); }
    try { onResolved?.(); } catch { setError(copy.refreshFailed); }
  };
  const replay = async () => {
    if (pending.current || busy || !current() || command.snapshot().phase !== "unknown" || !command.snapshot().original) return;
    pending.current = true; setWorking(true); setError("");
    try { await command.replay(); finish(); } catch { if (current()) setError(copy.recoveryFailed); }
    finally { pending.current = false; if (mounted.current) setWorking(false); }
  };
  const closeRefused = () => {
    if (pending.current || busy || !current() || command.snapshot().phase !== "refused") return;
    command.reset(); if (command.snapshot().phase === "idle") { try { onResolved?.(); } catch { setError(copy.refreshFailed); } }
  };
  if (state.phase === "idle") return error ? <Alert role="status" type="warning" title={error} /> : null;
  const problem = executionRuntimeProblem(state.error), message = state.error === "ackMismatch" ? copy.receiptMismatch : state.error === "retainedOriginalInvalid" ? copy.invalid : state.error === "retainedOriginalUnavailable" ? copy.unavailable :
    kind === "submission" ? taskSubmissionReason(i18n?.language, problem) : externalWorkOrderReason(i18n?.language || "", problem);
  const action = state.original?.action, reportCopy = taskSubmissionCopy(i18n?.language);
  const actionLabel = action ? kind === "work-order" ? externalWorkOrderActionLabel(i18n?.language || "", action) : action === "task.delivery.review" ? reportCopy.review : reportCopy.create : "";
  const summary = state.original?.payload.summary ?? state.original?.payload.comment ?? state.original?.payload.instructions;
  return <section className="delivery-manual-panel space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label={copy.title}>
    <Alert role="status" showIcon type={state.phase === "succeeded" ? "success" : state.phase === "sending" ? "info" : "warning"}
      title={state.phase === "succeeded" ? copy.confirmed : state.phase === "sending" ? copy.sending : state.phase === "refused" ? copy.refused : copy.unknown} description={copy.hint} />
    <p className="break-all text-sm">{kind === "submission" ? copy.submission : copy.workOrder} · {projectId} · {taskId}</p>
    {actionLabel && <strong>{actionLabel}</strong>}{typeof summary === "string" && summary && <p className="whitespace-pre-wrap break-words text-sm">{summary}</p>}
    {state.error && <Alert role="alert" type="warning" title={message} description={<details><summary>{copy.details}</summary><code>{problem.code || state.error}</code><p>{problem.message}</p></details>} />}
    {error && <Alert role="alert" type="warning" title={error} />}
    {state.phase === "unknown" && !state.original && state.error === "retainedOriginalUnavailable" && <p className="runtime-help">{copy.reloadHint}</p>}
    <Space wrap>
      {state.phase === "unknown" && !state.original && state.error === "retainedOriginalUnavailable" && <Button data-action={`reload-${kind}-recovery`} disabled={!current() || busy || working} onClick={() => { if (!pending.current && !busy && current()) window.location.reload(); }}>{copy.reload}</Button>}
      {state.phase === "unknown" && state.original && <Button type="primary" data-action={`recover-${kind}`} disabled={!current() || busy || working} loading={working} onClick={replay}>{copy.replay}</Button>}
      {state.phase === "succeeded" && <Button type="primary" data-action={`finish-${kind}-original`} disabled={!current() || busy || working} onClick={finish}>{copy.finish}</Button>}
      {state.phase === "refused" && <Button data-action={`discard-${kind}-original`} disabled={!current() || busy || working} onClick={closeRefused}>{copy.discard}</Button>}
    </Space>
    {state.original && <details className="runtime-help"><summary>{copy.original}</summary><dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all text-xs"><dt>{copy.version}</dt><dd>{state.original.intent.version}</dd><dt>{copy.target}</dt><dd>{String(state.original.payload.id || state.original.payload.submission_id || taskId)}</dd></dl><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(state.original, null, 2)}</pre></details>}
    {state.ack && <details className="runtime-help"><summary>{copy.receipt}</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(state.ack, null, 2)}</pre></details>}
  </section>;
}
type OwnerProps = { projectId: string; taskId: string; sessionId: string; isActive?: () => boolean; onPending?: (value: boolean) => void; onSaved: (ack: DeliveryCommandAck) => void; onResolved?: () => void };
function SubmissionRecoveryOwner(props: OwnerProps) { const command = useSubmissionCommand(props.projectId, props.taskId, props.sessionId, props.onPending); return <TaskExternalRecovery {...props} kind="submission" command={command} />; }
function WorkOrderRecoveryOwner(props: OwnerProps) { const command = useWorkOrderCommand(props.projectId, props.taskId, props.sessionId, props.onPending); return <TaskExternalRecovery {...props} kind="work-order" command={command} />; }
export function TaskExternalRecoveryOwner({ kind, ...props }: OwnerProps & { kind: TaskExternalKind }) { return kind === "submission" ? <SubmissionRecoveryOwner {...props} /> : <WorkOrderRecoveryOwner {...props} />; }
