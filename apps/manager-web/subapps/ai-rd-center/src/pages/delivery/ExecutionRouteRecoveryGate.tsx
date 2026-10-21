import { Alert, Button } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getProjectId } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { invalidateDeliveryQueries } from "@/lib/deliveryQuery";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";
import { executionDispatchRecoveryPending, useExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import { ExecutionQueueRecovery } from "./ExecutionQueueRecovery";
import { ExecutionOperationRecovery, executionOperationPending } from "./ExecutionOperationRecovery";
import { discoverTaskEditRecovery, taskEditRecoveryPending } from "@/lib/taskEditCommand";
import { TaskDefinitionRecoveryOwner } from "./DeliveryTaskDefinitionHost";
import { taskDefinitionCopy } from "@/i18n/task-definition";
import { discoverSubmissionRecovery, externalDeliveryRecoveryPending } from "@/lib/deliveryTaskSubmission";
import { discoverWorkOrderRecovery, workOrderRecoveryPending } from "@/lib/externalWorkOrderCommand";
import { TaskExternalRecoveryOwner } from "./TaskExternalRecovery";
import { deliveryOperationRecoveryCopy } from "@/i18n/delivery-operation-recovery";

type Selection = { projectId: string; kind: "queue" | "execution" | "task-edit" | "submission" | "work-order"; id: string };
const identity = (value: string) => Boolean(value) && value.length <= 64 && !/[\s\u0000-\u001f\u007f]/.test(value);
export function executionRouteRecoverySelection(hash: string, projectId: string): Selection | null {
  if (!/^#\/(?:dev-flow|tasks\/(?:execution|board))(?:\?|$)/.test(hash) || /[\u0000-\u001f\u007f]/.test(hash) || hash.indexOf("#", 1) >= 0) return null;
  const params = new URLSearchParams(hash.split("?")[1]);
  if (!projectId || params.getAll("project_id").length > 1 || params.getAll("execution_id").length > 1 ||
    params.has("project_id") && params.get("project_id") !== projectId) return null;
  const executionId = params.get("execution_id") || "";
  const task = params.get("task") || "", taskId = params.get("task_id") || task;
  if (params.getAll("task").length > 1 || params.getAll("task_id").length > 1 || task && taskId !== task) return null;
  if (params.getAll("execution_id").length === 1 && identity(executionId) && executionOperationPending(projectId, executionId)) return { projectId, kind: "execution", id: executionId };
  if (identity(taskId) && executionDispatchRecoveryPending(projectId, "execution.queue", taskId)) return { projectId, kind: "queue", id: taskId };
  const submissions = discoverSubmissionRecovery(projectId), orders = discoverWorkOrderRecovery(projectId);
  if (identity(taskId) && externalDeliveryRecoveryPending(projectId, taskId)) return { projectId, kind: "submission", id: taskId };
  if (identity(taskId) && workOrderRecoveryPending(projectId, taskId)) return { projectId, kind: "work-order", id: taskId };
  if (submissions[0]) return { projectId, kind: "submission", id: submissions[0] };
  if (orders[0]) return { projectId, kind: "work-order", id: orders[0] };
  const discovered = discoverTaskEditRecovery(projectId), edit = identity(taskId) && taskEditRecoveryPending(projectId, taskId) ? taskId : discovered[0];
  return edit ? { projectId, kind: "task-edit", id: edit } : null;
}
/** Startup recovery precedes context queries; a pending GET cannot replace this host. */
export function ExecutionRouteRecoveryGate({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation(), qc = useQueryClient(), exit = useExecutionExitGuard(), copy = taskDefinitionCopy(i18n?.language), externalCopy = deliveryOperationRecoveryCopy(i18n?.language);
  const projectId = getProjectId() || "", origin = useRef(projectSessionKey()), hash = useRef(location.hash);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const initial = useRef<{ selection: Selection | null; error: string }>();
  if (!initial.current) { try { initial.current = { selection: executionRouteRecoverySelection(hash.current, projectId), error: "" }; } catch { initial.current = { selection: null, error: copy.unavailable }; } }
  const [selected, setSelected] = useState(initial.current.selection), [discoveryError, setDiscoveryError] = useState(initial.current.error);
  const active = useRef(selected), mounted = useRef(true);
  active.current = selected;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { exit.setPending("startup-execution-recovery", Boolean(selected || discoveryError)); }, [selected, discoveryError]);
  const current = () => mounted.current && origin.current === projectSessionKey() && getProjectId() === projectId && active.current === selected;
  const pending = (value: boolean) => {
    if (!current()) return;
    let next: Selection | null;
    try { next = executionRouteRecoverySelection(hash.current, projectId); setDiscoveryError(""); } catch { setDiscoveryError(copy.unavailable); exit.setPending("startup-execution-recovery", true); return; }
    exit.setPending("startup-execution-recovery", value || Boolean(next));
    if (!value && (next?.kind !== selected?.kind || next?.id !== selected?.id)) setSelected(next);
  };
  const saved = (ack: DeliveryCommandAck) => {
    if (current() && ack.project_id === projectId) void invalidateDeliveryQueries(qc, projectId);
  };
  if (discoveryError) return <Alert type="error" title={copy.unavailable} action={<Button onClick={() => { if (!current()) return; try { const next = executionRouteRecoverySelection(hash.current, projectId); setSelected(next); setDiscoveryError(""); exit.setPending("startup-execution-recovery", Boolean(next)); } catch { setDiscoveryError(copy.unavailable); } }}>{copy.retryRecovery}</Button>} />;
  if (!selected) return children;
  const external = selected.kind === "submission" || selected.kind === "work-order";
  return <section className="delivery-workbench space-y-4" aria-label={external ? externalCopy.title : selected.kind === "task-edit" ? copy.recovery : t("deliveryExecutionRuntime.recoveryEntry")}>
    <Alert type="info" role="status" title={external ? externalCopy.title : selected.kind === "task-edit" ? copy.recovery : t("deliveryExecutionRuntime.recoveryEntry")} description={external ? externalCopy.hint : selected.kind === "task-edit" ? copy.recoveryHint : t("deliveryExecutionRuntime.recoveryEntryHint")} />
    <code className="runtime-identity">{selected.projectId} · {selected.id}</code>
    {selected.kind === "submission" || selected.kind === "work-order" ? <TaskExternalRecoveryOwner key={`${projectId}:${selected.kind}:${selected.id}`} kind={selected.kind} projectId={projectId} taskId={selected.id} sessionId={sessionId} isActive={current} onPending={pending} onSaved={saved} onResolved={() => pending(false)} /> : selected.kind === "task-edit" ? <TaskDefinitionRecoveryOwner key={`${projectId}:${sessionId}:${selected.id}`} projectId={projectId} taskId={selected.id} sessionId={sessionId} onPending={pending} onSaved={saved} onResolved={() => pending(false)} /> : selected.kind === "queue" ? <QueueStartupRecovery key={`${projectId}:${sessionId}:${selected.id}`} projectId={projectId} taskId={selected.id}
      sessionId={sessionId} isActive={current} onPending={pending} onSaved={saved} /> :
      <ExecutionOperationRecovery key={`${projectId}:${sessionId}:${selected.id}`} projectId={projectId} executionId={selected.id}
        sessionId={sessionId} isActive={current} onSaved={saved} onUnresolvedChange={pending} />}
  </section>;
}
function QueueStartupRecovery({ projectId, taskId, sessionId, isActive, onPending, onSaved }: {
  projectId: string; taskId: string; sessionId: string; isActive: () => boolean;
  onPending: (value: boolean) => void; onSaved: (ack: DeliveryCommandAck) => void;
}) {
  const command = useExecutionDispatchCommand(projectId, "execution.queue", taskId, sessionId, onPending);
  return <ExecutionQueueRecovery command={command} projectId={projectId} taskId={taskId} isActive={isActive} onSaved={onSaved} onResolved={() => onPending(false)} />;
}
