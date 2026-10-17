import { Alert, Button, Descriptions, Input, Modal, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryWorkspace } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  assertExecutionSession,
  executionRuntimeProblem,
  fetchExecutionRuntime,
  prepareExecutionControl,
  previewExecutionControl,
  submitExecutionControl,
  type ExecutionControlAction,
  type ExecutionControlIntent,
  type ExecutionControlPreview,
  type ExecutionRuntime,
} from "@/lib/executionRuntime";
export type ExecutionRuntimeControlProps = {
  projectId: string;
  executionId: string;
  sessionId: string;
  runtime: ExecutionRuntime;
  disabled?: boolean;
  readOnly?: boolean;
  onSaved: (data: DeliveryWorkspace) => void;
  onObserved: (data: ExecutionRuntime) => void;
  onUnresolvedChange?: (unresolved: boolean) => void;
};
type Draft = {
  action: ExecutionControlAction;
  reason: string;
  decision?: "approve" | "reject";
  approvalId?: string;
  preview: ExecutionControlPreview | null;
  intent: ExecutionControlIntent | null;
};
export function ExecutionRuntimeControl({
  projectId,
  executionId,
  sessionId,
  runtime,
  disabled = false,
  readOnly = false,
  onSaved,
  onObserved,
  onUnresolvedChange,
}: ExecutionRuntimeControlProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryExecutionRuntime.${key}`);
  const origin = useRef(projectSessionKey());
  const session = useRef(sessionId);
  const mounted = useRef(true);
  const pending = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<ExecutionControlPreview | null>(null);
  const [queried, setQueried] = useState<ExecutionRuntime | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => {
    assertExecutionSession(origin.current);
    if (!mounted.current || session.current !== sessionId)
      throw new Error("scopeChanged");
  };
  const allowed = (key: keyof ExecutionRuntime["controls"]) =>
    !readOnly && !disabled && runtime.controls[key].allowed;
  const begin = (
    action: ExecutionControlAction,
    decision?: "approve" | "reject",
  ) => {
    const key =
      action === "execution.approval" && decision === "reject"
        ? "approval_reject"
        : (action.split(".")[1] as keyof ExecutionRuntime["controls"]);
    if (!allowed(key) || busy || unknown || pending.current) return;
    try {
      current();
    } catch {
      setError(tr("scopeChanged"));
      return;
    }
    setDraft({
      action,
      decision,
      reason: "",
      preview: null,
      intent: null,
      approvalId:
        action === "execution.approval" ? runtime.approval?.id : undefined,
    });
    setError("");
    setConflict(false);
    setLatest(null);
    setQueried(null);
  };
  const fail = (failure: unknown, submitted = false) => {
    const info = executionRuntimeProblem(failure);
    setError(
      t(`deliveryExecutionRuntime.reasons.${info.code}`, {
        defaultValue:
          tr(info.message) === `deliveryExecutionRuntime.${info.message}`
            ? info.message
            : tr(info.message),
      }),
    );
    setConflict(info.conflict);
    if (submitted && info.unknown) {
      setUnknown(true);
      onUnresolvedChange?.(true);
    }
  };
  const preview = async () => {
    if (
      !draft ||
      busy ||
      pending.current ||
      !draft.reason.trim() ||
      unknown ||
      disabled ||
      readOnly
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      current();
      const value = await previewExecutionControl(
        projectId,
        executionId,
        draft.action,
        draft.reason,
        draft.approvalId && draft.decision
          ? { id: draft.approvalId, decision: draft.decision }
          : undefined,
      );
      current();
      setDraft({
        ...draft,
        preview: value,
        intent: value.allowed
          ? prepareExecutionControl(
              projectId,
              executionId,
              value,
              crypto.randomUUID(),
            )
          : null,
      });
    } catch (failure) {
      if (mounted.current) fail(failure);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const submit = async (retryOriginal = false) => {
    if (
      !draft?.intent ||
      busy ||
      pending.current ||
      conflict ||
      (!retryOriginal && (unknown || disabled || readOnly))
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    onUnresolvedChange?.(true);
    let unresolved = unknown;
    try {
      current();
      const updated = await submitExecutionControl(draft.intent);
      current();
      onSaved(updated);
      setDraft(null);
      setUnknown(false);
      setQueried(null);
      unresolved = false;
      onUnresolvedChange?.(false);
      try {
        const fresh = await fetchExecutionRuntime(projectId, executionId);
        current();
        onObserved(fresh);
      } catch (failure) {
        if (mounted.current) setError(executionRuntimeProblem(failure).message);
      }
    } catch (failure) {
      if (mounted.current) {
        const info = executionRuntimeProblem(failure);
        unresolved =
          info.unknown &&
          (unknown || draft.intent.scope === projectSessionKey());
        fail(failure, unresolved);
        if (!unresolved) {
          setUnknown(false);
          onUnresolvedChange?.(false);
        }
      }
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        if (!unresolved) onUnresolvedChange?.(false);
      }
    }
  };
  const queryOriginal = async () => {
    if (!draft || busy || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      current();
      const value = await fetchExecutionRuntime(projectId, executionId);
      current();
      setQueried(value);
      onObserved(value);
    } catch (failure) {
      if (mounted.current) setError(executionRuntimeProblem(failure).message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const readLatest = async () => {
    if (!draft || busy || unknown || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      current();
      const value = await previewExecutionControl(
        projectId,
        executionId,
        draft.action,
        draft.reason,
        draft.approvalId && draft.decision
          ? { id: draft.approvalId, decision: draft.decision }
          : undefined,
      );
      current();
      setLatest(value);
    } catch (failure) {
      if (mounted.current) setError(executionRuntimeProblem(failure).message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const adopt = () => {
    if (!latest?.allowed || !draft || busy || unknown) return;
    try {
      current();
      setDraft({
        ...draft,
        preview: latest,
        intent: prepareExecutionControl(
          projectId,
          executionId,
          latest,
          crypto.randomUUID(),
        ),
      });
      setConflict(false);
      setLatest(null);
      setError("");
    } catch (failure) {
      fail(failure);
    }
  };
  const close = () => {
    if (!busy && !unknown && !pending.current) {
      setDraft(null);
      setError("");
      setLatest(null);
    }
  };
  const labels = {
    start: "start",
    retry: "retryRun",
    cancel: "cancelRun",
    approval: "approveGate",
    approval_reject: "rejectGate",
  };
  const reasonList = (reasons: { code: string; message: string }[]) =>
    reasons
      .map((reason) =>
        t(`deliveryExecutionRuntime.reasons.${reason.code}`, {
          defaultValue: reason.message,
        }),
      )
      .join(" · ");
  const locked = busy || unknown;
  return (
    <div className="execution-runtime-controls">
      <Space wrap>
        {(["start", "retry", "cancel", "approval"] as const).map((key) => (
          <Button
            key={key}
            size="small"
            type={key === "start" ? "primary" : "default"}
            danger={key === "cancel"}
            disabled={!allowed(key) || busy || unknown || Boolean(draft)}
            title={reasonList(runtime.controls[key].reasons)}
            onClick={() =>
              begin(
                `execution.${key}`,
                key === "approval" ? "approve" : undefined,
              )
            }
          >
            {tr(labels[key])}
          </Button>
        ))}
        {runtime.approval && (
          <Button
            size="small"
            disabled={
              !allowed("approval_reject") || busy || unknown || Boolean(draft)
            }
            title={reasonList(runtime.controls.approval_reject.reasons)}
            onClick={() => begin("execution.approval", "reject")}
          >
            {tr("rejectGate")}
          </Button>
        )}
      </Space>
      {Object.values(runtime.controls).some(
        (control) => control.reasons.length,
      ) && (
        <details className="runtime-help">
          <summary>{tr("unavailableActions")}</summary>
          <ul>
            {(
              [
                "start",
                "retry",
                "cancel",
                "approval",
                "approval_reject",
              ] as const
            )
              .filter(
                (key) =>
                  !runtime.controls[key].allowed &&
                  runtime.controls[key].reasons.length,
              )
              .map((key) => (
                <li key={key}>
                  {tr(labels[key])}: {reasonList(runtime.controls[key].reasons)}
                </li>
              ))}
          </ul>
        </details>
      )}
      {!draft && error && <Alert role="alert" type="error" title={error} />}
      <Modal
        open={Boolean(draft)}
        title={tr("controlTitle")}
        width={560}
        className="execution-runtime-control"
        closable={!locked}
        maskClosable={false}
        keyboard={!locked}
        onCancel={close}
        footer={[
          <Button key="close" disabled={locked} onClick={close}>
            {tr("close")}
          </Button>,
          !draft?.preview && (
            <Button
              key="preview"
              type="primary"
              disabled={busy || !draft?.reason.trim()}
              loading={busy}
              onClick={preview}
            >
              {tr("preview")}
            </Button>
          ),
          Boolean(draft?.preview) && (
            <Button
              key="confirm"
              type="primary"
              danger={draft?.action === "execution.cancel"}
              disabled={
                busy ||
                unknown ||
                conflict ||
                disabled ||
                readOnly ||
                !draft?.intent
              }
              loading={busy && !unknown}
              onClick={() => submit()}
            >
              {tr("confirm")}
            </Button>
          ),
        ]}
      >
        {draft && (
          <>
            <p>
              {tr(
                draft.action === "execution.approval"
                  ? draft.decision === "reject"
                    ? "rejectGate"
                    : "approveGate"
                  : labels[
                      draft.action.split(".")[1] as "start" | "retry" | "cancel"
                    ],
              )}
            </p>
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "execution",
                  label: tr("execution"),
                  children: executionId,
                },
                {
                  key: "run",
                  label: tr("run"),
                  children:
                    draft.preview?.payload.run_id || runtime.run_id || "—",
                },
                {
                  key: "attempt",
                  label: tr("attempt"),
                  children: draft.preview?.payload.attempt ?? runtime.attempt,
                },
                ...(draft.preview
                  ? [
                      {
                        key: "version",
                        label: tr("fixedVersion"),
                        children: draft.preview.payload.run_version,
                      },
                    ]
                  : []),
                ...(draft.approvalId
                  ? [
                      {
                        key: "approval",
                        label: tr("approval"),
                        children: draft.approvalId,
                      },
                    ]
                  : []),
              ]}
            />
            <label htmlFor={`execution-control-reason-${executionId}`}>
              {tr("reason")}
            </label>
            <Input.TextArea
              id={`execution-control-reason-${executionId}`}
              aria-label={tr("reason")}
              value={draft.reason}
              rows={3}
              maxLength={2000}
              disabled={busy || Boolean(draft.preview) || unknown}
              onChange={(event) =>
                setDraft({ ...draft, reason: event.target.value })
              }
            />
            {draft.action === "execution.cancel" && (
              <Alert type="warning" title={tr("cancelConsequence")} />
            )}
            {draft.action === "execution.retry" &&
              runtime.recovery_requires_review && (
                <Alert type="warning" title={tr("recoveryReview")} />
              )}
            {draft.preview && (
              <Alert
                type={draft.preview.allowed ? "info" : "warning"}
                title={tr(
                  draft.preview.allowed ? "fixedPreview" : "previewDenied",
                )}
                description={reasonList(draft.preview.reasons)}
              />
            )}
            {error && <Alert role="alert" type="error" title={error} />}
            {unknown && (
              <Alert
                role="status"
                type="warning"
                title={tr("unknownResult")}
                description={tr("unknownHint")}
                action={
                  <Space wrap>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={queryOriginal}
                    >
                      {tr("queryOriginal")}
                    </Button>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => submit(true)}
                    >
                      {tr("retryOriginal")}
                    </Button>
                  </Space>
                }
              />
            )}
            {queried && (
              <p role="status" className="runtime-help">
                {tr("originalStatus")}:{" "}
                {t(`delivery.execution.states.${queried.status}`, {
                  defaultValue: queried.status,
                })}{" "}
                · {tr("attempt")} {queried.attempt}
                {queried.stop && ` · ${tr(`stop.${queried.stop.state}`)}`}
              </p>
            )}
            {conflict && (
              <Alert
                type="warning"
                title={tr("conflict")}
                action={
                  <Button
                    size="small"
                    disabled={busy || unknown}
                    onClick={readLatest}
                  >
                    {tr("readLatest")}
                  </Button>
                }
              />
            )}
            {latest && (
              <Alert
                type={latest.allowed ? "info" : "warning"}
                title={tr("latestPreview")}
                description={`${tr("fixedVersion")}: ${latest.payload.run_version} · ${reasonList(latest.reasons)}`}
                action={
                  latest.allowed && (
                    <Button size="small" disabled={busy} onClick={adopt}>
                      {tr("adopt")}
                    </Button>
                  )
                }
              />
            )}
            {draft.preview && !locked && !conflict && (
              <Button
                size="small"
                type="link"
                onClick={() =>
                  setDraft({ ...draft, preview: null, intent: null })
                }
              >
                {tr("editReason")}
              </Button>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
