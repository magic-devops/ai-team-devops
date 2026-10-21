import type { FeedbackReference } from "@/lib/deliveryFeedback";
import { TaskDispatchFeedback } from "../../subapps/ai-rd-center/src/pages/delivery/TaskDispatchFeedback";
import { taskDispatchCopy } from "@/i18n/task-dispatch";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Select, Skeleton, Space, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { getSessionRevision } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { invalidateDeliveryQueries } from "@/lib/deliveryQuery";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { externalWorkOrderCopy, externalWorkOrderReason } from "@/i18n/external-work-orders";
import { executionRuntimeProblem } from "@/lib/executionRuntime";
import { readSubmissionCurrent, readSubmissionDetail } from "@/lib/deliveryTaskSubmission";
import { externalWorkOrderReturn, externalWorkOrderTaskHref } from "@/lib/externalWorkOrderRoute";
import { createWorkOrderOriginal, useWorkOrderCommand, workOrderActionOriginal, type WorkOrderAction, type WorkOrderOriginal } from "@/lib/externalWorkOrderCommand";
import { previewWorkOrder, readWorkOrderCurrent, readWorkOrderDetail, readWorkOrderPacket, readWorkOrders,
  type WorkOrderCurrent, type WorkOrderDetail, type WorkOrderPreview, type WorkOrderReason, type WorkOrderSummary } from "@/lib/externalWorkOrders";
import { DesignReferenceFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDesignContextPanel";

type Props = { requestCreate?: { token: number; executorId: string; feedback_reference?: FeedbackReference }; onComposeSettled?: (token: number, started: boolean) => void; onComposeClosed?: (token: number) => void; onDispatch?: () => void; projectId: string; taskId: string; sessionId: string; selectedOrderId?: string; invalidSelection?: boolean; compose?: boolean;
  disabled?: boolean; isActive?: () => boolean; canSubmit?: () => boolean; onSaved?: (ack: DeliveryCommandAck) => void;
  onUnresolvedChange?: (pending: boolean) => void; onEditingChange?: (editing: boolean) => void;
  onSelect?: (orderId: string) => void; onWriteReport?: (order: { id: string; order_revision: number }) => void };
type Draft = { feedback_reference?: FeedbackReference; action: WorkOrderAction; current?: WorkOrderCurrent; detail?: WorkOrderDetail; executorId: string; instructions: string;
  comment: string; percent: number | null; knownPercent: boolean; status: "running" | "blocked"; submissionId: string; stopped: boolean };
const newDraft = (action: WorkOrderAction): Draft => ({ action, executorId: "", instructions: "", comment: "", percent: null, knownPercent: false, status: "running", submissionId: "", stopped: false });

export function ExternalWorkOrderPanel({ requestCreate, onComposeSettled, onComposeClosed, onDispatch, projectId, taskId, sessionId, selectedOrderId = "", invalidSelection = false, compose = false, disabled = false, isActive, canSubmit, onSaved, onUnresolvedChange, onEditingChange, onSelect, onWriteReport }: Props) {
  const { i18n } = useTranslation(), copy = externalWorkOrderCopy(i18n.language), dispatchCopy = taskDispatchCopy(i18n.language), client = useQueryClient();
  const origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false);
  const identity = JSON.stringify([projectId, taskId, sessionId]), live = useRef(identity); live.current = identity;
  const access = useRef({ disabled, isActive, canSubmit }); access.current = { disabled, isActive, canSubmit };
  const editingNotify = useRef(onEditingChange); editingNotify.current = onEditingChange;
  const command = useWorkOrderCommand(projectId, taskId, sessionId, onUnresolvedChange);
  const state = command.state, locked = !["idle", "refused"].includes(state.phase);
  const current = () => mounted.current && origin.current === projectSessionKey() && live.current === identity && access.current.isActive?.() !== false && command.current();
  const assertCurrent = () => { if (!current()) throw new Error("workOrderScopeChanged"); };
  const [selected, setSelected] = useState(selectedOrderId), [cursor, setCursor] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null), draftRef = useRef(draft); draftRef.current = draft;
  const [prepared, setPrepared] = useState<WorkOrderOriginal | null>(null), preparedRef = useRef(prepared); preparedRef.current = prepared;
  const [preview, setPreview] = useState<WorkOrderPreview | null>(null), [latest, setLatest] = useState<WorkOrderCurrent | WorkOrderDetail | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const changeDraft = (value: Draft | null) => { const changed = Boolean(draftRef.current) !== Boolean(value); draftRef.current = value; setDraft(value); if (changed) editingNotify.current?.(Boolean(value)); };
  const changePrepared = (value: WorkOrderOriginal | null) => { preparedRef.current = value; setPrepared(value); };
  const key = [projectId, sessionId, taskId, getSessionRevision()];
  const currentQ = useQuery({ queryKey: ["delivery-work-order-current", ...key], queryFn: ({ signal }) => readWorkOrderCurrent(projectId, taskId, origin.current, signal), enabled: current() && !locked, retry: false, gcTime: 0 });
  const facts = !currentQ.error && current() && currentQ.data?.task_id === taskId ? currentQ.data : undefined;
  const selectedId = invalidSelection ? "" : selected || facts?.active_work_order_id || "";
  const detailQ = useQuery({ queryKey: ["delivery-work-order-exact", ...key, selectedId], queryFn: ({ signal }) => readWorkOrderDetail(projectId, selectedId, origin.current, taskId, signal), enabled: current() && Boolean(selectedId) && !locked, retry: false, gcTime: 0 });
  const detail = !detailQ.error && current() && detailQ.data?.work_order.id === selectedId ? detailQ.data : undefined;
  const page = useQuery({ queryKey: ["delivery-work-orders", ...key, cursor], queryFn: ({ signal }) => readWorkOrders(projectId, origin.current, { taskId, cursor }, signal), enabled: current() && !locked, retry: false, gcTime: 0 });
  const reportCurrent = useQuery({ queryKey: ["delivery-work-order-report-current", ...key], queryFn: ({ signal }) => readSubmissionCurrent(projectId, taskId, origin.current, signal), enabled: current() && draft?.action === "work_order.report" && !locked, retry: false, gcTime: 0 });
  const latestReportId = !reportCurrent.error ? reportCurrent.data?.latest_submission_id || "" : "";
  const reportChoice = useQuery({ queryKey: ["delivery-work-order-report-choice", ...key, latestReportId], queryFn: ({ signal }) => readSubmissionDetail(projectId, taskId, latestReportId, origin.current, signal), enabled: current() && draft?.action === "work_order.report" && Boolean(latestReportId) && !locked, retry: false, gcTime: 0 });
  const reads = useRef({ facts, detail }); reads.current = { facts, detail };
  const canWrite = () => current() && !invalidSelection && !access.current.disabled && !pending.current && access.current.canSubmit?.() !== false && ["idle", "refused"].includes(command.snapshot().phase);
  const problem = (cause: unknown) => {
    const value = executionRuntimeProblem(cause);
    if (value.message === "feedbackInvalid") return dispatchCopy.feedbackInvalid;
    if (value.message === "workOrderScopeChanged") return copy.scopeChanged;
    if (["workOrderInvalid", "ackMismatch", "retainedOriginalInvalid"].includes(value.message)) return copy.responseInvalid;
    if (["workOrderPreviewRequired", "workOrderNotAllowed"].includes(value.message)) return copy.unavailable;
    return value.code ? externalWorkOrderReason(i18n.language, value) : value.message || copy.readFailed;
  };
  const fail = (cause: unknown) => { if (current()) setError(problem(cause)); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!locked && !pending.current) setSelected(selectedOrderId); }, [selectedOrderId]);
  useEffect(() => { onUnresolvedChange?.(["sending", "unknown", "succeeded"].includes(state.phase)); }, [state.phase]);
  useEffect(() => { if (draftRef.current) editingNotify.current?.(true); return () => editingNotify.current?.(false); }, []);
  const composed = useRef(false);
  useEffect(() => { if (!compose || composed.current || !facts || locked || disabled) return; composed.current = true; if (facts.can_dispatch && canWrite()) begin("work_order.create"); }, [compose, facts, locked, disabled]);

  const handledCreate = useRef(0), composeDraftToken = useRef(0);
  useEffect(() => {
    if (!requestCreate || requestCreate.token === handledCreate.current || busy) return;
    if (currentQ.error || invalidSelection || disabled || locked || !current()) { handledCreate.current = requestCreate.token; setError(dispatchCopy.changed); onComposeSettled?.(requestCreate.token, Boolean(draftRef.current)); return; }
    if (!facts || !canWrite()) return;
    handledCreate.current = requestCreate.token;
    if (draftRef.current) { setError(dispatchCopy.changed); onComposeSettled?.(requestCreate.token, true); return; }
    const executor = facts.executors.find((row) => row.id === requestCreate.executorId && row.active && row.available);
    const started = Boolean(facts.can_dispatch && executor && begin("work_order.create", requestCreate));
    if (started) composeDraftToken.current = requestCreate.token;
    if (!started) setError(dispatchCopy.changed); onComposeSettled?.(requestCreate.token, started);
  }, [requestCreate, facts, currentQ.error, invalidSelection, locked, busy, disabled, canSubmit]);
  function begin(action: WorkOrderAction, seed?: { executorId: string; feedback_reference?: FeedbackReference }) {
    if (!canWrite() || draftRef.current) return false;
    const value = reads.current;
    if (action === "work_order.create" ? !value.facts?.can_dispatch : !value.detail) return false;
    if (state.phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return false; }
    changeDraft({ ...newDraft(action), ...(action === "work_order.create" ? { current: structuredClone(value.facts), ...(seed ? { executorId: seed.executorId, feedback_reference: seed.feedback_reference } : {}) } : { detail: structuredClone(value.detail), status: value.detail?.work_order.state === "cancel_requested" ? "blocked" : "running" }) });
    changePrepared(null); setPreview(null); setLatest(null); setError(""); setFeedback(""); return true;
  }
  const patch = (change: Partial<Draft>) => { if (canWrite() && !preparedRef.current && draftRef.current) changeDraft({ ...draftRef.current, ...change }); };
  async function prepare() {
    const value = draftRef.current; if (!value || !canWrite()) return;
    if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; }
    pending.current = true; setBusy(true); setError(""); changePrepared(null); setPreview(null); setLatest(null);
    try {
      assertCurrent();
      if (value.action === "work_order.create") {
        const fresh = await readWorkOrderCurrent(projectId, taskId, origin.current); assertCurrent();
        if (!fresh.can_dispatch || !value.current || fresh.task_basis !== value.current.task_basis || fresh.definition_digest !== value.current.definition_digest || fresh.native_boundary_digest !== value.current.native_boundary_digest) { setLatest(fresh); throw new Error(copy.changed); }
        const candidate = await previewWorkOrder(projectId, taskId, origin.current, { task_basis: fresh.task_basis, executor_member_id: value.executorId, instructions: value.instructions, ...(value.feedback_reference ? { feedback_reference: value.feedback_reference } : {}) }); assertCurrent(); setPreview(candidate);
        changePrepared(createWorkOrderOriginal(candidate, value.instructions, crypto.randomUUID()));
      } else {
        if (!value.detail) throw new Error("workOrderInvalid");
        const next = await readWorkOrderDetail(projectId, value.detail.work_order.id, origin.current, taskId); assertCurrent();
        if (next.work_order.order_revision !== value.detail.work_order.order_revision || next.work_order.request_digest !== value.detail.work_order.request_digest || next.work_order.packet_digest !== value.detail.work_order.packet_digest) { setLatest(next); throw new Error(copy.changed); }
        let extra: Record<string, unknown> = {};
        if (value.action === "work_order.progress") { if (value.knownPercent && value.percent === null) throw new Error(copy.percentKnown); extra = { percent: value.knownPercent ? value.percent : null, status: value.status, message: value.comment }; }
        if (value.action === "work_order.cancel") extra = { comment: value.comment };
        if (value.action === "work_order.release") { if (!value.stopped) throw new Error(copy.stopConfirm); extra = { stopped_attestation: true, comment: value.comment }; }
        if (value.action === "work_order.report") {
          if (!value.stopped) throw new Error(copy.reportStopConfirm);
          const latestReport = await readSubmissionCurrent(projectId, taskId, origin.current); assertCurrent();
          if (latestReport.latest_submission_id !== value.submissionId) throw new Error(copy.changed);
          const report = await readSubmissionDetail(projectId, taskId, value.submissionId, origin.current); assertCurrent();
          if (report.submission.invalidated || report.submission.status !== "awaiting_review" || report.submission.review_id !== null || report.submission.definition_digest !== next.work_order.definition_digest || report.submission.native_boundary_digest !== next.work_order.native_boundary_digest || report.submission.submitted_by.id !== next.work_order.claimed_by?.id) throw new Error(copy.changed);
          extra = { submission_id: report.submission.id, submission_digest: report.submission.digest, stopped_attestation: true };
        }
        changePrepared(workOrderActionOriginal(next, value.action, extra, crypto.randomUUID()));
      }
    } catch (cause) { fail(cause); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function complete(ack: DeliveryCommandAck | undefined) {
    if (!ack) return; assertCurrent(); command.reset();
    if (command.snapshot().phase !== "idle") { onUnresolvedChange?.(true); return; }
    composeDraftToken.current = 0; changeDraft(null); changePrepared(null); setLatest(null); setPreview(null); setError(""); setFeedback(copy.confirmed); onUnresolvedChange?.(false);
    const id = ack.result?.work_order_id; if (typeof id === "string") setSelected(id);
    onSaved?.(ack); void invalidateDeliveryQueries(client, projectId);
    if (typeof id === "string") onSelect?.(id);
  }
  async function send(replay = false) {
    if (pending.current || !current() || (replay ? command.snapshot().phase !== "unknown" : !preparedRef.current || !canWrite())) return;
    pending.current = true; setBusy(true); setError("");
    try { const ack = replay ? await command.replay() : await command.run(preparedRef.current!); assertCurrent(); await complete(ack); }
    catch (cause) { fail(cause); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const close = () => { if (!current() || pending.current || locked) return; if (command.snapshot().phase === "refused") command.reset(); if (command.snapshot().phase !== "idle") return; changeDraft(null); changePrepared(null); setLatest(null); setPreview(null); setError(""); const token = composeDraftToken.current; composeDraftToken.current = 0; if (token) onComposeClosed?.(token); };
  async function download(order: WorkOrderSummary) {
    if (!current() || pending.current) return; pending.current = true; setBusy(true); setError("");
    try { const packet = await readWorkOrderPacket(projectId, order, origin.current); assertCurrent(); const blob = new Blob([JSON.stringify(packet, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `work-order-${order.id}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { fail(cause); } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const reasonFacts = (items: WorkOrderReason[]) => items.length ? <div className="text-sm text-[var(--muted)]"><p>{items.map((item) => externalWorkOrderReason(i18n.language, item)).join(" · ")}</p><details><summary>{copy.details}</summary>{items.map((item, index) => <p key={`${item.code}:${index}`}><code>{item.code}</code> · {item.message}</p>)}</details></div> : null;
  const readFailure = (cause: unknown, retry: () => unknown) => <Alert type="warning" showIcon title={copy.readFailed} description={problem(cause)} action={<Button size="small" disabled={busy} onClick={() => { if (current()) void retry(); }}>{copy.refresh}</Button>} />;
  const stateLabel = (value: string) => copy.states[value as keyof typeof copy.states] || copy.states.unknown;
  const background = typeof location === "undefined" ? "" : location.hash;
  const backParam = new URLSearchParams(background.split("?")[1]);
  const back = externalWorkOrderReturn(backParam.get("return_to") || "", projectId);
  const original = state.original || prepared;
  const actionTitle = (action: WorkOrderAction) => ({ "work_order.create": copy.create, "work_order.claim": copy.claim, "work_order.progress": copy.updateProgress, "work_order.cancel": copy.cancelOrder, "work_order.release": copy.release, "work_order.report": copy.linkReport })[action];
  const originalFacts = original && <details className="text-xs text-[var(--muted)]"><summary>{copy.details}</summary><dl className="grid grid-cols-[auto_1fr] gap-2 break-all"><dt>{copy.task}</dt><dd>{original.binding.task_id}</dd><dt>{copy.order}</dt><dd>{original.binding.work_order_id || "—"}</dd><dt>{copy.basis}</dt><dd>{original.binding.packet_digest}</dd></dl></details>;
  const recovery = <>
    {state.phase === "sending" && <Alert type="info" title={copy.sending} />}
    {state.phase === "unknown" && <Alert role="status" type="warning" showIcon title={copy.unknown} description={copy.unknownHint} action={state.original && <Button size="small" disabled={busy} data-action="recover-work-order" onClick={() => send(true)}>{copy.recover}</Button>} />}
    {state.phase === "succeeded" && <Alert type="info" title={copy.confirmed} action={<Button size="small" disabled={busy} onClick={async () => { if (pending.current || !current()) return; pending.current = true; setBusy(true); try { await complete(command.snapshot().ack); } catch (cause) { fail(cause); } finally { pending.current = false; if (mounted.current) setBusy(false); } }}>{copy.cleanup}</Button>} />}
    {state.error && <Alert type="warning" title={state.error.startsWith("retainedOriginal") ? copy.recoveryUnavailable : problem(new Error(state.error))} />}
    {locked && originalFacts}
  </>;
  const shown = draft, formLocked = busy || locked || Boolean(prepared);
  const reportSummary = !reportChoice.error && !reportCurrent.error && reportChoice.data?.submission.id === latestReportId ? reportChoice.data.submission : null;
  const eligibleReports = reportSummary && !reportSummary.invalidated && reportSummary.status === "awaiting_review" && reportSummary.review_id === null && reportSummary.definition_digest === draft?.detail?.work_order.definition_digest && reportSummary.native_boundary_digest === draft?.detail?.work_order.native_boundary_digest && reportSummary.submitted_by.id === draft?.detail?.work_order.claimed_by?.id ? [reportSummary] : [];
  return <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" aria-label={copy.title}>
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{copy.title}</strong><Space wrap>{back && <Button size="small" href={back} disabled={locked}>{copy.back}</Button>}<Button size="small" disabled={locked || busy} onClick={() => { if (current()) { void currentQ.refetch(); void page.refetch(); if (selectedId) void detailQ.refetch(); } }}>{copy.refresh}</Button><Button size="small" type="primary" disabled={(!onDispatch && !facts?.can_dispatch) || disabled || locked || busy || Boolean(draft)} onClick={() => { if (onDispatch) { if (canWrite()) onDispatch(); } else begin("work_order.create"); }}>{onDispatch ? dispatchCopy.title : copy.create}</Button></Space></div>
    {feedback && <Alert type="success" role="status" title={feedback} />}
    {invalidSelection && <Alert type="warning" role="alert" title={copy.responseInvalid} />}
    {!draft && recovery}{error && !draft && <Alert type="warning" role="alert" title={error} />}
    {currentQ.error ? readFailure(currentQ.error, currentQ.refetch) : !facts && !locked ? <Skeleton active title={false} paragraph={{ rows: 1 }} /> : facts && !facts.can_dispatch ? reasonFacts(facts.reasons) : null}
    {detailQ.error && readFailure(detailQ.error, detailQ.refetch)}
    {detail && <div className="space-y-3 rounded-lg bg-[var(--surface-muted)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><strong>{detail.work_order.task_title}</strong><p className="text-sm text-[var(--muted)]">{detail.work_order.executor.name} · {detail.work_order.executor.tool}</p></div><Tag color={detail.work_order.invalidated || detail.work_order.state === "cancel_requested" ? "warning" : detail.work_order.state === "reported" ? "processing" : undefined}>{stateLabel(detail.work_order.state)}</Tag></div>
      <DefinitionFacts definition={detail.definition} projectId={projectId} />
      <section aria-label={dispatchCopy.instructions}><strong>{dispatchCopy.instructions}</strong><p className="whitespace-pre-wrap text-sm">{detail.instructions || "—"}</p></section>
      {detail.feedback_context && <TaskDispatchFeedback context={detail.feedback_context} fixed />}
      <WorkOrderFacts order={detail.work_order} />
      {detail.work_order.state === "queued" && <p className="text-sm">{copy.queuedHint}</p>}
      {detail.work_order.state === "cancel_requested" && <Alert type="warning" title={copy.cancelRequestedHint} />}
      {detail.work_order.state === "reported" && (!detail.work_order.delivery_state || detail.work_order.delivery_state === "awaiting_review") && <p className="text-sm">{copy.reportedHint}</p>}
      {reasonFacts(detail.permissions.reasons)}
      <Space wrap>
        <Button size="small" disabled={busy} onClick={() => void download(detail.work_order)}>{copy.download}</Button>
        {detail.permissions.can_claim && <Button size="small" type="primary" disabled={!canWrite() || Boolean(draft)} onClick={() => begin("work_order.claim")}>{copy.claim}</Button>}
        {detail.permissions.can_progress && <Button size="small" disabled={!canWrite() || Boolean(draft)} onClick={() => begin("work_order.progress")}>{copy.updateProgress}</Button>}
        {detail.permissions.can_report && <><Button size="small" type="primary" disabled={locked || busy} href={onWriteReport ? undefined : externalWorkOrderTaskHref(projectId, taskId, detail.work_order.id, "", background, true)} onClick={onWriteReport ? () => { if (canWrite() && !pending.current && !draftRef.current) onWriteReport({ id: detail.work_order.id, order_revision: detail.work_order.order_revision }); } : undefined}>{copy.writeReport}</Button><Button size="small" disabled={!canWrite() || Boolean(draft)} onClick={() => begin("work_order.report")}>{copy.linkReport}</Button></>}
        {detail.work_order.submission && <Button size="small" href={externalWorkOrderTaskHref(projectId, taskId, detail.work_order.id, detail.work_order.submission.id, background)} disabled={locked}>{copy.openReport}</Button>}
        {detail.permissions.can_cancel && <Button size="small" disabled={!canWrite() || Boolean(draft)} onClick={() => begin("work_order.cancel")}>{copy.cancelOrder}</Button>}
        {detail.permissions.can_release && <Button size="small" disabled={!canWrite() || Boolean(draft)} onClick={() => begin("work_order.release")}>{copy.release}</Button>}
      </Space><p className="text-xs text-[var(--muted)]">{copy.packetHint}</p>
    </div>}
    <details><summary className="cursor-pointer text-sm">{copy.history}{page.data && !page.error ? ` · ${page.data.total}` : ""}</summary>
      {page.error ? readFailure(page.error, page.refetch) : page.isPending && !locked ? <Skeleton active title={false} paragraph={{ rows: 1 }} /> : <ul className="mt-2 space-y-2">{page.data?.items.map((order) => <li key={order.id}><Button size="small" type="link" disabled={locked || busy || Boolean(draft)} onClick={() => { if (!current() || pending.current || locked || draftRef.current) return; setSelected(order.id); onSelect?.(order.id); }}>{stateLabel(order.state)} · {order.executor.name} · {order.created_at}</Button></li>)}</ul>}
      {page.data && !page.error && !page.data.items.length && <p className="text-sm text-[var(--muted)]">{copy.empty}</p>}
      <Space wrap>{cursor && <Button size="small" disabled={locked || busy} onClick={() => setCursor("")}>{copy.first}</Button>}{page.data?.next_cursor && !page.error && <Button size="small" disabled={locked || busy} onClick={() => setCursor(page.data!.next_cursor!)}>{copy.next}</Button>}</Space>
    </details>
    <Modal open={Boolean(draft)} title={draft ? actionTitle(draft.action) : copy.title} width={760} onCancel={close} closable={!locked && !busy} maskClosable={false} keyboard={!locked && !busy}
      footer={<Space wrap><Button disabled={locked || busy} onClick={close}>{copy.close}</Button>{prepared ? <Button type="primary" disabled={locked || busy || !canWrite()} onClick={() => send()}>{copy.confirm}</Button> : <Button type="primary" disabled={locked || busy || !canWrite()} onClick={prepare}>{copy.prepare}</Button>}</Space>}>
      <div className="space-y-4">{recovery}{error && <Alert type="warning" role="alert" title={error} />}
      {shown?.action === "work_order.create" && <>
        <DefinitionFacts definition={shown.current!.definition} projectId={projectId} />
        <label className="block text-sm">{copy.member}<Select className="mt-1 w-full" aria-label={copy.member} value={shown.executorId || undefined} disabled={formLocked} placeholder={copy.chooseMember} options={shown.current!.executors.map((item) => ({ value: item.id, label: `${item.name} · ${item.tool}`, disabled: !item.active || !item.available }))} onChange={(executorId) => patch({ executorId })} /></label>
        {!shown.current!.executors.some((item) => item.active && item.available) && <p>{copy.noMembers} · <a href={`#/dev-flow?project_id=${encodeURIComponent(projectId)}&view=team&team_view=members`}>{copy.manageTeam}</a></p>}
        {shown.current!.executors.find((item) => item.id === shown.executorId)?.reasons && reasonFacts(shown.current!.executors.find((item) => item.id === shown.executorId)!.reasons)}
        <label className="block text-sm">{copy.instruction}<Input.TextArea className="mt-1" aria-label={copy.instruction} value={shown.instructions} maxLength={4000} rows={3} disabled={formLocked} onChange={(event) => patch({ instructions: event.target.value })} /></label><p className="text-xs text-[var(--muted)]">{copy.instructionHint}</p>
      </>}
      {shown?.detail && <><strong>{shown.detail.work_order.task_title}</strong><DefinitionFacts definition={shown.detail.definition} projectId={projectId} /><section aria-label={dispatchCopy.instructions}><strong>{dispatchCopy.instructions}</strong><p className="whitespace-pre-wrap">{shown.detail.instructions || "—"}</p></section>{shown.detail.feedback_context && <TaskDispatchFeedback context={shown.detail.feedback_context} fixed />}<WorkOrderFacts order={shown.detail.work_order} /></>}
      {shown?.action === "work_order.claim" && <p>{copy.claimHint}</p>}
      {shown?.action === "work_order.cancel" && <p>{shown.detail?.work_order.state === "queued" ? copy.cancelQueuedHint : copy.cancelRequestedHint}</p>}
      {shown?.action === "work_order.progress" && <>
        <p>{copy.progressHint}</p><Select className="w-full" aria-label={copy.status} disabled={formLocked} value={shown.status} options={[{ value: "running", label: copy.runningProgress, disabled: shown.detail?.work_order.state === "cancel_requested" }, { value: "blocked", label: copy.blockedProgress }]} onChange={(status) => patch({ status })} />
        <Checkbox disabled={formLocked} checked={shown.knownPercent} onChange={(event) => patch({ knownPercent: event.target.checked, percent: null })}>{copy.percentKnown}</Checkbox>
        {shown.knownPercent && <InputNumber aria-label={copy.progress} min={0} max={100} precision={0} value={shown.percent} disabled={formLocked} onChange={(percent) => patch({ percent: percent === null ? null : Number(percent) })} />}
      </>}
      {shown && ["work_order.progress", "work_order.cancel", "work_order.release"].includes(shown.action) && <label className="block text-sm">{shown.action === "work_order.progress" ? copy.progressMessage : copy.reason}<Input.TextArea className="mt-1" aria-label={copy.reason} rows={3} maxLength={4000} value={shown.comment} disabled={formLocked} onChange={(event) => patch({ comment: event.target.value })} /></label>}
      {shown?.action === "work_order.report" && <>
        <p>{copy.reportHint}</p>{reportCurrent.error ? readFailure(reportCurrent.error, reportCurrent.refetch) : reportChoice.error ? readFailure(reportChoice.error, reportChoice.refetch) : reportCurrent.isPending || latestReportId && reportChoice.isPending ? <Skeleton active title={false} paragraph={{ rows: 1 }} /> : <Select className="w-full" aria-label={copy.chooseReport} disabled={formLocked} value={shown.submissionId || undefined} placeholder={copy.chooseReport} options={eligibleReports.map((item) => ({ value: item.id, label: `${item.summary} · ${item.created_at}` }))} onChange={(submissionId) => patch({ submissionId })} />}
        {!reportCurrent.error && !reportCurrent.isPending && !reportChoice.error && !eligibleReports.length && <p>{copy.noReports}</p>}
      </>}
      {shown && ["work_order.report", "work_order.release"].includes(shown.action) && <><Checkbox disabled={formLocked} checked={shown.stopped} onChange={(event) => patch({ stopped: event.target.checked })}>{shown.action === "work_order.report" ? copy.reportStopConfirm : copy.stopConfirm}</Checkbox><p className="text-xs text-[var(--muted)]">{copy.stoppedHint}</p></>}
      {preview?.feedback_context && <TaskDispatchFeedback context={preview.feedback_context} fixed />}
      {preview && reasonFacts(preview.reasons)}{prepared && <Alert type="info" title={copy.fixed} action={<Button size="small" disabled={locked || busy} onClick={() => { if (canWrite()) changePrepared(null); }}>{copy.edit}</Button>} />}{originalFacts}
      {latest && <Alert type="warning" title={copy.changed} action={<Button size="small" disabled={locked || busy} onClick={() => { if (!canWrite() || !draftRef.current) return; changeDraft({ ...draftRef.current, ...("work_order" in latest ? { detail: structuredClone(latest) } : { current: structuredClone(latest) }), stopped: false }); setLatest(null); changePrepared(null); setError(""); }}>{copy.readLatest}</Button>} />}
      </div>
    </Modal>
  </section>;
}

export function WorkOrderFacts({ order }: { order: WorkOrderSummary }) {
  const { i18n } = useTranslation(), copy = externalWorkOrderCopy(i18n.language);
  return <div className="space-y-2 text-sm"><dl className="grid gap-2 sm:grid-cols-2"><div><dt className="text-xs text-[var(--muted)]">{copy.by}</dt><dd>{order.requested_by.name} · {order.created_at}</dd></div><div><dt className="text-xs text-[var(--muted)]">{copy.claimedBy}</dt><dd>{order.claimed_by ? `${order.claimed_by.name} · ${order.claimed_at}` : copy.states.queued}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-[var(--muted)]">{copy.progress}</dt><dd>{order.progress ? <>{order.progress.percent === null ? copy.percentUnknown : `${order.progress.percent}%`} · {order.progress.status === "blocked" ? copy.blockedProgress : copy.runningProgress}<p>{order.progress.message}</p><small>{order.progress.reported_at}</small></> : copy.noProgress}</dd></div></dl>
    {order.invalidated && <Alert type="warning" title={copy.states.stale} description={externalWorkOrderReason(i18n.language, { code: order.invalidated_reason || "", message: order.invalidated_reason || copy.changed })} />}
    {order.closure && <p>{order.closure.kind === "never_claimed" ? copy.neverClaimed : copy.stopReported} · {order.closure.actor.name} · {order.closure.at}<small className="block">{order.state === "reported" ? copy.stoppedHint : order.closure.comment}</small></p>}
    {order.delivery_state && <p>{copy.deliveryReview} · <Tag color={order.delivery_state === "accepted" ? "success" : order.delivery_state === "changes_requested" ? "warning" : undefined}>{copy.deliveryStates[order.delivery_state]}</Tag></p>}
    <details className="text-xs text-[var(--muted)]"><summary>{copy.details}</summary><dl className="grid grid-cols-[auto_1fr] gap-2 break-all"><dt>{copy.order}</dt><dd>{order.id}</dd><dt>{copy.task}</dt><dd>{order.task_id}</dd><dt>{copy.basis}</dt><dd>{order.request_digest}</dd><dt>{copy.packet}</dt><dd>{order.packet_digest}</dd></dl></details>
  </div>;
}
export function DefinitionFacts({ definition, projectId }: { definition: WorkOrderCurrent["definition"]; projectId: string }) {
  const { i18n } = useTranslation(), copy = externalWorkOrderCopy(i18n.language);
  return <section className="space-y-2 rounded-lg bg-[var(--surface-muted)] p-3" aria-label={copy.basis}><strong>{definition.title}</strong><p className="whitespace-pre-wrap text-sm">{definition.description}</p><p className="text-sm">{copy.owner}: {definition.owner?.name || definition.owner?.id || "—"}</p>{definition.requirement && <p className="text-sm">{copy.requirement}: {definition.requirement.title} · v{definition.requirement.revision}</p>}<ol className="list-decimal space-y-1 pl-5 text-sm">{definition.acceptance_criteria.map((text, index) => <li key={index}>{text}</li>)}</ol><DesignReferenceFacts references={definition.designs} projectId={projectId} target={{ kind: "task", id: definition.task_id }} /><details className="text-xs text-[var(--muted)]"><summary>{copy.dependencies}</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(definition.dependency_basis, null, 2)}</pre></details></section>;
}
