import { Alert, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { FeedbackContext } from "@/lib/deliveryFeedback";
import { submissionUrl, type SubmissionDetail } from "@/lib/deliveryTaskSubmission";
import { taskDispatchCopy } from "@/i18n/task-dispatch";
import { taskSubmissionCopy } from "@/i18n/task-submission";
/** Historical feedback is data, separate from current acceptance and new proof. */
export function TaskDispatchFeedback({ context, detail, fixed = false }: { context?: FeedbackContext | null; detail?: SubmissionDetail; fixed?: boolean }) {
  const { i18n } = useTranslation(), copy = taskDispatchCopy(i18n?.language), report = taskSubmissionCopy(i18n?.language);
  const payload = context?.submission.payload || detail?.payload, definition = context?.submission.definition || detail?.definition, decision = context?.decision || detail?.decision;
  if (!payload || !definition || !decision) return null;
  const reference = context?.reference || { submission_id: detail!.submission.id, submission_digest: detail!.submission.digest, decision_id: detail!.decision!.id };
  return <section className="space-y-3 rounded-lg border border-[var(--border)] p-3" aria-label={copy.historical}>
    <Alert type="warning" title={fixed ? copy.fixed : copy.historical} description={copy.historicalHint} />
    <h4 className="font-medium">{definition.title}</h4><strong>{payload.summary}</strong><blockquote className="whitespace-pre-wrap border-l-2 pl-3">{decision.comment}</blockquote>
    <p className="text-xs text-[var(--muted)]">{decision.reviewer.name} · {decision.created_at}</p>
    {(context?.decision.issue_id || detail?.submission.issue_id) && <p className="break-all text-xs">{report.issue}: {context?.decision.issue_id || detail?.submission.issue_id}</p>}
    <details><summary>{report.submission} · {reference.submission_id}</summary><p className="whitespace-pre-wrap">{definition.description}</p><ul>{payload.criteria.map((row) => <li key={`${row.source}:${row.index}`}><Tag>{report.results[row.result]}</Tag>{row.source === "task" ? definition.task_acceptance_criteria[row.index] : definition.requirement?.acceptance_criteria[row.index]}</li>)}</ul><ul>{payload.tests.map((row) => <li key={row.id}><Tag>{report.testStates[row.status]}</Tag>{row.title}</li>)}</ul>{payload.artifacts.map((row) => <article key={row.id}><strong>{row.title}</strong>{row.url && submissionUrl(row.url) && <a className="block break-all" href={row.url} target="_blank" rel="noopener noreferrer">{row.url}</a>}{row.content && <pre className="whitespace-pre-wrap break-words text-xs">{row.content}</pre>}{row.sha256 && <p className="break-all text-xs">{report.hash}: {row.sha256}</p>}</article>)}<p className="break-all text-xs">{reference.submission_digest}</p></details>
    <details className="text-xs"><summary>{report.details}</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(context || { reference, submission: { definition, payload }, decision }, null, 2)}</pre></details>
  </section>;
}
