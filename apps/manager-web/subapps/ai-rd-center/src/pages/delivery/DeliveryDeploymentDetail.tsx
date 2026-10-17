import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Skeleton,
  Tabs,
  Timeline,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryWorkspace,
} from "@/lib/delivery";
import {
  deploymentProblem,
  deploymentRecord,
  fetchDeliveryDeployment,
  submitDeploymentCommand,
  type DeploymentCommand,
  type DeploymentDetail,
  type DeploymentOperation,
} from "@/lib/deliveryDeployment";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { releaseTargetHref } from "@/lib/deliveryReleaseRoute";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { ReleaseDigest, releaseTime } from "./DeliveryReleaseFacts";
import {
  DeploymentReasons,
  DeploymentSnapshotFacts,
  DeploymentStatusTag,
} from "./DeliveryDeploymentFacts";

type OperationAction =
  | "dispatch"
  | "start"
  | "advance"
  | "observe"
  | "cancel"
  | "sync";
type ActionSession = {
  action: OperationAction;
  captured: DeploymentDetail;
  comment: string;
  intent: DeliveryIntent;
};
type DetailProps = {
  projectId: string;
  deploymentId: string;
  sessionId: string;
  background: string;
  readOnly?: boolean;
  onSaved: (data: DeliveryWorkspace) => void;
  onRollback: (id: string) => void;
  onUnresolvedChange?: (value: boolean) => void;
};
export function DeliveryDeploymentDetail(
  props: DetailProps & { onClose: () => void },
) {
  const { t } = useTranslation();
  const identity = useDrawerIdentity(
    `${props.projectId}:${props.sessionId}:${projectSessionKey()}`,
    props.deploymentId,
  );
  const [lock, setLock] = useState({ id: "", value: false });
  const blocked = lock.id === identity.displayId && lock.value;
  return (
    <Drawer
      open={Boolean(props.deploymentId)}
      title={t("deliveryDeployment.title")}
      width="min(1000px, 100vw)"
      rootClassName="delivery-release-drawer deployment-drawer"
      onClose={() => !blocked && props.onClose()}
      maskClosable={!blocked}
      keyboard={!blocked}
      afterOpenChange={identity.afterOpenChange}
    >
      {identity.displayId && (
        <DeploymentDetailContent
          key={`${props.projectId}:${props.sessionId}:${identity.displayId}`}
          {...props}
          deploymentId={identity.displayId}
          onUnresolvedChange={(value) =>
            setLock({ id: identity.displayId, value })
          }
        />
      )}
    </Drawer>
  );
}
export function DeploymentDetailContent({
  projectId,
  deploymentId,
  sessionId,
  background,
  readOnly = false,
  onSaved,
  onRollback,
  onUnresolvedChange,
}: DetailProps) {
  const { t, i18n } = useTranslation(),
    tr = (key: string) => t(`deliveryDeployment.${key}`);
  const origin = useRef(projectSessionKey());
  const [action, setAction] = useState<ActionSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [latest, setLatest] = useState<DeploymentDetail | null>(null);
  const query = useQuery({
    queryKey: [
      "delivery-deployment-detail",
      projectId,
      sessionId,
      deploymentId,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryDeployment(projectId, deploymentId, signal),
    gcTime: 0,
    retry: false,
    refetchInterval: action ? false : 3000,
  });
  const data = query.data;
  const can = (kind: OperationAction) =>
    Boolean(
      data &&
      !readOnly &&
      !query.isError &&
      data.deployment.actions[`can_${kind}`] &&
      (data.deployment.status !== "unknown" ||
        ["observe", "sync"].includes(kind)),
    );
  const begin = (kind: OperationAction) => {
    if (!data || !can(kind) || busy || unknown) return;
    setAction({
      action: kind,
      captured: structuredClone(data),
      comment: "",
      intent: { version: data.version, key: crypto.randomUUID() },
    });
    setError("");
    setConflict(false);
    setLatest(null);
  };
  const save = async () => {
    if (
      !action ||
      busy ||
      conflict ||
      readOnly ||
      (!unknown && !can(action.action)) ||
      (action.action !== "sync" && !action.comment.trim())
    )
      return;
    setBusy(true);
    setError("");
    onUnresolvedChange?.(true);
    let submitted = false;
    try {
      if (origin.current !== projectSessionKey())
        throw new Error("scopeChanged");
      const command: DeploymentCommand = `deployment.${action.action}`,
        payload =
          action.action === "sync"
            ? { id: action.captured.deployment.id }
            : {
                id: action.captured.deployment.id,
                basis: action.captured.deployment.basis,
                comment: action.comment.trim(),
              };
      const intent = prepareDeliveryIntent(action.intent, command, payload);
      setAction({ ...action, intent });
      submitted = true;
      const updated = await submitDeploymentCommand(
        projectId,
        command,
        payload,
        intent,
      );
      if (origin.current !== projectSessionKey())
        throw new Error("scopeChanged");
      onSaved(updated);
      setAction(null);
      setUnknown(false);
      onUnresolvedChange?.(false);
      await query.refetch();
    } catch (problem) {
      const info = deploymentProblem(problem);
      setConflict(info.conflict);
      setUnknown(submitted && info.unknown);
      onUnresolvedChange?.(submitted && info.unknown);
      setError(
        t(`deliveryDeploymentReasons.${info.code}`, {
          defaultValue: t(`deliveryDeployment.${info.message}`, {
            defaultValue: info.message,
          }),
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const readLatest = async () => {
    if (busy || unknown) return;
    setBusy(true);
    setLatest(null);
    try {
      if (origin.current !== projectSessionKey())
        throw new Error("scopeChanged");
      const result = await query.refetch();
      if (origin.current !== projectSessionKey())
        throw new Error("scopeChanged");
      if (
        result.data?.project_id === projectId &&
        result.data.deployment.id === deploymentId
      )
        setLatest(result.data);
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  };
  if (query.isPending) return <Skeleton active />;
  if (!data)
    return (
      <Alert
        type="warning"
        showIcon
        title={tr(
          deploymentProblem(query.error).missing
            ? "deploymentMissing"
            : "readFailed",
        )}
        action={
          <Button onClick={() => void query.refetch()}>{tr("retry")}</Button>
        }
      />
    );
  if (data.project_id !== projectId || data.deployment.id !== deploymentId)
    return <Empty description={tr("deploymentMissing")} />;
  const deployment = data.deployment;
  const actions = (
    ["dispatch", "start", "advance", "observe", "cancel", "sync"] as const
  ).filter(
    (kind) =>
      deployment.actions[`can_${kind}`] &&
      (deployment.status !== "unknown" || ["observe", "sync"].includes(kind)),
  );
  return (
    <div className="deployment-detail">
      <header className="delivery-release-detail-heading">
        <div>
          <div className="delivery-release-inline">
            <h2>{deployment.snapshot.candidate_snapshot.version}</h2>
            <DeploymentStatusTag status={deployment.status} />
            <span>{deployment.snapshot.environment_name}</span>
          </div>
          <p className="delivery-release-id">{deployment.id}</p>
          <p className="delivery-release-meta">
            {tr("requested")}:{" "}
            {deployment.requested_by.name || deployment.requested_by.id} ·{" "}
            {tr("observed")}: {releaseTime(data.as_of, i18n.language)}
          </p>
        </div>
        <Button disabled={busy} onClick={() => void query.refetch()}>
          {tr("refresh")}
        </Button>
      </header>
      {query.isError && <Alert type="error" showIcon title={tr("staleRead")} />}
      {deployment.status === "unknown" && (
        <Alert type="warning" showIcon title={tr("unknownHint")} />
      )}
      <div className="deployment-health-summary">
        <div>
          <span>{tr("actualTraffic")}</span>
          <strong>
            {deployment.actual_traffic === null
              ? tr("unknownValue")
              : `${deployment.actual_traffic}%`}
          </strong>
        </div>
        <div>
          <span>{tr("physical")}</span>
          <strong>
            {deployment.verified_at
              ? releaseTime(deployment.verified_at, i18n.language)
              : "—"}
          </strong>
        </div>
      </div>
      <p>
        {tr(deployment.current ? "current" : "superseded")} ·{" "}
        {tr(deployment.business_valid ? "businessValid" : "businessInvalid")}
      </p>
      <DeploymentReasons
        reasons={[...deployment.reasons, ...deployment.actions.reasons]}
      />
      <div className="delivery-release-actions">
        {actions.map((kind) => (
          <Button
            key={kind}
            danger={kind === "cancel"}
            disabled={busy || Boolean(action) || !can(kind)}
            onClick={() => begin(kind)}
          >
            {tr(kind === "cancel" ? "requestCancel" : kind)}
          </Button>
        ))}
        {deployment.actions.can_rollback &&
          deployment.snapshot.baseline &&
          deployment.status !== "unknown" && (
            <Button
              danger
              disabled={readOnly || busy || query.isError || Boolean(action)}
              onClick={() => onRollback(deployment.id)}
            >
              {tr("rollback")}
            </Button>
          )}
        {deployment.issue_id && (
          <Button
            href={releaseTargetHref(
              {
                project_id: projectId,
                kind: "issue",
                view: "issues",
                detail: "details",
                requirement_id: "",
                task_id: "",
                issue_id: deployment.issue_id,
              },
              background,
            )}
          >
            {tr("openIssue")}
          </Button>
        )}
      </div>
      {deployment.issue_id && (
        <Alert type="info" showIcon title={tr("issueHint")} />
      )}
      {action && (
        <section className="deployment-action-form">
          <h3>
            {tr(action.action === "cancel" ? "requestCancel" : action.action)}
          </h3>
          <p className="delivery-release-id">
            {action.captured.deployment.id} · {action.captured.deployment.basis}
          </p>
          {action.action !== "sync" && (
            <label>
              <span>{tr("comment")} *</span>
              <Input.TextArea
                autoFocus
                aria-label={tr("comment")}
                rows={3}
                maxLength={2000}
                disabled={busy || unknown}
                value={action.comment}
                onChange={(event) =>
                  setAction({ ...action, comment: event.target.value })
                }
              />
            </label>
          )}
          {unknown && <Alert type="warning" title={tr("unknownRequest")} />}
          {error && (
            <Alert
              type="error"
              showIcon
              title={tr(conflict ? "conflict" : "error")}
              description={error}
            />
          )}
          {conflict && (
            <Button disabled={busy} onClick={readLatest}>
              {t("deliveryRelease.readLatest")}
            </Button>
          )}
          {latest && (
            <section className="deployment-preview">
              <strong>{t("deliveryRelease.latest")}</strong>
              <DeploymentStatusTag status={latest.deployment.status} />
              <DeploymentReasons
                reasons={[
                  ...latest.deployment.reasons,
                  ...latest.deployment.actions.reasons,
                ]}
              />
              <ReleaseDigest
                title={tr("fixedPlan")}
                value={latest.deployment.basis}
              />
              <Button
                disabled={busy || !can(action.action)}
                onClick={() => {
                  setAction({
                    ...action,
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
                {t("deliveryRelease.adopt")}
              </Button>
            </section>
          )}
          <div className="delivery-release-actions">
            <Button
              disabled={busy || unknown}
              onClick={() => {
                setAction(null);
                setConflict(false);
              }}
            >
              {tr("cancel")}
            </Button>
            {unknown && (
              <Button loading={busy} disabled={busy || readOnly} onClick={save}>
                {tr("queryOriginal")}
              </Button>
            )}
            <Button
              type="primary"
              disabled={
                busy ||
                unknown ||
                conflict ||
                !can(action.action) ||
                (action.action !== "sync" && !action.comment.trim())
              }
              loading={busy}
              onClick={save}
            >
              {tr("confirmAction")}
            </Button>
          </div>
          {conflict && (
            <p className="delivery-release-meta">{tr("conflict")}</p>
          )}
        </section>
      )}
      <Tabs
        items={[
          {
            key: "timeline",
            label: tr("timeline"),
            children: (
              <Timeline
                items={deployment.operations.map((operation) => ({
                  key: operation.id,
                  color: operation.status === "failed" ? "red" : "blue",
                  content: (
                    <div className="deployment-operation">
                      <strong>
                        {tr(operation.observe ? "observe" : "operation")}{" "}
                        {operation.index + 1}
                      </strong>
                      <DeploymentStatusTag status={operation.status} />
                      <p className="delivery-release-id">
                        {operation.id} · {operation.run_id || "—"}
                      </p>
                      <p>
                        {tr("planTraffic")}:{" "}
                        {typeof operation.plan.traffic_percent === "number"
                          ? `${operation.plan.traffic_percent}%`
                          : tr("unknownValue")}{" "}
                        · {releaseTime(operation.updated_at, i18n.language)}
                      </p>
                    </div>
                  ),
                }))}
              />
            ),
          },
          {
            key: "logs",
            label: tr("logs"),
            children: deployment.operations.map((operation) => (
              <DeploymentOperationLogs
                key={operation.id}
                operation={operation}
              />
            )),
          },
          {
            key: "health",
            label: tr("health"),
            children: deployment.operations.map((operation) => (
              <DeploymentHealthEvidence
                key={operation.id}
                operation={operation}
              />
            )),
          },
          {
            key: "plan",
            label: tr("fixedPlan"),
            children: (
              <DeploymentSnapshotFacts
                snapshot={deployment.snapshot}
                background={background}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
export function DeploymentOperationLogs({
  operation,
}: {
  operation: DeploymentOperation;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryDeployment.${key}`);
  const result = deploymentRecord(operation.result),
    apply = deploymentRecord(result.apply);
  const text = [result.error, apply.stdout, apply.stderr]
    .filter((value) => typeof value === "string" && value)
    .join("\n");
  return (
    <section className="deployment-operation">
      <strong>
        {tr("operation")} {operation.index + 1}
      </strong>
      <p className="delivery-release-id">
        {operation.id} · {tr("run")}: {operation.run_id || "—"}
      </p>
      <p>
        {tr("exit")}:{" "}
        {typeof apply.exit_code === "number" ? apply.exit_code : "—"} ·{" "}
        {tr("duration")}:{" "}
        {typeof apply.duration_ms === "number"
          ? `${apply.duration_ms} ms`
          : "—"}
      </p>
      {apply.reused === true && <p>{tr("reused")}</p>}
      {(apply.stdout_truncated === true || apply.stderr_truncated === true) && (
        <p>{t("deliveryRuntime.truncated")}</p>
      )}
      <pre
        tabIndex={0}
        className="deployment-log"
        aria-label={`${tr("logs")} ${operation.id}`}
      >
        {text || tr("noResult")}
      </pre>
      <ReleaseDigest title={tr("fixedPlan")} value={operation.plan_digest} />
    </section>
  );
}
export function DeploymentHealthEvidence({
  operation,
}: {
  operation: DeploymentOperation;
}) {
  const { t, i18n } = useTranslation(),
    tr = (key: string) => t(`deliveryDeployment.${key}`);
  const result = deploymentRecord(operation.result),
    probes = Array.isArray(result.probes)
      ? result.probes.map(deploymentRecord)
      : [];
  return (
    <section className="deployment-operation">
      <h4>
        {tr("operation")} {operation.index + 1}
      </h4>
      <p>
        {tr("samples")}: {probes.length} · {tr("window")}:{" "}
        {typeof result.observation_seconds === "number"
          ? `${result.observation_seconds} s`
          : "—"}
      </p>
      {probes.length ? (
        probes.map((probe, i) => (
          <article
            className="deployment-probe"
            key={`${String(probe.observed_at)}:${i}`}
          >
            <strong>
              {probe.healthy === true
                ? tr("healthy")
                : probe.healthy === false
                  ? tr("unhealthy")
                  : tr("unknownValue")}
            </strong>
            <p>
              {tr("resultTraffic")}:{" "}
              {typeof probe.traffic_percent === "number"
                ? `${probe.traffic_percent}%`
                : tr("unknownValue")}{" "}
              · {tr("exit")}:{" "}
              {typeof probe.exit_code === "number" ? probe.exit_code : "—"} ·{" "}
              {tr("duration")}:{" "}
              {typeof probe.duration_ms === "number"
                ? `${probe.duration_ms} ms`
                : "—"}
            </p>
            {typeof probe.error === "string" && probe.error && (
              <Alert
                type="error"
                showIcon
                title={tr("error")}
                description={probe.error}
              />
            )}
            <p>
              {tr("evidenceTime")}:{" "}
              {releaseTime(
                typeof probe.observed_at === "string"
                  ? probe.observed_at
                  : null,
                i18n.language,
              )}
            </p>
            <ReleaseDigest
              title={t("deliveryRelease.artifactDigest")}
              value={
                typeof probe.artifact_sha256 === "string"
                  ? probe.artifact_sha256
                  : null
              }
            />
            <p className="delivery-release-id">
              {String(probe.operation_id || "—")}
            </p>
            {(probe.stdout_truncated === true ||
              probe.stderr_truncated === true) && (
              <p>{t("deliveryRuntime.truncated")}</p>
            )}
            {(typeof probe.stdout === "string" ||
              typeof probe.stderr === "string") && (
              <details>
                <summary>{tr("logs")}</summary>
                <pre tabIndex={0} className="deployment-log">
                  {[probe.stdout, probe.stderr]
                    .filter((value) => typeof value === "string" && value)
                    .join("\n") || "—"}
                </pre>
              </details>
            )}
          </article>
        ))
      ) : (
        <p>{tr("noProbes")}</p>
      )}
    </section>
  );
}
