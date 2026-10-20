import { Alert } from "antd";
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

type Selection = { projectId: string; kind: "queue" | "execution"; id: string };
const identity = (value: string) => Boolean(value) && value.length <= 64 && !/[\s\u0000-\u001f\u007f]/.test(value);
export function executionRouteRecoverySelection(hash: string, projectId: string): Selection | null {
  if (!/^#\/(?:dev-flow|tasks\/(?:execution|board))(?:\?|$)/.test(hash) || /[\u0000-\u001f\u007f]/.test(hash) || hash.indexOf("#", 1) >= 0) return null;
  const params = new URLSearchParams(hash.split("?")[1]);
  if (!projectId || params.getAll("project_id").length > 1 || params.getAll("execution_id").length > 1 ||
    params.has("project_id") && params.get("project_id") !== projectId) return null;
  const executionId = params.get("execution_id") || "";
  if (params.getAll("execution_id").length === 1 && identity(executionId) && executionOperationPending(projectId, executionId)) return { projectId, kind: "execution", id: executionId };
  const task = params.get("task") || "", taskId = params.get("task_id") || task;
  if (params.getAll("task").length > 1 || params.getAll("task_id").length > 1 || task && taskId !== task) return null;
  return identity(taskId) && executionDispatchRecoveryPending(projectId, "execution.queue", taskId) ? { projectId, kind: "queue", id: taskId } : null;
}
/** Startup recovery precedes context queries; a pending GET cannot replace this host. */
export function ExecutionRouteRecoveryGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation(), qc = useQueryClient(), exit = useExecutionExitGuard();
  const projectId = getProjectId() || "", origin = useRef(projectSessionKey()), hash = useRef(location.hash);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [selected, setSelected] = useState(() => executionRouteRecoverySelection(hash.current, projectId));
  const active = useRef(selected), mounted = useRef(true);
  active.current = selected;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { exit.setPending("startup-execution-recovery", Boolean(selected)); }, [selected]);
  const current = () => mounted.current && origin.current === projectSessionKey() && getProjectId() === projectId && active.current === selected;
  const pending = (value: boolean) => {
    if (!current()) return;
    const next = executionRouteRecoverySelection(hash.current, projectId);
    exit.setPending("startup-execution-recovery", value || Boolean(next));
    if (!value && (next?.kind !== selected?.kind || next?.id !== selected?.id)) setSelected(next);
  };
  const saved = (ack: DeliveryCommandAck) => {
    if (current() && ack.project_id === projectId) void invalidateDeliveryQueries(qc, projectId);
  };
  if (!selected) return children;
  return <section className="delivery-workbench space-y-4" aria-label={t("deliveryExecutionRuntime.recoveryEntry")}>
    <Alert type="info" role="status" title={t("deliveryExecutionRuntime.recoveryEntry")} description={t("deliveryExecutionRuntime.recoveryEntryHint")} />
    <code className="runtime-identity">{selected.projectId} · {selected.id}</code>
    {selected.kind === "queue" ? <QueueStartupRecovery key={`${projectId}:${sessionId}:${selected.id}`} projectId={projectId} taskId={selected.id}
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
