import { Alert, Button, Modal, Space, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { taskSubmissionCopy, taskSubmissionReason } from "@/i18n/task-submission";
import { submissionUrl, type SubmissionReworkMetadata } from "@/lib/deliveryTaskSubmission";
import type { SubmissionReworkPreview } from "@/lib/deliverySubmissionRework";

export function TaskSubmissionReworkPreview({ preview, busy, canAdopt, onAdopt, onClose }: {
  preview: SubmissionReworkPreview; busy: boolean; canAdopt: boolean; onAdopt: () => void; onClose: () => void;
}) {
  const { i18n } = useTranslation(), copy = taskSubmissionCopy(i18n?.language), source = preview.feedback_context;
  return <Modal open title={copy.reworkPreview} width={760} maskClosable={false} closable={!busy} keyboard={!busy} onCancel={onClose}
    footer={<Space wrap><Button disabled={busy} onClick={onClose}>{copy.close}</Button><Button type="primary" disabled={busy || !canAdopt || !preview.allowed} onClick={onAdopt}>{copy.reworkAdopt}</Button></Space>}>
    <div className="space-y-4">
      <Alert type="warning" title={copy.reworkHistorical} description={<>{copy.reworkReset}<p>{copy.reworkSourceHint}</p><p>{copy.reworkNoOrder}</p></>} />
      {preview.reasons.length > 0 && <Alert type="warning" title={copy.reasons} description={<><p>{preview.reasons.map((reason) => taskSubmissionReason(i18n?.language, reason)).join(" · ")}</p><details><summary>{copy.details}</summary><pre className="runtime-output whitespace-pre-wrap">{JSON.stringify(preview.reasons, null, 2)}</pre></details></>} />}
      <section className="space-y-2 rounded-lg border border-[var(--border)] p-3"><strong>{copy.reworkDecision}</strong><blockquote className="whitespace-pre-wrap break-words">{source.decision.comment}</blockquote><p className="runtime-help">{source.decision.reviewer.name} · {source.decision.created_at}</p></section>
      <section className="space-y-2"><strong>{copy.summary}</strong><p className="whitespace-pre-wrap break-words">{preview.draft.summary}</p></section>
      <section className="space-y-2"><strong>{copy.newBasis}</strong><p>{preview.current.definition.title}</p><ul className="space-y-2">{preview.current.criteria.map((criterion) => <li key={`${criterion.source}:${criterion.index}`}><Tag>{copy.results.unknown}</Tag>{criterion.text}</li>)}</ul></section>
      <details className="runtime-help"><summary>{copy.artifacts} · {preview.draft.artifacts.length}</summary>{preview.draft.artifacts.map((artifact) => <article key={artifact.id} className="space-y-1 py-2"><strong>{artifact.title}</strong>{artifact.url && submissionUrl(artifact.url) && <a className="block break-all" href={artifact.url} target="_blank" rel="noopener noreferrer">{artifact.url}</a>}<pre className="runtime-output whitespace-pre-wrap">{artifact.content}</pre>{artifact.sha256 && <p className="break-all">{copy.hash}: {artifact.sha256}</p>}</article>)}</details>
      <section><strong>{copy.tests}</strong><ul>{preview.draft.tests.map((test) => <li key={test.id}><Tag>{copy.testStates.not_run}</Tag>{test.title}</li>)}</ul></section>
      <details className="runtime-help"><summary>{copy.reworkFixed}</summary><dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all"><dt>{copy.submission}</dt><dd>{preview.rework_reference.submission_id}</dd><dt>{copy.digest}</dt><dd>{preview.rework_reference.submission_digest}</dd><dt>{copy.reworkDecision}</dt><dd>{preview.rework_reference.decision_id}</dd><dt>{copy.reworkBasis}</dt><dd>{preview.rework_basis}</dd></dl><pre className="runtime-output whitespace-pre-wrap">{JSON.stringify(source, null, 2)}</pre></details>
    </div>
  </Modal>;
}

export function SubmissionReworkFacts({ rework }: { rework: SubmissionReworkMetadata }) {
  const { i18n } = useTranslation(), copy = taskSubmissionCopy(i18n?.language);
  return <details className="runtime-help rounded-lg border border-[var(--border)] p-3"><summary>{copy.reworkFixed} · {rework.reference.submission_id}</summary>
    <p>{copy.reworkHistorical}</p><blockquote className="whitespace-pre-wrap break-words">{rework.feedback_context.decision.comment}</blockquote>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all"><dt>{copy.digest}</dt><dd>{rework.reference.submission_digest}</dd><dt>{copy.reworkDecision}</dt><dd>{rework.reference.decision_id}</dd><dt>{copy.reworkBasis}</dt><dd>{rework.basis}</dd><dt>{copy.reworkScopes}</dt><dd>{rework.feedback_runtime_scopes.join(" · ")}</dd></dl>
    <pre className="runtime-output whitespace-pre-wrap">{JSON.stringify(rework, null, 2)}</pre>
  </details>;
}
