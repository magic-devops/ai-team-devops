import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Skeleton, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryWorkspace } from "@/lib/delivery";
import {
  fetchDeliveryDeployments,
  type DeploymentEnvironment,
} from "@/lib/deliveryDeployment";
import { DeliveryDeploymentEnvironment } from "./DeliveryDeploymentEnvironment";
import { DeliveryDeploymentEditor } from "./DeliveryDeploymentEditor";
import { DeliveryDeploymentDetail } from "./DeliveryDeploymentDetail";
import {
  DeploymentReasons,
  DeploymentStatusTag,
} from "./DeliveryDeploymentFacts";
import { releaseTime } from "./DeliveryReleaseFacts";
import "./delivery-deployment.css";

type Preparation = { candidateId: string; rollbackOf: string } | null;
export function DeliveryDeploymentWorkbench({
  projectId,
  sessionId,
  releaseId,
  deploymentId,
  preparation,
  background,
  readOnly,
  onSaved,
  onClosePreparation,
  onRollback,
  onOpenDeployment,
  onCloseDeployment,
}: {
  projectId: string;
  sessionId: string;
  releaseId: string;
  deploymentId: string;
  preparation: Preparation;
  background: string;
  readOnly: boolean;
  onSaved: (data: DeliveryWorkspace) => void;
  onClosePreparation: () => void;
  onRollback: (id: string) => void;
  onOpenDeployment: (id: string, candidateId: string) => void;
  onCloseDeployment: () => void;
}) {
  const { t, i18n } = useTranslation(),
    tr = (key: string) => t(`deliveryDeployment.${key}`);
  const qc = useQueryClient();
  const [environmentEditor, setEnvironmentEditor] = useState<
    DeploymentEnvironment | "new" | null
  >(null);
  const query = useQuery({
    queryKey: ["delivery-deployment-index", projectId, sessionId],
    queryFn: ({ signal }) => fetchDeliveryDeployments(projectId, signal),
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
  });
  const index = query.data?.project_id === projectId ? query.data : undefined;
  const deployments = (index?.deployments || []).filter(
    (deployment) => !releaseId || deployment.candidate_id === releaseId,
  );
  const saved = (data: DeliveryWorkspace) => {
    onSaved(data);
    void qc.invalidateQueries({
      queryKey: ["delivery-deployment-index", projectId, sessionId],
    });
    void qc.invalidateQueries({
      queryKey: ["delivery-deployment-detail", projectId, sessionId],
    });
  };
  const unavailable = readOnly || query.isError;
  return (
    <section className="deployment-workbench" aria-label={tr("title")}>
      <header className="delivery-section-heading">
        <div>
          <h3>{tr("title")}</h3>
          <p className="delivery-release-meta">{tr("configuredOnly")}</p>
        </div>
        <div className="delivery-release-actions">
          <Button
            disabled={!index || unavailable || !index.permissions.can_configure}
            onClick={() => setEnvironmentEditor("new")}
          >
            {tr("newEnvironment")}
          </Button>
          <Button
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {tr("refresh")}
          </Button>
        </div>
      </header>
      {query.isPending && <Skeleton active />}
      {query.isError && (
        <Alert
          type="error"
          showIcon
          title={tr(index ? "staleRead" : "readFailed")}
        />
      )}
      {index && (
        <>
          <details className="delivery-release-captured">
            <summary>
              {tr("environments")} · {index.environments.length}
            </summary>
            {index.environments.length ? (
              <div className="deployment-environment-list">
                {index.environments.map((environment) => (
                  <article
                    className="deployment-environment-row"
                    key={environment.id}
                  >
                    <div>
                      <strong>{environment.name}</strong>
                      <Tag>
                        {tr("generation")} {environment.generation}
                      </Tag>
                      <p className="delivery-release-meta">
                        {environment.definition.workspace_id} ·{" "}
                        {environment.definition.target_device_id || tr("local")}
                      </p>
                      <DeploymentReasons reasons={environment.reasons} />
                    </div>
                    <div>
                      <Tag color={environment.active ? "blue" : "default"}>
                        {environment.active ? tr("active") : tr("restricted")}
                      </Tag>
                      {environment.locked_by.length > 0 && (
                        <p className="delivery-release-meta">{tr("locked")}</p>
                      )}
                      <Button
                        size="small"
                        onClick={() => setEnvironmentEditor(environment)}
                      >
                        {tr(
                          environment.can_edit &&
                            index.permissions.can_configure
                            ? "editEnvironment"
                            : "fixedPlan",
                        )}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Alert type="info" showIcon title={tr("noEnvironments")} />
            )}
          </details>
          {deployments.length ? (
            <div className="delivery-release-candidate-list">
              {deployments.map((deployment) => (
                <button
                  className="delivery-release-candidate-row"
                  key={deployment.id}
                  onClick={() =>
                    onOpenDeployment(deployment.id, deployment.candidate_id)
                  }
                >
                  <span className="delivery-release-inline">
                    <strong>
                      {deployment.snapshot.candidate_snapshot.version}
                    </strong>
                    <Tag>{deployment.snapshot.environment_name}</Tag>
                    <DeploymentStatusTag status={deployment.status} />
                  </span>
                  <span className="delivery-release-id">{deployment.id}</span>
                  <span className="delivery-release-meta">
                    {tr("actualTraffic")}:{" "}
                    {deployment.actual_traffic === null
                      ? tr("unknownValue")
                      : `${deployment.actual_traffic}%`}{" "}
                    · {releaseTime(deployment.updated_at, i18n.language)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("noDeployments")}
            />
          )}
          {environmentEditor && (
            <DeliveryDeploymentEnvironment
              key={`${projectId}:${sessionId}:${environmentEditor === "new" ? "new" : environmentEditor.id}`}
              projectId={projectId}
              initial={index}
              environment={
                environmentEditor === "new" ? undefined : environmentEditor
              }
              readOnly={unavailable}
              onSaved={saved}
              onClose={() => setEnvironmentEditor(null)}
            />
          )}
          {preparation && (
            <DeliveryDeploymentEditor
              key={`${projectId}:${sessionId}:${preparation.candidateId}:${preparation.rollbackOf}`}
              projectId={projectId}
              initial={index}
              candidateId={preparation.candidateId}
              rollbackOf={preparation.rollbackOf}
              background={background}
              readOnly={unavailable}
              onSaved={saved}
              onClose={onClosePreparation}
            />
          )}
        </>
      )}
      {preparation && !index && !query.isPending && (
        <Alert
          type="warning"
          showIcon
          title={tr("readFailed")}
          action={<Button onClick={onClosePreparation}>{tr("close")}</Button>}
        />
      )}
      <DeliveryDeploymentDetail
        projectId={projectId}
        sessionId={sessionId}
        deploymentId={preparation ? "" : deploymentId}
        background={background}
        readOnly={unavailable}
        onSaved={saved}
        onRollback={onRollback}
        onClose={onCloseDeployment}
      />
    </section>
  );
}
export function DeliveryDeploymentHandoff({
  projectId,
  sessionId,
  candidateId,
  canPrepare,
  onPrepare,
  onOpen,
}: {
  projectId: string;
  sessionId: string;
  candidateId: string;
  canPrepare: boolean;
  onPrepare: () => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryDeployment.${key}`);
  const query = useQuery({
    queryKey: ["delivery-deployment-index", projectId, sessionId],
    queryFn: ({ signal }) => fetchDeliveryDeployments(projectId, signal),
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
  });
  const index = query.data?.project_id === projectId ? query.data : undefined;
  return (
    <div className="deployment-handoff">
      {query.isPending && <Skeleton active />}
      {query.isError && (
        <Alert type="warning" title={tr(index ? "staleRead" : "readFailed")} />
      )}
      {index && (
        <>
          <Button
            type="primary"
            disabled={
              !canPrepare || query.isError || !index.permissions.can_prepare
            }
            onClick={onPrepare}
          >
            {tr("prepare")}
          </Button>
          {!index.permissions.can_prepare && (
            <p className="delivery-release-meta">
              {t("deliveryDeploymentReasons.deployment_execute_required")}
            </p>
          )}
          {!index.environments.length && <p>{tr("noEnvironments")}</p>}
          {index.deployments
            .filter((row) => row.candidate_id === candidateId)
            .map((row) => (
              <article key={row.id} className="deployment-handoff-row">
                <DeploymentStatusTag status={row.status} />
                <Button onClick={() => onOpen(row.id)}>{row.id}</Button>
                <span>
                  {row.actual_traffic === null
                    ? tr("unknownValue")
                    : `${row.actual_traffic}%`}
                </span>
              </article>
            ))}
        </>
      )}
    </div>
  );
}
