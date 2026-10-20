import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";
import type { useProjectEditorCommand } from "@/lib/projectEditorCommand";

export function ProjectCommandFeedback({ command, onRetry, onConfirmed }: {
  command: ReturnType<typeof useProjectEditorCommand>;
  onRetry: () => void;
  onConfirmed?: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const { state } = command;
  const error = state.phase === "succeeded" && state.error === "retainedOriginalUnavailable" ? tr("confirmedStorageUnavailable") : state.error && ["ackMismatch", "retainedOriginalInvalid", "retainedOriginalUnavailable"].includes(state.error)
    ? tr(state.error) : state.error;
  if (state.phase === "idle" && !error) return null;
  const unknown = state.phase === "unknown";
  const sending = state.phase === "sending";
  const original = state.original;
  return <div className="space-y-3" role="status" aria-live="polite">
    <Alert showIcon type={unknown ? "warning" : state.phase === "refused" ? "error" : "info"}
      title={tr(sending ? "saving" : unknown ? "unknown" : state.phase === "succeeded" ? "saved" : "saveFailed")}
      description={<div className="space-y-2">
        {unknown && <p>{tr("unknownHint")}</p>}
        {error && <p>{error}</p>}
        {original && <>
          <p className="text-xs text-[var(--muted)]">{tr("originalOperation")} · {tr(original.action === "project.lifecycle" ? "lifecycle" : "configure")} · v{original.intent.version}</p>
          <dl className="text-sm">
            <dt className="text-[var(--muted)]">{tr(original.action === "project.lifecycle" ? "targetStatus" : "name")}</dt>
            <dd>{original.action === "project.lifecycle" ? tr(String(original.payload.target_status)) : String(original.payload.name)}</dd>
            {original.action === "project.lifecycle" && <><dt className="mt-1 text-[var(--muted)]">{tr("reason")}</dt><dd className="whitespace-pre-wrap break-words">{String(original.payload.reason)}</dd></>}
          </dl>
        </>}
      </div>}
      action={unknown ? <Button data-action="retry-original" onClick={onRetry} disabled={!original}>{tr("retryOriginal")}</Button>
        : state.phase === "succeeded" && onConfirmed ? <Button data-action="finish-confirmed" onClick={onConfirmed}>{tr("finishConfirmed")}</Button> : undefined} />
  </div>;
}
