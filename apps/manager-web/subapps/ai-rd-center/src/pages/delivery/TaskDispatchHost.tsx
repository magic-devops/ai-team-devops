import { Alert, Button, Modal, Select, Skeleton, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchDeliveryTaskEditData } from "@/lib/deliveryQuery";
import { fetchDeliveryTargets, openExecutionDraft, executionTargetProblems, type DeliveryTargets, type ExecutionDraftSession } from "@/lib/deliveryExecution";
import { fetchTeamRuntimeBindings, selectExecutionMember, type TeamRuntimeBindings } from "@/lib/deliveryTeamRuntime";
import { readWorkOrderCurrent, type WorkOrderCurrent } from "@/lib/externalWorkOrders";
import { readSubmissionDetail, type SubmissionDetail } from "@/lib/deliveryTaskSubmission";
import type { FeedbackReference } from "@/lib/deliveryFeedback";
import type { DeliveryCommandAck, DeliveryTaskData } from "@/lib/delivery";
import type { ExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { commandDraft } from "@/lib/executionCommands";
import { taskDispatchCopy } from "@/i18n/task-dispatch";
import { useDeliveryDraftState } from "@/lib/useDeliveryDraftState";
import { closeTaskDispatchRoute, taskDispatchRequest } from "@/lib/taskDispatchRoute";
import { ExecutionPlanEditor } from "./ExecutionPlanEditor";
import { TaskDispatchFeedback } from "./TaskDispatchFeedback";

type Facts = { reference?: FeedbackReference; data: DeliveryTaskData; targets?: DeliveryTargets; bindings?: TeamRuntimeBindings; external?: WorkOrderCurrent; feedback?: SubmissionDetail; failures: string[] };
type Mode = "agent" | "command" | "external";
type Choice = { kind: "choice"; facts: Facts; mode: Mode | null; member: string | null } | { kind: "native"; facts: Facts; execution: ExecutionDraftSession };
export type ExternalDispatchRequest = { executorId: string; feedback_reference?: FeedbackReference };
// The immutable S digest + decision identity pins the historical body; fresh capability facts remain separate.
function factsKey(f: Facts) { return JSON.stringify([f.reference, f.data.version, f.data.task.basis, f.data.permissions.write, f.data.task.execution_gate,
  f.targets && [f.targets.runtime_configured, f.targets.can_execute, f.targets.workspaces.map((workspace) => [workspace.id, workspace.version, workspace.agents, [workspace.local, ...workspace.devices].map((target) => [target.id, target.kind, target.basis, target.can_execute, target.reason_codes, target.runtime_capabilities, target.providers, target.policy])])],
  f.bindings?.members.map((row) => [row.member_id, row.status, row.binding_basis, row.generation, row.binding?.workspace_id, row.binding?.agent_id, row.binding?.agent_version, row.binding?.profile_digest]), f.external?.active_work_order_id, f.external?.can_dispatch, f.external?.executors, f.failures]); }
export function TaskDispatchHost({ projectId, taskId, sessionId, requestOpen = 0, feedbackReference, queueCommand, onExternal, onSaved, onEditingChange, onUnresolvedChange, isActive, canSubmit, canStart }: {
  projectId: string; taskId: string; sessionId: string; requestOpen?: number; feedbackReference?: FeedbackReference; queueCommand: ExecutionDispatchCommand;
  onExternal: (request: ExternalDispatchRequest) => boolean; onSaved: (ack: DeliveryCommandAck) => void; onEditingChange?: (value: boolean) => void; onUnresolvedChange?: (value: boolean) => void; isActive?: () => boolean; canSubmit?: () => boolean; canStart?: () => boolean;
}) {
  const { i18n } = useTranslation(), copy = taskDispatchCopy(i18n?.language), origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false), handled = useRef(0);
  const identity = `${projectId}:${sessionId}:${taskId}`, liveIdentity = useRef(identity); liveIdentity.current = identity;
  const access = useRef({ isActive, canSubmit, canStart, queueCommand, feedbackReference }); access.current = { isActive, canSubmit, canStart, queueCommand, feedbackReference };
  const [draft, writeDraft] = useDeliveryDraftState<Choice | null>(null, onEditingChange), draftRef = useRef(draft);
  const setDraft = (value: Choice | null) => { draftRef.current = value; writeDraft(value); };
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [candidate, setCandidate] = useState<Facts | null>(null);
  const current = () => mounted.current && liveIdentity.current === identity && origin.current === projectSessionKey() && queueCommand.current() && access.current.isActive?.() !== false;
  const canChange = () => current() && !pending.current && access.current.canSubmit?.() !== false && ["idle", "refused"].includes(queueCommand.snapshot().phase);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load(): Promise<Facts> {
    const hash = typeof location === "undefined" ? "" : location.hash;
    const results = await Promise.allSettled([fetchDeliveryTaskEditData(projectId, taskId), fetchDeliveryTargets(projectId), fetchTeamRuntimeBindings(projectId), readWorkOrderCurrent(projectId, taskId, origin.current), feedbackReference ? readSubmissionDetail(projectId, taskId, feedbackReference.submission_id, origin.current) : Promise.resolve(undefined)]);
    if (!current() || hash !== (typeof location === "undefined" ? "" : location.hash)) throw new Error(copy.failed);
    if (results[0].status !== "fulfilled") throw results[0].reason;
    const data = results[0].value; if (data.project.id !== projectId || data.task.id !== taskId || !data.permissions.write) throw new Error(copy.failed);
    const feedback = results[4].status === "fulfilled" ? results[4].value : undefined;
    if (feedbackReference && (!feedback || feedback.project_id !== projectId || feedback.task_id !== taskId || feedback.submission.digest !== feedbackReference.submission_digest || feedback.decision?.id !== feedbackReference.decision_id || feedback.decision.decision !== "request_changes")) throw new Error(copy.feedbackInvalid);
    const targets = results[1].status === "fulfilled" && results[1].value.project_id === projectId ? results[1].value : undefined;
    const bindings = results[2].status === "fulfilled" && results[2].value.project_id === projectId ? results[2].value : undefined;
    const external = results[3].status === "fulfilled" && results[3].value.project_id === projectId && results[3].value.task_id === taskId ? results[3].value : undefined;
    return { reference: feedbackReference && structuredClone(feedbackReference), data, targets, bindings, external, feedback, failures: results.slice(1, 4).flatMap((value) => value.status === "rejected" ? [(value.reason as Error).message] : []) };
  }
  const open = async () => { if (!canChange() || access.current.canStart?.() === false || draftRef.current) return; pending.current = true; setBusy(true); setError(""); try { const facts = await load(); if (!current() || access.current.canSubmit?.() === false || access.current.canStart?.() === false) throw new Error(copy.changed); if (JSON.stringify(facts.reference) !== JSON.stringify(access.current.feedbackReference)) throw new Error(copy.feedbackInvalid); setDraft({ kind: "choice", facts, mode: null, member: null }); } catch (cause) { if (current()) setError((cause as Error).message); } finally { pending.current = false; if (mounted.current) setBusy(false); } };
  useEffect(() => { if (!requestOpen || requestOpen === handled.current || busy || canStart?.() === false || !canChange() || draftRef.current) return; handled.current = requestOpen; void open(); }, [requestOpen, busy, queueCommand.state.phase, isActive, canSubmit, canStart]);
  const close = () => { if (!current() || pending.current || !["idle", "refused"].includes(queueCommand.snapshot().phase)) return; handled.current = requestOpen; setDraft(null); setCandidate(null); setError(""); if (access.current.canSubmit?.() !== false) closeTaskDispatchRoute(projectId, taskId); };
  const patch = (value: Partial<{ mode: Mode; member: string }>) => { const old = draftRef.current; if (!canChange() || old?.kind !== "choice") return; setDraft({ ...old, ...value, ...(value.mode ? { member: null } : {}) }); setCandidate(null); };
  const next = async () => {
    const value = draftRef.current; if (!canChange() || value?.kind !== "choice" || !value.mode || value.mode !== "command" && value.member === null) return;
    pending.current = true; setBusy(true); setError("");
    try { if (JSON.stringify(value.facts.reference) !== JSON.stringify(access.current.feedbackReference)) throw new Error(copy.feedbackInvalid); const fresh = await load(); if (access.current.canSubmit?.() === false) throw new Error(copy.changed); if (JSON.stringify(fresh.reference) !== JSON.stringify(access.current.feedbackReference)) throw new Error(copy.feedbackInvalid); if (factsKey(value.facts) !== factsKey(fresh)) { setCandidate(fresh); return; }
      if (value.mode === "external") { const member = fresh.external?.executors.find((row) => row.id === value.member && row.active && row.available); if (!fresh.external?.can_dispatch || !member) throw new Error(copy.unavailable); if (!onExternal({ executorId: member.id, ...(fresh.reference ? { feedback_reference: structuredClone(fresh.reference) } : {}) })) throw new Error(copy.unavailable); setDraft(null); return; }
      if (!fresh.targets?.can_execute || !fresh.data.task.execution_gate.eligible || !fresh.external || fresh.external.active_work_order_id) throw new Error(copy.activeOrder);
      let execution = openExecutionDraft(fresh.data, taskId, crypto.randomUUID());
      if (value.mode === "command") execution = { ...execution, mode: "command", commands: [commandDraft("tests")] };
      else if (value.member) { const binding = fresh.bindings?.members.find((row) => row.member_id === value.member); if (!binding) throw new Error(copy.unavailable); execution = selectExecutionMember(execution, binding); const workspace = fresh.targets.workspaces.find((row) => row.id === execution.workspaceId), agent = workspace?.agents.find((row) => row.id === execution.agentId && row.version === execution.agentVersion); if (!agent) throw new Error(copy.changed); const targets = [workspace!.local, ...workspace!.devices].filter((row) => row.can_execute && !executionTargetProblems(row, "agent", agent.provider).length); if (targets.length === 1) execution.target = structuredClone(targets[0]); }
      if (fresh.reference) execution.feedback_reference = structuredClone(fresh.reference);
      setDraft({ kind: "native", facts: fresh, execution });
    } catch (cause) { if (current()) setError((cause as Error).message); } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const sourceMatches = () => JSON.stringify(draftRef.current?.facts.reference) === JSON.stringify(access.current.feedbackReference);
  const shown = draft?.kind === "choice" ? draft : null, facts = shown?.facts;
  const native = Boolean(facts?.data.task.execution_gate.eligible && facts.targets?.can_execute && facts.external && !facts.external.active_work_order_id);
  const memberOptions = shown?.mode === "external" ? facts?.external?.executors.map((row) => ({ value: row.id, label: row.name, disabled: !row.active || !row.available })) : [{ value: "", label: copy.direct }, ...(facts?.bindings?.members || []).map((row) => ({ value: row.member_id, label: facts?.data.members.find((member) => member.id === row.member_id)?.name || row.member_id, disabled: row.status !== "current" || !row.binding }))];
  const route = taskDispatchRequest(typeof location === "undefined" ? "" : location.hash, projectId, taskId);
  return <section className="space-y-3" aria-label={copy.title}>
    {route.invalid && <Alert type="warning" title={copy.feedbackInvalid} action={<Button disabled={!canChange() || Boolean(draft)} onClick={close}>{copy.close}</Button>} />}
    {route.open && requestOpen > 0 && !busy && !draft && !error && !candidate && canChange() && canStart?.() !== false && <Button onClick={() => void open()}>{copy.retry}</Button>}
    {busy && !draft && <Skeleton active title={false} paragraph={{ rows: 2 }} />}{error && !draft && <Alert type="warning" title={error} action={<Button disabled={busy || !canChange()} onClick={() => void open()}>{copy.retry}</Button>} />}
    {shown && facts && <Modal open width={760} title={copy.title} maskClosable={false} closable={!busy} onCancel={close} footer={<Space wrap><Button disabled={busy} onClick={close}>{copy.close}</Button><Button type="primary" loading={busy} disabled={!shown.mode || shown.mode !== "command" && shown.member === null || !canChange()} onClick={next}>{copy.next}</Button></Space>}>
      <div className="space-y-4"><strong>{facts.data.task.title}</strong><div><strong>{copy.current}</strong><p className="whitespace-pre-wrap">{facts.data.task.description}</p><ul>{(facts.data.task.acceptance_criteria || []).map((text, index) => <li key={index}>{text}</li>)}</ul></div>
      {facts.feedback && <TaskDispatchFeedback detail={facts.feedback} />}{facts.external?.active_work_order_id && <Alert type="warning" title={copy.activeOrder} />}{facts.failures.map((failure, index) => <Alert key={index} type="warning" title={failure} />)}
      <label className="block">{copy.method}<Select aria-label={copy.method} className="w-full" value={shown.mode || undefined} disabled={busy} options={[{ value: "agent", label: copy.agent, disabled: !native }, { value: "command", label: copy.command, disabled: !native }, { value: "external", label: copy.external, disabled: !facts.external?.can_dispatch }]} onChange={(mode) => patch({ mode })} /></label>
      {shown.mode && <p>{shown.mode === "external" ? copy.externalHint : shown.mode === "command" ? copy.commandHint : copy.nativeHint}</p>}{shown.mode && shown.mode !== "command" && <label className="block">{copy.member}<Select aria-label={copy.member} className="w-full" value={shown.member} disabled={busy} options={memberOptions} placeholder={copy.chooseMember} onChange={(member) => patch({ member })} /></label>}
      {error && <Alert type="warning" title={error} />}{candidate && <Alert type="warning" title={copy.changed} description={<><strong>{candidate.data.task.title}</strong><p className="whitespace-pre-wrap">{candidate.data.task.description}</p><ul>{candidate.data.task.acceptance_criteria?.map((text, index) => <li key={index}>{text}</li>)}</ul><p>{copy.member}: {candidate.bindings?.members.map((row) => `${row.member_id} · ${row.status} · ${row.binding?.agent_version ?? "—"}`).join("; ")}</p></>} action={<Button disabled={busy || !canChange()} onClick={() => { if (canChange()) { setDraft({ kind: "choice", facts: candidate, mode: null, member: null }); setCandidate(null); setError(""); } }}>{copy.refresh}</Button>} />}
      </div></Modal>}
    {draft && !sourceMatches() && <Alert type="warning" title={copy.feedbackInvalid} action={<Button disabled={!canChange()} onClick={close}>{copy.close}</Button>} />}
    {draft?.kind === "native" && draft.facts.targets && <ExecutionPlanEditor initial={draft.execution} initialTargets={draft.facts.targets} members={draft.facts.data.members} canConfigure={draft.facts.data.permissions.configure && draft.facts.targets.can_configure_policy} sessionId={sessionId} queueCommand={queueCommand} isActive={current} canSubmit={() => sourceMatches() && access.current.canSubmit?.() !== false} contextWarning={!sourceMatches() ? copy.feedbackInvalid : undefined} onSaved={onSaved} onClose={close} onUnresolvedChange={onUnresolvedChange} />}
  </section>;
}
