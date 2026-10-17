import { Alert, Drawer } from "antd";
import { useTranslation } from "react-i18next";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import type { DeliveryAction, DeliveryWorkspace } from "@/lib/delivery";
import { ExecutionObservationCard } from "./ExecutionObservationCard";
export function DeliveryExecutionInspector({ executionId, sessionId, workspace, onClose, onCommand }: { executionId: string; sessionId: string; workspace: DeliveryWorkspace; onClose: () => void; onCommand: (action: DeliveryAction, payload: Record<string, unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const identity = useDrawerIdentity(`${workspace.project.id}:${sessionId}`, executionId);
  const entry = workspace.executions?.find((item) => item.id === identity.displayId);
  return <Drawer open={Boolean(executionId)} title={t("deliveryRuntime.title")} width={680} className="delivery-inspector" onClose={onClose} afterOpenChange={identity.afterOpenChange} destroyOnHidden>
    {identity.displayId && (entry ? <ExecutionObservationCard key={`${workspace.project.id}:${sessionId}:${entry.id}`} entry={entry} projectId={workspace.project.id} active onCommand={onCommand} /> : <Alert type="warning" title={t("projectPortfolio.executionUnavailable")} description={identity.displayId} />)}
  </Drawer>;
}
