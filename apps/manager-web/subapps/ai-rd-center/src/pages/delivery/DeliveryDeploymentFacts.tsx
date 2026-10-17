import { Alert, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type {
  DeploymentReason,
  DeploymentSnapshot,
  DeploymentStatus,
} from "@/lib/deliveryDeployment";
import { ReleaseDigest, ReleaseSnapshotFacts } from "./DeliveryReleaseFacts";
import { ExecutionTargetFacts } from "./ExecutionTargetFacts";

export function DeploymentReasons({
  reasons,
}: {
  reasons: DeploymentReason[];
}) {
  const { t } = useTranslation();
  if (!reasons.length) return null;
  return (
    <ul className="deployment-reasons">
      {reasons.map((reason, i) => (
        <li key={`${reason.code}:${i}`}>
          {t(`deliveryDeploymentReasons.${reason.code}`, {
            defaultValue: reason.message,
          })}
        </li>
      ))}
    </ul>
  );
}
export function DeploymentStatusTag({
  status,
}: {
  status: DeploymentStatus | string;
}) {
  const { t } = useTranslation();
  return (
    <Tag
      color={
        ["verified", "rolled_back"].includes(status)
          ? "success"
          : status === "failed"
            ? "error"
            : ["unknown", "awaiting_promotion"].includes(status)
              ? "warning"
              : "default"
      }
    >
      {t(`deliveryDeployment.status.${status}`, { defaultValue: status })}
    </Tag>
  );
}
export function DeploymentSnapshotFacts({
  snapshot,
  background,
}: {
  snapshot: DeploymentSnapshot;
  background: string;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryDeployment.${key}`);
  return (
    <section className="deployment-fixed-plan" aria-label={tr("fixedPlan")}>
      <dl className="delivery-release-facts">
        <div>
          <dt>{tr("environment")}</dt>
          <dd>
            {snapshot.environment_name} · {tr("generation")}{" "}
            {snapshot.environment_generation}
          </dd>
        </div>
        <div>
          <dt>{tr("target")}</dt>
          <dd>
            {snapshot.target_snapshot.name} · {snapshot.definition.workspace_id}{" "}
            · {snapshot.target_snapshot.id}
          </dd>
        </div>
        <div>
          <dt>{tr("steps")}</dt>
          <dd>{snapshot.traffic_steps.map((n) => `${n}%`).join(" → ")}</dd>
        </div>
        <div>
          <dt>{tr("observation")}</dt>
          <dd>
            {t("deliveryDeployment.observationRule", {
              samples: snapshot.definition.min_samples,
              seconds: snapshot.definition.observation_seconds,
            })}
          </dd>
        </div>
        <div>
          <dt>{tr("baseline")}</dt>
          <dd>
            {snapshot.baseline
              ? `${snapshot.baseline.candidate_snapshot.version} · ${snapshot.baseline.deployment_id}`
              : tr("noBaseline")}
          </dd>
        </div>
      </dl>
      {!snapshot.target_snapshot.can_execute && (
        <Alert
          type="warning"
          showIcon
          title={tr("restricted")}
          description={snapshot.target_snapshot.reason_codes
            .map((code) =>
              t(`deliveryRuntime.reason_${code}`, { defaultValue: code }),
            )
            .join(" · ")}
        />
      )}
      <ReleaseDigest
        title={tr("target")}
        value={snapshot.target_snapshot.basis}
      />
      <details className="delivery-release-captured">
        <summary>{tr("target")}</summary>
        <ExecutionTargetFacts target={snapshot.target_snapshot} />
      </details>
      <p className="delivery-release-content">{snapshot.reason}</p>
      <details className="delivery-release-captured">
        <summary>
          {tr("candidate")} · {snapshot.candidate_id}
        </summary>
        <ReleaseSnapshotFacts
          snapshot={snapshot.candidate_snapshot}
          background={background}
        />
      </details>
    </section>
  );
}
