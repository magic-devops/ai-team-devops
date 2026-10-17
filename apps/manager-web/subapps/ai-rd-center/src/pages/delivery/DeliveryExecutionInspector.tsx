import { Alert, Drawer, Skeleton } from "antd";
import { useQuery } from "@tanstack/react-query";
import { fetchExecutionDetail } from "@/lib/deliveryQuery";
import { DeliveryQueryError } from "./DeliveryQueryViews";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import type {
  DeliveryAction,
  DeliveryContext,
  DeliveryCommandAck,
} from "@/lib/delivery";
import { ExecutionObservationCard } from "./ExecutionObservationCard";
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
}) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState(false);
  const identity = useDrawerIdentity(
    `${workspace.project.id}:${sessionId}`,
    executionId,
  );
  const query = useQuery({
    queryKey: [
      "delivery-execution-exact",
      workspace.project.id,
      sessionId,
      identity.displayId,
    ],
    queryFn: ({ signal }) =>
      fetchExecutionDetail(workspace.project.id, identity.displayId, signal),
    enabled: Boolean(identity.displayId) && !locked,
    retry: false,
    gcTime: 0,
  });
  const entry = query.data?.execution;
  return (
    <Drawer
      open={Boolean(executionId)}
      title={t("deliveryRuntime.title")}
      width="min(760px, 100vw)"
      className="delivery-inspector"
      closable={!locked}
      maskClosable={!locked}
      keyboard={!locked}
      onClose={() => {
        if (!locked) onClose();
      }}
      afterOpenChange={identity.afterOpenChange}
      destroyOnHidden
    >
      {identity.displayId &&
        (query.isPending ? (
          <Skeleton active />
        ) : query.error ? (
          <DeliveryQueryError
            error={query.error}
            onRetry={() => void query.refetch()}
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
            active
            onCommand={onCommand}
            onUnresolvedChange={(value) => {
              setLocked(value);
              onUnresolvedChange?.(value);
            }}
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
