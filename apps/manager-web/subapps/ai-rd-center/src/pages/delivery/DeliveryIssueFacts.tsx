import { Alert, Button, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type {
  DiagnosisView,
  IssueEvidence,
  IssueReason,
} from "@/lib/deliveryIssue";
import { issueEvidenceHref } from "@/lib/deliveryIssue";
export function IssueTime({ value }: { value: string }) {
  const { i18n } = useTranslation();
  const date = new Date(value);
  return (
    <time dateTime={value}>
      {Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(i18n.language, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(date)
        : "—"}
    </time>
  );
}
export function IssueReasons({ reasons }: { reasons: IssueReason[] }) {
  const { t } = useTranslation();
  if (!reasons.length) return null;
  return (
    <ul className="issue-reasons">
      {reasons.map((reason, index) => (
        <li key={`${reason.code}:${index}`}>
          {t(`deliveryIssue.reasons.${reason.code}`, {
            defaultValue: reason.message,
          })}
        </li>
      ))}
    </ul>
  );
}
export function IssueEvidenceList({
  evidence,
  projectId,
  background = "",
  captured = false,
}: {
  evidence: IssueEvidence[];
  projectId: string;
  background?: string;
  captured?: boolean;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryIssue.${key}`);
  return (
    <div className="issue-evidence-list">
      {evidence.map((item) => {
        const href =
          !item.restricted && !item.missing
            ? issueEvidenceHref(projectId, item.target, background)
            : null;
        return (
          <article
            className="issue-evidence-card"
            key={item.id}
            id={`issue-evidence-${encodeURIComponent(item.id)}`}
          >
            <header>
              <div>
                <Tag>{tr(`kinds.${item.kind}`)}</Tag>
                <strong>{item.label}</strong>
              </div>
              <div className="issue-tags">
                {item.status && (
                  <Tag>
                    {t(`deliveryIssue.evidenceStates.${item.status}`, {
                      defaultValue: item.status,
                    })}
                  </Tag>
                )}
                {item.restricted && (
                  <Tag color="orange">{tr("restricted")}</Tag>
                )}
                {item.missing && <Tag color="orange">{tr("missing")}</Tag>}
                {item.redacted && <Tag>{tr("redacted")}</Tag>}
                {item.truncated && <Tag color="orange">{tr("truncated")}</Tag>}
              </div>
            </header>
            <p className="issue-meta">
              {t(`deliveryIssue.summaries.${item.summary}`, {
                defaultValue: item.summary,
              })}
            </p>
            {item.facts.length > 0 && (
              <dl className="issue-facts">
                {item.facts.map((fact, index) => (
                  <div key={`${fact.label}:${index}`}>
                    <dt>
                      {t(`deliveryIssue.facts.${fact.label}`, {
                        defaultValue: fact.label,
                      })}
                    </dt>
                    <dd>
                      {[
                        "scope_current",
                        "result_current",
                        "is_test",
                        "succeeded",
                        "environment_current",
                        "latest_physical",
                        "observe_only",
                        "healthy",
                        "business_valid",
                      ].includes(fact.label)
                        ? t(`deliveryIssue.values.${fact.value}`, {
                            defaultValue: fact.value,
                          })
                        : [
                              "business_status",
                              "runtime_status",
                              "operation_status",
                            ].includes(fact.label)
                          ? t(`deliveryIssue.evidenceStates.${fact.value}`, {
                              defaultValue: fact.value,
                            })
                          : fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {item.excerpt && !item.restricted && (
              <details open={captured || undefined}>
                <summary>{tr("excerpt")}</summary>
                <pre>{item.excerpt}</pre>
              </details>
            )}
            {href && !captured && item.kind !== "issue" && (
              <Button size="small" href={href}>
                {tr("openSource")}
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}
export function IssueProposalFacts({
  diagnosis,
}: {
  diagnosis: DiagnosisView;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryIssue.${key}`),
    result = diagnosis.result;
  const usage = diagnosis.usage || {},
    tokens = usage.total_tokens;
  const citations = (ids: string[]) => (
    <ul className="issue-citations">
      {ids.map((id) => (
        <li key={id}>
          <span>
            {diagnosis.snapshot?.evidence.find((item) => item.id === id)
              ?.label || id}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="issue-proposal" aria-label={tr("proposal")}>
      <div className="issue-provenance">
        <Tag color={diagnosis.generator === "ai" ? "blue" : "default"}>
          {tr(diagnosis.generator)}
        </Tag>
        <Tag>{tr(`statuses.${diagnosis.status}`)}</Tag>
        {!diagnosis.current && <Tag color="orange">{tr("historical")}</Tag>}
        {diagnosis.model && (
          <span>
            {tr("model")}: {diagnosis.model}
          </span>
        )}
        {diagnosis.provider && (
          <span>
            {tr("provider")}: {diagnosis.provider}
          </span>
        )}
        <span>
          {diagnosis.generator === "rules"
            ? tr("noModelUsage")
            : `${tr("tokens")}: ${typeof tokens === "number" ? tokens : tr("unknownValue")}`}
        </span>
        <IssueTime value={diagnosis.created_at} />
      </div>
      <p className="issue-meta">
        {tr("requestedBy")}:{" "}
        {diagnosis.requested_by.name || diagnosis.requested_by.id}
      </p>
      {diagnosis.restricted ? (
        <Alert type="warning" showIcon title={tr("proposalRestricted")} />
      ) : (
        <>
          {diagnosis.status === "generating" && (
            <Alert type="info" showIcon title={tr("generatingHint")} />
          )}
          {diagnosis.error && (
            <Alert
              type="error"
              showIcon
              title={tr("generationFailed")}
              description={t(`deliveryIssue.reasons.${diagnosis.error.code}`, {
                defaultValue: diagnosis.error.message,
              })}
            />
          )}
          {result && (
            <>
              <Alert type="info" showIcon title={tr("hypothesisHint")} />
              <p className="issue-summary">{result.summary}</p>
              <section>
                <h4>{tr("hypotheses")}</h4>
                {result.hypotheses.length ? (
                  <ol className="issue-hypotheses">
                    {result.hypotheses.map((item, index) => (
                      <li key={index}>
                        <strong>{item.hypothesis}</strong>
                        <Tag>{tr(`confidence.${item.confidence}`)}</Tag>
                        {citations(item.evidence_ids)}
                        <ol>
                          {item.verification_steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="issue-meta">{tr("noHypothesis")}</p>
                )}
              </section>
              {result.checks.length > 0 && (
                <section>
                  <h4>{tr("checks")}</h4>
                  <ol className="issue-checks">
                    {result.checks.map((item, index) => (
                      <li key={index}>
                        <strong>{item.title}</strong>
                        <p>{item.instructions}</p>
                        {citations(item.evidence_ids)}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {result.risks.length > 0 && (
                <section>
                  <h4>{tr("risks")}</h4>
                  <ul>
                    {result.risks.map((risk, index) => (
                      <li key={index}>{risk}</li>
                    ))}
                  </ul>
                </section>
              )}
              {result.open_questions.length > 0 && (
                <section>
                  <h4>{tr("openQuestions")}</h4>
                  <ul>
                    {result.open_questions.map((question, index) => (
                      <li key={index}>{question}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          {diagnosis.review && (
            <Alert
              type={
                diagnosis.review.decision === "adopted" ? "success" : "info"
              }
              showIcon
              title={tr(`reviews.${diagnosis.review.decision}`)}
              description={
                <>
                  <p>{diagnosis.review.comment}</p>
                  <p>
                    {diagnosis.review.actor.name || diagnosis.review.actor.id} ·{" "}
                    <IssueTime value={diagnosis.review.at} />
                  </p>
                  <p>{tr("issueStillOpen")}</p>
                </>
              }
            />
          )}
        </>
      )}
      <IssueReasons reasons={diagnosis.actions.reasons} />
      <details className="issue-technical">
        <summary>{tr("recordDetails")}</summary>
        <dl>
          <dt>{tr("recordId")}</dt>
          <dd>{diagnosis.id}</dd>
          <dt>{tr("requestId")}</dt>
          <dd>{diagnosis.request_key}</dd>
          <dt>{tr("basis")}</dt>
          <dd>{diagnosis.issue_basis}</dd>
        </dl>
      </details>
    </section>
  );
}
