import { Alert, Button, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { safeEvidenceUrl } from "@/lib/delivery";
import { releaseTargetHref } from "@/lib/deliveryReleaseRoute";
import type {
  QualityTask,
  ReleaseCiEvidence,
  ReleaseReason,
  ReleaseSnapshot,
} from "@/lib/deliveryRelease";

export function releaseTime(value: string | null, language: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function ReleaseDigest({
  title,
  value,
}: {
  title: string;
  value: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="delivery-release-digest">
      <span>{title}</span>
      <Typography.Text
        copyable={
          value
            ? {
                text: value,
                tooltips: [
                  t("deliveryRelease.copy"),
                  t("deliveryRelease.copied"),
                ],
              }
            : false
        }
      >
        {value || "—"}
      </Typography.Text>
    </div>
  );
}
export function ReleaseReasons({
  reasons,
  background = "",
}: {
  reasons: ReleaseReason[];
  background?: string;
}) {
  const { t } = useTranslation();
  if (!reasons.length) return null;
  return (
    <ul className="delivery-release-reasons">
      {reasons.map((reason, index) => (
        <li key={`${reason.code}:${index}`}>
          <span>
            {t(`deliveryReleaseReasons.${reason.code}`, {
              defaultValue: reason.message,
            })}
          </span>
          {reason.target && background && (
            <Button
              size="small"
              href={releaseTargetHref(reason.target, background)}
            >
              {t("deliveryRelease.openEntity")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
export function QualityTaskFacts({
  task,
  background = "",
}: {
  task: QualityTask;
  background?: string;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const source = {
    native: "native",
    manual: "manual",
    external: "external",
    requirement: "requirementProof",
    none: "noProof",
  }[task.proof.source];
  return (
    <section className="delivery-release-task-facts">
      <div className="delivery-release-inline">
        <Tag color={task.verified ? "success" : "warning"}>
          {tr(task.verified ? "ready" : "notVerified")}
        </Tag>
        <strong>{task.title}</strong>
        <span className="delivery-release-id">{task.id}</span>
      </div>
      <p className="delivery-release-meta">
        {tr("recorded")}:{" "}
        {t(`page.tasks.status.${task.recorded_status}`, {
          defaultValue: task.recorded_status,
        })}{" "}
        · {tr("effective")}:{" "}
        {t(`deliveryProgress.states.${task.delivery_status}`, {
          defaultValue: task.delivery_status,
        })}
      </p>
      <p>
        {tr("source")}: {tr(source)}
        {task.proof.reviewer_id && ` · ${task.proof.reviewer_id}`}
        {task.proof.at && ` · ${releaseTime(task.proof.at, i18n.language)}`}
      </p>
      {task.owner && (
        <p className="delivery-release-meta">
          {t("delivery.owner")}: {task.owner.name || task.owner.id}{" "}
          {!task.owner.available && (
            <Tag color="warning">{tr("ownerUnavailable")}</Tag>
          )}
        </p>
      )}
      <h4>{tr("checks")}</h4>
      {task.acceptance_criteria.length ? (
        <ol>
          {task.acceptance_criteria.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ol>
      ) : (
        <p>{tr("noProof")}</p>
      )}
      {task.proof.run_id && (
        <ReleaseDigest title={tr("native")} value={task.proof.run_id} />
      )}
      {task.proof.evidence_sha256 && (
        <ReleaseDigest
          title={tr("envelopeDigest")}
          value={task.proof.evidence_sha256}
        />
      )}
      <ReleaseReasons reasons={task.reasons} background={background} />
      {task.issues.length > 0 && (
        <section>
          <h4>{tr("issues")}</h4>
          {task.issues.map((issue) => (
            <div className="delivery-release-inline" key={issue.id}>
              <Tag color="error">{issue.severity}</Tag>
              <span>{issue.title}</span>
              {background && (
                <Button
                  size="small"
                  href={releaseTargetHref(issue.target, background)}
                >
                  {tr("locateIssue")}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {background && (
        <Button size="small" href={releaseTargetHref(task.target, background) +
          (task.proof.source === "external" && task.proof.id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(task.proof.id)
            ? `&submission_id=${encodeURIComponent(task.proof.id)}` : "")}>
          {tr("openEntity")}
        </Button>
      )}
    </section>
  );
}
export function CiEvidenceFacts({ evidence }: { evidence: ReleaseCiEvidence }) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const p = evidence.statement.predicate,
    subject = evidence.statement.subject[0];
  const incomplete = evidence.reasons.some(
    (reason) => reason.code === "release_scope_check_incomplete",
  );
  return (
    <section className="delivery-release-ci-facts">
      <div className="delivery-release-inline">
        <Tag color={evidence.passed ? "success" : "error"}>
          {tr(evidence.passed ? "ciChecksPassed" : "ciChecksFailed")}
        </Tag>
        <Tag>
          {tr(
            incomplete
              ? "unverified"
              : evidence.current
                ? "evidenceCurrent"
                : "evidenceHistorical",
          )}
        </Tag>
        <span className="delivery-release-id">{evidence.id}</span>
      </div>
      <Alert type="info" showIcon title={tr("signedHint")} />
      <p>
        {tr("build")}:{" "}
        {t(`delivery.statuses.${p.build_result}`, {
          defaultValue: p.build_result,
        })}
      </p>
      <p>{t("deliveryRelease.tests", p.tests)}</p>
      {p.tests.total === 0 && (
        <Alert type="warning" showIcon title={tr("noTests")} />
      )}
      <dl className="delivery-release-facts">
        <div>
          <dt>{tr("repository")}</dt>
          <dd>{p.repository}</dd>
        </div>
        <div>
          <dt>{tr("workflow")}</dt>
          <dd>{p.workflow}</dd>
        </div>
        <div>
          <dt>{tr("ciRun")}</dt>
          <dd>
            {t("deliveryRelease.runNumber", {
              number: p.run_number,
              attempt: p.run_attempt,
            })}
            {safeEvidenceUrl(p.run_uri) && (
              <a
                href={safeEvidenceUrl(p.run_uri)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {" "}
                ↗
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt>{tr("observed")}</dt>
          <dd>{releaseTime(p.finished_at, i18n.language)}</dd>
        </div>
      </dl>
      <ReleaseDigest title={tr("commit")} value={p.commit_sha} />
      <ReleaseDigest
        title={tr("artifactDigest")}
        value={subject?.digest.sha256 || null}
      />
      <ReleaseDigest
        title={tr("envelopeDigest")}
        value={evidence.envelope_digest}
      />
      <ReleaseDigest title={tr("keyId")} value={evidence.key_id} />
      <ReleaseDigest title={tr("scopeBasis")} value={p.scope_basis} />
      <ReleaseReasons reasons={evidence.reasons} />
      <ReleaseSourceFacts packet={evidence.source_packet || null} />
      {p.source_trace && <p className="delivery-release-meta">{t("deliveryRelease.sourceChecked", {
        bindings: p.source_trace.verified_bindings, paths: p.source_trace.checked_paths,
      })}</p>}
    </section>
  );
}
export function ReleaseSnapshotFacts({
  snapshot,
  background = "",
}: {
  snapshot: ReleaseSnapshot;
  background?: string;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  return (
    <section
      className="delivery-release-snapshot"
      aria-label={tr("fixedSnapshot")}
    >
      <div className="delivery-release-inline">
        <strong>{snapshot.version}</strong>
        <Tag>{snapshot.environment}</Tag>
        <Tag>
          {t("deliveryRelease.requirementsCount", {
            count: snapshot.selected.requirement_ids.length,
          })}
        </Tag>
        <Tag>
          {t("deliveryRelease.tasksCount", {
            count: snapshot.quality.tasks.length,
          })}
        </Tag>
      </div>
      <ReleaseDigest title={tr("commit")} value={snapshot.ci.commit_sha} />
      <ReleaseSourceFacts packet={snapshot.ci.source_packet || null} />
      <ReleaseDigest
        title={tr("artifactDigest")}
        value={snapshot.ci.artifact_sha256}
      />
      <ReleaseDigest
        title={tr("scopeBasis")}
        value={snapshot.quality.scope_basis}
      />
      <p className="delivery-release-meta">
        {snapshot.ci.repository} · {snapshot.ci.workflow} ·{" "}
        {t("deliveryRelease.runNumber", {
          number: snapshot.ci.run_number,
          attempt: snapshot.ci.run_attempt,
        })}
      </p>
      {safeEvidenceUrl(snapshot.artifact_url) && (
        <a
          className="delivery-release-link"
          href={safeEvidenceUrl(snapshot.artifact_url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {tr("artifact")} · {snapshot.ci.artifact_name} ↗
        </a>
      )}
      <h4>{tr("notes")}</h4>
      <p className="delivery-release-content">{snapshot.release_notes}</p>
      <h4>{tr("rollback")}</h4>
      <p className="delivery-release-content">{snapshot.rollback_plan}</p>
      <h4>{tr("capturedScope")}</h4>
      {snapshot.quality.requirements.map((row) => (
        <details className="delivery-release-captured" key={row.id}>
          <summary>
            <Tag color={row.accepted ? "success" : "warning"}>
              {tr(row.accepted ? "ready" : "notVerified")}
            </Tag>
            {row.title} · {row.id} ·{" "}
            {t("delivery.revision", { number: row.revision })}
          </summary>
          <ol>
            {row.acceptance_criteria.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ol>
          <ReleaseReasons reasons={row.reasons} background={background} />
          {background && (
            <Button
              size="small"
              href={releaseTargetHref(row.target, background)}
            >
              {tr("openEntity")}
            </Button>
          )}
        </details>
      ))}
      {snapshot.quality.tasks.map((task) => (
        <details className="delivery-release-captured" key={task.id}>
          <summary>
            {task.title} · {task.id}
          </summary>
          <QualityTaskFacts task={task} background={background} />
        </details>
      ))}
    </section>
  );
}

export function ReleaseSourceFacts({ packet }: { packet: import("@/lib/deliveryRelease").ReleaseSourcePacket | null }) {
  const { t } = useTranslation(), tr = (key: string) => t(`deliveryRelease.${key}`);
  if (!packet) return <Alert type="warning" showIcon title={tr("sourceMissing")} />;
  return <section aria-label={tr("sourceAssociations")}>
    <h4>{tr("sourceAssociations")}</h4>
    <p className="delivery-release-meta">{tr("sourceApprovalIncluded")}</p>
    {packet.bindings.map((row) => <details className="delivery-release-captured" key={row.task_id}>
      <summary>{row.task_id} · {tr(row.kind === "change" ? "sourceCodeChange" : "sourceNoCode")}</summary>
      <p className="delivery-release-content">{row.comment}</p>
      {row.kind === "change" && <>
        <ReleaseDigest title={tr("sourceBaseCommit")} value={row.base_commit} />
        <ReleaseDigest title={tr("sourceAcceptedCommit")} value={row.accepted_commit} />
      </>}
      <ReleaseDigest title={tr("sourceTaskBasis")} value={row.task_basis} />
      <ReleaseDigest title={tr("sourceProofBasis")} value={row.proof_basis} />
    </details>)}
  </section>;
}
