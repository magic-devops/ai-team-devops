import { Alert, Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useExecutionDispatchCommand } from "@/lib/executionDispatchCommand";

export type ExecutionSyncControlProps = {
  projectId: string; executionId: string; sessionId: string; workspaceVersion?: number;
  canSync?: boolean; disabled?: boolean; isActive?: () => boolean;
  onSaved: (ack: DeliveryCommandAck) => void;
  onObserved?: () => Promise<void>;
  onUnresolvedChange?: (value: boolean) => void;
};
/** Sync may create a runtime plan. A failed response cannot prove that no plan exists. */
export function ExecutionSyncControl({ projectId, executionId, sessionId, workspaceVersion,
  canSync = false, disabled = false, isActive, onSaved, onObserved, onUnresolvedChange }: ExecutionSyncControlProps) {
  const { t } = useTranslation(), tr = (key: string) => t(`deliveryExecutionRuntime.${key}`);
  const origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false), generation = useRef(0);
  const epoch = generation.current, identity = JSON.stringify([projectId, executionId, sessionId]);
  const active = useRef({ identity, canSync, disabled, isActive, workspaceVersion });
  active.current = { identity, canSync, disabled, isActive, workspaceVersion };
  const [error, setError] = useState("");
  const command = useExecutionDispatchCommand(projectId, "execution.sync", executionId, sessionId, onUnresolvedChange);
  const state = command.state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && active.current.identity === identity && origin.current === projectSessionKey() && command.current() && active.current.isActive?.() !== false;
  const complete = async (ack: DeliveryCommandAck | undefined) => {
    if (!ack || !current()) return;
    command.reset();
    if (command.snapshot().phase !== "idle") { setError(tr("confirmedStorageUnavailable")); return; }
    generation.current++;
    try { onSaved(ack); } catch { setError(tr("refreshAfterSaveFailed")); }
    try { await onObserved?.(); } catch { if (current()) setError(tr("refreshAfterSaveFailed")); }
  };
  const submit = async (replay = false) => {
    const latest = active.current;
    if (!current() || pending.current || !replay && (epoch !== generation.current || latest.disabled || !latest.canSync ||
      !Number.isSafeInteger(latest.workspaceVersion) || Number(latest.workspaceVersion) < 0 || command.snapshot().phase !== "idle")) return;
    if (replay && command.snapshot().phase !== "unknown") return;
    pending.current = true; setError("");
    try {
      const ack = replay ? await command.replay() : await command.run({ action: "execution.sync", payload: { id: executionId },
        intent: { version: latest.workspaceVersion!, key: crypto.randomUUID() } });
      await complete(ack);
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : tr("actionFailed")); }
    finally { pending.current = false; }
  };
  const retained = state.original;
  return <section className="space-y-2 execution-sync-control" aria-label={tr("syncTitle")}>
    {canSync && <Button size="small" data-action="sync-execution" disabled={disabled || command.locked || state.phase !== "idle"}
      loading={state.phase === "sending"} onClick={() => submit()}>{t("deliveryRuntime.sync")}</Button>}
    {retained && <p className="runtime-help"><strong>{tr("syncTitle")}</strong> · {executionId} · {tr("syncProjectVersion")} {retained.intent.version}</p>}
    {state.phase === "sending" && <p role="status" className="runtime-help">{tr("syncSending")}</p>}
    {state.phase === "unknown" && <Alert role="status" type="warning" title={tr("syncUnknown")} description={tr("syncUnknownHint")}
      action={retained && <Button size="small" data-action="retry-sync-original" onClick={() => submit(true)}>{tr("retryOriginal")}</Button>} />}
    {state.phase === "succeeded" && <Alert role="status" type="success" title={tr("actionConfirmed")} description={tr("confirmedStorageUnavailable")}
      action={<Button size="small" data-action="finish-sync-confirmed" onClick={async () => {
        if (!current() || pending.current) return;
        pending.current = true;
        try { await complete(command.snapshot().ack); } finally { pending.current = false; }
      }}>{tr("finishConfirmed")}</Button>} />}
    {state.phase === "refused" && <Alert type="warning" title={tr("operationRefused")} />}
    {(state.error || error) && <Alert role="alert" type={state.phase === "succeeded" ? "info" : "error"}
      title={tr(state.error === "retainedOriginalInvalid" || state.error === "retainedOriginalUnavailable" ? state.error : "actionFailed")} description={error || state.error} />}
    {retained && <p className="runtime-help">{tr("syncConsequence")}</p>}
  </section>;
}
