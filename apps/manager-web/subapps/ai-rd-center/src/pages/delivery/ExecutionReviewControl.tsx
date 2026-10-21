import { Alert, Button, Input, Space } from "antd";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useExecutionReviewCommand, type ExecutionReviewOriginal } from "@/lib/executionReviewCommand";
import { executionReviewCopy } from "@/i18n/execution-review";

export type ExecutionReviewControlProps = {
  projectId: string; executionId: string; sessionId: string; taskId?: string; workspaceId?: string;
  runId?: string; runVersion?: number; workspaceVersion?: number; canReview?: boolean; canAccept?: boolean;
  disabled?: boolean; isActive?: () => boolean; canSubmit?: () => boolean;
  onSaved: (ack: DeliveryCommandAck) => void; onObserved?: () => Promise<void>;
  onUnresolvedChange?: (value: boolean) => void;
};
/** The same frozen review remains recoverable without any new detail/runtime GET. */
export function ExecutionReviewControl({ projectId, executionId, sessionId, taskId, workspaceId, runId, runVersion, workspaceVersion,
  canReview = false, canAccept = false, disabled = false, isActive, canSubmit, onSaved, onObserved, onUnresolvedChange }: ExecutionReviewControlProps) {
  const { i18n } = useTranslation(), copy = executionReviewCopy(i18n?.language), fieldId = useId();
  const origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false), generation = useRef(0);
  const confirmedBasis = useRef("");
  const epoch = generation.current, identity = JSON.stringify([projectId, executionId, sessionId]);
  const active = useRef({ identity, taskId, workspaceId, runId, runVersion, workspaceVersion, canReview, canAccept, disabled, isActive, canSubmit });
  active.current = { identity, taskId, workspaceId, runId, runVersion, workspaceVersion, canReview, canAccept, disabled, isActive, canSubmit };
  const [comment, setComment] = useState(""), commentRef = useRef(comment), [error, setError] = useState("");
  const commentScope = useRef(identity);
  commentRef.current = comment;
  const command = useExecutionReviewCommand(projectId, executionId, sessionId, onUnresolvedChange), state = command.state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && active.current.identity === identity && origin.current === projectSessionKey() && command.current() && active.current.isActive?.() !== false;
  const complete = async (ack: DeliveryCommandAck | undefined) => {
    if (!ack || !current()) return;
    command.reset();
    if (command.snapshot().phase !== "idle") { setError(copy.cleanupHint); return; }
    confirmedBasis.current = JSON.stringify([active.current.runId, active.current.runVersion, active.current.workspaceVersion]);
    generation.current++; setComment(""); commentRef.current = "";
    try { onSaved(ack); } catch { setError(copy.refreshFailed); }
    try { await onObserved?.(); } catch { if (current()) setError(copy.refreshFailed); }
  };
  const submit = async (decision: ExecutionReviewOriginal["payload"]["decision"], replay = false) => {
    const latest = active.current;
    if (!current() || pending.current) return;
    if (replay ? command.snapshot().phase !== "unknown" : epoch !== generation.current || command.snapshot().phase !== "idle" || latest.disabled ||
      !latest.canReview || decision === "accept" && !latest.canAccept || latest.canSubmit?.() === false || commentScope.current !== identity || !commentRef.current.trim() ||
      !latest.runId || !latest.taskId || !latest.workspaceId || !Number.isSafeInteger(latest.runVersion) || Number(latest.runVersion) < 1 ||
      !Number.isSafeInteger(latest.workspaceVersion) || Number(latest.workspaceVersion) < 0 ||
      confirmedBasis.current === JSON.stringify([latest.runId, latest.runVersion, latest.workspaceVersion])) return;
    pending.current = true; setError("");
    try {
      const ack = replay ? await command.replay() : await command.run({ action: "execution.review",
        payload: { id: executionId, run_version: latest.runVersion!, decision, comment: commentRef.current.trim() },
        intent: { version: latest.workspaceVersion!, key: crypto.randomUUID() }, runId: latest.runId!, taskId: latest.taskId!, workspaceId: latest.workspaceId! });
      await complete(ack);
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : copy.failed); }
    finally { pending.current = false; }
  };
  const retained = state.original, lock = command.locked || state.phase !== "idle" ||
    confirmedBasis.current === JSON.stringify([runId, runVersion, workspaceVersion]);
  if (!canReview && !retained && !state.error && !error) return null;
  return <section className="runtime-review space-y-2" aria-label={copy.title}>
    {canReview && <><p className="runtime-help">{copy.hint}</p><label htmlFor={fieldId}>{copy.comment}</label>
      <Input.TextArea id={fieldId} rows={3} maxLength={4000} value={commentScope.current === identity ? comment : ""} disabled={disabled || lock}
        onChange={(event) => { if (!current() || command.snapshot().phase !== "idle" || active.current.disabled) return; commentScope.current = identity; commentRef.current = event.target.value; setComment(event.target.value); }} />
      <Space wrap><Button type="primary" size="small" data-action="accept-execution-review" loading={state.phase === "sending"}
        disabled={disabled || lock || !canAccept || commentScope.current !== identity || !comment.trim()} onClick={() => submit("accept")}>{copy.accept}</Button>
        <Button size="small" data-action="reject-execution-review" disabled={disabled || lock || commentScope.current !== identity || !comment.trim()} onClick={() => submit("request_changes")}>{copy.reject}</Button></Space></>}
    {retained && <details><summary>{copy.details} · {copy.decisions[retained.payload.decision]}</summary>
      <p className="runtime-help">{copy.run}: {retained.runId} · {copy.runVersion} {retained.payload.run_version} · {copy.projectVersion} {retained.intent.version}</p>
      <blockquote>{retained.payload.comment}</blockquote></details>}
    {state.phase === "sending" && <p role="status" className="runtime-help">{copy.sending}</p>}
    {state.phase === "unknown" && <Alert role="status" type="warning" title={copy.unknown} description={copy.unknownHint}
      action={retained && <Button size="small" data-action="recover-execution-review" onClick={() => submit(retained.payload.decision, true)}>{copy.retry}</Button>} />}
    {state.phase === "succeeded" && <Alert role="status" type="success" title={copy.confirmed} description={copy.cleanupHint}
      action={<Button size="small" data-action="finish-execution-review" onClick={async () => {
        if (!current() || pending.current) return; pending.current = true;
        try { await complete(command.snapshot().ack); } finally { pending.current = false; }
      }}>{copy.finish}</Button>} />}
    {state.phase === "refused" && <Alert type="warning" title={copy.refused} action={<Button size="small" data-action="dismiss-execution-review" onClick={() => {
      if (!current() || pending.current || command.snapshot().phase !== "refused") return;
      command.reset(); if (command.snapshot().phase === "idle") { generation.current++; setError(""); }
    }}>{copy.dismiss}</Button>} />}
    {(state.error || error) && <Alert role="alert" type={state.phase === "succeeded" ? "info" : "error"} title={
      state.error === "retainedOriginalInvalid" ? copy.invalid : state.error === "retainedOriginalUnavailable" ? copy.unavailable : copy.failed} description={error || state.error} />}
  </section>;
}
