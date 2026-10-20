import { Alert, Button, Descriptions, Input, Modal, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { executionControlOriginal, useExecutionControlCommand } from "@/lib/executionControlCommand";
import {
  assertExecutionSession, executionRuntimeProblem, fetchExecutionRuntime,
  prepareExecutionControl, previewExecutionControl,
  type ExecutionControlAction, type ExecutionControlIntent, type ExecutionControlPreview, type ExecutionRuntime,
} from "@/lib/executionRuntime";
export type ExecutionRuntimeControlProps = {
  projectId: string; executionId: string; sessionId: string;
  workspaceId?: string; runtime?: ExecutionRuntime;
  isActive?: () => boolean;
  canSubmit?: () => boolean;
  disabled?: boolean; readOnly?: boolean;
  onSaved: (data: DeliveryCommandAck) => void;
  onObserved: (data: ExecutionRuntime) => void;
  onUnresolvedChange?: (unresolved: boolean) => void;
};
type Draft = {
  action: ExecutionControlAction; reason: string; decision?: "approve" | "reject"; approvalId?: string;
  preview: ExecutionControlPreview | null; intent: ExecutionControlIntent | null;
};
/** The same retained request is available before any fresh runtime read succeeds. */
export function ExecutionRuntimeControl({ projectId, executionId, sessionId, workspaceId, runtime, isActive, canSubmit,
  disabled = false, readOnly = false, onSaved, onObserved, onUnresolvedChange }: ExecutionRuntimeControlProps) {
  const { t } = useTranslation(), tr = (key: string) => t(`deliveryExecutionRuntime.${key}`);
  const origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false);
  const identity = JSON.stringify([projectId, executionId, sessionId]), liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  const access = useRef({ disabled, readOnly, workspaceId, runtime, isActive, canSubmit });
  access.current = { disabled, readOnly, workspaceId, runtime, isActive, canSubmit };
  const [draft, setDraft] = useState<Draft | null>(null), draftRef = useRef(draft);
  draftRef.current = draft;
  const changeDraft = (value: Draft | null) => { draftRef.current = value; setDraft(value); };
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<ExecutionControlPreview | null>(null);
  const [queried, setQueried] = useState<ExecutionRuntime | null>(null);
  const notify = useRef(onUnresolvedChange); notify.current = onUnresolvedChange;
  const controller = useRef<{ snapshot: () => { phase: string } }>();
  const command = useExecutionControlCommand(projectId, executionId, sessionId, (value) =>
    notify.current?.(value || controller.current?.snapshot().phase === "succeeded"));
  controller.current = command;
  const snapshot = () => command.snapshot();
  const isLocked = () => !["idle", "refused"].includes(snapshot().phase);
  const canWrite = () => access.current.isActive?.() !== false && access.current.canSubmit?.() !== false && !access.current.disabled && !access.current.readOnly && Boolean(access.current.workspaceId) &&
    access.current.runtime?.project_id === projectId && access.current.runtime?.execution_id === executionId;
  const state = command.state, unknown = state.phase === "unknown", confirmed = state.phase === "succeeded";
  const locked = busy || command.locked;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    notify.current?.(["sending", "unknown", "succeeded"].includes(state.phase));
  }, [state.phase]);
  const current = () => {
    assertExecutionSession(origin.current);
    if (!mounted.current || liveIdentity.current !== identity || !command.current() || access.current.isActive?.() === false) throw new Error("scopeChanged");
  };
  const fail = (failure: unknown) => {
    const info = executionRuntimeProblem(failure);
    setError(t(`deliveryExecutionRuntime.reasons.${info.code}`, { defaultValue: tr(info.message) === `deliveryExecutionRuntime.${info.message}` ? info.message : tr(info.message) }));
    setConflict(info.conflict);
  };
  const available = (key: keyof ExecutionRuntime["controls"]) => Boolean(canWrite() && access.current.runtime?.controls[key]?.allowed);
  const begin = (action: ExecutionControlAction, decision?: "approve" | "reject") => {
    const key = action === "execution.approval" && decision === "reject" ? "approval_reject" : action.split(".")[1] as keyof ExecutionRuntime["controls"];
    if (!available(key) || pending.current || draftRef.current || !["idle", "refused"].includes(snapshot().phase)) return;
    try {
      current();
      if (snapshot().phase === "refused") { command.reset(); if (snapshot().phase !== "idle") return; }
      changeDraft({ action, decision, reason: "", preview: null, intent: null, approvalId: action === "execution.approval" ? runtime?.approval?.id : undefined });
      setError(""); setConflict(false); setLatest(null); setQueried(null);
    } catch (failure) { fail(failure); }
  };
  const preview = async () => {
    const original = draftRef.current;
    if (!original?.reason.trim() || pending.current || isLocked() || !canWrite()) return;
    pending.current = true; setBusy(true); setError("");
    try {
      current();
      changeDraft({ ...original, preview: null, intent: null });
      const value = await previewExecutionControl(projectId, executionId, original.action, original.reason,
        original.approvalId && original.decision ? { id: original.approvalId, decision: original.decision } : undefined);
      current();
      changeDraft({ ...original, preview: value, intent: value.allowed ? prepareExecutionControl(projectId, executionId, value, crypto.randomUUID()) : null });
    } catch (failure) { if (mounted.current) fail(failure); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const complete = async (ack: DeliveryCommandAck | undefined) => {
    if (!ack) return;
    current();
    // Once confirmed, only clear local recovery. A refresh failure cannot trigger another POST.
    command.reset();
    if (snapshot().phase !== "idle") { setError(tr("confirmedStorageUnavailable")); notify.current?.(true); return; }
    changeDraft(null); setLatest(null); setConflict(false); setQueried(null); notify.current?.(false);
    try { onSaved(ack); } catch { setError(tr("refreshAfterSaveFailed")); }
    try { const value = await fetchExecutionRuntime(projectId, executionId); current(); onObserved(value); }
    catch { if (mounted.current) setError(tr("refreshAfterSaveFailed")); }
  };
  const submit = async (replay = false) => {
    if (pending.current || (!replay && (!canWrite() || conflict || isLocked()))) return;
    const original = draftRef.current;
    if (replay ? snapshot().phase !== "unknown" : !original?.intent) return;
    pending.current = true; setBusy(true); setError("");
    try {
      current();
      const ack = replay ? await command.replay() : await command.run(executionControlOriginal(original!.intent!, workspaceId!));
      current();
      if (snapshot().phase === "refused") fail(new Error(snapshot().error || ""));
      await complete(ack);
    } catch (failure) { if (mounted.current) fail(failure); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const queryOriginal = async () => {
    if (pending.current || !snapshot().original) return;
    pending.current = true; setBusy(true); setError("");
    try { current(); const value = await fetchExecutionRuntime(projectId, executionId); current(); setQueried(value); onObserved(value); }
    catch (failure) { if (mounted.current) fail(failure); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const readLatest = async () => {
    const original = draftRef.current;
    if (!original || pending.current || isLocked() || !canWrite()) return;
    pending.current = true; setBusy(true); setError(""); setLatest(null);
    try {
      current();
      changeDraft({ ...original, preview: null, intent: null });
      const value = await previewExecutionControl(projectId, executionId, original.action, original.reason,
        original.approvalId && original.decision ? { id: original.approvalId, decision: original.decision } : undefined);
      current(); setLatest(value);
    } catch (failure) { if (mounted.current) fail(failure); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const adopt = () => {
    if (!latest?.allowed || !draftRef.current || pending.current || isLocked() || !canWrite()) return;
    try {
      current();
      if (snapshot().phase === "refused") { command.reset(); if (snapshot().phase !== "idle") return; }
      changeDraft({ ...draftRef.current, preview: latest, intent: prepareExecutionControl(projectId, executionId, latest, crypto.randomUUID()) });
      setConflict(false); setLatest(null); setError("");
    } catch (failure) { fail(failure); }
  };
  const close = () => {
    if (pending.current || isLocked()) return;
    try {
      current();
      if (snapshot().phase === "refused") { command.reset(); if (snapshot().phase !== "idle") return; }
      changeDraft(null); setError(""); setLatest(null); setConflict(false);
    } catch (failure) { fail(failure); }
  };
  const original = state.original;
  const shown = original ? {
    action: original.action, reason: String(original.payload.reason), approvalId: original.payload.approval_id as string | undefined,
    decision: original.payload.decision as "approve" | "reject" | undefined,
    preview: null, intent: null,
  } : draft;
  const payload = original?.payload || draft?.preview?.payload;
  const labels = { start: "start", retry: "retryRun", cancel: "cancelRun", approval: "approveGate", approval_reject: "rejectGate" };
  const reasonList = (reasons: { code: string; message: string }[]) => reasons.map((reason) => t(`deliveryExecutionRuntime.reasons.${reason.code}`, { defaultValue: reason.message })).join(" · ");
  const actionLabel = (action: ExecutionControlAction, decision?: string) => tr(action === "execution.approval" ? decision === "reject" ? "rejectGate" : "approveGate" : labels[action.split(".")[1] as "start" | "retry" | "cancel"]);
  const editReason = () => {
    if (pending.current || isLocked() || !canWrite()) return;
    try {
      current();
      const previous = draftRef.current;
      if (!previous) return;
      if (snapshot().phase === "refused") { command.reset(); if (snapshot().phase !== "idle") return; }
      changeDraft({ ...previous, preview: null, intent: null }); setConflict(false); setLatest(null);
    } catch (failure) { fail(failure); }
  };
  const recovery = (
    <>
      {(state.error || error) && <Alert role="alert" type={confirmed ? "info" : "error"} title={tr(state.error === "retainedOriginalInvalid" || state.error === "retainedOriginalUnavailable" ? state.error : "actionFailed")} description={error || state.error} />}
      {unknown && <Alert role="status" type="warning" title={tr("unknownResult")} description={tr("unknownHint")}
        action={<Space wrap>
          {original && <Button size="small" data-action="query-original" disabled={busy} onClick={queryOriginal}>{tr("queryOriginal")}</Button>}
          {original && <Button size="small" data-action="retry-original" disabled={busy} onClick={() => submit(true)}>{tr("retryOriginal")}</Button>}
        </Space>} />}
      {confirmed && <Alert role="status" type="success" title={tr("actionConfirmed")} description={tr("confirmedStorageUnavailable")}
        action={<Button size="small" data-action="finish-confirmed" disabled={busy} onClick={async () => {
          if (pending.current) return;
          pending.current = true; setBusy(true);
          try { await complete(snapshot().ack); } catch (failure) { fail(failure); }
          finally { pending.current = false; setBusy(false); }
        }}>{tr("finishConfirmed")}</Button>} />}
      {queried && <p role="status" className="runtime-help">{tr("originalStatus")}: {t(`delivery.execution.states.${queried.status}`, { defaultValue: queried.status })} · {tr("attempt")} {queried.attempt}{queried.stop && ` · ${tr(`stop.${queried.stop.state}`)}`}</p>}
    </>
  );
  return <div className="execution-runtime-controls">
    {runtime && <Space wrap>
      {(["start", "retry", "cancel", "approval"] as const).map((key) => <Button key={key} size="small" type={key === "start" ? "primary" : "default"} danger={key === "cancel"}
        disabled={!available(key) || locked || Boolean(shown)} title={reasonList(runtime.controls[key].reasons)} onClick={() => begin(`execution.${key}`, key === "approval" ? "approve" : undefined)}>{tr(labels[key])}</Button>)}
      {runtime.approval && <Button size="small" disabled={!available("approval_reject") || locked || Boolean(shown)} title={reasonList(runtime.controls.approval_reject.reasons)} onClick={() => begin("execution.approval", "reject")}>{tr("rejectGate")}</Button>}
    </Space>}
    {runtime && Object.values(runtime.controls).some((value) => value.reasons.length) && <details className="runtime-help"><summary>{tr("unavailableActions")}</summary><ul>
      {(["start", "retry", "cancel", "approval", "approval_reject"] as const).filter((key) => !runtime.controls[key].allowed && runtime.controls[key].reasons.length).map((key) => <li key={key}>{tr(labels[key])}: {reasonList(runtime.controls[key].reasons)}</li>)}
    </ul></details>}
    {!shown && recovery}
    <Modal open={Boolean(shown)} title={tr("controlTitle")} width={560} className="execution-runtime-control" closable={!locked} maskClosable={false} keyboard={!locked} onCancel={close}
      footer={[
        <Button key="close" disabled={locked} onClick={close}>{tr("close")}</Button>,
        !original && !draft?.preview && <Button key="preview" type="primary" disabled={busy || !draft?.reason.trim() || disabled || readOnly} loading={busy} onClick={preview}>{tr("preview")}</Button>,
        Boolean(draft?.preview) && !original && <Button key="confirm" type="primary" danger={draft?.action === "execution.cancel"} disabled={locked || conflict || disabled || readOnly || !draft?.intent} loading={busy} onClick={() => submit()}>{tr("confirm")}</Button>,
      ]}>
      {shown && <>
        <p>{actionLabel(shown.action, shown.decision)}</p>
        <Descriptions size="small" column={1} items={[
          { key: "execution", label: tr("execution"), children: executionId },
          { key: "run", label: tr("run"), children: String(payload?.run_id ?? runtime?.run_id ?? "—") || "—" },
          { key: "attempt", label: tr("attempt"), children: Number(payload?.attempt ?? runtime?.attempt) || "—" },
          ...(payload ? [{ key: "version", label: tr("fixedVersion"), children: Number(payload.run_version) }] : []),
          ...(shown.approvalId ? [{ key: "approval", label: tr("approval"), children: shown.approvalId }] : []),
        ]} />
        <label htmlFor={`execution-control-reason-${executionId}`}>{tr("reason")}</label>
        <Input.TextArea id={`execution-control-reason-${executionId}`} aria-label={tr("reason")} value={shown.reason} rows={3} maxLength={2000} disabled={locked || Boolean(draft?.preview) || Boolean(original)}
          onChange={(event) => {
            if (!draftRef.current || draftRef.current !== draft || pending.current || snapshot().phase !== "idle" || draftRef.current.preview || !canWrite()) return;
            try { current(); changeDraft({ ...draftRef.current, reason: event.target.value }); } catch (failure) { fail(failure); }
          }} />
        {shown.action === "execution.cancel" && <Alert type="warning" title={tr("cancelConsequence")} />}
        {shown.action === "execution.retry" && runtime?.recovery_requires_review && <Alert type="warning" title={tr("recoveryReview")} />}
        {draft?.preview && !original && <Alert type={draft.preview.allowed ? "info" : "warning"} title={tr(draft.preview.allowed ? "fixedPreview" : "previewDenied")} description={reasonList(draft.preview.reasons)} />}
        {recovery}
        {(conflict || state.phase === "refused") && !unknown && !confirmed && <Alert type="warning" title={tr(state.phase === "refused" ? "operationRefused" : "conflict")} action={<Button size="small" disabled={busy || disabled || readOnly || !draft} onClick={readLatest}>{tr("readLatest")}</Button>} />}
        {latest && <Alert type={latest.allowed ? "info" : "warning"} title={tr("latestPreview")} description={`${tr("fixedVersion")}: ${latest.payload.run_version} · ${reasonList(latest.reasons)}`}
          action={latest.allowed && <Button size="small" disabled={busy || disabled || readOnly} onClick={adopt}>{tr("adopt")}</Button>} />}
        {draft?.preview && !locked && !conflict && <Button size="small" type="link" onClick={editReason}>{tr("editReason")}</Button>}
      </>}
    </Modal>
  </div>;
}
