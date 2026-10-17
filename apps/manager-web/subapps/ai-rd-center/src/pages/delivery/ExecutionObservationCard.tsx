import {
  Alert,
  Button,
  Collapse,
  Input,
  Progress,
  Space,
  Tag,
  Timeline,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExecutionExecutorFacts } from "./ExecutionExecutorFacts";
import type {
  DeliveryAction,
  DeliveryExecution,
  DeliveryCommandAck,
} from "@/lib/delivery";
import {
  fetchExecutionObservations,
  mergeExecutionEvents,
  type ExecutionEvent,
  type ExecutionObservations,
} from "@/lib/deliveryExecution";
import { executionIssueHref } from "@/lib/executionCommands";
import { ExecutionTargetFacts } from "./ExecutionTargetFacts";
import { ExecutionAcceptanceSnapshot } from "./ExecutionAcceptanceSnapshot";
import { ExecutionRuntimePanel } from "./ExecutionRuntimePanel";

export function ExecutionStageFacts({
  observation,
  status,
}: {
  observation: ExecutionObservations;
  status: string;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const work = observation.nodes.filter((node) => !node.is_test);
  const workState = work.some((node) => node.status === "failed")
    ? "failed"
    : work.length && work.every((node) => node.status === "passed")
      ? "passed"
      : work.some((node) => node.status === "running")
        ? "running"
        : "notStarted";
  const testState =
    observation.tests.status === "not_configured"
      ? "notConfiguredTest"
      : observation.tests.status;
  const reviewState =
    status === "accepted" && !observation.stale
      ? "accepted"
      : status === "changes_requested"
        ? "failed"
        : "awaiting";
  return (
    <div className="runtime-stages" aria-label={tr("title")}>
      <div>
        <small>01 · {tr("implementation")}</small>
        <strong data-state={workState}>{tr(workState)}</strong>
      </div>
      <div>
        <small>02 · {tr("testing")}</small>
        <strong data-state={testState}>{tr(testState)}</strong>
        {observation.tests.total > 0 && (
          <span>
            {t("deliveryRuntime.testRatio", {
              passed: observation.tests.passed,
              total: observation.tests.total,
            })}
          </span>
        )}
      </div>
      <div>
        <small>03 · {tr("review")}</small>
        <strong data-state={reviewState}>{tr(reviewState)}</strong>
      </div>
    </div>
  );
}

export function ExecutionObservationCard({
  entry,
  projectId,
  active,
  onCommand,
  sessionId,
  onSaved,
  onUnresolvedChange,
  initialNodeId,
  initialAttempt,
  initialStream,
  disabled = false,
}: {
  entry: DeliveryExecution;
  projectId: string;
  active: boolean;
  sessionId: string;
  workspaceVersion: number;
  onSaved: (data: DeliveryCommandAck) => void;
  onUnresolvedChange?: (value: boolean) => void;
  initialNodeId?: string;
  initialAttempt?: number;
  initialStream?: string;
  disabled?: boolean;
  onCommand: (
    action: DeliveryAction,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const [observation, setObservation] = useState<ExecutionObservations>();
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [comment, setComment] = useState("");
  const [controlLocked, setControlLocked] = useState(false);
  const cursor = useRef<string>();
  const controller = useRef<AbortController>();
  const readingRef = useRef(false);
  const mounted = useRef(true);
  const observe = useCallback(async () => {
    if (readingRef.current) return;
    readingRef.current = true;
    setReading(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await fetchExecutionObservations(
        projectId,
        entry.id,
        cursor.current,
        abort.signal,
      );
      if (!mounted.current || abort.signal.aborted) return;
      if (result.project_id !== projectId || result.execution_id !== entry.id)
        throw new Error(tr("noScope"));
      setObservation(result);
      setReadError("");
      setEvents((current) => mergeExecutionEvents(current, result.events));
      cursor.current = result.next_cursor || undefined;
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted)
        setReadError((failure as Error).message);
    } finally {
      readingRef.current = false;
      if (mounted.current) setReading(false);
    }
  }, [projectId, entry.id]);
  useEffect(() => {
    mounted.current = true;
    void observe();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [observe]);
  const terminal = ["accepted", "changes_requested", "cancelled"].includes(
    observation?.status || entry.status,
  );
  useEffect(() => {
    if (paused || (!observation?.more && (!active || terminal))) return;
    const timer = setInterval(
      () => void observe(),
      observation?.more ? 300 : 3000,
    );
    return () => clearInterval(timer);
  }, [active, paused, terminal, observe, observation?.more]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError("");
    try {
      await action();
      await observe();
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const status = observation?.status || entry.status;
  const stale = Boolean(entry.stale || observation?.stale);
  const runId = observation?.run_id || entry.run_id;
  const pendingBindingInvalidated =
    !runId &&
    Boolean(
      observation
        ? observation.executor_binding_invalidated
        : entry.executor_binding_invalidated,
    );
  const permissions = observation?.permissions;
  const completed =
    observation?.nodes.filter((node) =>
      ["passed", "failed", "skipped"].includes(node.status),
    ).length || 0;
  const percent = observation?.nodes.length
    ? Math.round((completed / observation.nodes.length) * 100)
    : 0;
  const review = (decision: string) =>
    act(() =>
      onCommand("execution.review", {
        id: entry.id,
        decision,
        comment: comment.trim(),
        run_version: observation?.run_version,
      }),
    );
  return (
    <article
      className={`runtime-execution-card is-${stale ? "stale" : status}`}
    >
      <div className="runtime-section-heading">
        <Tag
          color={
            status === "accepted" && !stale
              ? "success"
              : status === "failed"
                ? "error"
                : "default"
          }
        >
          {t(`delivery.execution.states.${status}`, { defaultValue: status })}
        </Tag>
        <small>
          {!Array.isArray(entry.snapshot.task_acceptance_criteria)
            ? t("deliveryTaskAcceptance.unrecordedCriteria")
            : entry.snapshot.requirement
              ? t("deliveryTaskAcceptance.requirementSnapshot", {
                  revision: entry.snapshot.requirement.revision,
                })
              : t("deliveryTaskAcceptance.ownSnapshot")}
        </small>
      </div>
      <code className="runtime-identity">
        {runId || entry.id} · {tr("attempt")}{" "}
        {observation?.attempt ?? entry.attempt ?? "—"}
      </code>
      {stale && <Alert type="warning" title={tr("stale")} />}
      {pendingBindingInvalidated && (
        <Alert
          type="warning"
          title={t("deliveryTeamRuntime.pendingInvalidated")}
        />
      )}
      <ExecutionExecutorFacts snapshot={entry.executor_snapshot} />
      {readError && (
        <Alert
          type="warning"
          role="alert"
          title={tr("disconnected")}
          description={readError}
          action={
            <Button
              size="small"
              loading={reading}
              onClick={() => void observe()}
            >
              {tr("refresh")}
            </Button>
          }
        />
      )}
      {actionError && <Alert type="error" role="alert" title={actionError} />}
      {observation && (
        <>
          <ExecutionStageFacts
            observation={{ ...observation, stale }}
            status={status}
          />
          <label className="runtime-node-progress">
            {tr("nodeCompletion")} · {completed}/{observation.nodes.length}
            <Progress
              percent={percent}
              size="small"
              status={status === "failed" ? "exception" : "normal"}
            />
          </label>
        </>
      )}
      <p className="runtime-help">
        {tr("observed")} ·{" "}
        {observation?.observed_at || entry.observed_at
          ? new Date(
              observation?.observed_at || entry.observed_at!,
            ).toLocaleString()
          : tr("noContact")}
        {paused && ` · ${tr("paused")}`}
      </p>
      {stale && permissions?.can_cancel && (
        <p className="runtime-help">
          {t("deliveryTaskAcceptance.cancelHistorical")}
        </p>
      )}
      <Space wrap className="runtime-actions">
        <Button
          size="small"
          disabled={reading || busy || controlLocked}
          onClick={() => void observe()}
        >
          {tr("refresh")}
        </Button>
        {active && !terminal && (
          <Button size="small" onClick={() => setPaused((value) => !value)}>
            {tr(paused ? "resume" : "pause")}
          </Button>
        )}
        {permissions?.can_sync && (
          <Button
            size="small"
            disabled={busy || controlLocked || disabled || Boolean(readError)}
            loading={busy}
            onClick={() =>
              void act(() => onCommand("execution.sync", { id: entry.id }))
            }
          >
            {tr("sync")}
          </Button>
        )}
        {entry.issue_id && (
          <Button
            size="small"
            href={executionIssueHref(entry.issue_id, location.hash, projectId)}
          >
            {tr("openIssue")} · {entry.issue_id}
          </Button>
        )}
      </Space>
      <ExecutionRuntimePanel
        projectId={projectId}
        executionId={entry.id}
        sessionId={sessionId}
        active={active}
        paused={paused}
        disabled={disabled || busy || Boolean(readError)}
        onSaved={onSaved}
        initialNodeId={initialNodeId}
        initialAttempt={initialAttempt}
        initialStream={initialStream}
        onUnresolvedChange={(value) => {
          setControlLocked(value);
          onUnresolvedChange?.(value);
        }}
      />
      <Collapse
        size="small"
        ghost
        items={[
          {
            key: "events",
            label: `${tr("events")} · ${events.length}`,
            children: (
              <>
                <p className="runtime-help">{tr("eventLimit")}</p>
                {events.length ? (
                  <Timeline
                    items={events.map((event) => ({
                      key: event.id,
                      color: event.status === "failed" ? "red" : "blue",
                      content: (
                        <div className="runtime-event">
                          <time>{new Date(event.at).toLocaleString()}</time>
                          <strong>
                            {event.node_id || event.type}
                            {event.attempt !== null &&
                              ` · ${tr("attempt")} ${event.attempt}`}
                          </strong>
                          <span>
                            {event.message || event.status || event.type}
                          </span>
                          {event.result && (
                            <details>
                              <summary>{tr("output")}</summary>
                              <pre className="runtime-output">
                                {[
                                  event.result.error,
                                  event.result.stdout,
                                  event.result.stderr,
                                  event.result.agent?.message,
                                  event.result.agent?.error,
                                ]
                                  .filter(Boolean)
                                  .join("\n") || "—"}
                              </pre>
                            </details>
                          )}
                        </div>
                      ),
                    }))}
                  />
                ) : (
                  <p>{tr("noEvents")}</p>
                )}
              </>
            ),
          },
          {
            key: "nodes",
            label: t("deliveryExecutionRuntime.resultFacts"),
            children: (
              <>
                <p className="runtime-help">
                  {t("deliveryExecutionRuntime.resultFactsHint")}
                </p>
                {observation?.nodes.map((node) => (
                  <section className="runtime-node-evidence" key={node.id}>
                    <div className="runtime-section-heading">
                      <strong>{node.title || node.id}</strong>
                      <span>
                        {node.is_test && (
                          <Tag color="blue">{tr("testing")}</Tag>
                        )}
                        <Tag
                          color={
                            node.status === "failed"
                              ? "error"
                              : node.status === "passed"
                                ? "success"
                                : "default"
                          }
                        >
                          {tr(node.status)}
                        </Tag>
                      </span>
                    </div>
                    {node.result && (
                      <>
                        {node.result.attempt !== null &&
                          node.result.attempt !== observation.attempt && (
                            <Tag color="warning">
                              {t("deliveryRuntime.previousAttempt", {
                                attempt: node.result.attempt,
                                current: observation.attempt,
                              })}
                            </Tag>
                          )}
                        <p className="runtime-help">
                          {tr("expectedExit")}:{" "}
                          {node.result.expected_exit_code ?? "—"} ·{" "}
                          {t("delivery.execution.exit")}:{" "}
                          {node.result.exit_code ?? "—"} · {tr("attempt")}:{" "}
                          {node.result.attempt ?? "—"} · {tr("duration")}:{" "}
                          {node.result.duration_ms === null
                            ? "—"
                            : `${node.result.duration_ms} ms`}
                        </p>
                        {node.result.agent && (
                          <p className="runtime-help">
                            {node.result.agent.provider} ·{" "}
                            {node.result.agent.agent_id} · v
                            {node.result.agent.profile_version ?? "—"} ·{" "}
                            {node.result.agent.usage
                              ? `${tr("usage")}: ${JSON.stringify(node.result.agent.usage)}`
                              : tr("unknownUsage")}
                          </p>
                        )}
                        {(node.result.stdout_truncated ||
                          node.result.stderr_truncated ||
                          node.result.agent?.usage_truncated) && (
                          <Tag color="warning">{tr("truncated")}</Tag>
                        )}
                        {node.result.agent && (
                          <pre
                            className="runtime-output"
                            tabIndex={0}
                            aria-label={`${t("deliveryExecutionRuntime.agentResult")} ${node.id}`}
                          >
                            {[
                              node.result.agent?.message,
                              node.result.agent?.error,
                            ]
                              .filter(Boolean)
                              .join("\n") || "—"}
                          </pre>
                        )}
                        {node.result.error && (
                          <p className="runtime-help">{node.result.error}</p>
                        )}
                      </>
                    )}
                  </section>
                ))}
              </>
            ),
          },
          {
            key: "snapshot",
            label: tr("snapshot"),
            children: (
              <>
                <strong>{entry.snapshot.title}</strong>
                <ExecutionAcceptanceSnapshot snapshot={entry.snapshot} />
                {entry.agent_snapshot && (
                  <p>
                    {entry.agent_snapshot.title} ·{" "}
                    {entry.agent_snapshot.provider} · v
                    {entry.agent_snapshot.version}
                  </p>
                )}
                {entry.target_snapshot && (
                  <ExecutionTargetFacts target={entry.target_snapshot} />
                )}
                {entry.plan_nodes?.map((node) => (
                  <div key={node.id} className="runtime-node-evidence">
                    <strong>{node.title || node.id}</strong>
                    {entry.test_node_ids.includes(node.id) && (
                      <Tag color="blue">{tr("testing")}</Tag>
                    )}
                    <pre className="runtime-output">
                      {JSON.stringify(
                        node.kind === "agent"
                          ? { kind: node.kind, agent_id: node.agent_id }
                          : {
                              argv: node.argv,
                              expected_exit_code: node.expected_exit_code,
                              timeout_seconds: node.timeout_seconds,
                            },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                ))}
              </>
            ),
          },
        ]}
      />
      {permissions?.can_review && (
        <div className="runtime-review">
          <p className="runtime-help">{tr("reviewHint")}</p>
          <label htmlFor={`runtime-review-${entry.id}`}>{tr("comment")}</label>
          <Input.TextArea
            id={`runtime-review-${entry.id}`}
            rows={3}
            maxLength={4000}
            value={comment}
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
          />
          <Space wrap>
            <Button
              type="primary"
              size="small"
              disabled={
                busy ||
                controlLocked ||
                disabled ||
                stale ||
                Boolean(readError) ||
                status !== "awaiting_review" ||
                !comment.trim() ||
                !["passed", "not_configured"].includes(
                  observation?.tests.status || "",
                )
              }
              onClick={() => void review("accept")}
            >
              {tr("accept")}
            </Button>
            <Button
              size="small"
              disabled={
                busy ||
                controlLocked ||
                disabled ||
                Boolean(readError) ||
                !comment.trim()
              }
              onClick={() => void review("request_changes")}
            >
              {tr("reject")}
            </Button>
          </Space>
        </div>
      )}
      {entry.review && (
        <blockquote>
          {entry.review.comment}
          <footer>
            {entry.review.actor} · {new Date(entry.review.at).toLocaleString()}
          </footer>
        </blockquote>
      )}
    </article>
  );
}
