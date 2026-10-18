import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  type DeliveryReleaseDetail,
} from "@/lib/deliveryRelease";
import {
  CiEvidenceFacts,
  ReleaseReasons,
  ReleaseSnapshotFacts,
  releaseTime,
} from "./DeliveryReleaseFacts";
import { DeliveryDeploymentHandoff } from "./DeliveryDeploymentWorkbench";
import { useReleaseCommand } from "@/lib/deliveryReleaseCommand";
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
  generation,
  onPending,
}: {
  releaseId: string;
  projectId: string;
  sessionId: string;
  background: string;
  onClose: () => void;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onPrepareDeployment?: (id: string) => void;
  onOpenDeployment?: (id: string) => void;
  generation?: number | null;
  onPending?: (pending: boolean) => void;
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
      size="min(1000px, 100vw)"
      rootClassName="delivery-release-drawer"
      onClose={onClose}
      afterOpenChange={identity.afterOpenChange}
    >
      {identity.displayId && (
        <ReleaseDetailContent
          key={`${projectId}:${sessionId}:${identity.displayId}`}
          projectId={projectId}
          releaseId={identity.displayId}
          sessionId={sessionId}
          background={background}
          onSaved={onSaved}
          onPrepareDeployment={onPrepareDeployment}
          onOpenDeployment={onOpenDeployment}
          generation={generation}
          onPending={onPending}
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
  generation,
  onPending,
}: {
  projectId: string;
  releaseId: string;
  sessionId: string;
  background: string;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onPrepareDeployment?: (id: string) => void;
  onOpenDeployment?: (id: string) => void;
  generation?: number | null;
  onPending?: (pending: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey());
  const command = useReleaseCommand(
    projectId,
    "review:" + releaseId,
    onPending,
  );
  const [review, setReview] = useState<ReviewSession | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<DeliveryReleaseDetail | null>(null);
  const query = useQuery({
    queryKey: [
      "delivery-release-detail",
      projectId,
      sessionId,
      releaseId,
      generation,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryRelease(projectId, releaseId, signal, generation),
    enabled: Boolean(releaseId),
    gcTime: 0,
    retry: false,
    refetchInterval: false,
  });
  const data = query.data;
  const check = () => {
    if (!command.current() || origin.current !== projectSessionKey())
      throw new Error("scopeChanged");
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
    if (
      !can(action) ||
      busy ||
      command.unresolved ||
      command.state.phase === "refused"
    )
      return;
    if (command.state.phase === "succeeded") command.reset();
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
      command.state.phase !== "idle" ||
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
      const updated = await command.run({ action, payload, intent });
      check();
      if (updated) {
        onSaved(updated);
        setReview(null);
        await query.refetch();
      }
    } catch (problem) {
      fail(problem);
    } finally {
      setBusy("");
    }
  };
  const read = async () => {
    if (busy || command.unresolved) return;
    setBusy("read");
    setLatest(null);
    try {
      check();
      await qc.invalidateQueries({
        queryKey: ["delivery-context", projectId, sessionId],
        exact: true,
      });
      const result = await fetchDeliveryRelease(projectId, releaseId);
      check();
      if (result.candidate.id === releaseId) setLatest(result);
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
      {command.state.error && (
        <Alert
          type="error"
          title={tr(
            command.state.phase === "unknown" ? "unknownRequest" : "saveFailed",
          )}
          description={t(`deliveryRelease.${command.state.error}`, {
            defaultValue: command.state.error,
          })}
        />
      )}
      {command.unresolved && command.state.original && (
        <pre className="delivery-release-raw">
          {JSON.stringify(command.state.original, null, 2)}
        </pre>
      )}
      {command.state.phase === "unknown" && (
        <Button
          type="primary"
          onClick={async () => {
            const ack = await command.replay();
            if (ack) {
              onSaved(ack);
              setReview(null);
              void query.refetch();
            }
          }}
        >
          {tr("replayOriginal")}
        </Button>
      )}
      {!review && command.state.phase === "refused" && (
        <Button disabled={Boolean(busy)} onClick={read}>
          {tr("readLatest")}
        </Button>
      )}
      {!review && latest && command.state.phase === "refused" && (
        <Button
          onClick={() => {
            const original = command.state.original!;
            command.reset();
            setReview({
              captured: structuredClone(latest),
              action:
                original.action === "release.candidate.revoke"
                  ? "revoke"
                  : original.payload.decision === "reject"
                    ? "reject"
                    : "approve",
              comment:
                typeof original.payload.comment === "string"
                  ? original.payload.comment
                  : "",
              intent: { version: latest.version, key: crypto.randomUUID() },
            });
            setLatest(null);
            setConflict(false);
          }}
        >
          {tr("adopt")}
        </Button>
      )}
      {!data.permissions.can_review && (
        <p className="delivery-release-meta">{tr("restricted")}</p>
      )}
      {!candidate.valid && (
        <Alert
          type="warning"
          showIcon
          title={tr(candidate.status === "unverified" ? "unverified" : "stale")}
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
            disabled={
              Boolean(busy) ||
              command.unresolved ||
              command.state.phase === "refused" ||
              !can(action)
            }
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
              disabled={Boolean(busy) || command.locked}
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
          {(conflict || command.state.phase === "refused") && (
            <Button
              loading={busy === "read"}
              disabled={Boolean(busy) || command.unresolved}
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
                  if (command.unresolved) return;
                  command.reset();
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
            <Button
              disabled={Boolean(busy) || command.unresolved}
              onClick={() => setReview(null)}
            >
              {tr("cancel")}
            </Button>
            <Button
              type="primary"
              onClick={save}
              loading={busy === "save"}
              disabled={
                Boolean(busy) ||
                command.state.phase !== "idle" ||
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
