import { Alert, Button, Form, Input, Modal, Select, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { enterPortfolioProject, prepareLifecycleSubmission, previewProjectLifecycle, projectSessionKey, type LifecycleDraft, type ProjectPortfolioDetail } from "@/lib/projectPortfolio";
import { useProjectEditorCommand } from "@/lib/projectEditorCommand";
import { projectStatuses, type ProjectStatus } from "@/lib/projectPortfolioRoute";
import { ProjectPortfolioFacts } from "./ProjectPortfolioFacts";
import { ProjectCommandFeedback } from "./ProjectCommandFeedback";

export function ProjectLifecycleEditor({ initial, background, onClose, onSaved, onUnresolvedChange }: {
  initial: ProjectPortfolioDetail; background: string; onClose: () => void; onSaved: () => void;
  onUnresolvedChange?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const origin = useRef(projectSessionKey());
  const command = useProjectEditorCommand(initial.project.id, "project.lifecycle", onUnresolvedChange);
  const [draft, setDraft] = useState<LifecycleDraft>(() => ({
    projectId: initial.project.id,
    targetStatus: (command.state.original?.payload.target_status as ProjectStatus) || (initial.project.status === "archived" ? "active" : "archived"),
    reason: String(command.state.original?.payload.reason || ""), preview: null,
    intent: command.state.original?.intent || { version: initial.project.version, key: crypto.randomUUID() },
  }));
  const draftRef = useRef(draft); draftRef.current = draft;
  const previewBusy = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmedAck = useRef<unknown>();
  const [confirmed, setConfirmed] = useState(false);
  const inScope = () => origin.current === projectSessionKey() && command.current();
  const phase = () => command.snapshot().phase;
  const canEdit = () => inScope() && !confirmedAck.current && !previewBusy.current && ["idle", "refused"].includes(phase());
  const replaceDraft = (value: LifecycleDraft) => { draftRef.current = value; setDraft(value); };
  const close = () => {
    if (!inScope() || previewBusy.current || ["sending", "unknown", "succeeded"].includes(phase())) return;
    onClose();
  };
  const change = (patch: Partial<LifecycleDraft>) => {
    if (!canEdit()) return;
    if (phase() === "refused") command.reset();
    replaceDraft({ ...draftRef.current, ...patch, preview: null }); setError("");
  };
  const read = async () => {
    if (!canEdit() || !initial.project.permissions.can_transition) return;
    const original = draftRef.current;
    if (!original.reason.trim() || original.reason.trim().length > 2000) return;
    if (phase() === "refused") command.reset();
    previewBusy.current = true; setBusy(true); setError("");
    replaceDraft({ ...original, preview: null });
    try {
      const result = await previewProjectLifecycle(original.projectId, original.targetStatus, original.reason);
      if (!inScope()) return;
      if (!result || result.project_id !== original.projectId || result.target_status !== original.targetStatus
        || result.reason !== original.reason.trim() || !Number.isSafeInteger(result.version) || result.version < 0
        || !/^[a-f0-9]{64}$/.test(result.preview_basis) || !result.permissions || !result.facts
        || !Array.isArray(result.blockers) || !Array.isArray(result.warnings)) throw new Error(tr("previewRequired"));
      replaceDraft({ ...original, preview: result, intent: { version: result.version, key: crypto.randomUUID() } });
    } catch (problem) {
      if (inScope()) setError(problem instanceof Error ? problem.message : tr("previewRequired"));
    } finally { previewBusy.current = false; setBusy(false); }
  };
  const complete = (ack: unknown) => {
    if (!ack || !inScope()) return;
    confirmedAck.current = ack; setConfirmed(true);
    command.reset();
    if (phase() !== "idle") { setError(tr("confirmedStorageUnavailable")); return; }
    try { onSaved(); onClose(); }
    catch { setError(tr("refreshAfterSaveFailed")); }
  };
  const finishConfirmed = () => complete(confirmedAck.current || command.snapshot().ack);
  const save = async () => {
    if (!canEdit() || phase() !== "idle" || !initial.project.permissions.can_transition) return;
    setError("");
    try {
      const prepared = prepareLifecycleSubmission(draftRef.current);
      replaceDraft(prepared.draft);
      complete(await command.run({ action: prepared.action, payload: prepared.payload, intent: { version: prepared.version, key: prepared.key } }));
    } catch (problem) { if (inScope()) setError(problem instanceof Error ? problem.message : tr("previewRequired")); }
  };
  const retry = async () => { if (inScope() && !previewBusy.current) complete(await command.replay()); };
  const allowed = initial.project.permissions.can_transition;
  const locked = busy || confirmed || command.locked;
  const unresolved = busy || command.unresolved || command.state.phase === "succeeded";
  const refused = command.state.phase === "refused";
  return <Modal open title={tr(initial.project.status === "archived" ? "restore" : "lifecycle")} width={680} className="project-portfolio-modal"
    closable={!unresolved} maskClosable={false} keyboard={!unresolved} onCancel={close} footer={<>
      <Button onClick={close} disabled={unresolved}>{tr("cancel")}</Button>
      <Button data-action="preview-lifecycle" onClick={read} loading={busy} disabled={!allowed || locked || !draft.reason.trim() || draft.reason.trim().length > 2000}>{tr(refused ? "readLatest" : "preview")}</Button>
      <Button data-action="confirm-lifecycle" type="primary" onClick={save} loading={command.state.phase === "sending"} disabled={!allowed || locked || refused || !draft.preview?.allowed || !draft.preview.permissions.can_transition}>{tr("confirm")}</Button>
    </>}>
    <div className="project-portfolio-detail">
      <header><strong>{initial.project.name}</strong><small className="project-portfolio-id">{initial.project.id}</small></header>
      {!allowed && <Alert type="info" title={tr("noPermission")} />}
      <ProjectCommandFeedback command={command} onRetry={retry} onConfirmed={finishConfirmed} />
      {error && <Alert type="error" showIcon title={tr(confirmed || command.state.phase === "succeeded" ? "saved" : "saveFailed")} description={error} />}
      <Form layout="vertical">
        <Form.Item label={tr("targetStatus")}><Select aria-label={tr("targetStatus")} value={draft.targetStatus} disabled={locked || !allowed} options={projectStatuses.filter((status) => status !== initial.project.status).map((status) => ({ value: status, label: tr(status) }))} onChange={(targetStatus: ProjectStatus) => change({ targetStatus })} /></Form.Item>
        <Form.Item label={tr("reason")} required help={tr("reasonRequired")}><Input.TextArea aria-label={tr("reason")} rows={3} maxLength={2000} showCount value={draft.reason} disabled={locked || !allowed} onChange={(event) => change({ reason: event.target.value })} /></Form.Item>
      </Form>
      {draft.preview && <section aria-label={tr("preview")}>
        <Alert type={draft.preview.allowed && !refused ? "info" : "warning"} title={tr("previewHint")} description={<span>{tr(draft.preview.from_status)} → {tr(draft.preview.target_status)} · v{draft.preview.version}</span>} />
        <ProjectPortfolioFacts row={{ ...draft.preview.facts, facts_as_of: draft.preview.facts.as_of }} />
        <h3>{tr("blockers")} · {draft.preview.blockers.length}</h3>
        {!draft.preview.blockers.length && <p>{tr("noBlockers")}</p>}
        {draft.preview.blockers.map((blocker, index) => <article className="project-portfolio-risk" key={`${blocker.target.execution_id || blocker.target.task_id || blocker.code}:${index}`}><strong>{t(`projectPortfolio.reasons.${blocker.code}`, { defaultValue: blocker.message })}</strong><div><Tag>{blocker.status}</Tag>{blocker.run_id && <span className="project-portfolio-id">{blocker.run_id}</span>}</div><Button disabled={unresolved || !initial.project.permissions.can_enter} onClick={() => { if (inScope() && !previewBusy.current && !["sending", "unknown", "succeeded"].includes(phase())) window.location.hash = enterPortfolioProject(initial.project, blocker.target, background); }}>{tr("openTarget")}</Button></article>)}
        {draft.preview.warnings.length > 0 && <><h3>{tr("warnings")}</h3>{draft.preview.warnings.map((warning) => <p key={warning.code}>{t(`projectPortfolio.reasons.${warning.code}`, { defaultValue: warning.message })} · {warning.count}</p>)}</>}
      </section>}
    </div>
  </Modal>;
}
