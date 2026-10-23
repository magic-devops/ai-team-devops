import { Alert, Button, Modal, Skeleton, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { discoverTaskPlans, PLAN_RETENTION_EVENT, type TaskPlanRetention } from "@/lib/taskPlanRetention";
import { useTaskPlanRetention } from "@/lib/useTaskPlanRetention";
import { taskPlanEditorHash, taskPlanRouteRequirement } from "@/lib/taskPlanRoute";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { fetchEditableRequirement, type DeliveryCommandAck, type DeliveryContext } from "@/lib/deliveryQuery";
import type { RequirementEditableResponse } from "@/lib/deliveryRequirementReads";
import { DeliveryTaskPlanForm } from "./DeliveryTaskPlanEditor";
import { TaskPlanRecoveryModal } from "./TaskPlanRecoveryModal";

export type TaskPlanLiveRead = { data?: DeliveryContext; pending: boolean; failed: boolean; refresh: () => Promise<DeliveryContext> };
type ReviewBarrier = { owner: TaskPlanRetention; pending: boolean; error?: unknown; context?: DeliveryContext; definition?: RequirementEditableResponse };
export function TaskPlanRecoveryWorkspace({ projectId, requirementId, sessionId, onClose, onSaved, onPending, liveRead }: {
  projectId: string; requirementId: string; sessionId: string; onClose: () => void;
  onSaved: (ack: DeliveryCommandAck) => void; onPending: (value: boolean) => void; liveRead: TaskPlanLiveRead;
}) {
  const { t } = useTranslation(), tr = (key: string) => t(`delivery.taskPlan.${key}`);
  const retention = useTaskPlanRetention(projectId, requirementId, onPending);
  const requirement = useQuery({ queryKey: ["delivery-plan-requirement", projectId, sessionId, requirementId, liveRead.data?.version, liveRead.data?.query_generation],
    queryFn: () => fetchEditableRequirement(projectId, requirementId), enabled: Boolean(liveRead.data && !liveRead.pending && !liveRead.failed),
    retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const [reviewState, setReview] = useState<ReviewBarrier | null>(null), barrier = useRef<ReviewBarrier | null>(null);
  const review = reviewState?.owner === retention.store ? reviewState : null;
  const current = useRef({ liveRead, requirement }); current.current = { liveRead, requirement };
  const matchesReview = () => {
    const check = barrier.current?.owner === retention.store ? barrier.current : null, { liveRead: live, requirement: read } = current.current;
    if (!check) return true;
    return !check.pending && !check.error && !read.isFetching && Boolean(check.context && check.definition &&
      live.data?.project.id === check.context.project.id && live.data?.version === check.context.version &&
      live.data?.query_generation === check.context.query_generation && live.data?.permissions.write === check.context.permissions.write &&
      read.data?.version === check.definition.version && read.data?.query_generation === check.definition.query_generation &&
      read.data?.requirement.basis === check.definition.requirement.basis);
  };
  const recheck = () => {
    if (barrier.current?.owner === retention.store && barrier.current.pending || !retention.store.current()) return;
    barrier.current = { owner: retention.store, pending: true }; setReview(barrier.current);
    void Promise.all([liveRead.refresh(), requirement.refetch()]).then(([context, result]) => {
      if (!retention.store.current()) return;
      const definition = result.data;
      if (result.isError || !definition || context.project.id !== projectId || definition.project_id !== projectId ||
        definition.requirement.id !== requirementId || definition.version !== context.version || definition.query_generation !== context.query_generation)
        throw result.error || new Error(tr("currentReadFailed"));
      barrier.current = { owner: retention.store, pending: false, context, definition }; setReview(barrier.current);
    }).catch((error) => { if (retention.store.current()) { barrier.current = { owner: retention.store, pending: false, error }; setReview(barrier.current); } });
  };
  useEffect(() => {
    if (review && matchesReview()) { barrier.current = null; setReview(null); }
  }, [review, liveRead, requirement.data, requirement.isFetching]);
  const canWriteCurrent = () => {
    const { liveRead: live, requirement: read } = current.current, data = live.data, definition = read.data;
    return matchesReview() && !live.pending && !live.failed && !read.isPending && !read.isError && Boolean(data?.permissions.write) &&
      data?.project.id === projectId && definition?.project_id === projectId && definition?.requirement.id === requirementId &&
      definition.version === data.version && definition.query_generation === data.query_generation;
  };
  const close = () => { retention.store.close(); onPending(false); onClose(); };
  if (!retention.view.owned || retention.view.command.phase !== "idle") return <TaskPlanRecoveryModal
    store={retention.store} onClose={close} onSaved={onSaved} onUnresolvedChange={onPending}
    onEdit={recheck} />;
  if (review?.pending || liveRead.pending || !liveRead.failed && requirement.isPending) return <Modal open footer={null} onCancel={close} title={tr("title")}><Skeleton active /></Modal>;
  const data = !liveRead.failed ? liveRead.data : undefined, definition = !requirement.isError ? requirement.data : undefined;
  if (!matchesReview() || !data || !definition || data.project.id !== projectId || definition.project_id !== projectId || definition.requirement.id !== requirementId ||
    definition.version !== data.version || definition.query_generation !== data.query_generation) return <TaskPlanRecoveryModal
    store={retention.store} onClose={close} onSaved={onSaved} onUnresolvedChange={onPending}
    readError={review?.error || requirement.error || tr("currentReadFailed")} onRetryCurrent={recheck} />;
  return <DeliveryTaskPlanForm data={data} requirement={definition.requirement} requirementVersion={definition.version}
    retention={retention} canWriteCurrent={canWriteCurrent} onClose={close} onSaved={onSaved} onUnresolvedChange={onPending} />;
}

/** Remains present before context/requirement reads, including missing and denied records. */
export function TaskPlanRecoveryGateway({ projectId, sessionId, onSaved, onPending, canNavigate, liveRead }: {
  projectId: string; sessionId: string; onSaved: (ack: DeliveryCommandAck, requirementId: string) => void;
  onPending: (value: boolean) => void; canNavigate: () => boolean; liveRead: TaskPlanLiveRead;
}) {
  const { t } = useTranslation(), tr = (key: string) => t(`delivery.taskPlan.${key}`), owner = useRef(projectSessionKey());
  const [openId, setOpenId] = useState(() => taskPlanRouteRequirement(location.hash, projectId)), [, tick] = useState(0);
  useEffect(() => {
    const route = () => { if (owner.current === projectSessionKey()) setOpenId(taskPlanRouteRequirement(location.hash, projectId)); };
    const local = () => { if (owner.current === projectSessionKey()) tick((n) => n + 1); };
    for (const name of ["hashchange", "popstate"]) window.addEventListener(name, route);
    for (const name of [PLAN_RETENTION_EVENT, "storage"]) window.addEventListener(name, local);
    return () => {
      for (const name of ["hashchange", "popstate"]) window.removeEventListener(name, route);
      for (const name of [PLAN_RETENTION_EVENT, "storage"]) window.removeEventListener(name, local);
    };
  }, [projectId]);
  let plans: ReturnType<typeof discoverTaskPlans> = [], failed = false;
  try { plans = discoverTaskPlans(projectId); } catch { failed = true; }
  const close = () => {
    if (owner.current !== projectSessionKey() || taskPlanRouteRequirement(location.hash, projectId) !== openId) return;
    history.replaceState(history.state, "", taskPlanEditorHash(projectId, "")); setOpenId("");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return <>
    {failed && <Alert type="warning" title={tr("local.unavailable")} />}
    {plans.length > 0 && <section className="delivery-plan-recovery-index" aria-label={tr("localPlans")}>
      <strong>{tr("localPlans")}</strong><small>{tr("localOnly")}</small>
      <div className="delivery-actions">{plans.map((plan) => <Button key={plan.requirementId} disabled={Boolean(openId)} onClick={() => {
        if (owner.current === projectSessionKey() && canNavigate()) location.hash = taskPlanEditorHash(projectId, plan.requirementId);
      }}>{plan.title}<Tag>{tr(`retainedPhase.${plan.phase}`)}</Tag></Button>)}</div>
    </section>}
    {openId && <TaskPlanRecoveryWorkspace key={`${projectId}:${sessionId}:${openId}`} projectId={projectId} requirementId={openId} sessionId={sessionId}
      liveRead={liveRead} onPending={onPending} onClose={close} onSaved={(ack) => {
        if (owner.current !== projectSessionKey() || taskPlanRouteRequirement(location.hash, projectId) !== openId) return;
        onPending(false); close(); onSaved(ack, openId);
      }} />}
  </>;
}
