import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Input, Skeleton, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryCommandAck,
} from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import {
  fetchDeliveryRelease,
  releaseProblem,
  submitReleaseCommand,
  type DeliveryReleaseDetail,
} from "@/lib/deliveryRelease";
import {
  CiEvidenceFacts,
  ReleaseReasons,
  ReleaseSnapshotFacts,
  releaseTime,
} from "./DeliveryReleaseFacts";
import { DeliveryDeploymentHandoff } from "./DeliveryDeploymentWorkbench";
type ReviewSession = {
  captured: DeliveryReleaseDetail;
  action: "approve" | "reject" | "revoke";
  comment: string;
  intent: DeliveryIntent;
};

export function DeliveryReleaseDetail({
  releaseId,
  projectId,
  sessionId,
  background,
  onClose,
  onSaved,
  onPrepareDeployment,
  onOpenDeployment,
}: {
  releaseId: string;
  projectId: string;
  sessionId: string;
  background: string;
  onClose: () => void;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onPrepareDeployment?: (id: string) => void;
  onOpenDeployment?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const identity = useDrawerIdentity(
    `${projectId}:${sessionId}:${projectSessionKey()}`,
    releaseId,
  );
  return (
    <Drawer
      open={Boolean(releaseId)}
      title={t("deliveryRelease.releases")}
      width="min(1000px, 100vw)"
      rootClassName="delivery-release-drawer"
      onClose={onClose}
      afterOpenChange={identity.afterOpenChange}
    >
      {identity.displayId && (
        <ReleaseDetailContent
          key={`${projectId}:${identity.displayId}`}
          projectId={projectId}
          releaseId={identity.displayId}
          sessionId={sessionId}
          background={background}
          onSaved={onSaved}
          onPrepareDeployment={onPrepareDeployment}
          onOpenDeployment={onOpenDeployment}
        />
      )}
    </Drawer>
  );
}
export function ReleaseDetailContent({
  projectId,
  releaseId,
  sessionId,
  background,
  onSaved,
  onPrepareDeployment,
  onOpenDeployment,
}: {
  projectId: string;
  releaseId: string;
  sessionId: string;
  background: string;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onPrepareDeployment?: (id: string) => void;
  onOpenDeployment?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey());
  const [review, setReview] = useState<ReviewSession | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<DeliveryReleaseDetail | null>(null);
  const query = useQuery({
    queryKey: ["delivery-release-detail", projectId, sessionId, releaseId],
    queryFn: ({ signal }) => fetchDeliveryRelease(projectId, releaseId, signal),
    enabled: Boolean(releaseId),
    gcTime: 0,
    retry: false,
    refetchInterval: review ? false : 5000,
  });
  const data = query.data;
  const check = () => {
    if (origin.current !== projectSessionKey()) throw new Error("scopeChanged");
  };
  const fail = (problem: unknown) => {
    const info = releaseProblem(problem);
    setConflict(info.conflict);
    setError(
      t(`deliveryReleaseReasons.${info.code}`, {
        defaultValue: t(`deliveryRelease.${info.message}`, {
          defaultValue: info.message,
        }),
      }),
    );
  };
  if (query.isPending) return <Skeleton active />;
  if (!data)
    return (
      <Alert
        type="warning"
        showIcon
        title={tr(
          releaseProblem(query.error).missing ? "releaseMissing" : "readFailed",
        )}
        action={
          <Button onClick={() => void query.refetch()}>{tr("retry")}</Button>
        }
      />
    );
  if (data.project_id !== projectId || data.candidate.id !== releaseId)
    return <Empty description={tr("releaseMissing")} />;
  const candidate = data.candidate;
  const can = (action: ReviewSession["action"]) =>
    !query.isError &&
    data.permissions.can_review &&
    (action === "approve"
      ? candidate.permissions.can_approve
      : action === "reject"
        ? candidate.permissions.can_reject
        : candidate.permissions.can_revoke);
  const begin = (action: ReviewSession["action"]) => {
    if (!can(action) || busy) return;
    setReview({
      captured: structuredClone(data),
      action,
      comment: "",
      intent: { version: data.version, key: crypto.randomUUID() },
    });
    setError("");
    setConflict(false);
    setLatest(null);
  };
  const save = async () => {
    if (
      !review ||
      busy ||
      conflict ||
      !can(review.action) ||
      !review.comment.trim()
    )
      return;
    setBusy("save");
    setError("");
    try {
      check();
      const action =
        review.action === "revoke"
          ? "release.candidate.revoke"
          : "release.candidate.review";
      const payload = {
        id: review.captured.candidate.id,
        ...(review.action === "revoke" ? {} : { decision: review.action }),
        comment: review.comment.trim(),
        review_basis: review.captured.candidate.review_basis,
      };
      const intent = prepareDeliveryIntent(review.intent, action, payload);
      setReview({ ...review, intent });
      const updated = await submitReleaseCommand(
        projectId,
        action,
        payload,
        intent,
      );
      check();
      onSaved(updated);
      setReview(null);
      await query.refetch();
    } catch (problem) {
      fail(problem);
    } finally {
      setBusy("");
    }
  };
  const read = async () => {
    if (busy) return;
    setBusy("read");
    setLatest(null);
    try {
      check();
      const result = await query.refetch();
      check();
      if (result.data?.candidate.id === releaseId) setLatest(result.data);
    } catch (problem) {
      fail(problem);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="delivery-release-detail">
      <header className="delivery-release-detail-heading">
        <div>
          <div className="delivery-release-inline">
            <h2>{candidate.snapshot.version}</h2>
            <Tag>{candidate.snapshot.environment}</Tag>
            <Tag
              color={
                candidate.status === "approved"
                  ? "success"
                  : candidate.status === "stale"
                    ? "warning"
                    : "default"
              }
            >
              {tr(candidate.status)}
            </Tag>
          </div>
          <p className="delivery-release-id">{candidate.id}</p>
          <p className="delivery-release-meta">
            {tr("created")}:{" "}
            {candidate.created_by.name || candidate.created_by.id} ·{" "}
            {releaseTime(candidate.created_at, i18n.language)}
          </p>
        </div>
        <Button onClick={() => void query.refetch()} disabled={Boolean(busy)}>
          {tr("refresh")}
        </Button>
      </header>
      {query.isError && (
        <Alert
          type="error"
          showIcon
          title={tr("staleRead")}
          description={String(query.error)}
        />
      )}
      <Alert type="info" showIcon title={tr("approvalHint")} />
      {!data.permissions.can_review && (
        <p className="delivery-release-meta">{tr("restricted")}</p>
      )}
      {!candidate.valid && (
        <Alert
          type="warning"
          showIcon
          title={tr("stale")}
          description={
            <ReleaseReasons
              reasons={
                candidate.invalidated_reasons.length
                  ? candidate.invalidated_reasons
                  : candidate.reasons
              }
              background={background}
            />
          }
        />
      )}
      {candidate.invalidated_at && (
        <p>
          {tr("invalidatedAt")}:{" "}
          {releaseTime(candidate.invalidated_at, i18n.language)}
        </p>
      )}
      <ReleaseSnapshotFacts
        snapshot={candidate.snapshot}
        background={background}
      />
      <details className="delivery-release-captured">
        <summary>{tr("evidence")}</summary>
        <CiEvidenceFacts evidence={data.evidence} />
        <details>
          <summary>{tr("envelope")}</summary>
          <pre className="delivery-release-raw">{data.envelope}</pre>
        </details>
      </details>
      <section className="delivery-release-deployment">
        <h3>{tr("deployment")}</h3>
        {candidate.deployment.status !== "not_handed_off" && (
          <p>{t(`deliveryDeployment.status.${candidate.deployment.status}`)}</p>
        )}
        {onPrepareDeployment && onOpenDeployment ? (
          <DeliveryDeploymentHandoff
            projectId={projectId}
            sessionId={sessionId}
            candidateId={candidate.id}
            canPrepare={
              !query.isError &&
              candidate.status === "approved" &&
              candidate.valid
            }
            onPrepare={() => onPrepareDeployment(candidate.id)}
            onOpen={onOpenDeployment}
          />
        ) : (
          <Alert
            type="info"
            title={tr("notHandedOff")}
            description={tr("deploymentHint")}
          />
        )}
      </section>
      <section>
        <h3>{tr("reviewHistory")}</h3>
        {candidate.reviews.length ? (
          candidate.reviews.map((item, index) => (
            <article
              className="delivery-release-review-record"
              key={`${item.at}:${index}`}
            >
              <div className="delivery-release-inline">
                <Tag>{tr(item.decision)}</Tag>
                <strong>{item.actor.name || item.actor.id}</strong>
                <span>{releaseTime(item.at, i18n.language)}</span>
              </div>
              <p className="delivery-release-content">{item.comment}</p>
            </article>
          ))
        ) : (
          <p className="delivery-release-meta">{tr("noReviews")}</p>
        )}
      </section>
      <div className="delivery-release-actions">
        {(["approve", "reject", "revoke"] as const).map((action) => (
          <Button
            key={action}
            type={action === "approve" ? "primary" : "default"}
            danger={action === "revoke"}
            disabled={Boolean(busy) || !can(action)}
            onClick={() => begin(action)}
          >
            {tr(action)}
          </Button>
        ))}
      </div>
      {review && (
        <section className="delivery-release-review-form">
          <h3>{tr(review.action)}</h3>
          <p className="delivery-release-meta">
            {review.captured.candidate.snapshot.version} ·{" "}
            {review.captured.candidate.snapshot.environment}
          </p>
          <label>
            <span>{tr("comment")} *</span>
            <Input.TextArea
              autoFocus
              aria-label={tr("comment")}
              value={review.comment}
              rows={3}
              maxLength={4000}
              disabled={Boolean(busy)}
              onChange={(event) =>
                setReview({ ...review, comment: event.target.value })
              }
            />
          </label>
          {error && (
            <Alert
              type="error"
              showIcon
              title={tr(conflict ? "conflict" : "saveFailed")}
              description={error}
            />
          )}
          {conflict && (
            <Button
              loading={busy === "read"}
              disabled={Boolean(busy)}
              onClick={read}
            >
              {tr("readLatest")}
            </Button>
          )}
          {latest && (
            <section>
              <strong>
                {tr("latest")}: {tr(latest.candidate.status)}
              </strong>
              <ReleaseReasons
                reasons={latest.candidate.reasons}
                background={background}
              />
              <Button
                disabled={Boolean(busy)}
                onClick={() => {
                  setReview({
                    ...review,
                    captured: structuredClone(latest),
                    intent: {
                      version: latest.version,
                      key: crypto.randomUUID(),
                    },
                  });
                  setConflict(false);
                  setLatest(null);
                }}
              >
                {tr("adopt")}
              </Button>
            </section>
          )}
          <div className="delivery-release-actions">
            <Button disabled={Boolean(busy)} onClick={() => setReview(null)}>
              {tr("cancel")}
            </Button>
            <Button
              type="primary"
              onClick={save}
              loading={busy === "save"}
              disabled={
                Boolean(busy) ||
                conflict ||
                !review.comment.trim() ||
                !can(review.action)
              }
            >
              {tr("confirm")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
