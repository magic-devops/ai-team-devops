import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";
import { designCopy, designReason } from "@/i18n/design-library";
import { executionRuntimeProblem } from "@/lib/executionRuntime";
import type { useDesignCommand } from "@/lib/designCommand";

export function DesignOperationRecovery({ command, busy, error = "", onReplay, onFinish }: { command: ReturnType<typeof useDesignCommand>; busy: boolean; error?: string; onReplay: () => void; onFinish: () => void }) {
  const { i18n } = useTranslation(), copy = designCopy(i18n?.language), state = command.state;
  const problem = executionRuntimeProblem(error || state.error), message = problem.message === "designInvalid" || state.error === "ackMismatch" || state.error === "retainedOriginalInvalid" ? copy.invalid : problem.message === "designScopeChanged" ? copy.scope : state.error === "retainedOriginalUnavailable" ? copy.storage : designReason(i18n?.language, problem);
  return <>
    {message && <Alert role="alert" type="warning" title={copy.failed} description={<>{message}{problem.code && <details className="runtime-help"><summary>{copy.details}</summary><code>{problem.code}</code></details>}</>} />}
    {state.phase === "unknown" && <Alert role="status" type="warning" title={copy.unknown} description={copy.recovery} action={state.original && <Button size="small" data-action="recover-design" disabled={busy} onClick={onReplay}>{copy.replay}</Button>} />}
    {state.phase === "succeeded" && <Alert role="status" type="info" title={copy.confirmed} action={<Button size="small" data-action="finish-design" disabled={busy} onClick={onFinish}>{copy.finish}</Button>} />}
    {state.original && command.locked && <details className="runtime-help"><summary>{copy.details}</summary><p>{state.original.action}</p><p>{copy.version}: {state.original.intent.version}</p><pre className="runtime-output whitespace-pre-wrap">{JSON.stringify(state.original.payload, null, 2)}</pre></details>}
  </>;
}
