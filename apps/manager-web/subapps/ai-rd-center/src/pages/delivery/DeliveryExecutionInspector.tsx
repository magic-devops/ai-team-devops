import { Alert, Drawer } from "antd";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import type { DeliveryAction, DeliveryWorkspace } from "@/lib/delivery";
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
  workspace: DeliveryWorkspace;
  onClose: () => void;
  onCommand: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onSaved: (data: DeliveryWorkspace) => void;
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
  const entry = workspace.executions?.find(
    (item) => item.id === identity.displayId,
  );
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
        (entry ? (
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
