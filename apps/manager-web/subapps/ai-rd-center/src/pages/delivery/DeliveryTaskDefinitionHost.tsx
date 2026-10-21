import { Alert, Button, Input, Modal, Select, Skeleton, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck, DeliveryTaskData } from "@/lib/delivery";
import { fetchDeliveryTaskEditData } from "@/lib/deliveryQuery";
import { adoptTaskEdit, openTaskEdit, taskEditPayload, type TaskEditSession } from "@/lib/deliveryTaskEditing";
import { useDeliveryDraftState } from "@/lib/useDeliveryDraftState";
import { beginProgressExactRead } from "@/lib/deliveryProgress";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { closeTaskDefinitionRoute, readTaskDefinitionSource, taskDefinitionRequest } from "@/lib/taskDefinitionRoute";
import { taskDefinitionCopy } from "@/i18n/task-definition";
import { useTaskEditCommand, validTaskEditOriginal, type TaskEditCommand, type TaskEditOriginal } from "@/lib/taskEditCommand";
import type { DiscussionAdoption, DiscussionSourceReference } from "@/lib/deliveryDiscussions";
import { DeliveryReferenceSelect } from "@/components/DeliveryReferenceSelect";
import { TaskCriteriaEditor } from "./TaskCriteriaEditor";
import { DiscussionSourceCard } from "./DeliveryDiscussionCommon";
import { applyDiscussionAdoption } from "./DeliveryDiscussionAdoptionSource";
import { remapCriterionIndexes } from "@/lib/deliveryTaskPlan";

type Values = Record<string, unknown> & { title: string; description: string; acceptance_criteria: string[]; requirement_criteria_indices: string[]; depends_on: string[]; starts_on: string | null; ends_on: string | null; blocked_reason: string };
type Shortcut = { owner_id: string } | { status: "pending" | "in_progress" | "blocked" | "completed" };
type Draft = { shortcut?: Shortcut; session: TaskEditSession; values: Values; key: string; source?: DiscussionAdoption; sourceReference?: DiscussionSourceReference };
function definitionValues(session: TaskEditSession): Values {
  const task = session.task;
  return { title: task.title, description: task.description || "", acceptance_criteria: [...(task.acceptance_criteria || [])],
    requirement_criteria_indices: remapCriterionIndexes(task.planning?.requirement_criteria_indices || [], task.planning?.requirement_snapshot?.acceptance_criteria || session.criteria, session.criteria).map(String), depends_on: [...(task.planning?.depends_on || [])],
    starts_on: task.planning?.starts_on || null, ends_on: task.planning?.ends_on || null, blocked_reason: task.planning?.blocked_reason || "" };
}
export function TaskDefinitionOriginal({ original, current = false }: { original?: TaskEditOriginal; current?: boolean }) {
  const { i18n } = useTranslation(), copy = taskDefinitionCopy(i18n?.language);
  if (!original) return <Alert type="error" title={copy.unavailable} />;
  const labels: Record<string, string> = { title: copy.title, description: copy.description, acceptance_criteria: copy.criteria, requirement_criteria_indices: copy.requirementCriteria,
    depends_on: copy.dependencies, starts_on: copy.starts, ends_on: copy.ends, blocked_reason: copy.blocker, owner_id: copy.owner, status: copy.status };
  return <section aria-label={current ? copy.currentDefinition : copy.originalFields} className="space-y-2"><p>{current ? copy.currentVersion : copy.version}: {original.intent.version}</p>
    <dl className="grid gap-2">{Object.entries(original.payload).filter(([key]) => labels[key]).map(([key, value]) => <div key={key}><dt className="text-xs text-[var(--muted)]">{labels[key]}</dt><dd className="whitespace-pre-wrap break-words">{Array.isArray(value) ? value.join("\n") || "—" : value === null || value === "" ? "—" : String(value)}</dd></div>)}</dl>
    {original.source_reference && <p className="runtime-help">{copy.source}</p>}
    <details><summary>{copy.trace}</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(original, null, 2)}</pre></details>
  </section>;
}
/** Recovery owns no current reads or fresh-write permissions. */
export function TaskDefinitionRecovery({ projectId, taskId, command, onSaved, onResolved, onReadLatest, busy = false }: {
  projectId: string; taskId: string; command: TaskEditCommand; onSaved: (ack: DeliveryCommandAck) => void; onResolved?: () => void; onReadLatest?: () => void; busy?: boolean;
}) {
  const { i18n } = useTranslation(), copy = taskDefinitionCopy(i18n?.language), [error, setError] = useState("");
  const state = command.state, pending = useRef(false);
  const finish = () => {
    if (!command.current() || command.snapshot().phase !== "succeeded") return;
    const ack = command.snapshot().ack; if (!ack || ack.project_id !== projectId) return;
    command.reset(); if (command.snapshot().phase !== "idle") return;
    try { onSaved(ack); } catch { setError(copy.refreshFailed); }
    try { onResolved?.(); } catch { setError(copy.refreshFailed); }
  };
  const replay = async () => {
    if (pending.current || !command.current() || command.snapshot().phase !== "unknown" || !command.snapshot().original) return;
    pending.current = true; setError("");
    try { await command.replay(); finish(); } catch (cause) { setError((cause as Error).message); } finally { pending.current = false; }
  };
  if (state.phase === "idle") return error ? <Alert type="warning" title={error} /> : null;
  return <section className="delivery-manual-panel space-y-3" aria-label={copy.recovery}>
    <Alert type={state.phase === "succeeded" ? "success" : "warning"} title={state.phase === "succeeded" ? copy.confirmed : state.phase === "refused" ? copy.refused : copy.recovery} description={copy.recoveryHint} />
    <p className="break-all text-xs text-[var(--muted)]">{projectId} · {taskId}</p>
    {state.error && <Alert type="error" title={state.error.startsWith("retainedOriginal") ? copy.unavailable : state.error} />}{error && <Alert type="warning" title={error} />}
    <TaskDefinitionOriginal original={state.original} />
    <Space wrap>{state.phase === "unknown" && <Button type="primary" disabled={!state.original || !command.current() || busy} onClick={replay}>{copy.replay}</Button>}
      {state.phase === "succeeded" && <Button type="primary" disabled={!command.current() || busy} onClick={finish}>{copy.finish}</Button>}
      {state.phase === "refused" && <><Button disabled={!command.current() || busy || !onReadLatest} onClick={onReadLatest}>{copy.retry}</Button><Button disabled={!command.current() || busy} onClick={() => { if (!command.current()) return; command.reset(); if (command.snapshot().phase === "idle") onResolved?.(); }}>{copy.discard}</Button></>}
    </Space>
  </section>;
}
export function TaskDefinitionRecoveryOwner({ projectId, taskId, sessionId, onPending, onSaved, onResolved }: {
  projectId: string; taskId: string; sessionId: string; onPending?: (value: boolean) => void; onSaved: (ack: DeliveryCommandAck) => void; onResolved?: () => void;
}) {
  const command = useTaskEditCommand(projectId, taskId, sessionId, onPending);
  return <TaskDefinitionRecovery projectId={projectId} taskId={taskId} command={command} onSaved={onSaved} onResolved={() => { closeTaskDefinitionRoute(projectId, taskId); onResolved?.(); }} />;
}
export function DeliveryTaskDefinitionHost({ projectId, taskId, sessionId, command, current, readError, requestEdit = 0, canEdit, freshBlockReason, isActive, canSubmit, onSaved, onEditingChange }: {
  projectId: string; taskId: string; sessionId: string; command: TaskEditCommand; current?: DeliveryTaskData; readError?: unknown; requestEdit?: number; canEdit: boolean; freshBlockReason?: string;
  isActive?: () => boolean; canSubmit?: () => boolean; onSaved: (ack: DeliveryCommandAck) => void; onEditingChange?: (value: boolean) => void;
}) {
  const { i18n } = useTranslation(), copy = taskDefinitionCopy(i18n?.language), origin = useRef(projectSessionKey()), identity = `${projectId}:${sessionId}:${taskId}`, liveIdentity = useRef(identity); liveIdentity.current = identity;
  const access = useRef({ canEdit, isActive, canSubmit, current, readError }); access.current = { canEdit, isActive, canSubmit, current, readError };
  const [draft, writeDraft] = useDeliveryDraftState<Draft | null>(null, onEditingChange), draftRef = useRef(draft);
  const setDraft = (value: Draft | null) => { draftRef.current = value; writeDraft(value); };
  const [candidate, setCandidate] = useState<DeliveryTaskData | null>(null), [error, setError] = useState(""), [feedback, setFeedback] = useState(""), [busy, setBusy] = useState(false), [relink, setRelink] = useState(false), [, renderRoute] = useState(0);
  const pending = useRef(false), mounted = useRef(true), handled = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = () => mounted.current && origin.current === projectSessionKey() && liveIdentity.current === identity && command.current();
  const canWrite = () => active() && access.current.canEdit && !access.current.readError && access.current.isActive?.() !== false && access.current.canSubmit?.() !== false;
  const route = taskDefinitionRequest(typeof location === "undefined" ? "" : location.hash, projectId, taskId);
  const closeRoute = () => { closeTaskDefinitionRoute(projectId, taskId); renderRoute((value) => value + 1); };
  const cancelRoute = () => {
    if (!active() || pending.current || !["idle", "refused"].includes(command.snapshot().phase)) return;
    handled.current = requestEdit; closeRoute(); setError("");
  };
  const resolved = () => { handled.current = requestEdit; setDraft(null); setCandidate(null); setError(""); setRelink(false); closeRoute(); };
  const read = async (latest = false) => {
    if (pending.current || !canWrite() || !["idle", "refused"].includes(command.snapshot().phase)) return;
    const ticket = beginProgressExactRead(); pending.current = true; setBusy(true); setError("");
    try {
      if (route.invalid) throw new Error(copy.invalidRoute);
      const data = await fetchDeliveryTaskEditData(projectId, taskId); if (!ticket.current() || !canWrite()) return;
      if (data.project.id !== projectId || data.task.id !== taskId || !data.permissions.write) throw new Error(copy.readFailed);
      if (data.requirement && ["release", "operations"].includes(data.requirement.flow.stage)) throw new Error(copy.stageLocked);
      const session = openTaskEdit(data, taskId);
      if (latest || command.snapshot().phase === "refused") { setCandidate(data); return; }
      const source = route.source ? await readTaskDefinitionSource(projectId, taskId, route.source) : undefined;
      if (!ticket.current() || !canWrite()) return;
      const values = applyDiscussionAdoption(definitionValues(session), source);
      setDraft({ session, values, key: crypto.randomUUID(), source, sourceReference: source?.reference }); setCandidate(null); setFeedback(""); setRelink(false);
    } catch (cause) { if (active()) setError(route.source ? copy.sourceInvalid : (cause as Error).message); }
    finally { ticket.finish(); pending.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    if (!requestEdit || requestEdit === handled.current || pending.current || busy || !canWrite() || !["idle", "refused"].includes(command.snapshot().phase)) return;
    // Only consume a request once its exact read starts. A newer source waits for the older read to leave.
    handled.current = requestEdit; void read();
  }, [requestEdit, canEdit, Boolean(readError), command.state.phase, busy, canSubmit, isActive]);
  const patch = (key: string, value: unknown) => { const previous = draftRef.current; if (!previous || pending.current || command.snapshot().phase !== "idle" || !canWrite()) return; setDraft({ ...previous, values: { ...previous.values, [key]: value } }); };
  const adopt = () => {
    if (!candidate || !canWrite() || pending.current || !["idle", "refused"].includes(command.snapshot().phase)) return;
    const previous = draftRef.current, original = command.snapshot().original, session = openTaskEdit(candidate, taskId);
    let values = definitionValues(session), needsRelink = false;
    const shortcut: Shortcut | undefined = previous?.shortcut || (original && "owner_id" in original.payload ? { owner_id: original.payload.owner_id } : original && "status" in original.payload ? { status: original.payload.status } : undefined);
    if (previous) values = adoptTaskEdit(previous.session, candidate, previous.values).values as Values;
    else if (original && "title" in original.payload) {
      const payload = original.payload; needsRelink = payload.task_basis !== session.task.basis && payload.requirement_criteria_indices.length > 0;
      values = { ...values, title: payload.title, description: payload.description, acceptance_criteria: [...payload.acceptance_criteria], depends_on: [...payload.depends_on], starts_on: payload.starts_on, ends_on: payload.ends_on, blocked_reason: payload.blocked_reason,
        requirement_criteria_indices: needsRelink ? [] : payload.requirement_criteria_indices.map(String) };
    }
    command.reset(); if (command.snapshot().phase !== "idle") return;
    setDraft({ session, values, shortcut, key: crypto.randomUUID(), source: previous?.source, sourceReference: previous?.sourceReference || original?.source_reference }); setCandidate(null); setError(""); setRelink(needsRelink);
  };
  const finish = () => {
    if (!active() || command.snapshot().phase !== "succeeded") return;
    const ack = command.snapshot().ack; if (!ack || ack.project_id !== projectId) return;
    command.reset(); if (command.snapshot().phase !== "idle") return;
    resolved(); setFeedback(copy.saved);
    try { onSaved(ack); } catch { setError(copy.refreshFailed); }
  };
  const save = async () => {
    const value = draftRef.current; if (!value || pending.current || !canWrite() || command.snapshot().phase !== "idle") return;
    try {
      if (!value.shortcut && (typeof value.values.title !== "string" || !value.values.title.trim())) throw new Error(copy.required);
      const original: TaskEditOriginal = { action: "task.update", payload: value.shortcut ? { id: taskId, task_basis: value.session.task.basis!, ...value.shortcut } : taskEditPayload(value.session, value.values), intent: { version: value.session.version, key: value.key }, ...(value.sourceReference ? { source_reference: structuredClone(value.sourceReference) } : {}) };
      if (!validTaskEditOriginal(original, taskId)) throw new Error(copy.invalidInput);
      pending.current = true; setBusy(true); setError(""); await command.run(original); finish();
    } catch (cause) { if (active()) setError((cause as Error).message); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const close = () => { if (!active() || pending.current || !["idle", "refused"].includes(command.snapshot().phase)) return; if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; } resolved(); };
  const locked = busy || command.state.phase !== "idle", values = draft?.values;
  const candidateSession = candidate ? openTaskEdit(candidate, taskId) : undefined;
  const candidateFacts = candidate && candidateSession && <section className="space-y-2 rounded-lg border border-[var(--border)] p-3"><Alert type="warning" title={copy.changed} /><h4>{copy.currentDefinition}</h4>
    <TaskDefinitionOriginal current original={{ action: "task.update", payload: taskEditPayload(candidateSession, definitionValues(candidateSession)), intent: { version: candidateSession.version, key: "current-definition-view" } }} />
    <dl><dt>{copy.owner}</dt><dd>{candidate.members.find((member) => member.id === candidate.task.owner_id)?.name || candidate.task.owner_id || "—"}</dd><dt>{copy.status}</dt><dd>{candidate.task.recorded_status || candidate.task.status || "—"}</dd></dl>
    {candidate.requirement && <div><p>{candidate.requirement.title} · {copy.requirementCriteria}</p><ol>{candidateSession.criteria.map((text, index) => <li key={index}>{index + 1}. {text}</li>)}</ol></div>}
    <Button disabled={busy || !canWrite()} onClick={adopt}>{copy.adopt}</Button></section>;
  const recovery = <TaskDefinitionRecovery projectId={projectId} taskId={taskId} command={command} onSaved={onSaved} onResolved={resolved} onReadLatest={() => void read(true)} busy={busy} />;
  return <section className="space-y-3" aria-label={copy.edit}>
    {route.open && !draft && command.state.phase === "idle" && freshBlockReason && <Alert type="warning" title={freshBlockReason} />}
    {!draft && recovery}{!draft && candidateFacts}{feedback && <Alert type="success" role="status" title={feedback} />}
    {route.invalid && <Alert type="warning" title={copy.invalidRoute} action={<Button disabled={busy || !command.current() || !["idle", "refused"].includes(command.state.phase)} onClick={cancelRoute}>{copy.cancel}</Button>} />}
    {!draft && busy && <Skeleton active title={false} paragraph={{ rows: 2 }} />}
    {route.open && requestEdit > 0 && handled.current === requestEdit && !draft && !candidate && !busy && !error && !freshBlockReason && command.state.phase === "idle" && <Button disabled={!canWrite()} onClick={() => void read()}>{copy.retry}</Button>}
    {!draft && error && <Alert type="warning" title={error} action={<Space wrap><Button disabled={!canWrite() || busy} onClick={() => void read()}>{copy.retry}</Button>{route.open && <Button disabled={busy} onClick={cancelRoute}>{copy.cancel}</Button>}</Space>} />}
    {draft && values && <Modal open width={760} title={copy.edit} maskClosable={false} closable={!locked || command.state.phase === "refused" && !busy} keyboard={!locked} onCancel={close} onOk={() => void save()} okText={copy.save} cancelText={copy.cancel} confirmLoading={busy}
      okButtonProps={{ disabled: locked || !canWrite() }} cancelButtonProps={{ disabled: busy || !["idle", "refused"].includes(command.state.phase) }}>
      {command.state.phase !== "idle" && recovery}{error && <Alert type="error" title={error} />}{relink && <Alert type="warning" title={copy.relink} />}{candidateFacts}
      {draft.source ? <DiscussionSourceCard adoption={draft.source} /> : draft.sourceReference && <p>{copy.source}</p>}
      {draft.shortcut ? <div className="grid gap-2 py-3"><TaskDefinitionOriginal original={{ action: "task.update", payload: { id: taskId, task_basis: draft.session.task.basis!, ...draft.shortcut }, intent: { version: draft.session.version, key: draft.key } }} /></div> : <div className="grid gap-4 py-3">
        <label className="grid gap-1"><span>{copy.title} *</span><Input aria-label={copy.title} maxLength={256} disabled={locked} value={String(values.title || "")} onChange={(event) => patch("title", event.target.value)} /></label>
        <label className="grid gap-1"><span>{copy.description}</span><Input.TextArea aria-label={copy.description} rows={4} maxLength={10000} disabled={locked} value={String(values.description || "")} onChange={(event) => patch("description", event.target.value)} /></label>
        <fieldset className="grid gap-1"><legend>{copy.criteria}</legend><TaskCriteriaEditor disabled={locked} value={values.acceptance_criteria as string[]} onChange={(value) => patch("acceptance_criteria", value)} /></fieldset>
        {draft.session.task.req_id && <label className="grid gap-1"><span>{copy.requirementCriteria}</span><Select mode="multiple" aria-label={copy.requirementCriteria} disabled={locked} value={values.requirement_criteria_indices as string[]} options={draft.session.criteria.map((text, index) => ({ value: String(index), label: `${index + 1}. ${text}` }))} onChange={(value) => patch("requirement_criteria_indices", value)} /></label>}
        <label className="grid gap-1"><span>{copy.dependencies}</span><DeliveryReferenceSelect kind="task" multiple label={copy.dependencies} queryGeneration={current?.query_generation} disabled={locked} value={values.depends_on as string[]} filter={(item) => item.id !== taskId} onChange={(value) => patch("depends_on", value)} /></label>
        <div className="grid gap-4 sm:grid-cols-2">{[["starts_on", copy.starts], ["ends_on", copy.ends]].map(([key, label]) => <label className="grid gap-1" key={key}><span>{label}</span><Input type="date" aria-label={label} disabled={locked} value={String(values[key] || "")} onChange={(event) => patch(key, event.target.value || null)} /></label>)}</div>
        <label className="grid gap-1"><span>{copy.blocker}</span><Input.TextArea aria-label={copy.blocker} rows={2} maxLength={2000} disabled={locked} value={String(values.blocked_reason || "")} onChange={(event) => patch("blocked_reason", event.target.value)} /></label>
      </div>}
    </Modal>}
  </section>;
}
