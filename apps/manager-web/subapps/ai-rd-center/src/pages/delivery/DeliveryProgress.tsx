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
} from "antd";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DeliveryCommandAck,
  DeliveryInboxTarget,
  DeliveryContext,
} from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { DeliveryReferenceSelect } from "@/components/DeliveryReferenceSelect";
import {
  defaultProgressRange,
  fetchDeliveryProgress,
  fetchDeliveryProgressSummary,
  parseProgressRoute,
  progressHash,
  progressRangeProblem,
  progressDateChange,
  type ProgressRoute,
} from "@/lib/deliveryProgress";
import { DeliveryProgressCharts } from "./DeliveryProgressCharts";
import {
  DeliveryProgressHistory,
  progressDateTime,
} from "./DeliveryProgressDetails";
import {
  DeliveryProgressBaselineCatalogue,
  DeliveryProgressSnapshotBrowser,
  DeliveryProgressComparisonBrowser,
} from "./DeliveryProgressBrowser";
import { DeliveryProgressCommands } from "./DeliveryProgressCommands";
import { DeliveryQueryError } from "./DeliveryQueryViews";

type Props = {
  projectId: string;
  sessionId: string;
  workspace: DeliveryContext;
  onWorkspace: (data: DeliveryCommandAck) => void;
  onOpenTask: (target: DeliveryInboxTarget) => void;
  onPending?: (identity: string, value: boolean) => void;
};
export function DeliveryProgress({
  projectId,
  sessionId,
  workspace,
  onWorkspace,
  onOpenTask,
  onPending,
}: Props) {
  const { t, i18n } = useTranslation(),
    tr = (key: string, options?: Record<string, unknown>) =>
      t(`deliveryProgress.${key}`, options),
    qc = useQueryClient();
  const [route, setRoute] = useState(() => parseProgressRoute(location.hash));
  const [dateDraft, setDateDraft] = useState(() => ({
    startsOn: route.startsOn,
    endsOn: route.endsOn,
  }));
  const [blocked, setBlocked] = useState(false);
  const pending = useRef(new Map<string, boolean>()),
    owner = useRef(projectSessionKey());
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
  const current = () => owner.current === projectSessionKey();
  const changeRoute = useCallback((patch: Partial<ProgressRoute>) => {
    if (!current() || [...pending.current.values()].some(Boolean)) return;
    const next = { ...parseProgressRoute(location.hash), ...patch };
    history.pushState(
      null,
      "",
      `${location.pathname}${location.search}${progressHash(next)}`,
    );
    setRoute(next);
    setDateDraft({ startsOn: next.startsOn, endsOn: next.endsOn });
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);
  const rangeProblem = progressRangeProblem(route.startsOn, route.endsOn),
    scopeProblem = route.scope !== "project" && !route.scopeId,
    dateDraftProblem = progressRangeProblem(
      dateDraft.startsOn,
      dateDraft.endsOn,
    );
  const query = useQuery({
    queryKey: [
      "delivery-progress",
      projectId,
      sessionId,
      route.startsOn,
      route.endsOn,
      route.scope,
      route.scopeId,
      route.baselineId,
      workspace.query_generation,
    ],
    queryFn: ({ signal }) => fetchDeliveryProgress(projectId, route, signal),
    enabled: !rangeProblem && !scopeProblem && !blocked,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: blocked ? false : 10000,
  });
  const data =
    !query.isError &&
    current() &&
    query.data?.project_id === projectId &&
    query.data.scope.kind === route.scope &&
    (route.scope === "project" || query.data.scope.id === route.scopeId)
      ? query.data
      : undefined;
  const unavailable =
    !data || query.isError || Boolean(rangeProblem || scopeProblem);
  const sourceKind = route.baselineDetail ? "baseline" : "observation",
    requestedSource = route.baselineDetail
      ? route.baselineId
      : route.observationId;
  const inspector = useDrawerIdentity(
    `${projectId}:${sessionId}:${sourceKind}:${route.scope}:${route.scopeId}`,
    requestedSource,
  );
  const refresh = () => {
    if (current() && !blocked) void query.refetch();
  };
  const saved = (ack: DeliveryCommandAck) => {
    if (!current() || ack.project_id !== projectId) return;
    onWorkspace(ack);
    void qc.invalidateQueries({
      queryKey: ["delivery-progress", projectId, sessionId],
    });
    void qc.invalidateQueries({
      queryKey: ["delivery-progress-baselines", projectId, sessionId],
    });
    if (ack.action === "baseline.create" && ack.resource.kind === "baseline")
      changeRoute({
        baselineId: ack.resource.id,
        catalogueOpen: false,
        baselineDetail: false,
        observationId: "",
      });
    void query.refetch();
  };
  const childPending = (identity: string, value: boolean) => {
    pending.current.set(identity, value);
    setBlocked([...pending.current.values()].some(Boolean));
    onPending?.(identity, value);
  };
  return (
    <div className="delivery-progress-page">
      <div className="delivery-section-heading delivery-progress-title">
        <div>
          <h2>{tr("title")}</h2>
          <p className="delivery-hint">{tr("subtitle")}</p>
        </div>
        <Button
          disabled={blocked || Boolean(rangeProblem || scopeProblem)}
          loading={query.isFetching}
          onClick={refresh}
        >
          {tr("refresh")}
        </Button>
      </div>
      <DeliveryProgressCommands
        projectId={projectId}
        route={route}
        data={data}
        canWrite={workspace.permissions.write}
        canApprove={workspace.permissions.approve}
        unavailable={unavailable}
        onSaved={saved}
        onRefresh={refresh}
        onPending={childPending}
      />
      <div className="delivery-progress-filters">
        <label>
          <span>{tr("scope")}</span>
          <Select
            aria-label={tr("scope")}
            value={route.scope}
            disabled={blocked}
            onChange={(scope) =>
              changeRoute({
                scope,
                scopeId: "",
                baselineId: "",
                observationId: "",
                baselineDetail: false,
                catalogueOpen: false,
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
            <DeliveryReferenceSelect
              kind={route.scope}
              value={route.scopeId || undefined}
              label={tr("chooseScope")}
              disabled={blocked}
              queryGeneration={workspace.query_generation}
              onChange={(scopeId) =>
                changeRoute({
                  scopeId,
                  baselineId: "",
                  observationId: "",
                  baselineDetail: false,
                })
              }
            />
          </label>
        )}
        <label>
          <span>{tr("startsOn")}</span>
          <Input
            type="date"
            aria-label={tr("startsOn")}
            value={dateDraft.startsOn}
            disabled={blocked}
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
            disabled={blocked}
            onChange={(event) =>
              progressDateChange(setDateDraft, "endsOn", event)
            }
          />
        </label>
        <Button
          disabled={blocked || Boolean(dateDraftProblem)}
          onClick={() =>
            changeRoute({
              ...dateDraft,
              observationId: "",
              baselineDetail: false,
            })
          }
        >
          {tr("applyRange")}
        </Button>
        <Button
          disabled={blocked || Boolean(scopeProblem)}
          onClick={() => changeRoute({ catalogueOpen: true })}
        >
          {t("deliveryProgress.bounded.catalogue")}
        </Button>
        {route.baselineId && (
          <Button
            disabled={blocked}
            onClick={() =>
              changeRoute({ baselineId: "", baselineDetail: false })
            }
          >
            {tr("noBaseline")}
          </Button>
        )}
      </div>
      <div className="delivery-progress-presets">
        {[14, 30, 90].map((count) => (
          <Button
            size="small"
            key={count}
            disabled={blocked}
            onClick={() => {
              const endsOn = defaultProgressRange().endsOn;
              changeRoute({
                startsOn: new Date(
                  Date.parse(endsOn + "T00:00:00Z") - (count - 1) * 86400000,
                )
                  .toISOString()
                  .slice(0, 10),
                endsOn,
                observationId: "",
                baselineDetail: false,
              });
            }}
          >
            {tr("recentDays", { count })}
          </Button>
        ))}
      </div>
      {dateDraftProblem && (
        <Alert type="warning" title={tr(dateDraftProblem)} />
      )}
      {rangeProblem && <Alert type="error" title={tr(rangeProblem)} />}
      {scopeProblem && <Alert type="info" title={tr("missingScope")} />}
      {query.error && (
        <DeliveryQueryError error={query.error} onRetry={refresh} />
      )}
      {query.isPending && !rangeProblem && !scopeProblem && (
        <Skeleton active paragraph={{ rows: 7 }} />
      )}
      {data && (
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
          <section className="delivery-progress-current">
            <div className="delivery-section-heading">
              <h3>{tr("current")}</h3>
              <small>
                {progressDateTime(data.as_of, i18n.language)} UTC ·{" "}
                {data.scope.label}
              </small>
            </div>
            <div className="delivery-progress-metrics">
              {[
                ["total", data.current.metrics.tasks_total],
                ["verified", data.current.metrics.verified_completed],
                ["remaining", data.current.metrics.remaining],
                ["review", data.current.metrics.awaiting_review],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{tr(String(label))}</span>
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
          </section>
          {!data.coverage.observed_days.length && (
            <Alert
              type="info"
              title={tr("noHistory")}
              description={tr("noHistoryHint")}
            />
          )}
          <p className="delivery-hint">{tr("gapHint")}</p>
          <DeliveryProgressCharts
            data={data}
            onOpen={(id) =>
              changeRoute({ observationId: id, baselineDetail: false })
            }
          />
          {data.baseline && (
            <section className="delivery-panel delivery-progress-baseline">
              <div className="delivery-section-heading">
                <div>
                  <Tag>{tr("immutable")}</Tag>
                  <h2>{data.baseline.title}</h2>
                </div>
                <Button
                  disabled={blocked}
                  onClick={() =>
                    changeRoute({ baselineDetail: true, observationId: "" })
                  }
                >
                  {t("deliveryProgress.bounded.viewBaseline")}
                </Button>
              </div>
              <p>
                {tr("frozenCount", { count: data.baseline.task_count ?? "—" })}{" "}
                · {data.baseline.scope.label} · {data.baseline.starts_on || "—"}{" "}
                → {data.baseline.ends_on || "—"}
              </p>
              <small>
                {tr("createdAt")}:{" "}
                {progressDateTime(data.baseline.created_at, i18n.language)} UTC
                · {tr("sourceVersion")}: {data.baseline.source_version}
              </small>
              {data.baseline.note && (
                <p className="delivery-description">{data.baseline.note}</p>
              )}
              <DeliveryProgressComparisonBrowser
                projectId={projectId}
                sessionId={sessionId}
                baselineId={data.baseline.id}
                generation={data.query_generation}
                disabled={blocked}
                onOpenTask={onOpenTask}
              />
            </section>
          )}
          <DeliveryProgressHistory
            data={data}
            onOpen={(id) =>
              changeRoute({ observationId: id, baselineDetail: false })
            }
          />
        </>
      )}
      <Drawer
        open={Boolean(route.catalogueOpen)}
        title={t("deliveryProgress.bounded.catalogue")}
        size="min(760px, 100vw)"
        destroyOnHidden
        closable={!blocked}
        maskClosable={!blocked}
        keyboard={!blocked}
        onClose={() => changeRoute({ catalogueOpen: false })}
        className="delivery-inspector delivery-progress-drawer"
      >
        {route.catalogueOpen && (
          <DeliveryProgressBaselineCatalogue
            key={`${projectId}:${sessionId}:${route.scope}:${route.scopeId}`}
            projectId={projectId}
            sessionId={sessionId}
            route={route}
            disabled={blocked}
            onSelect={(id, view) =>
              changeRoute({
                baselineId: id,
                baselineDetail: view,
                observationId: "",
                catalogueOpen: false,
              })
            }
          />
        )}
      </Drawer>
      <Drawer
        open={Boolean(requestedSource)}
        title={tr(route.baselineDetail ? "baseline" : "history")}
        size="min(760px, 100vw)"
        destroyOnHidden
        closable={!blocked}
        maskClosable={!blocked}
        keyboard={!blocked}
        afterOpenChange={inspector.afterOpenChange}
        onClose={() =>
          changeRoute({ observationId: "", baselineDetail: false })
        }
        className="delivery-inspector delivery-progress-drawer"
      >
        {inspector.displayId &&
          !/^HTTP 403:/.test(
            String(
              query.error instanceof Error
                ? query.error.message
                : query.error || "",
            ),
          ) && (
            <DeliveryProgressSnapshotBrowser
              key={`${projectId}:${sessionId}:${sourceKind}:${inspector.displayId}:${route.scope}:${route.scopeId}`}
              projectId={projectId}
              sessionId={sessionId}
              sourceKind={sourceKind}
              sourceId={inspector.displayId}
              route={route}
              disabled={blocked}
              generation={workspace.query_generation}
              onOpenTask={onOpenTask}
            />
          )}
      </Drawer>
    </div>
  );
}
export function DeliveryProgressSummary({
  projectId,
  sessionId,
  queryGeneration,
  onRefreshContext,
  onOpen,
}: {
  projectId: string;
  sessionId: string;
  queryGeneration?: number | null;
  onRefreshContext?: () => unknown;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const range = defaultProgressRange();
  const query = useQuery({
    queryKey: [
      "delivery-progress-summary",
      projectId,
      sessionId,
      queryGeneration,
      range.startsOn,
      range.endsOn,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryProgressSummary(projectId, range, signal, queryGeneration),
    enabled: queryGeneration != null,
    gcTime: 0,
    retry: false,
  });
  const data =
    !query.error &&
    query.data?.project_id === projectId &&
    query.data?.query_generation === queryGeneration
      ? query.data
      : undefined;
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
        <DeliveryQueryError
          error={query.error}
          onRetry={() => {
            void Promise.resolve(onRefreshContext?.()).then(() =>
              query.refetch(),
            );
          }}
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
