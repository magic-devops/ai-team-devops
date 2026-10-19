import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Modal, Skeleton } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchDeliveryContext,
  fetchRequirementDetail,
} from "@/lib/deliveryQuery";
import {
  combineRequirementDefinition,
  fetchRequirementDefinition,
} from "@/lib/deliveryRequirementReads";
import {
  useRequirementCommand,
  type RequirementOriginal,
} from "@/lib/deliveryRequirementCommand";
import { useCollaborationRoute } from "@/lib/deliveryCollaboration";
import {
  fetchRequirementAdoption,
  hasRequirementAdoption,
} from "@/lib/deliveryRequirementAdoption";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { DiscussionSourceCard } from "./DeliveryDiscussionCommon";
import { RequirementChangeForm } from "./DeliveryRequirementChangeEditor";

export function RequirementOriginalSummary({
  original,
}: {
  original?: RequirementOriginal;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  if (!original)
    return <Alert type="warning" title={tr("retainedOriginalInvalid")} />;
  const labels: Record<string, string> = {
    title: "titleField",
    description: "description",
    acceptance_criteria: "criteria",
    priority: "priority",
    owner_id: "owner",
    due_on: "due",
    milestone_id: "milestone",
    blocked_reason: "blockedReason",
  };
  return (
    <section className="delivery-requirement-original">
      <p>
        {tr("targetRequirement")} · {String(original.payload.id)} ·{" "}
        {tr("submittedVersion")} {original.intent.version}
      </p>
      <h4>{tr("proposedChanges")}</h4>
      <dl className="delivery-record-fields">
        {Object.entries(original.payload)
          .filter(([key]) => key in labels)
          .map(([key, value]) => (
            <div key={key}>
              <dt>{t(`delivery.${labels[key]}`)}</dt>
              <dd>
                {Array.isArray(value) ? (
                  <ol>
                    {value.map((item, index) => (
                      <li key={index}>{String(item)}</li>
                    ))}
                  </ol>
                ) : value === null || value === "" ? (
                  tr("none")
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          ))}
      </dl>
      {original.source_reference && <p>{tr("retainedDiscussionSource")}</p>}
      <details>
        <summary>{tr("technicalTrace")}</summary>
        <pre className="delivery-collaboration-original">
          {JSON.stringify(original, null, 2)}
        </pre>
      </details>
    </section>
  );
}
export function DeliveryRequirementChangeHost({
  projectId,
  requirementId,
  sessionId,
  onClose,
  onSaved,
  onUnresolvedChange,
}: {
  projectId: string;
  requirementId: string;
  sessionId: string;
  onClose: () => void;
  onSaved: (ack: DeliveryCommandAck) => void;
  onUnresolvedChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const command = useRequirementCommand(
    projectId,
    requirementId,
    onUnresolvedChange,
  );
  const recovering = command.unresolved;
  const { route } = useCollaborationRoute(() => {});
  const [reviewed, setReviewed] = useState("");
  const needsSource = hasRequirementAdoption(route);
  const sourceKey = JSON.stringify([
    route.sourceThread,
    route.sourceMessage,
    route.sourceThreadVersion,
    route.sourceMessageRevision,
    route.sourceResolution,
    route.sourceField,
  ]);
  const source = useQuery({
    queryKey: [
      "delivery-requirement-edit-source",
      projectId,
      sessionId,
      requirementId,
      sourceKey,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementAdoption(projectId, requirementId, route, signal),
    enabled: !recovering && needsSource,
    retry: false,
    gcTime: 0,
  });
  const context = useQuery({
    queryKey: [
      "delivery-requirement-edit-context",
      projectId,
      sessionId,
      requirementId,
    ],
    queryFn: ({ signal }) => fetchDeliveryContext(projectId, signal),
    enabled: !recovering,
    retry: false,
    gcTime: 0,
  });
  const head = useQuery({
    queryKey: [
      "delivery-requirement-edit-head",
      projectId,
      sessionId,
      requirementId,
      context.data?.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementDetail(
        projectId,
        requirementId,
        signal,
        context.data?.query_generation,
      ),
    enabled:
      !recovering &&
      context.data?.query_state.status === "ready" &&
      !context.isError,
    retry: false,
    gcTime: 0,
  });
  const definition = useQuery({
    queryKey: [
      "delivery-requirement-edit-definition",
      projectId,
      sessionId,
      requirementId,
      head.data?.requirement.basis,
      head.data?.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementDefinition(
        projectId,
        requirementId,
        head.data!.query_generation,
        signal,
      ),
    enabled: !recovering && !!head.data && !head.isError,
    retry: false,
    gcTime: 0,
  });
  if (recovering)
    return (
      <Modal
        open
        maskClosable={false}
        keyboard={false}
        closable={false}
        title={tr("editRequirement")}
        footer={
          <Button
            data-action="retry-change"
            loading={command.state.phase === "sending"}
            disabled={
              !command.state.original || command.state.phase === "sending"
            }
            onClick={async () => {
              const ack = await command.replay();
              if (ack) {
                command.reset();
                onUnresolvedChange(false);
                onSaved(ack);
                onClose();
              }
            }}
          >
            {tr("retryOriginal")}
          </Button>
        }
      >
        <Alert
          type="warning"
          title={tr("unknownWrite")}
          description={tr("unknownWriteHint")}
        />
        {command.state.error && (
          <Alert
            type="error"
            title={tr(
              command.state.error.startsWith("retainedOriginal")
                ? command.state.error
                : "readFailed",
            )}
          />
        )}
        <RequirementOriginalSummary original={command.state.original} />
      </Modal>
    );
  if (needsSource && (reviewed !== sourceKey || !source.data || source.isError))
    return (
      <Modal
        open
        title={tr("sourceReview")}
        onCancel={onClose}
        footer={
          <>
            <Button onClick={onClose}>{t("delivery.cancel")}</Button>
            <Button
              data-action="retry-edit-source"
              onClick={() => void source.refetch()}
            >
              {tr("refresh")}
            </Button>
            <Button
              data-action="review-edit-source"
              disabled={!source.data || source.isError}
              onClick={() => setReviewed(sourceKey)}
            >
              {tr("reviewSource")}
            </Button>
          </>
        }
      >
        {source.isPending ? (
          <Skeleton active />
        ) : source.data && !source.isError ? (
          <DiscussionSourceCard adoption={source.data} />
        ) : (
          <Alert type="warning" title={tr("sourceReviewRequired")} />
        )}
        <p>{tr("sourceReviewHint")}</p>
      </Modal>
    );
  let requirement;
  if (
    context.data?.project_id === projectId &&
    context.data.query_state.status === "ready" &&
    !context.isError &&
    !head.isError &&
    !definition.isError &&
    head.data &&
    definition.data
  )
    try {
      requirement = combineRequirementDefinition(head.data, definition.data);
    } catch {
      /* A mismatched definition remains unavailable until explicit refresh. */
    }
  if (requirement && context.data && head.data)
    return (
      <RequirementChangeForm
        key={`${projectId}:${sessionId}:${requirementId}`}
        workspace={context.data}
        requirement={requirement}
        requirementVersion={head.data.version}
        sessionId={sessionId}
        onSaved={onSaved}
        onClose={onClose}
        onUnresolvedChange={onUnresolvedChange}
        command={command}
        initialSource={needsSource ? source.data : undefined}
      />
    );
  return (
    <Modal
      open
      title={tr("editRequirement")}
      onCancel={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("delivery.cancel")}</Button>
          <Button
            data-action="retry-edit-reads"
            onClick={() => {
              void context.refetch();
              void head.refetch();
              if (head.data) void definition.refetch();
            }}
          >
            {tr("refresh")}
          </Button>
        </>
      }
    >
      {context.isPending || head.isPending || definition.isPending ? (
        <Skeleton active />
      ) : null}
      <Alert type="info" title={tr("definitionUnavailable")} />
    </Modal>
  );
}
