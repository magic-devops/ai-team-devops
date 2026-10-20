import { Alert, Button, Space, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import type { ExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { executionHandoffCopy } from "@/i18n/execution-handoff";
import "./delivery-runtime.css";

/** One command owner supplies this view, including before current task/target reads succeed. */
export function ExecutionQueueRecovery({ command, projectId, taskId, onSaved, onResolved, isActive }: {
  command: ExecutionDispatchCommand;
  projectId: string;
  taskId: string;
  onSaved: (ack: DeliveryCommandAck) => void;
  onResolved?: () => void;
  isActive?: () => boolean;
}) {
  const { t, i18n } = useTranslation(), tr = (key: string) => t(`deliveryRuntime.${key}`);
  const handoffCopy = executionHandoffCopy(i18n.language);
  const origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false);
  const confirmed = useRef(false);
  const identity = `${projectId}:${taskId}`, liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  const access = useRef({ command, isActive }); access.current = { command, isActive };
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => {
    if (!mounted.current || origin.current !== projectSessionKey() || identity !== liveIdentity.current ||
      !command.current() || access.current.command.snapshot !== command.snapshot || access.current.isActive?.() === false)
      throw new Error("queueSourceChanged");
  };
  const finish = (ack?: DeliveryCommandAck) => {
    current();
    command.reset();
    if (command.snapshot().phase !== "idle") { setFeedback(tr("queueCleanupFailed")); return; }
    if (ack) {
      confirmed.current = true;
      try { onSaved(ack); } catch { setFeedback(tr("queueRefreshAfterSaveFailed")); }
    }
    onResolved?.();
  };
  const act = async (action: "replay" | "finish" | "dismiss") => {
    if (pending.current) return;
    const before = command.snapshot();
    if (action === "replay" ? before.phase !== "unknown" || !before.original :
      action === "finish" ? before.phase !== "succeeded" || !before.ack : before.phase !== "refused") return;
    pending.current = true; setBusy(true); setFeedback("");
    try {
      current();
      if (action === "replay") {
        const ack = await command.replay();
        current();
        if (ack) finish(ack);
      } else finish(action === "finish" ? before.ack : undefined);
    } catch (failure) {
      if (mounted.current) setFeedback((failure as Error).message === "queueSourceChanged" ? tr("queueSourceChanged") : (failure as Error).message);
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const state = command.state, original = state.original;
  if (state.phase === "idle" && !state.error && !feedback) return null;
  const errorText = state.error === "retainedOriginalUnavailable" ? tr("queueStorageUnavailable") :
    state.error === "retainedOriginalInvalid" ? tr("queueOriginalUnavailable") : state.error;
  if (state.phase === "idle") return <Alert role="status" type={confirmed.current ? "info" : "warning"}
    title={confirmed.current ? handoffCopy.received : tr("queueRecoveryTitle")} description={feedback || errorText} />;
  const field = (key: string) => {
    const value = original?.payload[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "—";
  };
  const nodes = [original?.payload.nodes, original?.payload.test_nodes].flatMap((value) => Array.isArray(value) ? value : []);
  return <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label={tr("queueRecoveryTitle")}>
    <Alert role="status" showIcon type={state.phase === "succeeded" ? "success" : "warning"}
      title={state.phase === "succeeded" ? handoffCopy.received : tr(state.phase === "sending" ? "queueSending" : state.phase === "refused" ? "queueRefused" : "queueUnknown")}
      description={state.phase === "succeeded" ? handoffCopy.receivedHint : tr("queueRequestOnly")} />
    <Space wrap>
      {state.phase === "unknown" && <Button type="primary" disabled={!original || busy} loading={busy} onClick={() => act("replay")}>{tr("queueRetryOriginal")}</Button>}
      {state.phase === "succeeded" && <Button type="primary" disabled={busy || !state.ack} loading={busy} onClick={() => act("finish")}>{tr("queueFinishConfirmed")}</Button>}
      {state.phase === "refused" && <Button disabled={busy} onClick={() => act("dismiss")}>{tr("queueDismissRefused")}</Button>}
    </Space>
    {original ? <>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        {[
          [tr("queueProject"), projectId], [tr("queueTask"), field("task_id")],
          [tr("workspace"), field("workspace_id")], [tr("queueMember"), field("executor_member_id") || tr("queueDirect")],
          [tr("agentProfile"), field("agent_id") || tr("queueNoAgent")],
          [tr("version"), field("agent_version")],
          [tr("queueTarget"), field("target_kind") === "local" ? tr("local") : field("target_device_id")],
        ].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="break-all font-mono text-xs">{value}</dd></div>)}
      </dl>
      <details className="space-y-3 text-sm">
        <summary className="cursor-pointer text-[var(--muted)]">{tr("queueRequestDetails")}</summary>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            [tr("queueOriginalVersion"), original.intent.version], [tr("queueRequestKey"), original.intent.key],
            [tr("queueTaskBasis"), field("task_basis")], [tr("queueTargetBasis"), field("target_basis")],
            [tr("queueBindingBasis"), field("executor_binding_basis") || "—"],
          ].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="break-all font-mono text-xs">{value}</dd></div>)}
        </dl>
      <div className="space-y-2"><strong className="text-sm">{tr("queueOriginalNodes")}</strong><div className="flex flex-wrap gap-2">
        {nodes.map((node: unknown, index) => {
          const record = node as Record<string, unknown>;
          return <Tag key={index}>{String(record.title || record.id)} · {record.kind === "approval" ? t("deliveryExecutionRuntime.approval") : tr(record.kind === "agent" ? "agent" : "command")}</Tag>;
        })}
        {!nodes.length && <span className="text-sm text-[var(--muted)]">{tr("queueNoNodes")}</span>}
      </div></div>
      <p className="break-all text-xs text-[var(--muted)]">{tr("queueTestNodeIds")} · {Array.isArray(original.payload.test_node_ids) ? original.payload.test_node_ids.join(" · ") || "—" : "—"}</p>
      </details>
    </> : <Alert type="error" role="alert" title={tr("queueOriginalUnavailable")} description={tr("queueStorageUnavailable")} />}
    {(state.error || feedback) && <Alert type="warning" role="alert" title={feedback || errorText} />}
  </section>;
}
