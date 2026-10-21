import { Alert, Button, Input, Modal, Select, Skeleton, Space, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { getSessionRevision } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { executionRuntimeProblem } from "@/lib/executionRuntime";
import { executionIssueHref } from "@/lib/executionCommands";
import { taskSubmissionCopy, taskSubmissionReason } from "@/i18n/task-submission";
import { parseSubmissionSelection, readSubmissionCurrent, readSubmissionDetail, readSubmissions, submissionUrl, useSubmissionCommand, validSubmissionOriginal,
  type SubmissionCurrent, type SubmissionDetail, type SubmissionOriginal, type SubmissionReason, type TaskSubmissionPayload, type TaskSubmissionReviewPayload } from "@/lib/deliveryTaskSubmission";
import { TaskAcceptanceFacts } from "./TaskAcceptanceFacts";

type Draft = { kind: "submit"; current: SubmissionCurrent; payload: TaskSubmissionPayload } | { kind: "review"; detail: SubmissionDetail; decision: "accept" | "request_changes"; comment: string };
type Props = { projectId: string; taskId: string; sessionId: string; disabled?: boolean; isActive?: () => boolean; canSubmit?: () => boolean;
  onSaved: (ack: DeliveryCommandAck) => void; onEditingChange?: (value: boolean) => void; onUnresolvedChange?: (value: boolean) => void };
export function submissionDraft(current: SubmissionCurrent): TaskSubmissionPayload {
  return { task_id: current.task_id, task_basis: current.task_basis, definition_digest: current.definition_digest, native_boundary_digest: current.native_boundary_digest,
    source: { kind: "human", name: "", url: "" }, summary: "", artifacts: [{ id: "evidence-1", title: "", content: "", url: "", sha256: null }],
    criteria: current.criteria.map(({ source, index, text_digest }) => ({ source, index, text_digest, result: "unknown", evidence_ids: [] })), tests: [] };
}
export function adoptSubmissionDraft(payload: TaskSubmissionPayload, current: SubmissionCurrent): TaskSubmissionPayload {
  return { ...structuredClone(payload), task_basis: current.task_basis, definition_digest: current.definition_digest, native_boundary_digest: current.native_boundary_digest,
    criteria: current.criteria.map(({ source, index, text_digest }) => payload.criteria.find((item) => item.source === source && item.index === index && item.text_digest === text_digest) ||
      { source, index, text_digest, result: "unknown", evidence_ids: [] }) };
}
const sameBasis = (a: SubmissionCurrent, b: SubmissionCurrent) => a.task_basis === b.task_basis && a.definition_digest === b.definition_digest && a.native_boundary_digest === b.native_boundary_digest;

export function DeliveryTaskSubmissionPanel({ projectId, taskId, sessionId, disabled = false, isActive, canSubmit, onSaved, onEditingChange, onUnresolvedChange }: Props) {
  const { i18n } = useTranslation(), copy = taskSubmissionCopy(i18n?.language);
  const origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false);
  const identity = JSON.stringify([projectId, taskId, sessionId]), activeIdentity = useRef(identity); activeIdentity.current = identity;
  const access = useRef({ disabled, isActive, canSubmit }); access.current = { disabled, isActive, canSubmit };
  const notify = useRef(onUnresolvedChange); notify.current = onUnresolvedChange;
  const controller = useRef<{ snapshot: () => { phase: string } }>();
  const command = useSubmissionCommand(projectId, taskId, sessionId, (value) => notify.current?.(value || controller.current?.snapshot().phase === "succeeded")); controller.current = command;
  const state = command.state, locked = !["idle", "refused"].includes(state.phase);
  const isLocked = () => !["idle", "refused"].includes(command.snapshot().phase);
  const [draft, setDraft] = useState<Draft | null>(null), draftRef = useRef(draft); draftRef.current = draft;
  const [prepared, setPrepared] = useState<SubmissionOriginal | null>(null), preparedRef = useRef(prepared); preparedRef.current = prepared;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [blocked, setBlocked] = useState<SubmissionReason[]>([]);
  const [changed, setChanged] = useState(false), [latest, setLatest] = useState<SubmissionCurrent | SubmissionDetail | null>(null);
  const initialSelection = useRef(parseSubmissionSelection(typeof location === "undefined" ? "" : location.hash, projectId, taskId));
  const [selected, setSelected] = useState(initialSelection.current.id), [invalidSelection, setInvalidSelection] = useState(initialSelection.current.invalid), [historyOpen, setHistoryOpen] = useState(false), [cursor, setCursor] = useState("");
  const changeDraft = (value: Draft | null) => { draftRef.current = value; setDraft(value); };
  const changePrepared = (value: SubmissionOriginal | null) => { preparedRef.current = value; setPrepared(value); };
  const current = () => mounted.current && activeIdentity.current === identity && origin.current === projectSessionKey() && access.current.isActive?.() !== false && command.current();
  const assertCurrent = () => { if (!current()) throw new Error("submissionScopeChanged"); };
  const query = useQuery({ queryKey: ["delivery-task-submission-current", projectId, sessionId, taskId, getSessionRevision()],
    queryFn: ({ signal }) => readSubmissionCurrent(projectId, taskId, origin.current, signal), enabled: current() && !locked, retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const proof = !query.error && current() && query.data?.project_id === projectId && query.data.task_id === taskId ? query.data : undefined;
  const selectedId = invalidSelection ? "" : selected || proof?.latest_submission_id || "";
  const detailQuery = useQuery({ queryKey: ["delivery-task-submission", projectId, sessionId, taskId, getSessionRevision(), selectedId],
    queryFn: ({ signal }) => readSubmissionDetail(projectId, taskId, selectedId, origin.current, signal), enabled: current() && Boolean(selectedId) && !locked,
    retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const detail = !detailQuery.error && current() && detailQuery.data?.project_id === projectId && detailQuery.data.task_id === taskId && detailQuery.data.submission.id === selectedId ? detailQuery.data : undefined;
  const history = useQuery({ queryKey: ["delivery-task-submissions", projectId, sessionId, taskId, getSessionRevision(), cursor],
    queryFn: ({ signal }) => readSubmissions(projectId, taskId, origin.current, cursor, signal), enabled: current() && historyOpen && !locked,
    retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const reads = useRef({ proof, detail }); reads.current = { proof, detail };
  const canWrite = () => current() && !isLocked() && !access.current.disabled && access.current.canSubmit?.() !== false && Boolean(reads.current.proof) && !query.error;
  const reportError = (cause: unknown) => { if (!current()) return; const problem = executionRuntimeProblem(cause); setError(problem.message === "submissionInvalid" || problem.message === "retainedOriginalInvalid" ? copy.invalid : problem.message === "submissionScopeChanged" ? copy.scopeChanged : problem.code ? JSON.stringify({ detail: problem }) : problem.message); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const selectRoute = () => { if (!current() || isLocked()) return; const value = parseSubmissionSelection(location.hash, projectId, taskId); setSelected(value.id); setInvalidSelection(value.invalid); };
    window.addEventListener("hashchange", selectRoute); window.addEventListener("popstate", selectRoute);
    return () => { window.removeEventListener("hashchange", selectRoute); window.removeEventListener("popstate", selectRoute); };
  }, [projectId, taskId, sessionId, command]);
  useEffect(() => { notify.current?.(["sending", "unknown", "succeeded"].includes(state.phase)); }, [state.phase]);
  useEffect(() => { if (!draft) return; onEditingChange?.(true); return () => onEditingChange?.(false); }, [Boolean(draft), onEditingChange]);
  const begin = (decision?: "accept" | "request_changes") => {
    if (!canWrite() || pending.current || locked || draftRef.current || (decision ? !reads.current.detail?.permissions.can_review || decision === "accept" && !reads.current.detail.permissions.can_accept : !reads.current.proof?.can_submit)) return;
    try { assertCurrent(); if (state.phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; }
      changeDraft(decision ? { kind: "review", detail: structuredClone(reads.current.detail!), decision, comment: "" } : { kind: "submit", current: structuredClone(reads.current.proof!), payload: submissionDraft(reads.current.proof!) });
      changePrepared(null); setChanged(false); setLatest(null); setError(""); setFeedback(""); setBlocked([]);
    } catch (cause) { reportError(cause); }
  };
  const patch = (change: Partial<TaskSubmissionPayload>) => {
    const value = draftRef.current; if (!value || value.kind !== "submit" || pending.current || locked || preparedRef.current || !canWrite()) return;
    changeDraft({ ...value, payload: { ...value.payload, ...change } }); setError("");
  };
  const preview = async (readLatest = false) => {
    const value = draftRef.current; if (!value || pending.current || locked || !canWrite()) return;
    pending.current = true; setBusy(true); setError(""); setBlocked([]); changePrepared(null); setLatest(null);
    try {
      assertCurrent();
      if (value.kind === "submit") {
        const next = await readSubmissionCurrent(projectId, taskId, origin.current); assertCurrent();
        if (readLatest || !sameBasis(value.current, next)) { setLatest(next); setChanged(true); return; }
        if (!next.can_submit) { setBlocked(next.reasons); throw new Error(next.reasons.map((item) => taskSubmissionReason(i18n?.language, item)).join(" · ") || copy.changed); }
        const original: SubmissionOriginal = { action: "task.delivery.submit", payload: structuredClone(value.payload), intent: { version: next.version, key: crypto.randomUUID() } };
        if (!validSubmissionOriginal(original, taskId)) throw new Error("submissionInvalid"); changePrepared(original);
      } else {
        const next = await readSubmissionDetail(projectId, taskId, value.detail.submission.id, origin.current); assertCurrent();
        if (next.submission.digest !== value.detail.submission.digest) throw new Error("submissionInvalid");
        if (readLatest || next.task_basis !== value.detail.task_basis || next.native_boundary_digest !== value.detail.native_boundary_digest) { setLatest(next); setChanged(true); return; }
        if (!next.permissions.can_review || value.decision === "accept" && !next.permissions.can_accept) { setBlocked(next.permissions.reasons); throw new Error(next.permissions.reasons.map((item) => taskSubmissionReason(i18n?.language, item)).join(" · ") || copy.changed); }
        const payload: TaskSubmissionReviewPayload = { task_id: taskId, submission_id: next.submission.id, submission_digest: next.submission.digest, task_basis: next.task_basis!, native_boundary_digest: next.native_boundary_digest!, decision: value.decision, comment: value.comment.trim() };
        const original: SubmissionOriginal = { action: "task.delivery.review", payload, intent: { version: next.version, key: crypto.randomUUID() } };
        if (!validSubmissionOriginal(original, taskId)) throw new Error("submissionInvalid"); changePrepared(original);
      }
    } catch (cause) { reportError(cause); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const adopt = () => {
    const value = draftRef.current; if (!value || !latest || pending.current || locked || !canWrite()) return;
    try { assertCurrent(); if (state.phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; }
      if (value.kind === "submit" && "criteria" in latest) changeDraft({ ...value, current: structuredClone(latest), payload: adoptSubmissionDraft(value.payload, latest) });
      else if (value.kind === "review" && "submission" in latest && latest.submission.id === value.detail.submission.id && latest.submission.digest === value.detail.submission.digest) changeDraft({ ...value, detail: structuredClone(latest) });
      else throw new Error("submissionInvalid");
      changePrepared(null); setChanged(false); setLatest(null); setError("");
    } catch (cause) { reportError(cause); }
  };
  const complete = async (ack: DeliveryCommandAck | undefined) => {
    if (!ack) return; assertCurrent();
    const original = command.snapshot().original;
    command.reset(); if (command.snapshot().phase !== "idle") { notify.current?.(true); return; }
    changeDraft(null); changePrepared(null); setLatest(null); setChanged(false); setError(""); notify.current?.(false);
    setFeedback(original?.action === "task.delivery.review" ? copy.reviewSaved : copy.submitted);
    const id = ack.result?.submission_id; if (typeof id === "string") { setSelected(id); setInvalidSelection(false); }
    try { onSaved(ack); const value = await query.refetch(); assertCurrent(); if (value.isError) setError(copy.refreshFailed); if (id && id === selectedId) void detailQuery.refetch(); if (historyOpen) void history.refetch(); }
    catch { if (current()) setError(copy.refreshFailed); }
  };
  const submit = async (replay = false) => {
    const original = preparedRef.current;
    if (pending.current || (replay ? command.snapshot().phase !== "unknown" : !original || locked || changed || !canWrite())) return;
    pending.current = true; setBusy(true); setError("");
    try { assertCurrent(); const ack = replay ? await command.replay() : await command.run(original!); assertCurrent(); await complete(ack); }
    catch (cause) { reportError(cause); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const close = () => { if (pending.current || isLocked()) return; try { assertCurrent(); if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; } changeDraft(null); changePrepared(null); setLatest(null); setChanged(false); setError(""); } catch (cause) { reportError(cause); } };
  const shownOriginal = state.original || prepared, formLocked = locked || busy || Boolean(prepared), shown = state.original ? null : draft;
  const payload = shown?.kind === "submit" ? shown.payload : null;
  const evidenceOptions = payload?.artifacts.map((item, index) => ({ value: item.id, label: item.title || `${copy.artifacts} ${index + 1}` })) || [];
  const reasons = (items: SubmissionReason[]) => <div className="runtime-help"><p>{items.map((item) => taskSubmissionReason(i18n?.language, item)).join(" · ")}</p><details><summary>{copy.details}</summary><ul>{items.map((item, index) => <li key={`${item.code}:${index}`}><code>{item.code}</code> · {item.message}</li>)}</ul></details></div>;
  const errorProblem = executionRuntimeProblem(error || state.error);
  const errorMessage = errorProblem.code ? taskSubmissionReason(i18n?.language, errorProblem) : errorProblem.message;
  const problemFacts = (cause: unknown) => { const problem = executionRuntimeProblem(cause); return <>{taskSubmissionReason(i18n?.language, problem)}{problem.code && <details className="runtime-help"><summary>{copy.details}</summary><code>{problem.code}</code><p>{problem.message}</p></details>}</>; };
  const fixedDetails = (original: SubmissionOriginal) => <details className="runtime-help"><summary>{copy.details}</summary><dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all"><dt>{copy.task}</dt><dd>{taskId}</dd><dt>{copy.version}</dt><dd>{original.intent.version}</dd><dt>{copy.digest}</dt><dd>{original.payload.task_basis}</dd></dl></details>;
  const recovery = <>
    {(error || state.error) && <Alert role="alert" type="warning" title={copy.failed} description={state.error === "retainedOriginalUnavailable" ? copy.unavailableStorage : state.error === "retainedOriginalInvalid" || state.error === "ackMismatch" ? copy.invalid : <>{errorMessage}{errorProblem.code && <details className="runtime-help"><summary>{copy.details}</summary><code>{errorProblem.code}</code><p>{errorProblem.message}</p></details>}</>} />}
    {blocked.length > 0 && Boolean(error) && reasons(blocked)}
    {state.phase === "unknown" && <Alert role="status" type="warning" title={copy.unknown} description={copy.unknownHint} action={state.original && <Button size="small" data-action="recover-submission" disabled={busy} onClick={() => void submit(true)}>{copy.replay}</Button>} />}
    {state.phase === "succeeded" && <Alert role="status" type="info" title={copy.confirmed} action={<Button size="small" data-action="finish-submission" disabled={busy} onClick={async () => { if (pending.current) return; pending.current = true; setBusy(true); try { await complete(command.snapshot().ack); } catch (cause) { reportError(cause); } finally { pending.current = false; if (mounted.current) setBusy(false); } }}>{copy.finish}</Button>} />}
    {state.original && locked && <details className="runtime-help"><summary>{copy.original}</summary><p>{state.original.action === "task.delivery.submit" ? (state.original.payload as TaskSubmissionPayload).summary : (state.original.payload as TaskSubmissionReviewPayload).comment}</p>{fixedDetails(state.original)}</details>}
  </>;
  return <section className="delivery-manual-panel" aria-label={copy.title}>
    <div className="runtime-section-heading"><strong>{copy.title}</strong><Space wrap><Button size="small" loading={query.isFetching || detailQuery.isFetching} onClick={() => { if (current()) { void query.refetch(); if (selectedId) void detailQuery.refetch(); } }}>{copy.refresh}</Button><Button size="small" disabled={disabled || !proof?.can_submit || locked || Boolean(draft)} onClick={() => begin()}>{copy.create}</Button></Space></div>
    <p className="runtime-help">{copy.intro}</p>
    {feedback && <Alert role="status" type="success" title={feedback} />}
    {!draft && recovery}
    {invalidSelection && <Alert type="warning" role="alert" title={copy.invalid} />}
    {!proof && !query.error && !locked && <><Skeleton active title={false} paragraph={{ rows: 1 }} /><p className="runtime-help">{copy.loading}</p></>}
    {query.error && <Alert type="warning" title={copy.readFailed} description={problemFacts(query.error)} action={<Button size="small" loading={query.isFetching} onClick={() => { if (current()) void query.refetch(); }}>{copy.refresh}</Button>} />}
    {proof && !proof.can_submit && proof.reasons.length > 0 && reasons(proof.reasons)}
    {proof && !selectedId && <p className="runtime-help">{copy.empty}</p>}
    {detailQuery.error && <Alert type="warning" title={copy.readFailed} description={problemFacts(detailQuery.error)} action={<Button size="small" onClick={() => { if (current()) void detailQuery.refetch(); }}>{copy.refresh}</Button>} />}
    {selectedId && detailQuery.isPending && !locked && <Skeleton active title={false} paragraph={{ rows: 2 }} />}
    {detail && <>
      <SubmissionFacts detail={detail} />
      {detail.permissions.can_review && <Space wrap><Button size="small" type="primary" disabled={disabled || !proof || locked || Boolean(draft) || !detail.permissions.can_accept} onClick={() => begin("accept")}>{copy.accept}</Button><Button size="small" disabled={disabled || !proof || locked || Boolean(draft)} onClick={() => begin("request_changes")}>{copy.reject}</Button></Space>}
      {detail.permissions.reasons.length > 0 && reasons(detail.permissions.reasons)}
    </>}
    <details className="runtime-help" onToggle={(event) => { if (current()) setHistoryOpen(event.currentTarget.open); }}><summary>{copy.history}</summary>
      {history.error ? <Alert type="warning" title={copy.readFailed} description={problemFacts(history.error)} action={<Button size="small" onClick={() => { if (current()) { if (cursor) setCursor(""); else void history.refetch(); } }}>{copy.first}</Button>} /> : history.isPending ? <Skeleton active title={false} paragraph={{ rows: 1 }} /> : <ul>{history.data?.items.map((item) => <li key={item.id}><Button size="small" type="link" disabled={locked || Boolean(draft)} onClick={() => { if (current() && !pending.current && !locked && !draftRef.current) setSelected(item.id); }}>{copy.statuses[item.status]} · {item.summary} · {item.created_at}</Button></li>)}</ul>}
      <Space wrap>{cursor && <Button size="small" disabled={locked} onClick={() => { if (current()) setCursor(""); }}>{copy.first}</Button>}{history.data?.next_cursor && <Button size="small" disabled={locked} onClick={() => { if (current() && history.data?.next_cursor) setCursor(history.data.next_cursor); }}>{copy.more}</Button>}</Space>
    </details>
    <Modal open={Boolean(draft)} title={draft?.kind === "review" ? copy.review : copy.create} width={760} maskClosable={false} closable={!locked && !busy} keyboard={!locked && !busy} onCancel={close}
      footer={<Space wrap><Button disabled={locked || busy} onClick={close}>{copy.close}</Button>{!locked && !prepared && <Button type="primary" loading={busy} disabled={!proof || disabled || changed} onClick={() => void preview()}>{draft?.kind === "review" ? copy.reviewPreview : copy.preview}</Button>}{prepared && !locked && <Button type="primary" loading={busy} disabled={disabled || changed} onClick={() => void submit()}>{draft?.kind === "review" ? copy.reviewConfirm : copy.confirm}</Button>}</Space>}>
      <p className="runtime-help">{copy.reportOnly}</p>
      {draft && recovery}
      {shown?.kind === "submit" && payload && <div className="space-y-4">
        <TaskAcceptanceFacts acceptance={{ criteria: shown.current.criteria.map((item) => item.text), sources: shown.current.criteria.map(({ source, index, text }) => ({ source, index, text })), available: shown.current.criteria.length > 0, requirement_id: shown.current.definition.requirement?.id || null, requirement_revision: shown.current.definition.requirement?.revision ?? null }} />
        <label className="block">{copy.kind}<Select className="w-full" aria-label={copy.kind} disabled={formLocked} value={payload.source.kind} options={Object.entries(copy.kinds).map(([value, label]) => ({ value, label }))} onChange={(kind) => patch({ source: { ...payload.source, kind } })} /></label>
        <label className="block">{copy.name} *<Input aria-label={copy.name} value={payload.source.name} maxLength={2000} disabled={formLocked} onChange={(event) => patch({ source: { ...payload.source, name: event.target.value } })} /></label>
        <label className="block">{copy.sourceUrl}<Input aria-label={copy.sourceUrl} value={payload.source.url} maxLength={2000} disabled={formLocked} onChange={(event) => patch({ source: { ...payload.source, url: event.target.value } })} /></label>
        <label className="block">{copy.summary} *<Input.TextArea aria-label={copy.summary} value={payload.summary} maxLength={2000} rows={3} disabled={formLocked} onChange={(event) => patch({ summary: event.target.value })} /></label>
        <fieldset className="space-y-3"><legend>{copy.artifacts}</legend>{payload.artifacts.map((item, index) => <div key={item.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
          <label className="block">{copy.evidenceTitle} *<Input aria-label={`${copy.evidenceTitle} ${index + 1}`} maxLength={2000} value={item.title} disabled={formLocked} onChange={(event) => patch({ artifacts: payload.artifacts.map((row) => row.id === item.id ? { ...row, title: event.target.value } : row) })} /></label>
          <label className="block">{copy.content}<Input.TextArea aria-label={`${copy.content} ${index + 1}`} rows={3} maxLength={8000} value={item.content} disabled={formLocked} onChange={(event) => patch({ artifacts: payload.artifacts.map((row) => row.id === item.id ? { ...row, content: event.target.value } : row) })} /></label>
          <label className="block">{copy.url}<Input aria-label={`${copy.url} ${index + 1}`} maxLength={2000} value={item.url} disabled={formLocked} onChange={(event) => patch({ artifacts: payload.artifacts.map((row) => row.id === item.id ? { ...row, url: event.target.value } : row) })} /></label>
          <details className="runtime-help"><summary>{copy.details}</summary><label>{copy.hash}<Input aria-label={`${copy.hash} ${index + 1}`} maxLength={64} value={item.sha256 || ""} disabled={formLocked} onChange={(event) => patch({ artifacts: payload.artifacts.map((row) => row.id === item.id ? { ...row, sha256: event.target.value || null } : row) })} /></label></details>
          <Button size="small" disabled={formLocked || payload.artifacts.length === 1} onClick={() => patch({ artifacts: payload.artifacts.filter((row) => row.id !== item.id), criteria: payload.criteria.map((row) => ({ ...row, evidence_ids: row.evidence_ids.filter((id) => id !== item.id) })), tests: payload.tests.map((row) => ({ ...row, evidence_ids: row.evidence_ids.filter((id) => id !== item.id) })) })}>{copy.remove}</Button>
        </div>)}<Button size="small" disabled={formLocked || payload.artifacts.length >= 40} onClick={() => patch({ artifacts: [...payload.artifacts, { id: `evidence-${crypto.randomUUID()}`, title: "", content: "", url: "", sha256: null }] })}>{copy.addEvidence}</Button></fieldset>
        <fieldset className="space-y-3"><legend>{copy.criteria}</legend><p className="runtime-help">{copy.criteriaHint}</p>{payload.criteria.map((item, index) => <div key={`${item.source}:${item.index}`} className="space-y-1"><p>{index + 1}. {shown.current.criteria[index]?.text}</p>
          <Select className="w-full" aria-label={`${copy.criteria} ${index + 1}`} value={item.result} disabled={formLocked} options={Object.entries(copy.results).map(([value, label]) => ({ value, label }))} onChange={(result) => patch({ criteria: payload.criteria.map((row, position) => position === index ? { ...row, result } : row) })} />
          <Select mode="multiple" className="w-full" aria-label={`${copy.evidenceIds} ${index + 1}`} value={item.evidence_ids} disabled={formLocked} options={evidenceOptions} onChange={(evidence_ids) => patch({ criteria: payload.criteria.map((row, position) => position === index ? { ...row, evidence_ids } : row) })} />
        </div>)}</fieldset>
        <fieldset className="space-y-3"><legend>{copy.tests}</legend>{!payload.tests.length && <p className="runtime-help">{copy.noTests}</p>}{payload.tests.map((item, index) => <div key={item.id} className="space-y-1">
          <label className="block">{copy.testTitle} *<Input aria-label={`${copy.testTitle} ${index + 1}`} value={item.title} disabled={formLocked} maxLength={2000} onChange={(event) => patch({ tests: payload.tests.map((row) => row.id === item.id ? { ...row, title: event.target.value } : row) })} /></label>
          <Select className="w-full" aria-label={`${copy.tests} ${index + 1}`} value={item.status} disabled={formLocked} options={Object.entries(copy.testStates).map(([value, label]) => ({ value, label }))} onChange={(status) => patch({ tests: payload.tests.map((row) => row.id === item.id ? { ...row, status } : row) })} />
          <Select mode="multiple" className="w-full" aria-label={`${copy.tests} ${copy.evidenceIds} ${index + 1}`} value={item.evidence_ids} disabled={formLocked} options={evidenceOptions} onChange={(evidence_ids) => patch({ tests: payload.tests.map((row) => row.id === item.id ? { ...row, evidence_ids } : row) })} />
          <Button size="small" disabled={formLocked} onClick={() => patch({ tests: payload.tests.filter((row) => row.id !== item.id) })}>{copy.remove}</Button>
        </div>)}<Button size="small" disabled={formLocked || payload.tests.length >= 40} onClick={() => patch({ tests: [...payload.tests, { id: `test-${crypto.randomUUID()}`, title: "", status: "unknown", evidence_ids: [] }] })}>{copy.addTest}</Button></fieldset>
      </div>}
      {shown?.kind === "review" && <><SubmissionFacts detail={shown.detail} /><label className="block">{copy.comment} *<Input.TextArea aria-label={copy.comment} rows={3} maxLength={4000} disabled={formLocked} value={shown.comment} onChange={(event) => { if (!pending.current && !locked && !preparedRef.current && draftRef.current?.kind === "review" && canWrite()) changeDraft({ ...draftRef.current, comment: event.target.value }); }} /></label><p>{shown.decision === "accept" ? copy.accept : copy.reject}</p></>}
      {prepared && <Alert type="info" title={copy.fixed} action={<Button size="small" disabled={locked || busy} onClick={() => { if (!pending.current && !locked && canWrite()) changePrepared(null); }}>{copy.edit}</Button>} />}
      {shownOriginal && fixedDetails(shownOriginal)}
      {(changed || state.phase === "refused") && <Alert type="warning" title={copy.changed} action={<Button size="small" disabled={busy || locked} onClick={() => void preview(true)}>{copy.readLatest}</Button>} />}
      {latest && <div><strong>{copy.newBasis}</strong><p>{"criteria" in latest ? latest.definition.title : latest.submission.summary}</p><Button size="small" disabled={busy || locked} onClick={adopt}>{copy.adopt}</Button></div>}
    </Modal>
  </section>;
}

export function SubmissionFacts({ detail }: { detail: SubmissionDetail }) {
  const { i18n } = useTranslation(), copy = taskSubmissionCopy(i18n?.language), s = detail.submission, payload = detail.payload;
  const criterionText = (source: "task" | "requirement", index: number) => source === "task" ? detail.definition.task_acceptance_criteria[index] : detail.definition.requirement?.acceptance_criteria[index];
  return <section className="space-y-3 rounded-lg border border-[var(--border)] p-3" aria-label={copy.submission}>
    <div className="runtime-section-heading"><strong>{payload.summary}</strong><Tag color={s.status === "accepted" && !s.invalidated ? "success" : s.status === "changes_requested" || s.invalidated ? "warning" : "default"}>{copy.statuses[s.status]}</Tag></div>
    <p className="runtime-help">{copy.source}: {payload.source.name} · {copy.kinds[payload.source.kind]} · {copy.author}: {s.submitted_by.name} · {s.created_at}</p>
    <p className="runtime-help">{copy.reportOnly}</p>
    {s.invalidated && <Alert type="warning" title={copy.notCurrent} description={<>{taskSubmissionReason(i18n?.language, { code: s.invalidated_reason, message: s.invalidated_reason })}<details className="runtime-help"><summary>{copy.details}</summary><code>{s.invalidated_reason}</code></details></>} />}
    <ul className="space-y-2">{payload.criteria.map((item) => <li key={`${item.source}:${item.index}`}><Tag>{copy.results[item.result]}</Tag>{criterionText(item.source, item.index) || copy.snapshot}<small className="block runtime-help">{item.evidence_ids.map((id) => payload.artifacts.find((row) => row.id === id)?.title || id).join(" · ")}</small></li>)}</ul>
    <div><strong className="text-sm">{copy.tests}</strong>{payload.tests.length ? <ul>{payload.tests.map((item) => <li key={item.id}><Tag>{copy.testStates[item.status]}</Tag>{item.title}<small className="block runtime-help">{item.evidence_ids.map((id) => payload.artifacts.find((row) => row.id === id)?.title || id).join(" · ")}</small></li>)}</ul> : <p className="runtime-help">{copy.noTests}</p>}</div>
    <details className="runtime-help"><summary>{copy.artifacts} · {payload.artifacts.length}</summary>{payload.artifacts.map((item) => <article className="space-y-1 py-2" key={item.id}><strong>{item.title}</strong>{item.url && submissionUrl(item.url) && <a className="block break-all" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>}{item.content && <pre className="runtime-output whitespace-pre-wrap">{item.content}</pre>}{item.sha256 && <p className="break-all">{copy.hash}: {item.sha256}</p>}</article>)}</details>
    {detail.decision && <blockquote><p>{detail.decision.comment}</p><footer>{copy.reviewer}: {detail.decision.reviewer.name} · {detail.decision.created_at}</footer></blockquote>}
    {s.issue_id && <Button size="small" href={executionIssueHref(s.issue_id, typeof location === "undefined" ? "" : location.hash, detail.project_id)}>{copy.issue}</Button>}
    <details className="runtime-help"><summary>{copy.details}</summary><dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all"><dt>{copy.submission}</dt><dd>{s.id}</dd><dt>{copy.digest}</dt><dd>{s.digest}</dd><dt>{copy.task}</dt><dd>{s.task_id}</dd></dl></details>
  </section>;
}
