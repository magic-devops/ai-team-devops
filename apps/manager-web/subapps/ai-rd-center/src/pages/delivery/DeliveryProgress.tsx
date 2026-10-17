import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Select,
  Skeleton,
  Tag,
  Tooltip,
} from "antd";
import { ArrowRight, Camera, LockKeyhole, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  prepareDeliveryIntent,
  saveDelivery,
  type DeliveryInboxTarget,
  type DeliveryIntent,
  type DeliveryWorkspace,
} from "@/lib/delivery";
import { planError } from "@/lib/deliveryTaskPlan";
import {
  defaultProgressRange,
  fetchDeliveryProgress,
  fetchProgressObservation,
  parseProgressRoute,
  progressHash,
  progressRangeProblem,
  progressDateChange,
  type DeliveryProgress as ProgressData,
  type ProgressRoute,
} from "@/lib/deliveryProgress";
import { DeliveryEditor, type EditorSpec } from "./DeliveryEditor";
import { DeliveryProgressCharts } from "./DeliveryProgressCharts";
import {
  DeliveryProgressComparison,
  DeliveryProgressHistory,
  DeliveryProgressSnapshot,
  progressDateTime,
} from "./DeliveryProgressDetails";

function progressQueryKey(
  projectId: string,
  sessionId: string,
  route: ProgressRoute,
) {
  return [
    "delivery-progress",
    projectId,
    sessionId,
    route.startsOn,
    route.endsOn,
    route.scope,
    route.scopeId,
    route.baselineId,
  ];
}
type Props = {
  projectId: string;
  sessionId: string;
  workspace: DeliveryWorkspace;
  onWorkspace: (data: DeliveryWorkspace) => void;
  onOpenTask: (target: DeliveryInboxTarget) => void;
};
export function DeliveryProgress({
  projectId,
  sessionId,
  workspace,
  onWorkspace,
  onOpenTask,
}: Props) {
  const { t, i18n } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`deliveryProgress.${key}`, options);
  const qc = useQueryClient();
  const [route, setRoute] = useState(() => parseProgressRoute(location.hash));
  const [dateDraft, setDateDraft] = useState(() => ({
    startsOn: route.startsOn,
    endsOn: route.endsOn,
  }));
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [recorded, setRecorded] = useState(false);
  const recordIntent = useRef<DeliveryIntent>();
  useEffect(() => {
    const sync = () => {
      const next = parseProgressRoute(location.hash);
      setRoute(next);
      setDateDraft({ startsOn: next.startsOn, endsOn: next.endsOn });
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const changeRoute = useCallback(
    (patch: Partial<ProgressRoute>, replace = false) => {
      const next = { ...parseProgressRoute(location.hash), ...patch };
      const hash = progressHash(next);
      history[replace ? "replaceState" : "pushState"](
        null,
        "",
        `${location.pathname}${location.search}${hash}`,
      );
      setRoute(next);
      setDateDraft({ startsOn: next.startsOn, endsOn: next.endsOn });
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [],
  );
  const rangeProblem = progressRangeProblem(route.startsOn, route.endsOn);
  const scopeProblem = route.scope !== "project" && !route.scopeId;
  const dateDraftProblem = progressRangeProblem(
    dateDraft.startsOn,
    dateDraft.endsOn,
  );
  const key = progressQueryKey(projectId, sessionId, route);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      fetchDeliveryProgress(
        projectId,
        scopeProblem
          ? { ...route, scope: "project", scopeId: "", baselineId: "" }
          : route,
        signal,
      ),
    enabled: !rangeProblem,
    gcTime: 0,
    refetchInterval: 10000,
  });
  const data = query.data;
  const observation = useQuery({
    queryKey: [
      "delivery-progress-observation",
      projectId,
      sessionId,
      route.observationId,
      route.scope,
      route.scopeId,
    ],
    queryFn: ({ signal }) =>
      fetchProgressObservation(projectId, route.observationId, route, signal),
    enabled: Boolean(route.observationId),
    gcTime: 0,
    retry: false,
  });
  const scopeOptions =
    data?.scopes[route.scope === "sprint" ? "sprints" : "milestones"] || [];
  const refresh = () => void query.refetch();
  const saveResult = (updated: DeliveryWorkspace) => {
    onWorkspace(updated);
    void qc.invalidateQueries({
      queryKey: ["delivery-progress", projectId, sessionId],
    });
  };
  const record = async () => {
    if (busy || !data) return;
    setBusy(true);
    setActionError("");
    setRecorded(false);
    if (!recordIntent.current || recordIntent.current.version !== data.version)
      recordIntent.current = {
        version: data.version,
        key: crypto.randomUUID(),
      };
    try {
      const updated = await saveDelivery(
        projectId,
        "progress.record",
        {},
        recordIntent.current.version,
        recordIntent.current.key,
      );
      saveResult(updated);
      setRecorded(true);
      recordIntent.current = undefined;
      await query.refetch();
    } catch (error) {
      const failure = planError(error);
      setActionError(
        failure.conflict ? t("delivery.conflict") : failure.message,
      );
      if (failure.conflict) await query.refetch();
    } finally {
      setBusy(false);
    }
  };
  const freeze = () => {
    if (!data) return;
    const frozenRoute = { ...route, observationId: "" };
    let pinned = structuredClone(data);
    let latest: ProgressData | undefined;
    let intent: DeliveryIntent = {
      version: data.version,
      key: crypto.randomUUID(),
    };
    const freezeHint = (facts: ProgressData) =>
      `${tr("freezeHint")} ${tr("freezeScope")}: ${facts.scope.label} · ${tr("freezeCount", { count: facts.current.task_ids.length })}. ${tr("basisHint")} ${tr("freezeDates")}`;
    const scopeDates =
      data.scope.kind === "project"
        ? workspace.project
        : scopeOptions.find((scope) => scope.id === route.scopeId);
    setEditor({
      title: tr("freeze"),
      hint: freezeHint(data),
      fields: [
        { key: "title", label: tr("titleField"), required: true, max: 200 },
        { key: "starts_on", label: tr("startsOn"), type: "date" },
        { key: "ends_on", label: tr("endsOn"), type: "date" },
        { key: "note", label: tr("note"), type: "area", max: 4000 },
      ],
      values: {
        title: `${data.scope.label} · ${new Date().toISOString().slice(0, 10)}`,
        starts_on: scopeDates?.starts_on || "",
        ends_on: scopeDates?.ends_on || "",
        note: "",
      },
      submit: async (values) => {
        if (
          values.starts_on &&
          values.ends_on &&
          String(values.starts_on) > String(values.ends_on)
        )
          throw new Error(tr("dateOrder"));
        const payload = {
          title: String(values.title || "").trim(),
          scope: pinned.scope.kind,
          scope_id: pinned.scope.id,
          task_ids: [...pinned.current.task_ids],
          basis: pinned.current.basis,
          starts_on: values.starts_on || null,
          ends_on: values.ends_on || null,
          note: String(values.note || "").trim(),
        };
        intent = prepareDeliveryIntent(intent, "baseline.create", payload);
        try {
          const updated = await saveDelivery(
            projectId,
            "baseline.create",
            payload,
            intent.version,
            intent.key,
          );
          saveResult(updated);
          const receiptEvent = updated.activity.find(
            (event) =>
              event.action === "baseline.create" &&
              event.data.input.basis === payload.basis &&
              event.data.input.title === payload.title,
          );
          changeRoute({
            ...frozenRoute,
            baselineId: receiptEvent?.resource_id || "",
          });
        } catch (error) {
          const failure = planError(error);
          const result = new Error(
            failure.conflict ? t("delivery.conflict") : failure.message,
          );
          result.name = failure.conflict ? "DeliveryConflict" : "Error";
          throw result;
        }
      },
      loadLatest: async () => {
        latest = await fetchDeliveryProgress(projectId, {
          ...frozenRoute,
          baselineId: "",
        });
        return {
          version: latest.version,
          items: [
            { label: tr("freezeScope"), value: latest.scope.label },
            {
              label: tr("taskCount"),
              value: String(latest.current.task_ids.length),
            },
            {
              label: tr("tasks"),
              value:
                latest.current.tasks
                  .map(
                    (task) =>
                      `${task.title} (${task.id}) · ${task.assigned_to || "—"} · ${task.estimate || "—"} · ${task.starts_on || "—"} → ${task.ends_on || "—"}`,
                  )
                  .join("\n") || tr("noTasks"),
            },
          ],
        };
      },
      adoptVersion: (version) => {
        if (latest) pinned = latest;
        intent = { version, key: crypto.randomUUID() };
        setEditor((current) =>
          current ? { ...current, hint: freezeHint(pinned) } : current,
        );
      },
    });
  };
  const openObservation = useCallback(
    (id: string) => changeRoute({ observationId: id }),
    [changeRoute],
  );
  const openCurrentTask = (target: DeliveryInboxTarget) => {
    onOpenTask(target);
  };
  return (
    <div className="delivery-progress-page">
      <div className="delivery-section-heading delivery-progress-title">
        <div>
          <h2>{tr("title")}</h2>
          <p className="delivery-hint">{tr("subtitle")}</p>
        </div>
        <div className="delivery-actions">
          <Tooltip title={tr("recordHint")}>
            <Button
              icon={<Camera size={15} />}
              loading={busy}
              disabled={
                !workspace.permissions.write ||
                !data ||
                Boolean(rangeProblem || scopeProblem)
              }
              onClick={() => void record()}
            >
              {tr("record")}
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<LockKeyhole size={15} />}
            disabled={
              !workspace.permissions.approve ||
              !data ||
              Boolean(rangeProblem || scopeProblem)
            }
            onClick={freeze}
          >
            {tr("freeze")}
          </Button>
          <Button
            aria-label={tr("refresh")}
            icon={<RefreshCw size={15} />}
            loading={query.isFetching}
            onClick={refresh}
            disabled={Boolean(rangeProblem || scopeProblem)}
          />
        </div>
      </div>
      <div className="delivery-progress-filters">
        <label>
          <span>{tr("scope")}</span>
          <Select
            aria-label={tr("scope")}
            value={route.scope}
            onChange={(scope) =>
              changeRoute({
                scope,
                scopeId: "",
                baselineId: "",
                observationId: "",
              })
            }
            options={["project", "milestone", "sprint"].map((scope) => ({
              value: scope,
              label: tr(scope),
            }))}
          />
        </label>
        {route.scope !== "project" && (
          <label>
            <span>{tr("chooseScope")}</span>
            <Select
              aria-label={tr("chooseScope")}
              value={route.scopeId || undefined}
              placeholder={tr("chooseScope")}
              onChange={(scopeId) =>
                changeRoute({ scopeId, baselineId: "", observationId: "" })
              }
              options={scopeOptions.map((scope) => ({
                value: scope.id,
                label: scope.title,
              }))}
            />
          </label>
        )}
        <label>
          <span>{tr("startsOn")}</span>
          <Input
            type="date"
            aria-label={tr("startsOn")}
            value={dateDraft.startsOn}
            onChange={(event) =>
              progressDateChange(setDateDraft, "startsOn", event)
            }
          />
        </label>
        <label>
          <span>{tr("endsOn")}</span>
          <Input
            type="date"
            aria-label={tr("endsOn")}
            value={dateDraft.endsOn}
            onChange={(event) =>
              progressDateChange(setDateDraft, "endsOn", event)
            }
          />
        </label>
        <Button
          disabled={Boolean(dateDraftProblem)}
          onClick={() => changeRoute({ ...dateDraft, observationId: "" })}
        >
          {tr("applyRange")}
        </Button>
        <label className="delivery-progress-baseline-filter">
          <span>{tr("baseline")}</span>
          <Select
            aria-label={tr("baseline")}
            value={route.baselineId}
            onChange={(baselineId) =>
              changeRoute({ baselineId, observationId: "" })
            }
            options={[
              { value: "", label: tr("noBaseline") },
              ...(data?.baselines || []).map((baseline) => ({
                value: baseline.id,
                label: baseline.title,
              })),
            ]}
          />
        </label>
        <div className="delivery-progress-presets">
          {[14, 30, 90].map((count) => (
            <Button
              size="small"
              key={count}
              onClick={() => {
                const endsOn = defaultProgressRange().endsOn;
                const startsOn = new Date(
                  Date.parse(`${endsOn}T00:00:00Z`) - (count - 1) * 86400000,
                )
                  .toISOString()
                  .slice(0, 10);
                changeRoute({ startsOn, endsOn, observationId: "" });
              }}
            >
              {tr("recentDays", { count })}
            </Button>
          ))}
        </div>
      </div>
      {dateDraftProblem && (
        <Alert type="warning" showIcon title={tr(dateDraftProblem)} />
      )}
      {rangeProblem && <Alert type="error" showIcon title={tr(rangeProblem)} />}
      {scopeProblem && (
        <Alert type="info" showIcon title={tr("missingScope")} />
      )}
      {query.error && (
        <Alert
          type="error"
          showIcon
          title={tr(data ? "stale" : "readFailed")}
          description={query.error.message}
          action={<Button onClick={refresh}>{tr("refresh")}</Button>}
        />
      )}
      {actionError && (
        <Alert
          type="error"
          showIcon
          title={actionError}
          closable
          onClose={() => setActionError("")}
        />
      )}
      {recorded && (
        <Alert
          type="success"
          showIcon
          title={tr("recordSuccess")}
          closable
          onClose={() => setRecorded(false)}
        />
      )}
      {query.isPending && !rangeProblem && !scopeProblem && (
        <Skeleton active paragraph={{ rows: 7 }} />
      )}
      {data && !rangeProblem && !scopeProblem && (
        <>
          <div className="delivery-progress-coverage">
            <span>
              <b>{tr("coverage")}</b> ·{" "}
              {tr("coverageCount", {
                observed: data.coverage.observed_days.length,
                missing: data.coverage.missing_days.length,
              })}
            </span>
            {data.coverage.future_days.length > 0 && (
              <span>
                {tr("futureCount", { count: data.coverage.future_days.length })}
              </span>
            )}
            <small>
              {tr("latest")}:{" "}
              {progressDateTime(data.coverage.last_observed_at, i18n.language)}{" "}
              UTC
            </small>
            <Tag>UTC</Tag>
          </div>
          <div className="delivery-progress-current">
            <div className="delivery-section-heading">
              <h3>{tr("current")}</h3>
              <small>
                {progressDateTime(data.as_of, i18n.language)} UTC ·{" "}
                {data.scope.label}
              </small>
            </div>
            <div className="delivery-progress-metrics">
              {(
                [
                  ["total", data.current.metrics.tasks_total],
                  ["verified", data.current.metrics.verified_completed],
                  ["remaining", data.current.metrics.remaining],
                  ["review", data.current.metrics.awaiting_review],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <span>{tr(label)}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="delivery-hint">
              {tr("recorded")} {data.current.metrics.recorded_completed} ·{" "}
              {tr("acceptedRequirements")}{" "}
              {data.current.metrics.requirements_accepted}/
              {data.current.metrics.requirements_total} · {tr("recordedHint")}
            </p>
          </div>
          {!data.coverage.observed_days.length && (
            <Alert
              type="info"
              showIcon
              title={tr("noHistory")}
              description={tr("noHistoryHint")}
            />
          )}
          <p className="delivery-hint">{tr("gapHint")}</p>
          <DeliveryProgressCharts data={data} onOpen={openObservation} />
          {data.baseline && (
            <section className="delivery-panel delivery-progress-baseline">
              <div className="delivery-section-heading">
                <div>
                  <Tag icon={<LockKeyhole size={11} />}>{tr("immutable")}</Tag>
                  <h2>{data.baseline.title}</h2>
                </div>
                <Button
                  size="small"
                  disabled={!workspace.permissions.approve}
                  onClick={freeze}
                >
                  {tr("replan")}
                </Button>
              </div>
              <p>
                {tr("frozenCount", { count: data.baseline.task_ids.length })} ·{" "}
                {data.baseline.scope.label} · {data.baseline.starts_on || "—"} →{" "}
                {data.baseline.ends_on || "—"}
              </p>
              <small>
                {tr("createdBy")}:{" "}
                {workspace.members.find(
                  (member) => member.id === `user:${data.baseline!.created_by}`,
                )?.name || data.baseline.created_by}{" "}
                · {tr("createdAt")}:{" "}
                {progressDateTime(data.baseline.created_at, i18n.language)} UTC
                · {tr("sourceVersion")}: {data.baseline.source_version}
              </small>
              {data.baseline.note && (
                <p className="delivery-description">{data.baseline.note}</p>
              )}
              {data.comparison && (
                <DeliveryProgressComparison
                  comparison={data.comparison}
                  currentTasks={workspace.tasks}
                  onOpenTask={openCurrentTask}
                />
              )}
            </section>
          )}
          <DeliveryProgressHistory data={data} onOpen={openObservation} />
        </>
      )}
      <Drawer
        open={Boolean(route.observationId)}
        onClose={() => changeRoute({ observationId: "" })}
        title={tr("history")}
        width={660}
        className="delivery-inspector delivery-progress-drawer"
        destroyOnHidden
      >
        {observation.isPending && <Skeleton active />}
        {observation.error && (
          <Alert
            type="error"
            showIcon
            title={tr("observationFailed")}
            description={observation.error.message}
            action={
              <Button onClick={() => void observation.refetch()}>
                {tr("refresh")}
              </Button>
            }
          />
        )}
        {observation.data && (
          <DeliveryProgressSnapshot
            observation={observation.data}
            currentTasks={workspace.tasks}
            onOpenTask={openCurrentTask}
          />
        )}
      </Drawer>
      {editor && (
        <DeliveryEditor spec={editor} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}

export function DeliveryProgressSummary({
  projectId,
  sessionId,
  onOpen,
}: {
  projectId: string;
  sessionId: string;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [route] = useState<ProgressRoute>(() => ({
    ...defaultProgressRange(),
    scope: "project",
    scopeId: "",
    baselineId: "",
    observationId: "",
  }));
  const query = useQuery({
    queryKey: progressQueryKey(projectId, sessionId, route),
    queryFn: ({ signal }) => fetchDeliveryProgress(projectId, route, signal),
    gcTime: 0,
    refetchInterval: 10000,
  });
  const data = query.data;
  return (
    <section className="delivery-panel delivery-progress-summary">
      <div className="delivery-section-heading">
        <h2>{t("deliveryProgress.history")}</h2>
        <Button type="link" size="small" onClick={onOpen}>
          {t("deliveryProgress.viewProgress")}
          <ArrowRight size={12} />
        </Button>
      </div>
      {query.isPending && <Skeleton active paragraph={{ rows: 2 }} />}
      {query.error && (
        <Alert
          type="error"
          showIcon
          title={t(
            data ? "deliveryProgress.stale" : "deliveryProgress.readFailed",
          )}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              {t("deliveryProgress.refresh")}
            </Button>
          }
        />
      )}
      {data && (
        <>
          <div className="delivery-progress-summary-value">
            <strong>
              {data.current.metrics.verified_completed}
              <small>/{data.current.metrics.tasks_total}</small>
            </strong>
            <span>{t("deliveryProgress.verified")}</span>
          </div>
          <p>
            {t("deliveryProgress.coverageCount", {
              observed: data.coverage.observed_days.length,
              missing: data.coverage.missing_days.length,
            })}
          </p>
          <p className="delivery-hint">
            {data.coverage.last_observed_at
              ? `${t("deliveryProgress.latest")}: ${progressDateTime(data.coverage.last_observed_at, i18n.language)} UTC`
              : t("deliveryProgress.lastNotRecorded")}
          </p>
          <p className="delivery-hint">{t("deliveryProgress.gapHint")}</p>
        </>
      )}
      {!data && !query.isPending && !query.error && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("deliveryProgress.noHistory")}
        />
      )}
    </section>
  );
}
