import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Select,
  Skeleton,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryWorkspace } from "@/lib/delivery";
import {
  fetchDeliveryQuality,
  fetchDeliveryReleases,
} from "@/lib/deliveryRelease";
import {
  parseReleaseRoute,
  releaseHash,
  releaseTargetHref,
  type ReleaseRoute,
} from "@/lib/deliveryReleaseRoute";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import {
  CiEvidenceFacts,
  QualityTaskFacts,
  ReleaseDigest,
  ReleaseReasons,
  releaseTime,
} from "./DeliveryReleaseFacts";
import { DeliveryReleaseEditor } from "./DeliveryReleaseEditor";
import { DeliveryReleaseEvidenceEditor } from "./DeliveryReleaseEvidenceEditor";
import { DeliveryReleaseDetail } from "./DeliveryReleaseDetail";
import "./delivery-release.css";

export function DeliveryReleaseWorkbench({
  view,
  workspace,
  sessionId,
  onSaved,
}: {
  view: "quality" | "releases";
  workspace: DeliveryWorkspace;
  sessionId: string;
  onSaved: (workspace: DeliveryWorkspace) => void;
}) {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const projectId = workspace.project.id;
  const qc = useQueryClient();
  const [route, setRoute] = useState(() => parseReleaseRoute(location.hash));
  const [editor, setEditor] = useState<"candidate" | "policy" | "ci" | null>(
    null,
  );
  useEffect(() => {
    const sync = () => setRoute(parseReleaseRoute(location.hash));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const selected = {
    requirement_ids: route.requirementIds,
    task_ids: route.taskIds,
  };
  const selectedCount =
    selected.requirement_ids.length + selected.task_ids.length;
  const catalogue = useQuery({
    queryKey: ["delivery-quality-catalogue", projectId, sessionId],
    queryFn: ({ signal }) => fetchDeliveryQuality(projectId, undefined, signal),
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
  });
  const selectedQuality = useQuery({
    queryKey: [
      "delivery-quality-scope",
      projectId,
      sessionId,
      ...selected.requirement_ids,
      "tasks",
      ...selected.task_ids,
    ],
    queryFn: ({ signal }) => fetchDeliveryQuality(projectId, selected, signal),
    enabled: selectedCount > 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
  });
  const indexQuery = useQuery({
    queryKey: ["delivery-release-index", projectId, sessionId],
    queryFn: ({ signal }) => fetchDeliveryReleases(projectId, signal),
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
  });
  const index = indexQuery.data,
    quality = catalogue.data,
    currentScope = selectedCount ? selectedQuality.data : catalogue.data;
  const readFailed =
    catalogue.isError ||
    indexQuery.isError ||
    (selectedCount > 0 && selectedQuality.isError);
  const archived = workspace.project.status === "archived";
  const writable = !readFailed && !archived;
  const backgroundParams = new URLSearchParams(location.hash.split("?")[1]);
  backgroundParams.set("project_id", projectId);
  const background = releaseHash(
    { ...route, view },
    `#/dev-flow?${backgroundParams}`,
  );
  const navigate = (patch: Partial<ReleaseRoute>, replace = false) => {
    const next = { ...route, view, ...patch };
    setRoute(next);
    history[replace ? "replaceState" : "pushState"](
      null,
      "",
      releaseHash(next, background),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const saved = (updated: DeliveryWorkspace) => {
    onSaved(updated);
    for (const key of [
      "delivery-quality-catalogue",
      "delivery-quality-scope",
      "delivery-release-index",
      "delivery-release-detail",
    ])
      void qc.invalidateQueries({ queryKey: [key, projectId, sessionId] });
  };
  const evidenceIdentity = useDrawerIdentity(
    `${projectId}:${sessionId}`,
    route.evidenceId,
  );
  const evidence = index?.evidence.find(
    (item) => item.id === evidenceIdentity.displayId,
  );
  const toggle = (
    kind: "requirement" | "task",
    id: string,
    checked: boolean,
  ) => {
    const key = kind === "requirement" ? "requirementIds" : "taskIds";
    navigate({
      [key]: checked
        ? [...route[key], id]
        : route[key].filter((value) => value !== id),
    });
  };
  const requirementRows =
    quality?.requirements.map((row) => ({
      kind: "requirement" as const,
      id: row.id,
      title: row.title,
      ready: row.accepted,
      attention:
        !row.accepted ||
        row.reasons.length > 0 ||
        row.issues.some(
          (issue) =>
            ["P0", "P1"].includes(issue.severity) &&
            !["resolved", "closed"].includes(issue.status),
        ),
      reasons: row.reasons,
      issueCount: row.issues.length,
      row,
    })) || [];
  const taskRows =
    quality?.independent_tasks.map((row) => ({
      kind: "task" as const,
      id: row.id,
      title: row.title,
      ready: row.verified,
      attention:
        !row.verified ||
        row.reasons.length > 0 ||
        row.issues.some(
          (issue) =>
            ["P0", "P1"].includes(issue.severity) &&
            !["resolved", "closed"].includes(issue.status),
        ),
      reasons: row.reasons,
      issueCount: row.issues.length,
      row,
    })) || [];
  const allRows = [...requirementRows, ...taskRows];
  const rows = allRows.filter(
    (row) =>
      (route.kind === "all" || row.kind === route.kind) &&
      (route.state === "all" ||
        (route.state === "ready" ? row.ready : row.attention)) &&
      (!route.query.trim() ||
        `${row.id} ${row.title}`
          .toLocaleLowerCase()
          .includes(route.query.trim().toLocaleLowerCase())),
  );
  if (catalogue.isPending || indexQuery.isPending)
    return <Skeleton active paragraph={{ rows: 9 }} />;
  return (
    <section className="delivery-release-workbench" aria-label={tr(view)}>
      <header className="delivery-release-header">
        <div>
          <h2>{tr(view)}</h2>
          <p>{tr("intro")}</p>
        </div>
        <div className="delivery-release-actions">
          <Button
            onClick={() => {
              void catalogue.refetch();
              void indexQuery.refetch();
              if (selectedCount) void selectedQuality.refetch();
            }}
            loading={
              catalogue.isFetching ||
              indexQuery.isFetching ||
              (selectedCount > 0 && selectedQuality.isFetching)
            }
          >
            {tr("refresh")}
          </Button>
          <Button
            onClick={() => setEditor("policy")}
            disabled={!writable || !index?.permissions.can_configure}
          >
            {tr("configure")}
          </Button>
          <Button
            onClick={() => setEditor("ci")}
            disabled={
              !writable ||
              !index?.permissions.can_import ||
              !currentScope?.scope_basis
            }
          >
            {tr("import")}
          </Button>
          <Button
            type="primary"
            onClick={() => setEditor("candidate")}
            disabled={
              !writable || !index?.permissions.can_create || !selectedCount
            }
          >
            {tr("create")}
          </Button>
        </div>
      </header>
      <Alert type="info" showIcon title={tr("approvalHint")} />
      {readFailed && (
        <Alert
          type="error"
          showIcon
          title={tr(quality && index ? "staleRead" : "readFailed")}
          description={String(
            catalogue.error || indexQuery.error || selectedQuality.error || "",
          )}
        />
      )}
      {archived && <Alert type="info" showIcon title={tr("archived")} />}
      {index &&
        !index.permissions.can_create &&
        !index.permissions.can_import &&
        !index.permissions.can_configure && (
          <p className="delivery-release-meta">{tr("restricted")}</p>
        )}
      <div
        className="delivery-release-metrics"
        role="group"
        aria-label={tr("quality")}
      >
        {[
          {
            key: "requirementsCount",
            count: requirementRows.length,
            kind: "requirement",
            state: "all",
          },
          {
            key: "tasksCount",
            count: taskRows.length,
            kind: "task",
            state: "all",
          },
          {
            key: "verifiedCount",
            count: allRows.filter((row) => row.ready).length,
            kind: "all",
            state: "ready",
          },
          {
            key: "attention",
            count: allRows.filter((row) => row.attention).length,
            kind: "all",
            state: "attention",
          },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() =>
              navigate({
                view: "quality",
                kind: item.kind as ReleaseRoute["kind"],
                state: item.state as ReleaseRoute["state"],
              })
            }
          >
            <strong>{item.count}</strong>
            <span>
              {item.key === "attention"
                ? tr("attention")
                : item.key === "tasksCount"
                  ? tr("task")
                  : t(`deliveryRelease.${item.key}`, { count: item.count })}
            </span>
          </button>
        ))}
      </div>
      <section className="delivery-release-selection" aria-label={tr("scope")}>
        <div className="delivery-release-inline">
          <strong>{tr("scope")}</strong>
          <span>
            {selectedCount
              ? t("deliveryRelease.scopeCount", {
                  requirements: route.requirementIds.length,
                  tasks: route.taskIds.length,
                })
              : tr("scopeEmpty")}
          </span>
          <Button
            size="small"
            disabled={!selectedCount}
            onClick={() => navigate({ requirementIds: [], taskIds: [] })}
          >
            {tr("clear")}
          </Button>
        </div>
        <p className="delivery-release-meta">{tr("scopeHint")}</p>
        {selectedCount > 0 && (
          <>
            <p className="delivery-release-id">
              {[...route.requirementIds, ...route.taskIds].join(" · ")}
            </p>
            <ReleaseDigest
              title={tr("scopeBasis")}
              value={currentScope?.scope_basis || null}
            />
            {currentScope && (
              <ReleaseReasons
                reasons={currentScope.reasons}
                background={background}
              />
            )}
          </>
        )}
      </section>
      {view === "quality" ? (
        <>
          <div className="delivery-release-toolbar">
            <Input
              aria-label={tr("query")}
              placeholder={tr("query")}
              allowClear
              value={route.query}
              onChange={(event) =>
                navigate({ query: event.target.value }, true)
              }
            />
            <Select
              aria-label={tr("source")}
              value={route.kind}
              onChange={(kind) => navigate({ kind })}
              options={["all", "requirement", "task"].map((value) => ({
                value,
                label: tr(value),
              }))}
            />
            <Select
              aria-label={tr("effective")}
              value={route.state}
              onChange={(state) => navigate({ state })}
              options={["all", "ready", "attention"].map((value) => ({
                value,
                label: tr(value),
              }))}
            />
          </div>
          {!rows.length ? (
            <Empty
              description={tr(allRows.length ? "emptyFilter" : "emptyQuality")}
            />
          ) : (
            <div className="delivery-release-quality-list">
              {rows.map((item) => (
                <article
                  className="delivery-release-quality-row"
                  key={`${item.kind}:${item.id}`}
                >
                  <div className="delivery-release-row-heading">
                    <Checkbox
                      checked={(item.kind === "requirement"
                        ? route.requirementIds
                        : route.taskIds
                      ).includes(item.id)}
                      aria-label={`${tr("scope")}: ${item.title} (${item.id})`}
                      onChange={(event) =>
                        toggle(item.kind, item.id, event.target.checked)
                      }
                    />
                    <div>
                      <strong>{item.title}</strong>
                      <div className="delivery-release-meta">
                        {tr(item.kind)} · {item.id}
                        {item.kind === "requirement" &&
                          ` · ${t("delivery.revision", { number: item.row.revision })}`}
                      </div>
                    </div>
                    <span className="delivery-release-inline">
                      <Tag color={item.ready ? "success" : "warning"}>
                        {tr(item.ready ? "ready" : "notVerified")}
                      </Tag>
                      {item.ready && item.attention && (
                        <Tag color="warning">{tr("attention")}</Tag>
                      )}
                    </span>
                    <Button
                      size="small"
                      href={releaseTargetHref(item.row.target, background)}
                    >
                      {tr("openEntity")}
                    </Button>
                  </div>
                  <ReleaseReasons
                    reasons={item.reasons}
                    background={background}
                  />
                  <details className="delivery-release-inline-details">
                    <summary>{tr("inspectQuality")}</summary>
                    {item.kind === "task" ? (
                      <QualityTaskFacts
                        task={item.row}
                        background={background}
                      />
                    ) : (
                      <>
                        <ol>
                          {item.row.acceptance_criteria.map((text, i) => (
                            <li key={i}>{text}</li>
                          ))}
                        </ol>
                        {item.row.task_ids
                          .map((id) =>
                            quality?.tasks.find((task) => task.id === id),
                          )
                          .filter((task) => Boolean(task))
                          .map(
                            (task) =>
                              task && (
                                <QualityTaskFacts
                                  key={task.id}
                                  task={task}
                                  background={background}
                                />
                              ),
                          )}
                      </>
                    )}
                  </details>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <section>
          <h3>{tr("releases")}</h3>
          {!index?.candidates.length ? (
            <Empty description={tr("emptyReleases")} />
          ) : (
            <div className="delivery-release-candidate-list">
              {index.candidates.map((item) => (
                <button
                  className="delivery-release-candidate-row"
                  key={item.id}
                  onClick={() => navigate({ releaseId: item.id })}
                >
                  <div className="delivery-release-inline">
                    <strong>{item.snapshot.version}</strong>
                    <Tag>{item.snapshot.environment}</Tag>
                    <Tag
                      color={
                        item.status === "approved"
                          ? "success"
                          : item.status === "stale"
                            ? "warning"
                            : "default"
                      }
                    >
                      {tr(item.status)}
                    </Tag>
                  </div>
                  <span className="delivery-release-meta">
                    {item.id} · {releaseTime(item.created_at, i18n.language)}
                  </span>
                  <span className="delivery-release-id">
                    {item.snapshot.ci.commit_sha}
                  </span>
                  <span className="delivery-release-meta">
                    {tr("notHandedOff")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="delivery-release-evidence-directory">
        <div className="delivery-release-inline">
          <h3>{tr("evidence")}</h3>
          {index?.policy ? (
            <Tag>
              {t("deliveryRelease.generation", {
                generation: index.policy.generation,
              })}
            </Tag>
          ) : (
            <Tag color="warning">{tr("trustMissing")}</Tag>
          )}
        </div>
        {index?.policy && (
          <p className="delivery-release-meta">
            {index.policy.repository} · {index.policy.workflow}
          </p>
        )}
        {!index?.evidence.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={tr("evidenceEmpty")}
          />
        ) : (
          <div className="delivery-release-evidence-list">
            {index.evidence.map((item) => (
              <button
                className="delivery-release-evidence-row"
                key={item.id}
                onClick={() => navigate({ evidenceId: item.id })}
              >
                <span className="delivery-release-inline">
                  <Tag color={item.passed ? "success" : "error"}>
                    {tr(item.passed ? "ready" : "blocked")}
                  </Tag>
                  <Tag>
                    {tr(
                      item.current ? "evidenceCurrent" : "evidenceHistorical",
                    )}
                  </Tag>
                </span>
                <strong>{item.statement.subject[0]?.name || item.id}</strong>
                <span className="delivery-release-meta">
                  {t("deliveryRelease.runNumber", {
                    number: item.statement.predicate.run_number,
                    attempt: item.statement.predicate.run_attempt,
                  })}
                </span>
                <span className="delivery-release-id">
                  {item.statement.predicate.commit_sha}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      {index && index.legacy_history.length > 0 && (
        <details className="delivery-release-captured">
          <summary>
            {tr("historicalManual")} · {index.legacy_history.length}
          </summary>
          <p>{tr("historicalHint")}</p>
          {index.legacy_history.map((item, i) => (
            <article
              className="delivery-release-review-record"
              key={`${item.requirement_id}:${i}`}
            >
              <strong>{item.requirement_title || item.requirement_id}</strong>
              <p>
                {String(item.record.version || "—")} ·{" "}
                {String(item.record.environment || "—")}
              </p>
              <p className="delivery-release-content">
                {String(item.record.verification || "")}
              </p>
            </article>
          ))}
        </details>
      )}
      <p className="delivery-release-meta">
        {tr("observed")}:{" "}
        {releaseTime(quality?.as_of || index?.as_of || null, i18n.language)}
      </p>
      <DeliveryReleaseDetail
        releaseId={route.releaseId}
        projectId={projectId}
        sessionId={sessionId}
        background={background}
        onSaved={saved}
        onClose={() => navigate({ releaseId: "" })}
      />
      <Drawer
        open={Boolean(route.evidenceId)}
        title={tr("evidence")}
        width="min(780px, 100vw)"
        rootClassName="delivery-release-drawer"
        onClose={() => navigate({ evidenceId: "" })}
        afterOpenChange={evidenceIdentity.afterOpenChange}
      >
        {evidenceIdentity.displayId &&
          (evidence ? (
            <CiEvidenceFacts evidence={evidence} />
          ) : (
            <Empty description={tr("evidenceMissing")} />
          ))}
      </Drawer>
      {editor === "candidate" && index && (
        <DeliveryReleaseEditor
          key={`${projectId}:candidate`}
          projectId={projectId}
          initial={index}
          selected={selected}
          readOnly={!writable}
          onSaved={saved}
          onClose={() => setEditor(null)}
        />
      )}
      {(editor === "policy" || editor === "ci") && index && (
        <DeliveryReleaseEvidenceEditor
          key={`${projectId}:${editor}`}
          projectId={projectId}
          initial={index}
          quality={currentScope}
          mode={editor}
          readOnly={!writable}
          onSaved={saved}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
