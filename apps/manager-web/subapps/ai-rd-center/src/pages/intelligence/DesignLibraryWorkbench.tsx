import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, Modal, Select, Skeleton, Space, Switch, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownView } from "@/components/MarkdownView";
import { getProjectId, getSessionRevision } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDesignCommand, validDesignOriginal, type DesignAction, type DesignOriginal } from "@/lib/designCommand";
import { designLibraryHref, designReturnHref, parseDesignLibraryRoute, readDesignCompare, readDesignDocument, readDesignDocuments, readDesignRevision, readDesignRevisions, type DesignContent, type DesignDocumentView, type DesignRevisionView, type DesignCompare } from "@/lib/designLibrary";
import { designCopy } from "@/i18n/design-library";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { DesignOperationRecovery } from "../delivery/DesignOperationRecovery";
import { DesignGenerationPanel } from "./DesignGenerationPanel";

type Edit = { action: DesignAction; content: DesignContent; base: DesignDocumentView | null; source: DesignRevisionView | null; previewId?: string };
const blank = (): DesignContent => ({ title: "", category: "architecture", tags: [], content: "", note: "" });
export function DesignDocsWorkbench(_props: { focused?: boolean }) {
  const projectId = getProjectId() || "";
  return <DesignLibrarySession key={`${projectId}:${projectSessionKey()}`} projectId={projectId} />;
}
export function DesignLibrarySession({ projectId }: { projectId: string }) {
  const { i18n } = useTranslation(), copy = designCopy(i18n?.language), origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false);
  const [route, setRoute] = useState(() => parseDesignLibraryRoute(typeof location === "undefined" ? "" : location.hash, projectId));
  const [q, setQ] = useState(""), [archived, setArchived] = useState(false), [cursor, setCursor] = useState(""), [revisionCursor, setRevisionCursor] = useState(""), [historyOpen, setHistoryOpen] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null), editRef = useRef(edit); editRef.current = edit;
  const [prepared, setPrepared] = useState<DesignOriginal | null>(null), originalRef = useRef(prepared); originalRef.current = prepared;
  const [candidate, setCandidate] = useState<DesignDocumentView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [feedback, setFeedback] = useState(""), [diff, setDiff] = useState<DesignCompare | null>(null);
  const command = useDesignCommand(projectId, `library:${getSessionRevision()}`), locked = command.locked;
  const [generationPending, setGenerationPending] = useState(false), generationPendingRef = useRef(generationPending); generationPendingRef.current = generationPending;
  const active = () => mounted.current && origin.current === projectSessionKey() && command.current();
  const unlocked = () => active() && !pending.current && !generationPendingRef.current && ["idle", "refused"].includes(command.snapshot().phase);
  useEffect(() => { mounted.current = true; const sync = () => { if (!pending.current && ["idle", "refused"].includes(command.snapshot().phase)) { setRoute(parseDesignLibraryRoute(location.hash, projectId)); setDiff(null); setRevisionCursor(""); } }; window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync); return () => { mounted.current = false; window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); }; }, [projectId, command]);
  const catalogue = useQuery({ queryKey: ["design-library", projectId, origin.current, q, archived, cursor], queryFn: ({ signal }) => readDesignDocuments(projectId, origin.current, { q, includeArchived: archived, cursor }, signal), enabled: active() && Boolean(projectId) && !locked, retry: false, gcTime: 0 });
  const document = useQuery({ queryKey: ["design-document", projectId, origin.current, route.documentId], queryFn: ({ signal }) => readDesignDocument(projectId, route.documentId, origin.current, signal), enabled: active() && Boolean(route.documentId) && !route.invalid && !locked, retry: false, gcTime: 0 });
  const head = !document.error && document.data?.project_id === projectId && document.data.document.id === route.documentId ? document.data : undefined;
  const revisionId = route.revisionId || head?.document.head_revision_id || "";
  const revision = useQuery({ queryKey: ["design-revision", projectId, origin.current, route.documentId, revisionId], queryFn: ({ signal }) => readDesignRevision(projectId, route.documentId, revisionId, origin.current, signal), enabled: active() && Boolean(route.documentId && revisionId) && !route.invalid && !locked, retry: false, gcTime: 0 });
  const source = !revision.error && revision.data?.project_id === projectId && revision.data.document_id === route.documentId && revision.data.revision.id === revisionId ? revision.data : undefined;
  const history = useQuery({ queryKey: ["design-revisions", projectId, origin.current, route.documentId, revisionCursor], queryFn: ({ signal }) => readDesignRevisions(projectId, route.documentId, origin.current, revisionCursor, signal), enabled: active() && Boolean(head) && historyOpen && !locked, retry: false, gcTime: 0 });
  const access = useRef({ head, source, catalogue: catalogue.data, failed: Boolean(catalogue.error || route.invalid) }); access.current = { head, source, catalogue: catalogue.data, failed: Boolean(catalogue.error || route.invalid) };
  const canStart = () => unlocked() && !access.current.failed && Boolean(access.current.catalogue?.permissions.can_write);
  const select = (documentId: string, selectedRevision = "") => { if (!unlocked() || editRef.current) return; const href = designLibraryHref(projectId, documentId, selectedRevision, route.background); setRoute(parseDesignLibraryRoute(href, projectId)); setDiff(null); setRevisionCursor(""); location.hash = href; };
  const begin = (action: DesignAction) => {
    if (!canStart() || editRef.current || action !== "design.document.create" && (!access.current.head?.permissions.can_write || !access.current.source)) return;
    if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; }
    const saved = access.current.source;
    const value: Edit = { action, base: access.current.head || null, source: saved || null, content: action === "design.document.create" ? blank() : saved ? { title: saved.revision.title, category: saved.revision.category, tags: [...saved.revision.tags], content: saved.content, note: "" } : blank() };
    editRef.current = value; setEdit(value); originalRef.current = null; setPrepared(null); setCandidate(null); setError(""); setFeedback("");
  };
  const patch = (change: Partial<DesignContent>) => { if (!canStart() || !editRef.current || originalRef.current) return; const next = { ...editRef.current, content: { ...editRef.current.content, ...change } }; editRef.current = next; setEdit(next); };
  const check = async (fresh = false) => {
    if (!canStart() || !editRef.current) return;
    if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; }
    const value = editRef.current; pending.current = true; setBusy(true); setError(""); originalRef.current = null; setPrepared(null);
    try {
      const current = value.action === "design.document.create" ? await readDesignDocuments(projectId, origin.current) : await readDesignDocument(projectId, value.base!.document.id, origin.current);
      if (!active() || !current.permissions.can_write) throw new Error("designScopeChanged");
      if ("document" in current && (fresh || current.document.document_version !== value.base?.document.document_version || current.document.head_revision_digest !== value.base?.document.head_revision_digest)) { setCandidate(current); setError(copy.changed); return; }
      const base = "document" in current ? { document_id: current.document.id, document_version: current.document.document_version, base_revision_id: current.document.head_revision_id, base_revision_digest: current.document.head_revision_digest } : {};
      const payload = value.action === "design.document.create" ? value.content : value.action === "design.revision.save" ? { ...value.content, ...base, ...(value.previewId ? { preview_id: value.previewId } : {}) } : value.action === "design.revision.restore" ? { ...base, revision_id: value.source!.revision.id, revision_digest: value.source!.revision.digest, note: value.content.note } : { ...base, archived: !value.base!.document.archived };
      const original: DesignOriginal = { action: value.action, payload, intent: { version: current.version, key: crypto.randomUUID() } };
      if (!validDesignOriginal(original)) throw new Error(copy.invalidInput); originalRef.current = original; setPrepared(original);
    } catch (cause) { if (active()) setError((cause as Error).message); } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const finish = async () => {
    if (!active() || command.snapshot().phase !== "succeeded") return; const ack = command.snapshot().ack; if (!ack) return;
    command.reset(); if (command.snapshot().phase !== "idle") return;
    setEdit(null); editRef.current = null; originalRef.current = null; setPrepared(null); setCandidate(null); setError(""); setFeedback(copy.saved);
    const id = ack.result?.document_id, savedRevision = ack.result?.revision_id;
    if (typeof id === "string" && typeof savedRevision === "string") { const href = designLibraryHref(projectId, id, savedRevision, route.background); setRoute(parseDesignLibraryRoute(href, projectId)); location.hash = href; }
    try { const result = await catalogue.refetch(); if (result.isError) setError(copy.refreshFailed); } catch { setError(copy.refreshFailed); }
  };
  const send = async (replay = false) => {
    if (!active() || pending.current || (replay ? command.snapshot().phase !== "unknown" : !canStart() || !originalRef.current || candidate)) return;
    pending.current = true; setBusy(true); setError(""); try { if (replay) await command.replay(); else await command.run(originalRef.current!); if (active()) { if (command.snapshot().phase === "refused") { originalRef.current = null; setPrepared(null); } await finish(); } } catch (cause) { if (active()) setError((cause as Error).message); } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const close = () => { if (!unlocked()) return; if (command.snapshot().phase === "refused") { command.reset(); if (command.snapshot().phase !== "idle") return; } setEdit(null); editRef.current = null; originalRef.current = null; setPrepared(null); setCandidate(null); setError(""); };
  const recovery = <DesignOperationRecovery command={command} busy={busy} error={error} onReplay={() => void send(true)} onFinish={() => void finish()} />;
  const readError = catalogue.error || document.error || revision.error;
  return <WorkbenchShell title={copy.title} description={copy.intro} actions={<Space wrap>{route.background && <Button disabled={locked || Boolean(edit)} href={route.background}>{copy.back}</Button>}<Button onClick={() => { if (active()) { void catalogue.refetch(); if (head) void document.refetch(); if (source) void revision.refetch(); } }}>{copy.refresh}</Button><Button type="primary" disabled={!catalogue.data?.permissions.can_write || Boolean(catalogue.error) || locked || Boolean(edit)} onClick={() => begin("design.document.create")}>{copy.create}</Button></Space>}>
    {!edit && recovery}{feedback && <Alert type="success" role="status" title={feedback} />}{route.invalid && <Alert type="warning" title={copy.invalid} />}
    {readError && <Alert type="warning" title={copy.readFailed} description={(readError as Error).message} />}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]"><aside className="space-y-3 rounded-lg border border-[var(--border)] p-3"><Input.Search aria-label={copy.search} value={q} onChange={(event) => { if (!unlocked() || edit) return; setQ(event.target.value); setCursor(""); }} /><label className="flex items-center gap-2"><Switch size="small" checked={archived} disabled={locked || Boolean(edit)} onChange={(value) => { if (unlocked()) { setArchived(value); setCursor(""); } }} />{copy.archived}</label>
      {catalogue.isPending ? <Skeleton active paragraph={{ rows: 3 }} /> : !catalogue.data?.items.length ? <Empty description={copy.empty} /> : <ul className="space-y-2">{catalogue.data.items.map((item) => <li key={item.id}><Button type={item.id === route.documentId ? "primary" : "text"} className="h-auto w-full whitespace-normal text-left" disabled={locked || Boolean(edit)} onClick={() => select(item.id)}>{item.title} · v{item.revision_number}{item.archived && <Tag>{copy.archive}</Tag>}</Button></li>)}</ul>}
      <Space wrap>{cursor && <Button size="small" disabled={locked || Boolean(edit)} onClick={() => setCursor("")}>{copy.first}</Button>}{catalogue.data?.next_cursor && <Button size="small" disabled={locked || Boolean(edit)} onClick={() => setCursor(catalogue.data!.next_cursor!)}>{copy.next}</Button>}</Space></aside>
      <section className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] p-3">{!route.documentId ? <Empty description={copy.select} /> : !source ? !revision.error && !document.error && <><Skeleton active /><p>{copy.loading}</p></> : <><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{source.revision.title}</h2><Tag>v{source.revision.number}</Tag></div><p className="runtime-help">{source.revision.author.name} · {source.revision.created_at} · {copy.categories[source.revision.category]}</p>{head && source.revision.id !== head.document.head_revision_id && <Alert type="info" title={copy.older} action={<Button size="small" disabled={locked || Boolean(edit)} onClick={() => select(head.document.id, head.document.head_revision_id)}>{copy.head}</Button>} />}<MarkdownView content={source.content} />
        <Space wrap><Button disabled={!head?.permissions.can_write || head.document.archived || locked || Boolean(edit)} onClick={() => begin("design.revision.save")}>{copy.edit}</Button>{head && source.revision.id !== head.document.head_revision_id && <Button disabled={!head.permissions.can_write || head.document.archived || locked || Boolean(edit)} onClick={() => begin("design.revision.restore")}>{copy.restore}</Button>}<Button disabled={!head?.permissions.can_write || locked || Boolean(edit)} onClick={() => begin("design.document.archive")}>{head?.document.archived ? copy.unarchive : copy.archive}</Button>{head && source.revision.id !== head.document.head_revision_id && <Button disabled={locked || busy} onClick={async () => { if (!unlocked()) return; try { const result = await readDesignCompare(projectId, head.document.id, source.revision.id, head.document.head_revision_id, origin.current); if (active()) setDiff(result); } catch (cause) { if (active()) setError((cause as Error).message); } }}>{copy.compare}</Button>}</Space>
        {diff && <details open><summary>{copy.diff} · +{diff.added_lines} / −{diff.removed_lines}{diff.truncated && ` · ${copy.truncated}`}</summary><pre className="runtime-output whitespace-pre-wrap">{diff.diff_preview}</pre></details>}
        {designReturnHref(projectId, source.document_id, source.revision.id, route.background) && <Button type="primary" disabled={locked || Boolean(edit) || generationPending} href={designReturnHref(projectId, source.document_id, source.revision.id, route.background)!}>{copy.adopt}</Button>}
        <DesignGenerationPanel key={source.document_id} projectId={projectId} source={source} disabled={locked || Boolean(edit)} canGenerate={Boolean(head?.permissions.can_generate && !head.document.archived && source.revision.id === head.document.head_revision_id)} canStart={canStart} onPending={(value) => { generationPendingRef.current = value; setGenerationPending(value); }} onSave={(value) => {
          if (!canStart() || !head || !value.can_save || !value.content || value.base_revision_id !== head.document.head_revision_id || value.base_revision_digest !== head.document.head_revision_digest) return;
          const next: Edit = { action: "design.revision.save", base: head, source, previewId: value.id, content: { title: source.revision.title, category: source.revision.category, tags: [...source.revision.tags], content: value.content, note: "" } }; editRef.current = next; setEdit(next); setPrepared(null); originalRef.current = null; setCandidate(null); setError("");
        }} />
        <details className="runtime-help"><summary>{copy.details}</summary><p>{source.document_id} · {source.revision.id}</p><p className="break-all">{copy.digest}: {source.revision.digest}</p></details>
      </>}
      {head && <details onToggle={(event) => setHistoryOpen(event.currentTarget.open)}><summary>{copy.history}</summary>{history.error ? <Alert title={copy.readFailed} description={(history.error as Error).message} /> : history.isPending ? <Skeleton active paragraph={{ rows: 2 }} /> : <ul>{history.data?.items.map((item) => <li key={item.id}><Button type="link" size="small" disabled={locked || Boolean(edit)} onClick={() => select(head.document.id, item.id)}>v{item.number} · {item.title} · {item.created_at}</Button></li>)}</ul>}<Space wrap>{revisionCursor && <Button size="small" onClick={() => setRevisionCursor("")}>{copy.first}</Button>}{history.data?.next_cursor && <Button size="small" disabled={locked} onClick={() => setRevisionCursor(history.data!.next_cursor!)}>{copy.next}</Button>}</Space></details>}</section></div>
    <Modal open={Boolean(edit)} title={edit?.action === "design.document.create" ? copy.create : edit?.action === "design.revision.save" ? copy.edit : edit?.action === "design.revision.restore" ? copy.restore : edit?.base?.document.archived ? copy.unarchive : copy.archive} width={800} maskClosable={false} closable={!locked && !busy} keyboard={!locked && !busy} onCancel={close} footer={<Space wrap><Button disabled={locked || busy} onClick={close}>{copy.cancel}</Button>{!prepared && <Button type="primary" disabled={locked || busy || Boolean(candidate)} onClick={() => void check()}>{copy.check}</Button>}{prepared && <Button type="primary" disabled={locked || busy} onClick={() => void send()}>{copy.confirm}</Button>}</Space>}>
      {edit && recovery}{edit && ["design.document.create", "design.revision.save"].includes(edit.action) && <div className="space-y-3"><label className="block">{copy.name}<Input aria-label={copy.name} value={edit.content.title} maxLength={200} disabled={locked || busy || Boolean(prepared)} onChange={(event) => patch({ title: event.target.value })} /></label><label className="block">{copy.category}<Select className="w-full" aria-label={copy.category} value={edit.content.category} disabled={locked || busy || Boolean(prepared)} options={Object.entries(copy.categories).map(([value, label]) => ({ value, label }))} onChange={(category) => patch({ category })} /></label><label className="block">{copy.tags}<Input value={edit.content.tags.join(", ")} disabled={locked || busy || Boolean(prepared)} onChange={(event) => patch({ tags: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} /></label><label className="block">{copy.content}<Input.TextArea aria-label={copy.content} rows={16} value={edit.content.content} disabled={locked || busy || Boolean(prepared)} onChange={(event) => patch({ content: event.target.value })} /></label></div>}
      {edit && edit.action !== "design.document.archive" && <label className="block">{copy.note}<Input aria-label={copy.note} maxLength={300} value={edit.content.note} disabled={locked || busy || Boolean(prepared)} onChange={(event) => patch({ note: event.target.value })} /></label>}
      {edit?.action === "design.revision.restore" && <MarkdownView content={edit.source?.content || ""} />}{prepared && <Alert type="info" title={copy.fixed} action={<Button disabled={locked || busy} onClick={() => { if (unlocked()) { originalRef.current = null; setPrepared(null); } }}>{copy.edit}</Button>} />}
      {candidate && <Alert type="warning" title={copy.changed} description={candidate.document.title} action={<Button disabled={locked || busy} onClick={() => { if (!unlocked() || !editRef.current) return; const next = { ...editRef.current, base: candidate }; editRef.current = next; setEdit(next); setCandidate(null); setPrepared(null); setError(""); }}>{copy.adoptBasis}</Button>} />}
      {command.state.phase === "refused" && <Button disabled={locked || busy} onClick={() => void check(true)}>{copy.latest}</Button>}
    </Modal>
  </WorkbenchShell>;
}
