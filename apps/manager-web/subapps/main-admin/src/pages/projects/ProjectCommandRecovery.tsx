import { Alert } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjectEditorCommand, type ProjectEditorAction } from "@/lib/projectEditorCommand";
import { ProjectCommandFeedback } from "./ProjectCommandFeedback";

/** Recovery stays available even when a fresh project-detail read is denied. */
export function ProjectCommandRecovery({ projectId, action, onPending, onSaved, onResolved, onWarning }: {
  projectId: string; action: ProjectEditorAction; onPending: (pending: boolean) => void;
  onSaved: () => void; onResolved: () => void; onWarning?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const command = useProjectEditorCommand(projectId, action, onPending);
  const [error, setError] = useState("");
  const complete = (ack: unknown) => {
    if (!ack || !command.current()) return;
    command.reset();
    if (command.snapshot().phase !== "idle") { setError(t("projectPortfolio.confirmedStorageUnavailable")); return; }
    try { onSaved(); }
    catch {
      const message = t("projectPortfolio.refreshAfterSaveFailed");
      setError(message); onWarning?.(message);
    } finally { onResolved(); }
  };
  const retry = async () => complete(await command.replay());
  return <section className="space-y-3" aria-label={t("projectPortfolio.recovery")}>
    <p className="project-portfolio-id">{projectId}</p>
    <ProjectCommandFeedback command={command} onRetry={retry} onConfirmed={() => complete(command.snapshot().ack)} />
    {error && <Alert type="info" title={t("projectPortfolio.saved")} description={error} />}
  </section>;
}
