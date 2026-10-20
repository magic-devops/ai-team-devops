import { Alert, Drawer, Skeleton } from "antd";
import { useQuery } from "@tanstack/react-query";
import { fetchExecutionDetail } from "@/lib/deliveryQuery";
import { DeliveryQueryError } from "./DeliveryQueryViews";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import type {
  DeliveryAction,
  DeliveryContext,
  DeliveryCommandAck,
} from "@/lib/delivery";
import { ExecutionObservationCard } from "./ExecutionObservationCard";
import { ExecutionOperationRecovery, executionOperationPending } from "./ExecutionOperationRecovery";
export function DeliveryExecutionInspector({
  executionId,
  sessionId,
  workspace,
  onClose,
  onCommand,
  onSaved,
  onUnresolvedChange,
  nodeId,
  attempt,
  stream,
  isActive,
}: {
  executionId: string;
  sessionId: string;
  workspace: DeliveryContext;
  onClose: () => void;
  onCommand: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onSaved: (data: DeliveryCommandAck) => void;
  onUnresolvedChange?: (value: boolean) => void;
  nodeId?: string;
  attempt?: number;
  stream?: string;
  isActive?: () => boolean;
}) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState(false);
  const pending = useRef(false), requested = useRef(executionId);
  const parentActive = useRef(isActive); parentActive.current = isActive;
  requested.current = executionId;
  const [recoveryId, setRecoveryId] = useState(() => executionOperationPending(workspace.project.id, executionId) ? executionId : "");
  const unresolved = (value: boolean) => {
    if (parentActive.current?.() === false) return;
    const retained = executionOperationPending(workspace.project.id, identity.displayId);
    pending.current = value || retained;
    setLocked(value || retained);
    if (!value && !retained) setRecoveryId("");
    onUnresolvedChange?.(value || retained);
  };
  const identity = useDrawerIdentity(
    `${workspace.project.id}:${sessionId}`,
    executionId,
  );
  const current = () => parentActive.current?.() !== false && Boolean(requested.current) && requested.current === identity.displayId;
  useEffect(() => {
    setRecoveryId(executionOperationPending(workspace.project.id, identity.displayId) ? identity.displayId : "");
  }, [workspace.project.id, sessionId, identity.displayId]);
  const query = useQuery({
    queryKey: [
      "delivery-execution-exact",
      workspace.project.id,
      sessionId,
      identity.displayId,
    ],
    queryFn: ({ signal }) =>
      fetchExecutionDetail(workspace.project.id, identity.displayId, signal),
    enabled: Boolean(identity.displayId) && !locked && parentActive.current?.() !== false,
    retry: false,
    gcTime: 0,
  });
  const entry = query.data?.execution;
  const failedReadRecoveryId = query.error && executionOperationPending(workspace.project.id, identity.displayId) ? identity.displayId : "";
  const displayedRecoveryId = recoveryId || failedReadRecoveryId;
  useEffect(() => { if (failedReadRecoveryId && !recoveryId) setRecoveryId(failedReadRecoveryId); }, [failedReadRecoveryId, recoveryId]);
  return (
    <Drawer
      open={Boolean(executionId)}
      title={t("deliveryRuntime.title")}
      width="min(760px, 100vw)"
      className="delivery-inspector"
      closable={!locked && !executionOperationPending(workspace.project.id, identity.displayId)}
      maskClosable={!locked && !executionOperationPending(workspace.project.id, identity.displayId)}
      keyboard={!locked && !executionOperationPending(workspace.project.id, identity.displayId)}
      onClose={() => {
        if (current() && !pending.current && requested.current === executionId && !executionOperationPending(workspace.project.id, identity.displayId)) onClose();
      }}
      afterOpenChange={identity.afterOpenChange}
      destroyOnHidden
    >
      {identity.displayId && displayedRecoveryId === identity.displayId && (
        <ExecutionOperationRecovery
          key={`${workspace.project.id}:${sessionId}:${identity.displayId}`}
          projectId={workspace.project.id}
          executionId={identity.displayId}
          sessionId={sessionId}
          isActive={current}
          onSaved={onSaved}
          onUnresolvedChange={unresolved}
        />
      )}
      {identity.displayId && displayedRecoveryId !== identity.displayId &&
        (query.isPending ? (
          <Skeleton active />
        ) : query.error ? (
          <DeliveryQueryError
            error={query.error}
            onRetry={() => { if (current()) void query.refetch(); }}
          />
        ) : entry ? (
          <ExecutionObservationCard
            key={`${workspace.project.id}:${sessionId}:${entry.id}`}
            entry={entry}
            projectId={workspace.project.id}
            sessionId={sessionId}
            workspaceVersion={workspace.version}
            onSaved={onSaved}
            initialNodeId={nodeId}
            initialAttempt={attempt}
            initialStream={stream}
            active={Boolean(executionId) && executionId === identity.displayId}
            disabled={!executionId || executionId !== identity.displayId}
            isActive={current}
            onCommand={onCommand}
            onUnresolvedChange={unresolved}
          />
        ) : (
          <Alert
            type="warning"
            title={t("projectPortfolio.executionUnavailable")}
            description={identity.displayId}
          />
        ))}
    </Drawer>
  );
}
