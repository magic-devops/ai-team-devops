import { Alert, Button, Input, Select, Space, Switch, Tag } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  assertExecutionSession,
  executionRuntimeProblem,
  fetchExecutionNodeOutput,
  mergeExecutionOutput,
  type ExecutionNodeOutput as OutputResponse,
  type ExecutionOutputChunk,
  type ExecutionOutputStream,
  type ExecutionRuntime,
} from "@/lib/executionRuntime";
export type ExecutionNodeOutputProps = {
  projectId: string;
  executionId: string;
  sessionId: string;
  runtime: ExecutionRuntime;
  active: boolean;
  initialNodeId?: string;
  initialAttempt?: number;
  initialStream?: string;
};
export function ExecutionNodeOutput({
  projectId,
  executionId,
  sessionId,
  runtime,
  active,
  initialNodeId,
  initialAttempt,
  initialStream,
}: ExecutionNodeOutputProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryExecutionRuntime.${key}`);
  const params = new URLSearchParams(
    typeof location === "undefined" ? "" : location.hash.split("?")[1],
  );
  const route =
    params.get("execution_id") === executionId ? params : new URLSearchParams();
  const [nodeId, setNodeId] = useState(
    initialNodeId ??
      route.get("execution_node") ??
      runtime.active_node_id ??
      runtime.nodes.find((node) => node.status === "failed")?.id ??
      runtime.nodes[0]?.id ??
      "",
  );
  const rawAttempt = route.get("execution_attempt");
  const [attempt, setAttempt] = useState(
    initialAttempt ??
      (rawAttempt === null
        ? runtime.attempt
        : /^[1-9]\d*$/.test(rawAttempt) &&
            Number.isSafeInteger(Number(rawAttempt))
          ? Number(rawAttempt)
          : NaN),
  );
  const [stream, setStream] = useState(
    initialStream ?? route.get("execution_stream") ?? "stdout",
  );
  const node = runtime.nodes.find((item) => item.id === nodeId);
  const valid = Boolean(
    node &&
    Number.isSafeInteger(attempt) &&
    attempt > 0 &&
    ["stdout", "stderr"].includes(stream),
  );
  const select = (
    nextNode: string,
    nextAttempt: number,
    nextStream: string,
  ) => {
    setNodeId(nextNode);
    setAttempt(nextAttempt);
    setStream(nextStream);
    if (
      typeof location !== "undefined" &&
      (/^#\/tasks\/execution(?:\?|$)/.test(location.hash) ||
        (/^#\/dev-flow(?:\?|$)/.test(location.hash) &&
          new URLSearchParams(location.hash.split("?")[1]).get(
            "execution_id",
          ) === executionId))
    ) {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      params.set("execution_id", executionId);
      params.set("execution_node", nextNode);
      params.set("execution_attempt", String(nextAttempt));
      params.set("execution_stream", nextStream);
      location.hash = `${location.hash.split("?")[0]}?${params}`;
    }
  };
  useEffect(() => {
    if (initialNodeId !== undefined) setNodeId(initialNodeId);
    if (initialAttempt !== undefined) setAttempt(initialAttempt);
    if (initialStream !== undefined) setStream(initialStream);
  }, [initialNodeId, initialAttempt, initialStream]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      if (params.get("execution_id") !== executionId) return;
      const selectedAttempt = params.get("execution_attempt");
      setNodeId(
        params.get("execution_node") ??
          runtime.active_node_id ??
          runtime.nodes.find((node) => node.status === "failed")?.id ??
          runtime.nodes[0]?.id ??
          "",
      );
      setAttempt(
        selectedAttempt === null
          ? runtime.attempt
          : /^[1-9]\d*$/.test(selectedAttempt) &&
              Number.isSafeInteger(Number(selectedAttempt))
            ? Number(selectedAttempt)
            : NaN,
      );
      setStream(params.get("execution_stream") ?? "stdout");
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [executionId, runtime]);
  const attempts = [
    ...new Set([
      runtime.attempt,
      ...(node?.available_attempts || []),
      ...(Number.isSafeInteger(attempt) && attempt > 0 ? [attempt] : []),
    ]),
  ].sort((a, b) => b - a);
  return (
    <section className="execution-node-output" aria-label={tr("stepLogs")}>
      <div className="runtime-section-heading">
        <strong>{tr("stepLogs")}</strong>
        <Tag>{tr("loadedOnly")}</Tag>
      </div>
      <div className="execution-output-layout">
        <div
          className="execution-step-list"
          role="group"
          aria-label={tr("step")}
        >
          {runtime.nodes.map((item) => (
            <Button
              key={item.id}
              type={item.id === nodeId ? "primary" : "text"}
              block
              aria-pressed={item.id === nodeId}
              onClick={() => select(item.id, runtime.attempt, stream)}
            >
              <span>{item.title || item.id}</span>
              <small>
                {t(`deliveryRuntime.${item.status}`, {
                  defaultValue: item.status,
                })}
                {item.is_test && ` · ${t("deliveryRuntime.testing")}`}
              </small>
            </Button>
          ))}
        </div>
        <div className="execution-step-content">
          <div className="execution-output-selectors">
            <label className="execution-step-picker">
              {tr("step")}
              <Select
                aria-label={tr("step")}
                value={nodeId || undefined}
                options={runtime.nodes.map((item) => ({
                  value: item.id,
                  label: `${item.title || item.id} · ${t(`deliveryRuntime.${item.status}`, { defaultValue: item.status })}`,
                }))}
                onChange={(value) => select(value, runtime.attempt, stream)}
              />
            </label>
            <label>
              {tr("attempt")}
              <Select
                aria-label={tr("attempt")}
                value={Number.isSafeInteger(attempt) ? attempt : undefined}
                placeholder={tr("invalidSelection")}
                options={attempts.map((value) => ({
                  value,
                  label: `${tr("attempt")} ${value}${value === runtime.attempt ? ` · ${tr("currentAttempt")}` : ""}`,
                }))}
                onChange={(value) => select(nodeId, value, stream)}
              />
            </label>
            <label>
              {tr("stream")}
              <Select
                aria-label={tr("stream")}
                value={stream}
                options={[
                  { value: "stdout", label: "stdout" },
                  { value: "stderr", label: "stderr" },
                ]}
                onChange={(value) => select(nodeId, attempt, value)}
              />
            </label>
          </div>
          {node?.reused_result && (
            <Alert
              type="info"
              title={tr("reusedResult")}
              description={t("deliveryExecutionRuntime.reusedAttempt", {
                attempt: node.result_attempt,
              })}
            />
          )}
          {!runtime.nodes.length ? (
            <p className="runtime-help">{tr("noSteps")}</p>
          ) : !valid ? (
            <Alert
              type="warning"
              title={tr("invalidSelection")}
              description={tr("chooseExactStep")}
            />
          ) : (
            <ExecutionOutputPane
              key={`${projectId}:${sessionId}:${executionId}:${nodeId}:${attempt}:${stream}`}
              projectId={projectId}
              executionId={executionId}
              nodeId={nodeId}
              attempt={attempt}
              stream={stream as ExecutionOutputStream}
              active={active}
            />
          )}
        </div>
      </div>
    </section>
  );
}
type PaneProps = {
  projectId: string;
  executionId: string;
  nodeId: string;
  attempt: number;
  stream: ExecutionOutputStream;
  active: boolean;
};
export function ExecutionOutputPane({
  projectId,
  executionId,
  nodeId,
  attempt,
  stream,
  active,
}: PaneProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryExecutionRuntime.${key}`);
  const [data, setData] = useState<OutputResponse | null>(null);
  const [chunks, setChunks] = useState<ExecutionOutputChunk[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [autoRead, setAutoRead] = useState(active);
  const [follow, setFollow] = useState(true);
  const [omitted, setOmitted] = useState(0);
  const [copyState, setCopyState] = useState("");
  const cursor = useRef<string>();
  const records = useRef<ExecutionOutputChunk[]>([]);
  const controller = useRef<AbortController>();
  const pending = useRef(false);
  const mounted = useRef(true);
  const origin = useRef(projectSessionKey());
  const output = useRef<HTMLPreElement>(null);
  const read = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      assertExecutionSession(origin.current);
      const value = await fetchExecutionNodeOutput(
        projectId,
        executionId,
        nodeId,
        attempt,
        stream,
        cursor.current,
        abort.signal,
      );
      assertExecutionSession(origin.current);
      if (!mounted.current || abort.signal.aborted) return;
      const merged = mergeExecutionOutput(records.current, value.chunks);
      records.current = merged.chunks;
      setChunks(merged.chunks);
      setOmitted((count) => count + merged.omitted);
      setData((previous) => ({
        ...value,
        sanitized: Boolean(previous?.sanitized || value.sanitized),
        truncated: Boolean(previous?.truncated || value.truncated),
        gaps: [
          ...new Map(
            [...(previous?.gaps || []), ...value.gaps].map((gap) => [
              `${gap.after_seq}:${gap.before_seq}:${gap.reason}`,
              gap,
            ]),
          ).values(),
        ],
      }));
      setError("");
      cursor.current = value.next_cursor || undefined;
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) {
        const info = executionRuntimeProblem(failure);
        setError(
          tr(info.message) === `deliveryExecutionRuntime.${info.message}`
            ? info.message
            : tr(info.message),
        );
        if (info.message === "scopeChanged") {
          records.current = [];
          setChunks([]);
          setData(null);
        }
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [projectId, executionId, nodeId, attempt, stream]);
  useEffect(() => {
    mounted.current = true;
    void read();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [read]);
  useEffect(() => {
    if (!active || !autoRead || data?.complete || data?.more || error) return;
    const timer = setInterval(() => void read(), 3000);
    return () => clearInterval(timer);
  }, [active, autoRead, data?.complete, data?.more, error, read]);
  useEffect(() => {
    if (follow && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [chunks, follow]);
  const loaded = chunks.map((chunk) => chunk.text).join("");
  const matches = search
    ? loaded
        .split("\n")
        .filter((line) =>
          line.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .join("\n")
    : loaded;
  const copy = async () => {
    try {
      assertExecutionSession(origin.current);
      await navigator.clipboard.writeText(matches);
      assertExecutionSession(origin.current);
      if (mounted.current) setCopyState(tr("copied"));
    } catch {
      if (mounted.current) setCopyState(tr("copyFailed"));
    }
  };
  return (
    <div className="execution-output-pane">
      <p className="runtime-help">{tr("sanitizedHint")}</p>
      <Space wrap>
        <Tag>{tr(data?.source || "unavailable")}</Tag>
        {data?.sanitized && <Tag color="warning">{tr("redacted")}</Tag>}
        {(data?.truncated || chunks.some((chunk) => chunk.truncated)) && (
          <Tag color="warning">{tr("truncated")}</Tag>
        )}
        {data?.complete && <Tag>{tr("completeOutput")}</Tag>}
      </Space>
      {Boolean(data?.gaps.length || omitted) && (
        <Alert
          type="warning"
          title={tr("outputGaps")}
          description={
            <>
              {omitted > 0 && (
                <p>
                  {t("deliveryExecutionRuntime.localOmitted", {
                    count: omitted,
                  })}
                </p>
              )}
              {data?.gaps.map((gap) => (
                <p key={`${gap.after_seq}:${gap.before_seq}:${gap.reason}`}>
                  {gap.after_seq} → {gap.before_seq ?? "…"} ·{" "}
                  {t(`deliveryExecutionRuntime.gapReasons.${gap.reason}`, {
                    defaultValue: gap.reason,
                  })}
                </p>
              ))}
            </>
          }
        />
      )}
      {data && data.availability !== "available" && (
        <Alert type="info" title={tr(`availability.${data.availability}`)} />
      )}
      <div className="execution-output-toolbar">
        <Input
          aria-label={tr("searchLoaded")}
          placeholder={tr("searchLoaded")}
          value={search}
          allowClear
          onChange={(event) => setSearch(event.target.value)}
        />
        <Space wrap>
          <Button size="small" disabled={busy} loading={busy} onClick={read}>
            {tr("refreshOutput")}
          </Button>
          <Button size="small" disabled={!matches} onClick={copy}>
            {tr("copyLoaded")}
          </Button>
        </Space>
      </div>
      <Space wrap className="runtime-help">
        <label>
          <Switch
            size="small"
            checked={autoRead && active}
            disabled={!active}
            onChange={setAutoRead}
            aria-label={tr("autoRead")}
          />{" "}
          {tr("autoRead")}
        </label>
        <label>
          <Switch
            size="small"
            checked={follow}
            onChange={setFollow}
            aria-label={tr("followLatest")}
          />{" "}
          {tr("followLatest")}
        </label>
      </Space>
      {(!active || !autoRead) && (
        <p className="runtime-help" role="status">
          {tr(active ? "readingPaused" : "automaticReadingOff")}
        </p>
      )}
      {error && (
        <Alert
          role="alert"
          type="warning"
          title={tr("readFailed")}
          description={error}
        />
      )}
      <pre
        ref={output}
        className="runtime-output execution-stream-output"
        tabIndex={0}
        aria-label={tr("loadedOutput")}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            element.scrollHeight - element.scrollTop - element.clientHeight >
            30
          )
            setFollow(false);
        }}
      >
        {matches || tr(search ? "noLoadedMatches" : "noOutputYet")}
      </pre>
      {data?.more && (
        <Button size="small" disabled={busy} loading={busy} onClick={read}>
          {tr("loadMore")}
        </Button>
      )}
      <p className="runtime-help" role="status">
        {copyState}
      </p>
    </div>
  );
}
