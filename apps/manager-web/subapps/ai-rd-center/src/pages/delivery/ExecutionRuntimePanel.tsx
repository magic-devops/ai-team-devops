import { Alert, Button, Skeleton, Space, Tag } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import {
  assertExecutionSession,
  executionRuntimeProblem,
  fetchExecutionRuntime,
  type ExecutionRuntime,
} from "@/lib/executionRuntime";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { ExecutionNodeOutput } from "./ExecutionNodeOutput";
import { ExecutionRuntimeControl } from "./ExecutionRuntimeControl";
import type { ExecutionControlOperationsRead } from "@/lib/executionControlOperations";
type Props = {
  projectId: string;
  executionId: string;
  workspaceId: string;
  sessionId: string;
  active: boolean;
  paused: boolean;
  disabled: boolean;
  isActive?: () => boolean;
  canSubmit?: () => boolean;
  controlRead?: ExecutionControlOperationsRead;
  onSaved: (data: DeliveryCommandAck) => void;
  onUnresolvedChange: (value: boolean) => void;
  initialNodeId?: string;
  initialAttempt?: number;
  initialStream?: string;
};
export function ExecutionRuntimePanel({
  projectId,
  executionId,
  workspaceId,
  sessionId,
  active,
  paused,
  disabled,
  isActive,
  canSubmit,
  controlRead,
  onSaved,
  onUnresolvedChange,
  initialNodeId,
  initialAttempt,
  initialStream,
}: Props) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryExecutionRuntime.${key}`);
  const [runtime, setRuntime] = useState<ExecutionRuntime>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [locked, setLocked] = useState(false);
  const origin = useRef(projectSessionKey());
  const mounted = useRef(true),
    pending = useRef(false),
    abort = useRef<AbortController>();
  const read = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setReading(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      assertExecutionSession(origin.current);
      const value = await fetchExecutionRuntime(
        projectId,
        executionId,
        controller.signal,
      );
      assertExecutionSession(origin.current);
      if (mounted.current && !controller.signal.aborted) {
        setRuntime(value);
        setError("");
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) {
        const info = executionRuntimeProblem(failure);
        setError(info.message);
        setRuntime(undefined);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setReading(false);
    }
  }, [projectId, executionId]);
  useEffect(() => {
    mounted.current = true;
    void read();
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, [read]);
  useEffect(() => {
    if (!active || paused || locked) return;
    const timer = setInterval(() => void read(), 3000);
    return () => clearInterval(timer);
  }, [active, paused, locked, read]);
  const unresolved = (value: boolean) => {
    setLocked(value);
    onUnresolvedChange(value);
  };
  const stop = runtime?.stop;
  return (
    <div className="execution-runtime-panel">
      {!runtime && !error && (
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      )}
      {error && (
        <Alert
          type="warning"
          role="alert"
          title={tr("runtimeReadFailed")}
          description={error}
          action={
            <Button size="small" loading={reading} onClick={read}>
              {tr("refreshOutput")}
            </Button>
          }
        />
      )}
      <ExecutionRuntimeControl
        key={`${projectId}:${sessionId}:${executionId}`}
        projectId={projectId}
        executionId={executionId}
        workspaceId={workspaceId}
        isActive={isActive}
        canSubmit={canSubmit}
        sessionId={sessionId}
        runtime={error ? undefined : runtime}
        controlRead={controlRead}
        disabled={disabled}
        onSaved={onSaved}
        onObserved={setRuntime}
        onUnresolvedChange={unresolved}
      />
      {runtime && !error && (
        <>
          <div className="execution-runtime-facts">
            <Space wrap>
              <Tag>
                {tr("runState")}:{" "}
                {t(`delivery.execution.states.${runtime.status}`, {
                  defaultValue: runtime.status,
                })}
              </Tag>
              <Tag>
                {tr("attempt")} {runtime.attempt}
              </Tag>
              {runtime.active_node_id && (
                <Tag color="processing">
                  {tr("activeStep")}:{" "}
                  {runtime.nodes.find(
                    (node) => node.id === runtime.active_node_id,
                  )?.title || runtime.active_node_id}
                </Tag>
              )}
            </Space>
          </div>
          {runtime.recovery_requires_review && (
            <Alert type="warning" title={tr("recoveryReview")} />
          )}
          {stop && (
            <Alert
              type={
                stop.state === "confirmed" || stop.state === "not_started"
                  ? "info"
                  : "warning"
              }
              title={tr(`stop.${stop.state}`)}
              description={
                <div>
                  <p>{tr("stopConsequence")}</p>
                  <p>{stop.reason}</p>
                  {stop.evidence && <p>{stop.evidence}</p>}
                  <small>
                    {stop.id} · {tr("attempt")} {stop.attempt} ·{" "}
                    {stop.confirmed_at || stop.requested_at || "—"}
                  </small>
                </div>
              }
            />
          )}
          <ExecutionNodeOutput
            key={`${projectId}:${sessionId}:${executionId}`}
            projectId={projectId}
            executionId={executionId}
            sessionId={sessionId}
            runtime={runtime}
            active={active && !paused}
            initialNodeId={initialNodeId}
            initialAttempt={initialAttempt}
            initialStream={initialStream}
          />
        </>
      )}
    </div>
  );
}
