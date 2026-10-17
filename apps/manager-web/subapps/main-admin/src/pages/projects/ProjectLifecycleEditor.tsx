import { Alert, Button, Form, Input, Modal, Select, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { enterPortfolioProject, prepareLifecycleSubmission, previewProjectLifecycle, projectSessionKey, submitProjectCommand, type LifecycleDraft, type ProjectPortfolioDetail } from "@/lib/projectPortfolio";
import { projectStatuses, type ProjectStatus } from "@/lib/projectPortfolioRoute";
import { ProjectPortfolioFacts } from "./ProjectPortfolioFacts";

export function ProjectLifecycleEditor({ initial, background, onClose, onSaved }: { initial: ProjectPortfolioDetail; background: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const origin = useRef(projectSessionKey());
  const [draft, setDraft] = useState<LifecycleDraft>(() => ({ projectId: initial.project.id, targetStatus: initial.project.status === "archived" ? "active" : "archived", reason: "", preview: null, intent: { version: initial.project.version, key: crypto.randomUUID() } }));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const current = () => { if (origin.current !== projectSessionKey()) throw new Error(tr("scopeChanged")); };
  const read = async () => {
    if (busy) return;
    setBusy("preview"); setError("");
    setDraft({ ...draft, preview: null });
    try {
      current();
      const result = await previewProjectLifecycle(draft.projectId, draft.targetStatus, draft.reason);
      current();
      if (result.project_id !== draft.projectId || result.target_status !== draft.targetStatus || result.reason !== draft.reason.trim()) throw new Error(tr("scopeChanged"));
      setDraft({ ...draft, preview: result, intent: { version: result.version, key: crypto.randomUUID() } });
      setConflict(false);
    } catch (problem) { setError(problem instanceof Error ? problem.message : tr("previewRequired")); }
    finally { setBusy(""); }
  };
  const save = async () => {
    if (busy || conflict) return;
    setBusy("save"); setError("");
    try {
      current();
      const prepared = prepareLifecycleSubmission(draft);
      setDraft(prepared.draft);
      await submitProjectCommand(prepared.projectId, prepared.action, prepared.payload, { version: prepared.version, key: prepared.key });
      current(); onSaved(); onClose();
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : tr("saveFailed");
      setConflict(message.includes("409")); setError(message);
    } finally { setBusy(""); }
  };
  const change = (patch: Partial<LifecycleDraft>) => { setDraft({ ...draft, ...patch, preview: null }); setConflict(false); setError(""); };
  const allowed = initial.project.permissions.can_transition;
  return <Modal open title={tr(initial.project.status === "archived" ? "restore" : "lifecycle")} width={680} className="project-portfolio-modal" closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={onClose} footer={<>
    <Button onClick={onClose} disabled={Boolean(busy)}>{tr("cancel")}</Button>
    <Button onClick={read} loading={busy === "preview"} disabled={!allowed || Boolean(busy) || !draft.reason.trim() || draft.reason.trim().length > 2000}>{tr(conflict ? "readLatest" : "preview")}</Button>
    <Button type="primary" onClick={save} loading={busy === "save"} disabled={!allowed || Boolean(busy) || conflict || !draft.preview?.allowed || !draft.preview.permissions.can_transition}>{tr("confirm")}</Button>
  </>}>
    <div className="project-portfolio-detail">
      <header><strong>{initial.project.name}</strong><small className="project-portfolio-id">{initial.project.id}</small></header>
      {!allowed && <Alert type="info" title={tr("noPermission")} />}
      {error && <Alert type="error" showIcon title={tr(conflict ? "conflict" : "saveFailed")} description={error} />}
      <Form layout="vertical">
        <Form.Item label={tr("targetStatus")}><Select aria-label={tr("targetStatus")} value={draft.targetStatus} disabled={Boolean(busy) || !allowed} options={projectStatuses.filter((status) => status !== initial.project.status).map((status) => ({ value: status, label: tr(status) }))} onChange={(targetStatus: ProjectStatus) => change({ targetStatus })} /></Form.Item>
        <Form.Item label={tr("reason")} required help={tr("reasonRequired")}><Input.TextArea aria-label={tr("reason")} rows={3} maxLength={2000} showCount value={draft.reason} disabled={Boolean(busy) || !allowed} onChange={(event) => change({ reason: event.target.value })} /></Form.Item>
      </Form>
      {draft.preview && <section aria-label={tr("preview")}>
        <Alert type={draft.preview.allowed && !conflict ? "info" : "warning"} title={tr("previewHint")} description={<span>{tr(draft.preview.from_status)} → {tr(draft.preview.target_status)} · v{draft.preview.version}</span>} />
        <ProjectPortfolioFacts row={{ ...draft.preview.facts, facts_as_of: draft.preview.facts.as_of }} />
        <h3>{tr("blockers")} · {draft.preview.blockers.length}</h3>
        {!draft.preview.blockers.length && <p>{tr("noBlockers")}</p>}
        {draft.preview.blockers.map((blocker, index) => <article className="project-portfolio-risk" key={`${blocker.target.execution_id || blocker.target.task_id || blocker.code}:${index}`}><strong>{t(`projectPortfolio.reasons.${blocker.code}`, { defaultValue: blocker.message })}</strong><div><Tag>{blocker.status}</Tag>{blocker.run_id && <span className="project-portfolio-id">{blocker.run_id}</span>}</div><Button disabled={Boolean(busy) || !initial.project.permissions.can_enter} onClick={() => { current(); window.location.hash = enterPortfolioProject(initial.project, blocker.target, background); }}>{tr("openTarget")}</Button></article>)}
        {draft.preview.warnings.length > 0 && <><h3>{tr("warnings")}</h3>{draft.preview.warnings.map((warning) => <p key={warning.code}>{t(`projectPortfolio.reasons.${warning.code}`, { defaultValue: warning.message })} · {warning.count}</p>)}</>}
      </section>}
    </div>
  </Modal>;
}
