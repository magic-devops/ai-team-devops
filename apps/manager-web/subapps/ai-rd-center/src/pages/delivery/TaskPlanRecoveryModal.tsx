import { Alert, Button, Modal, Popconfirm, Skeleton, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { fetchDeliveryContext, fetchDeliveryReferences, type TaskSummary } from "@/lib/deliveryQuery";
import type { TaskPlanRetention } from "@/lib/taskPlanRetention";

export function TaskPlanRecoveryModal({ store, onClose, onSaved, onEdit, onUnresolvedChange, readError, onRetryCurrent }: {
  store: TaskPlanRetention; onClose: () => void; onSaved: (ack: DeliveryCommandAck) => void | Promise<void>;
  onEdit?: () => void; onUnresolvedChange?: (value: boolean) => void;
  readError?: unknown; onRetryCurrent?: () => void;
}) {
  const { t } = useTranslation(), tr = (key: string) => t(`delivery.taskPlan.${key}`);
  const [busy, setBusy] = useState(false), active = useRef(false), [error, setError] = useState("");
  const view = store.snapshot(), command = view.command;
  const close = () => {
    if (active.current || command.phase === "sending" || view.status === "unavailable" && view.owned) return;
    store.close(); onUnresolvedChange?.(false); onClose();
  };
  const run = async (action: () => Promise<void>) => {
    if (active.current || !store.current()) return;
    active.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { if (store.current()) setError((cause as Error).message); }
    finally { active.current = false; setBusy(false); }
  };
  const showTasks = () => void run(async () => {
    const state = store.snapshot().command;
    if (state.phase !== "succeeded" || !state.ack || !store.retainReceipt()) return;
    const context = await fetchDeliveryContext(state.ack.project_id);
    if (!store.current()) return;
    if (context.project.id !== state.ack.project_id || context.version < state.ack.applied_version) throw new Error(tr("currentReadFailed"));
    const ids = state.ack.result?.task_ids as string[];
    const tasks = await fetchDeliveryReferences<TaskSummary>(state.ack.project_id, "task", { ids }, undefined, context.query_generation);
    if (!store.current() || ids.some((id) => !tasks.items.some((item) => item.id === id && item.data.id === id && item.data.req_id === state.original?.payload.requirement_id)))
      throw new Error(tr("currentReadFailed"));
    // Keep the receipt when the caller cannot refresh or navigate. Viewing never sends tasks.plan.
    onUnresolvedChange?.(false); await onSaved(state.ack);
  });
  return <Modal open className="delivery-task-plan-recovery" title={tr("recoveryTitle")} footer={null} width={720} maskClosable={false}
    closable={!busy && command.phase !== "sending"} onCancel={close}>
    <p className="delivery-hint">{tr("recoveryHint")}</p>
    <Tag>{view.draft?.requirement.id || command.original?.payload.requirement_id}</Tag>
    <Tag color={command.phase === "succeeded" ? "green" : command.phase === "unknown" ? "orange" : undefined}>
      {tr(`retainedPhase.${command.phase === "idle" ? "draft" : command.phase}`)}
    </Tag>
    {view.draft && <h3>{view.draft.requirement.title}</h3>}
    {view.status === "opening" ? <Skeleton active /> : <Alert showIcon
      type={["unavailable", "invalid", "changed"].includes(view.status) ? "error" : "info"}
      title={tr(`local.${view.status}`)} />}
    {command.original && <dl className="delivery-facts">
      <div><dt>{tr("originalVersion")}</dt><dd>{command.original.intent.version}</dd></div>
      <div><dt>{tr("originalKey")}</dt><dd><code>{command.original.intent.key}</code></dd></div>
      <div><dt>{tr("plannedItems")}</dt><dd>{command.original.payload.items.length}</dd></div>
    </dl>}
    {command.error && command.error !== "retainedOriginalUnavailable" && <Alert type="warning" title={command.error} />}
    {error && <Alert type="error" title={error} />}
    {Boolean(readError) && <Alert type="warning" title={tr("currentReadFailed")} description={String(readError)}
      action={<Button onClick={onRetryCurrent}>{t("delivery.refresh")}</Button>} />}
    {view.draft && <details><summary>{tr("localDraftContents")}</summary>
      <p>{view.draft.requirement.description}</p>
      <ol>{view.draft.rows.map((row) => <li key={row.key}><strong>{row.title || row.key}</strong>
        <p>{row.description}</p><code>{row.owner_id}</code><ul>{row.acceptance_criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
      </li>)}</ol>
    </details>}
    <div className="delivery-actions">
      {view.status === "unavailable" && view.draft && ["idle", "refused"].includes(command.phase) && <Button disabled={busy}
        onClick={() => { if (!active.current && view.draft) store.saveDraft(view.draft); }}>{tr("retryLocalSave")}</Button>}
      {view.status === "busy" && <Button type="primary" onClick={() => store.open()}>{t("delivery.refresh")}</Button>}
      {command.phase === "unknown" && command.original && <Button type="primary" loading={busy} disabled={!view.owned}
        onClick={() => void run(async () => { await store.replay(); })}>{t("deliveryDiscussion.retryOriginal")}</Button>}
      {command.phase === "refused" && onEdit && <Button disabled={!view.owned || busy} onClick={() => {
        if (!store.current() || active.current) return; store.editRefused(); if (store.snapshot().command.phase === "idle") onEdit();
      }}>{tr("reviewRefused")}</Button>}
      {command.phase === "succeeded" && <Button type="primary" loading={busy} disabled={!view.owned} onClick={showTasks}>{tr("viewCreated")}</Button>}
      {["idle", "refused", "succeeded"].includes(command.phase) && view.owned && <Popconfirm title={tr("discardConfirm")}
        onConfirm={() => { if (!active.current && store.discard()) { store.close(); onUnresolvedChange?.(false); onClose(); } }}>
        <Button danger disabled={busy}>{tr("discardLocal")}</Button>
      </Popconfirm>}
      <Button disabled={busy || command.phase === "sending" || view.status === "unavailable" && view.owned} onClick={close}>{tr("resumeLater")}</Button>
      {view.status === "unavailable" && view.owned && command.phase !== "sending" && <Popconfirm title={tr("closeUnsavedConfirm")}
        onConfirm={() => { if (!active.current) { store.close(); onUnresolvedChange?.(false); onClose(); } }}>
        <Button disabled={busy}>{tr("closeUnsaved")}</Button>
      </Popconfirm>}
    </div>
    {command.phase === "succeeded" && <ul>{(command.ack?.result?.task_ids as string[] || []).map((id) => <li key={id}><code>{id}</code></li>)}</ul>}
  </Modal>;
}
