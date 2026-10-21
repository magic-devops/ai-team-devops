import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Select, Skeleton, Space, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownView } from "@/components/MarkdownView";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { designCopy, designReason } from "@/i18n/design-library";
import { useDesignCommand, validDesignOriginal, type DesignOriginal } from "@/lib/designCommand";
import { designLibraryHref, designSlots, parseDesignSourceRoute, previewDesignAdoption, readDesignCurrent, readDesignDocuments, readDesignRevision, readDesignRevisions,
  type DesignCurrent, type DesignPreview, type DesignReference, type DesignSlot, type DesignTarget } from "@/lib/designLibrary";
import { DesignOperationRecovery } from "./DesignOperationRecovery";

type Props = { projectId: string; target: DesignTarget; sessionId: string; disabled?: boolean; isActive?: () => boolean; canSubmit?: () => boolean; onSaved: (ack: DeliveryCommandAck) => void; onEditingChange?: (value: boolean) => void; onUnresolvedChange?: (value: boolean) => void };
export function DesignReferenceFacts({ references, projectId, background = "", target }: { references: DesignReference[]; projectId: string; background?: string; target?: DesignTarget }) {
  const { i18n } = useTranslation(), copy = designCopy(i18n?.language);
  return <ul className="space-y-2">{designSlots.map((slot) => { const value = references.find((item) => item.slot === slot); return <li className="rounded-lg border border-[var(--border)] p-3" key={slot}><strong>{copy.slots[slot]}</strong>{value ? <><p>{value.title} · v{value.revision_number}</p><Tag>{value.origin_kind === "requirement" && target?.kind !== "requirement" ? copy.inherited : copy.own}</Tag><Button size="small" type="link" href={designLibraryHref(projectId, value.document_id, value.revision_id, background)}>{copy.sourceOpen}</Button><details className="runtime-help"><summary>{copy.details}</summary><p>{value.origin_kind} · {value.origin_id} · {value.adoption_id}</p><p className="break-all">{value.revision_digest}</p></details></> : <p className="runtime-help">{copy.noContext}</p>}</li>; })}</ul>;
}
export function DeliveryDesignContextPanel({ projectId, target, sessionId, disabled = false, isActive, canSubmit, onSaved, onEditingChange, onUnresolvedChange }: Props) {
  const { i18n } = useTranslation(), copy = designCopy(i18n?.language), origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false);
  const identity = JSON.stringify([projectId, target.kind, target.id, sessionId]), liveIdentity = useRef(identity); liveIdentity.current = identity;
  const access = useRef({ disabled, isActive, canSubmit }); access.current = { disabled, isActive, canSubmit };
  const notify = useRef(onUnresolvedChange); notify.current = onUnresolvedChange;
  const controller = useRef<{ snapshot: () => { phase: string } }>();
  const command = useDesignCommand(projectId, identity, target, (value) => notify.current?.(value || controller.current?.snapshot().phase === "succeeded")); controller.current = command;
  const locked = command.locked, isLocked = () => !["idle", "refused"].includes(command.snapshot().phase);
  const active = () => mounted.current && origin.current === projectSessionKey() && liveIdentity.current === identity && access.current.isActive?.() !== false && command.current();
  const [selection] = useState(() => parseDesignSourceRoute(typeof location === "undefined" ? "" : location.hash, projectId, target));
  const [open, setOpen] = useState(false), [operation, setOperation] = useState<"adopt" | "clear">("adopt"), [slot, setSlot] = useState<DesignSlot>("prd");
  const [documentId, setDocumentId] = useState(selection.documentId), [revisionId, setRevisionId] = useState(selection.revisionId), [cursor, setCursor] = useState(""), [revisionCursor, setRevisionCursor] = useState("");
  const [comment, setComment] = useState(""), [basis, setBasis] = useState<DesignCurrent | null>(null), [candidate, setCandidate] = useState<DesignCurrent | null>(null), [preview, setPreview] = useState<DesignPreview | null>(null);
  const [prepared, setPrepared] = useState<DesignOriginal | null>(null), originalRef = useRef(prepared); originalRef.current = prepared;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const draft = useRef({ operation, slot, documentId, revisionId, comment, basis }); draft.current = { operation, slot, documentId, revisionId, comment, basis };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!open) return; onEditingChange?.(true); return () => onEditingChange?.(false); }, [open, onEditingChange]);
  useEffect(() => { notify.current?.(["sending", "unknown", "succeeded"].includes(command.state.phase)); }, [command.state.phase]);
  const currentQuery = useQuery({ queryKey: ["delivery-design-current", projectId, origin.current, target.kind, target.id], queryFn: ({ signal }) => readDesignCurrent(projectId, target, origin.current, signal), enabled: active() && !locked, retry: false, gcTime: 0 });
  const current = !currentQuery.error && currentQuery.data?.project_id === projectId && currentQuery.data.target_kind === target.kind && currentQuery.data.target_id === target.id ? currentQuery.data : undefined;
  const currentRef = useRef(current); currentRef.current = current;
  const canWrite = () => active() && !pending.current && !isLocked() && !access.current.disabled && access.current.canSubmit?.() !== false && Boolean(currentRef.current?.can_adopt);
  const documents = useQuery({ queryKey: ["design-adoption-documents", projectId, origin.current, cursor], queryFn: ({ signal }) => readDesignDocuments(projectId, origin.current, { cursor }, signal), enabled: active() && open && operation === "adopt" && !locked, retry: false, gcTime: 0 });
  const revisions = useQuery({ queryKey: ["design-adoption-revisions", projectId, origin.current, documentId, revisionCursor], queryFn: ({ signal }) => readDesignRevisions(projectId, documentId, origin.current, revisionCursor, signal), enabled: active() && open && operation === "adopt" && Boolean(documentId) && !locked, retry: false, gcTime: 0 });
  const revision = useQuery({ queryKey: ["design-adoption-source", projectId, origin.current, documentId, revisionId], queryFn: ({ signal }) => readDesignRevision(projectId, documentId, revisionId, origin.current, signal), enabled: active() && open && operation === "adopt" && Boolean(documentId && revisionId) && !locked, retry: false, gcTime: 0 });
  const source = !revision.error && revision.data?.document_id === documentId && revision.data.revision.id === revisionId ? revision.data : undefined;
  const sourceRef = useRef(source); sourceRef.current = source;
  const begin = (nextOperation: "adopt" | "clear", selectedSlot: DesignSlot = slot) => {
    if (!canWrite() || open || nextOperation === "clear" && !currentRef.current?.own.some((item) => item.slot === selectedSlot)) return;
    if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; }
    setOperation(nextOperation); setSlot(selectedSlot); setBasis(structuredClone(currentRef.current!)); setComment(""); setPreview(null); setPrepared(null); originalRef.current = null; setCandidate(null); setError(""); setFeedback(""); setOpen(true);
  };
  const change = (update: () => void) => { if (!canWrite() || originalRef.current) return; update(); setPreview(null); setCandidate(null); setError(""); };
  const check = async () => {
    if (!canWrite() || !draft.current.basis || !draft.current.comment.trim() || draft.current.operation === "adopt" && !sourceRef.current) return;
    if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; }
    const value = structuredClone(draft.current), selected = sourceRef.current; pending.current = true; setBusy(true); setError(""); setPreview(null); setPrepared(null); originalRef.current = null;
    try {
      const latest = await readDesignCurrent(projectId, target, origin.current); if (!active()) return;
      if (!latest.can_adopt) { setCandidate(latest); throw new Error(copy.incomplete); }
      if (latest.target_basis !== value.basis!.target_basis || latest.design_basis !== value.basis!.design_basis) { setCandidate(latest); throw new Error(copy.changed); }
      const input = { operation: value.operation, slot: value.slot, target_basis: latest.target_basis, design_basis: latest.design_basis, document_id: value.operation === "adopt" ? selected!.document_id : null, revision_id: value.operation === "adopt" ? selected!.revision.id : null, revision_digest: value.operation === "adopt" ? selected!.revision.digest : null };
      const result = await previewDesignAdoption(projectId, target, input, origin.current); if (!active()) return; setPreview(result);
      if (!result.allowed || !result.complete || !result.available || !result.preview_basis) throw new Error(copy.incomplete);
      const original: DesignOriginal = { action: `${target.kind}.design.${value.operation}`, payload: { [`${target.kind}_id`]: target.id, target_basis: result.target_basis, design_basis: result.design_basis, preview_basis: result.preview_basis, slot: value.slot, comment: value.comment.trim(), ...(value.operation === "adopt" ? { document_id: input.document_id, revision_id: input.revision_id, revision_digest: input.revision_digest } : {}) }, intent: { version: result.version, key: crypto.randomUUID() } };
      if (!validDesignOriginal(original)) throw new Error("designInvalid"); originalRef.current = original; setPrepared(original);
    } catch (cause) { if (active()) setError((cause as Error).message); } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const finish = async () => {
    if (!active() || command.snapshot().phase !== "succeeded") return; const ack = command.snapshot().ack; if (!ack) return;
    command.reset(); if (command.snapshot().phase !== "idle") { notify.current?.(true); return; }
    setOpen(false); originalRef.current = null; setPrepared(null); setPreview(null); setCandidate(null); setError(""); setFeedback(copy.saved); notify.current?.(false);
    try { onSaved(ack); const result = await currentQuery.refetch(); if (result.isError) setError(copy.refreshFailed); } catch { if (active()) setError(copy.refreshFailed); }
  };
  const send = async (replay = false) => {
    if (!active() || pending.current || (replay ? command.snapshot().phase !== "unknown" : !canWrite() || !originalRef.current || !preview?.allowed)) return;
    pending.current = true; setBusy(true); setError(""); try { if (replay) await command.replay(); else await command.run(originalRef.current!); if (active()) { if (command.snapshot().phase === "refused") { originalRef.current = null; setPrepared(null); setPreview(null); } await finish(); } } catch (cause) { if (active()) setError((cause as Error).message); } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const close = () => { if (!active() || pending.current || isLocked()) return; if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; } setOpen(false); setPrepared(null); originalRef.current = null; setPreview(null); setError(""); };
  const recovery = <DesignOperationRecovery command={command} busy={busy} error={error} onReplay={() => void send(true)} onFinish={() => void finish()} />;
  const background = typeof location === "undefined" ? "" : location.hash;
  const reasonFacts = (items: { code: string; message: string }[]) => items.length > 0 && <div className="runtime-help"><ul>{items.map((item, index) => <li key={`${item.code}:${index}`}>{designReason(i18n?.language, item)}</li>)}</ul><details><summary>{copy.details}</summary>{items.map((item, index) => <p key={index}><code>{item.code}</code> · {item.message}</p>)}</details></div>;
  return <section className="delivery-manual-panel space-y-3" aria-label={copy.context}><div className="runtime-section-heading"><strong>{copy.context}</strong><Space wrap><Button size="small" onClick={() => { if (active()) void currentQuery.refetch(); }}>{copy.refresh}</Button><Button size="small" disabled={disabled || !current?.can_adopt || locked || open} onClick={() => begin("adopt")}>{copy.adopt}</Button><Button size="small" href={designLibraryHref(projectId, "", "", background)} disabled={locked || open}>{copy.library}</Button></Space></div><p className="runtime-help">{copy.contextIntro}</p>
    {!open && recovery}{feedback && <Alert role="status" type="success" title={feedback} />}{selection.invalid && <Alert type="warning" title={copy.invalid} />}{currentQuery.error ? <Alert type="warning" title={copy.readFailed} description={(currentQuery.error as Error).message} /> : !current ? !locked && <Skeleton active paragraph={{ rows: 2 }} /> : <><DesignReferenceFacts target={target} references={current.effective} projectId={projectId} background={background} />{reasonFacts(current.reasons)}<Space wrap>{current.own.map((item) => <Button key={item.slot} size="small" disabled={disabled || !current.can_adopt || locked || open} onClick={() => begin("clear", item.slot)}>{copy.clear} · {copy.slots[item.slot]}</Button>)}</Space></>}
    <Modal open={open} title={operation === "clear" ? copy.clear : copy.adopt} width={820} maskClosable={false} closable={!locked && !busy} keyboard={!locked && !busy} onCancel={close} footer={<Space wrap><Button disabled={locked || busy} onClick={close}>{copy.cancel}</Button>{!prepared && <Button type="primary" disabled={locked || busy || !current || Boolean(candidate) || !comment.trim() || operation === "adopt" && !source} onClick={() => void check()}>{copy.preview}</Button>}{prepared && <Button type="primary" disabled={locked || busy || !preview?.allowed} onClick={() => void send()}>{operation === "clear" ? copy.clearConfirm : copy.adoptConfirm}</Button>}</Space>}>
      {open && recovery}<div className="space-y-3"><label className="block">{copy.slot}<Select aria-label={copy.slot} className="w-full" disabled={locked || busy || Boolean(prepared) || operation === "clear"} value={slot} options={designSlots.map((value) => ({ value, label: copy.slots[value] }))} onChange={(value) => change(() => setSlot(value))} /></label>
      {operation === "clear" ? <Alert type="warning" title={copy.clearHint} /> : <><label className="block">{copy.source}<Select aria-label={copy.source} className="w-full" value={documentId || undefined} disabled={locked || busy || Boolean(prepared)} options={documents.data?.items.map((item) => ({ value: item.id, label: `${item.title} · v${item.revision_number}` }))} onChange={(value) => change(() => { setDocumentId(value); setRevisionId(""); setRevisionCursor(""); })} /></label><Space wrap>{cursor && <Button size="small" disabled={locked || busy || Boolean(prepared)} onClick={() => change(() => setCursor(""))}>{copy.first}</Button>}{documents.data?.next_cursor && <Button size="small" disabled={locked || busy || Boolean(prepared)} onClick={() => change(() => setCursor(documents.data!.next_cursor!))}>{copy.next}</Button>}</Space><label className="block">{copy.revision}<Select aria-label={copy.revision} className="w-full" value={revisionId || undefined} disabled={locked || busy || Boolean(prepared)} options={revisions.data?.items.map((item) => ({ value: item.id, label: `v${item.number} · ${item.title} · ${item.created_at}` }))} onChange={(value) => change(() => setRevisionId(value))} /></label><Space wrap>{revisionCursor && <Button size="small" disabled={locked || busy || Boolean(prepared)} onClick={() => change(() => setRevisionCursor(""))}>{copy.first}</Button>}{revisions.data?.next_cursor && <Button size="small" disabled={locked || busy || Boolean(prepared)} onClick={() => change(() => setRevisionCursor(revisions.data!.next_cursor!))}>{copy.next}</Button>}</Space>{source && <details open><summary>{source.revision.title} · v{source.revision.number}</summary><MarkdownView content={source.content} /></details>}{(documents.error || revisions.error || revision.error) && <Alert type="warning" title={copy.readFailed} description={String(documents.error || revisions.error || revision.error)} />}</>}
      <label className="block">{copy.comment}<Input.TextArea aria-label={copy.comment} rows={3} maxLength={4000} value={comment} disabled={locked || busy || Boolean(prepared)} onChange={(event) => change(() => setComment(event.target.value))} /></label>
      {preview && <section className="space-y-3"><strong>{copy.after}</strong><DesignReferenceFacts target={target} references={preview.next_effective} projectId={projectId} background={background} /><strong>{copy.impact}</strong>{preview.impact.invalidates_current_acceptance && <Alert type="warning" title={copy.invalidates} />}{preview.impact.counts ? <dl className="grid grid-cols-2 gap-2">{Object.entries(preview.impact.counts).map(([key, count]) => <div key={key}><dt>{copy.counts[key as keyof typeof copy.counts]}</dt><dd>{count}</dd></div>)}</dl> : <Alert type="warning" title={copy.incomplete} />}{reasonFacts(preview.reasons)}<details className="runtime-help"><summary>{copy.details}</summary><p>{preview.preview_basis}</p><pre>{JSON.stringify(preview.budget, null, 2)}</pre></details></section>}
      {prepared && <Alert type="info" title={copy.fixed} action={<Button disabled={locked || busy} onClick={() => { if (canWrite()) { originalRef.current = null; setPrepared(null); } }}>{copy.edit}</Button>} />}
      {candidate && <Alert type="warning" title={copy.changed} description={reasonFacts(candidate.reasons)} action={<Button disabled={locked || busy || !candidate.can_adopt} onClick={() => { if (!canWrite()) return; setBasis(candidate); setCandidate(null); setPreview(null); setPrepared(null); originalRef.current = null; setError(""); }}>{copy.adoptBasis}</Button>} />}
      </div>
    </Modal>
  </section>;
}
