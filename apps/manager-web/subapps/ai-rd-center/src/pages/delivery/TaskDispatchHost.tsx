import { Alert, Button, Modal, Skeleton, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchDeliveryTaskEditData } from "@/lib/deliveryQuery";
import { fetchDeliveryTargets, openExecutionDraft, executionTargetProblems, type ExecutionDraftSession } from "@/lib/deliveryExecution";
import { fetchTeamRuntimeBindings, selectExecutionMember } from "@/lib/deliveryTeamRuntime";
import { readWorkOrderCurrent } from "@/lib/externalWorkOrders";
import { readSubmissionDetail } from "@/lib/deliveryTaskSubmission";
import type { FeedbackReference } from "@/lib/deliveryFeedback";
import type { DeliveryCommandAck } from "@/lib/delivery";
import type { ExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { commandDraft } from "@/lib/executionCommands";
import { taskDispatchCopy } from "@/i18n/task-dispatch";
import { useDeliveryDraftState } from "@/lib/useDeliveryDraftState";
import { closeTaskDispatchRoute, taskDispatchRequest } from "@/lib/taskDispatchRoute";
import { ExecutionPlanEditor } from "./ExecutionPlanEditor";
import { TaskDispatchFeedback } from "./TaskDispatchFeedback";
import { TaskDispatchChoices } from "./TaskDispatchChoices";
import { dispatchChoices, type TaskDispatchFacts as Facts, type DispatchMode as Mode } from "@/lib/taskDispatchChoices";

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
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [candidate, writeCandidate] = useState<Facts | null>(null);
  const candidateRef = useRef(candidate); candidateRef.current = candidate;
  const setCandidate = (value: Facts | null) => { candidateRef.current = value; writeCandidate(value); };
  const [search, setSearch] = useState(""), [limit, setLimit] = useState(40);
  const current = () => mounted.current && liveIdentity.current === identity && origin.current === projectSessionKey() && queueCommand.current() && access.current.isActive?.() !== false;
  const canProceed = () => current() && access.current.canSubmit?.() !== false && access.current.canStart?.() !== false && ["idle", "refused"].includes(queueCommand.snapshot().phase);
  const canChange = () => !pending.current && canProceed();
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
  const open = async () => { if (!canChange() || draftRef.current) return; pending.current = true; setBusy(true); setError(""); try { const facts = await load(); if (!canProceed() || draftRef.current) throw new Error(copy.changed); if (JSON.stringify(facts.reference) !== JSON.stringify(access.current.feedbackReference)) throw new Error(copy.feedbackInvalid); setSearch(""); setLimit(40); setDraft({ kind: "choice", facts, mode: null, member: null }); } catch (cause) { if (current()) setError((cause as Error).message); } finally { pending.current = false; if (mounted.current) setBusy(false); } };
  useEffect(() => { if (!requestOpen || requestOpen === handled.current || busy || canStart?.() === false || !canChange() || draftRef.current) return; handled.current = requestOpen; void open(); }, [requestOpen, busy, queueCommand.state.phase, isActive, canSubmit, canStart]);
  const close = (expected: Choice | null) => { if (draftRef.current !== expected || !current() || pending.current || !["idle", "refused"].includes(queueCommand.snapshot().phase)) return; handled.current = requestOpen; setDraft(null); setCandidate(null); setError(""); if (access.current.canSubmit?.() !== false) closeTaskDispatchRoute(projectId, taskId); };
  const choose = (expected: Choice, mode: Mode, member: string) => {
    if (!canChange() || draftRef.current !== expected || expected.kind !== "choice" || !sourceMatches()) return;
    if (!dispatchChoices(expected.facts).some((row) => row.mode === mode && row.member === member && row.available)) return;
    setDraft({ ...expected, mode, member }); setCandidate(null); setError("");
  };
  const next = async (expected: Choice) => {
    const value = draftRef.current; if (!canChange() || value !== expected || value?.kind !== "choice" || !value.mode || value.member === null || !dispatchChoices(value.facts).some((row) => row.mode === value.mode && row.member === value.member && row.available)) return;
    pending.current = true; setBusy(true); setError("");
    try { if (JSON.stringify(value.facts.reference) !== JSON.stringify(access.current.feedbackReference)) throw new Error(copy.feedbackInvalid); const fresh = await load(); if (!canProceed() || draftRef.current !== value) return; if (JSON.stringify(fresh.reference) !== JSON.stringify(access.current.feedbackReference)) throw new Error(copy.feedbackInvalid); if (factsKey(value.facts) !== factsKey(fresh)) { setCandidate(fresh); return; }
      if (!dispatchChoices(fresh).some((row) => row.mode === value.mode && row.member === value.member && row.available)) throw new Error(copy.unavailable);
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
  const options = facts ? dispatchChoices(facts) : [], selectedChoice = options.find((row) => shown && row.mode === shown.mode && row.member === shown.member);
  const closeBlocked = busy || !["idle", "refused"].includes(queueCommand.snapshot().phase);
  const route = taskDispatchRequest(typeof location === "undefined" ? "" : location.hash, projectId, taskId);
  return <section className="space-y-3" aria-label={copy.title}>
    {route.invalid && <Alert type="warning" title={copy.feedbackInvalid} action={<Button disabled={closeBlocked || Boolean(draft)} onClick={() => close(null)}>{copy.close}</Button>} />}
    {route.open && requestOpen > 0 && !busy && !draft && !error && !candidate && canChange() && canStart?.() !== false && <Button onClick={() => void open()}>{copy.retry}</Button>}
    {busy && !draft && <Skeleton active title={false} paragraph={{ rows: 2 }} />}{error && !draft && <Alert type="warning" title={error} action={<Button disabled={busy || !canChange()} onClick={() => void open()}>{copy.retry}</Button>} />}
    {shown && facts && <Modal open width={760} title={copy.title} maskClosable={false} closable={!closeBlocked} keyboard={!closeBlocked} onCancel={() => close(shown)} footer={<Space wrap><Button disabled={closeBlocked} onClick={() => close(shown)}>{copy.close}</Button><Button type="primary" loading={busy} disabled={!selectedChoice?.available || !canChange()} onClick={() => next(shown)}>{copy.next}</Button></Space>}>
      <div className="space-y-4"><strong>{facts.data.task.title}</strong><div><strong>{copy.current}</strong><p className="whitespace-pre-wrap">{facts.data.task.description}</p><ul>{(facts.data.task.acceptance_criteria || []).map((text, index) => <li key={index}>{text}</li>)}</ul></div>
      {facts.feedback && <TaskDispatchFeedback detail={facts.feedback} />}{facts.external?.active_work_order_id && <Alert type="warning" title={copy.activeOrder} />}{facts.failures.map((failure, index) => <Alert key={index} type="warning" title={failure} />)}
      <TaskDispatchChoices options={options} value={shown} search={search} limit={limit} disabled={busy || !canChange()} onChoose={(mode, member) => choose(shown, mode, member)} onSearch={(value) => { if (canChange() && draftRef.current === shown) { setSearch(value); setLimit(40); } }} onMore={() => { if (canChange() && draftRef.current === shown) setLimit((value) => value + 40); }} />
      {shown.mode && <p className="runtime-help">{shown.mode === "external" ? copy.externalHint : shown.mode === "command" ? copy.commandHint : copy.nativeHint}</p>}
      {error && <Alert type="warning" title={error} />}{candidate && <Alert type="warning" title={copy.changed} description={<><strong>{candidate.data.task.title}</strong><p className="whitespace-pre-wrap">{candidate.data.task.description}</p><ul>{candidate.data.task.acceptance_criteria?.map((text, index) => <li key={index}>{text}</li>)}</ul></>} action={<Button disabled={busy || !canChange()} onClick={() => { if (canChange() && draftRef.current === shown && candidateRef.current === candidate && JSON.stringify(candidate.reference) === JSON.stringify(access.current.feedbackReference)) { setDraft({ kind: "choice", facts: candidate, mode: null, member: null }); setSearch(""); setLimit(40); setCandidate(null); setError(""); } }}>{copy.refresh}</Button>} />}
      </div></Modal>}
    {draft && !sourceMatches() && <Alert type="warning" title={copy.feedbackInvalid} action={<Button disabled={closeBlocked} onClick={() => close(draft)}>{copy.close}</Button>} />}
    {draft?.kind === "native" && draft.facts.targets && <ExecutionPlanEditor initial={draft.execution} initialTargets={draft.facts.targets} members={draft.facts.data.members} canConfigure={draft.facts.data.permissions.configure && draft.facts.targets.can_configure_policy} sessionId={sessionId} queueCommand={queueCommand} isActive={current} canSubmit={() => draftRef.current === draft && sourceMatches() && canProceed()} contextWarning={!sourceMatches() ? copy.feedbackInvalid : undefined} onSaved={onSaved} onClose={() => close(draft)} onUnresolvedChange={onUnresolvedChange} />}
  </section>;
}
