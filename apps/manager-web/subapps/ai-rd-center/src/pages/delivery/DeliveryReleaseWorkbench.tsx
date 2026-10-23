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
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryContext, DeliveryCommandAck } from "@/lib/delivery";
import {
  fetchDeliveryQuality,
  fetchDeliveryReleases,
  fetchQualityCatalogue,
  fetchReleasePage,
  fetchReleaseEvidence,
  releaseProblem,
  type ReleasePageKind,
} from "@/lib/deliveryRelease";
import {
  parseReleaseRoute,
  releaseHash,
  releaseTargetHref,
  type ReleaseRoute,
} from "@/lib/deliveryReleaseRoute";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";
import {
  releaseRecoverySlots,
  useReleaseCommand,
} from "@/lib/deliveryReleaseCommand";
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
import { DeliveryReleaseSourceEditor } from "./DeliveryReleaseSourceEditor";
import type { DeliveryQuality, ReleasePolicy } from "@/lib/deliveryRelease";
import { DeliveryDeploymentWorkbench } from "./DeliveryDeploymentWorkbench";
import "./delivery-release.css";

const hash = () => (typeof location === "undefined" ? "" : location.hash);
export function DeliveryReleaseWorkbench({
  view,
  workspace,
  sessionId,
  onSaved,
  onUnresolvedChange,
}: {
  view: "quality" | "releases";
  workspace: DeliveryContext;
  sessionId: string;
  onSaved: (ack: DeliveryCommandAck) => void;
  onUnresolvedChange?: (id: string, pending: boolean) => void;
}) {
  const { t, i18n } = useTranslation(),
    tr = (key: string) => t(`deliveryRelease.${key}`);
  const projectId = workspace.project.id,
    generation = workspace.query_generation,
    qc = useQueryClient(),
    exit = useExecutionExitGuard();
  const [route, setRoute] = useState(() => parseReleaseRoute(hash()));
  const [recoveries, setRecoveries] = useState(() =>
    releaseRecoverySlots(projectId, route.releaseId),
  );
  const [editor, setEditor] = useState<"candidate" | "policy" | "ci" | null>(
    null,
  );
  const [sourceEditor, setSourceEditor] = useState<{ scope: string; quality: DeliveryQuality; policy: ReleasePolicy } | null>(null);
  const sourceExit = useRef<{ scope: string; check: () => boolean } | null>(null);
  const [deploymentPreparation, setDeploymentPreparation] = useState<{
    candidateId: string;
    rollbackOf: string;
  } | null>(null);
  useEffect(() => {
    const read = () => setRoute(parseReleaseRoute(hash()));
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);
  const selected = {
      requirement_ids: route.requirementIds,
      task_ids: route.taskIds,
    },
    selectedCount = selected.requirement_ids.length + selected.task_ids.length;
  const context = useQuery({
    queryKey: ["delivery-release-context", projectId, sessionId, generation],
    queryFn: ({ signal }) =>
      fetchDeliveryReleases(projectId, signal, generation),
    retry: false,
    gcTime: 0,
  });
  const catalogue = useQuery({
    queryKey: [
      "delivery-quality-catalogue",
      projectId,
      sessionId,
      generation,
      route.kind,
      route.state,
      route.query,
      route.qualityCursor,
    ],
    queryFn: ({ signal }) =>
      fetchQualityCatalogue(
        projectId,
        {
          kind: route.kind,
          readiness: route.state,
          q: route.query,
          cursor: route.qualityCursor,
        },
        signal,
        generation,
      ),
    enabled: view === "quality",
    retry: false,
    gcTime: 0,
  });
  const scopeEnabled = selectedCount > 0;
  const selectedQuality = useQuery({
    queryKey: [
      "delivery-quality-scope",
      projectId,
      sessionId,
      generation,
      selected,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryQuality(projectId, selected, signal, generation),
    enabled: scopeEnabled,
    retry: false,
    gcTime: 0,
  });
  const directory = route.directory,
    cursorKey =
      directory === "candidate"
        ? "releaseCursor"
        : directory === "evidence"
          ? "evidenceCursor"
          : "legacyCursor",
    queryKey =
      directory === "candidate"
        ? "releaseQuery"
        : directory === "evidence"
          ? "evidenceQuery"
          : "legacyQuery";
  const pages = useQuery({
    queryKey: [
      "delivery-release-page",
      projectId,
      sessionId,
      generation,
      directory,
      route[queryKey],
      route[cursorKey],
    ],
    queryFn: ({ signal }) =>
      fetchReleasePage(
        projectId,
        directory,
        { q: route[queryKey], cursor: route[cursorKey] },
        signal,
        generation,
      ),
    enabled: view === "releases",
    retry: false,
    gcTime: 0,
  });
  const active = view === "quality" ? catalogue : pages;
  const readError =
    context.error ||
    active.error ||
    (scopeEnabled ? selectedQuality.error : null);
  const mixed =
    Boolean(
      context.data &&
      (context.data.version !== workspace.version ||
        context.data.query_generation !== generation),
    ) ||
    Boolean(
      active.data &&
      context.data &&
      (active.data.version !== context.data.version ||
        active.data.query_generation !== context.data.query_generation),
    ) ||
    Boolean(
      scopeEnabled &&
      selectedQuality.data &&
      context.data &&
      (selectedQuality.data.version !== context.data.version ||
        selectedQuality.data.query_generation !==
          context.data.query_generation),
    );
  const writable =
    !readError &&
    !mixed &&
    !exit.pending &&
    workspace.project.status !== "archived" &&
    context.isSuccess &&
    active.isSuccess;
  const params = new URLSearchParams(hash().split("?")[1]);
  params.set("project_id", projectId);
  const background = releaseHash({ ...route, view }, `#/dev-flow?${params}`);
  const canNavigate = () => {
    if (sourceExit.current?.scope === `${projectId}:${sessionId}` && !sourceExit.current.check()) return false;
    return exit.canNavigate();
  };
  const navigate = (patch: Partial<ReleaseRoute>, replace = false) => {
    if (!canNavigate()) return;
    const next = { ...route, view, ...patch };
    if (
      patch.kind !== undefined ||
      patch.state !== undefined ||
      patch.query !== undefined
    )
      next.qualityCursor = "";
    if (patch.releaseQuery !== undefined) next.releaseCursor = "";
    if (patch.evidenceQuery !== undefined) next.evidenceCursor = "";
    if (patch.legacyQuery !== undefined) next.legacyCursor = "";
    setRoute(next);
    history[replace ? "replaceState" : "pushState"](
      null,
      "",
      releaseHash(next, background),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const refresh = async () => {
    if (!canNavigate()) return;
    navigate(view === "quality" ? { qualityCursor: "" } : { [cursorKey]: "" });
    await qc.invalidateQueries({
      queryKey: ["delivery-context", projectId, sessionId],
      exact: true,
    });
    await qc.invalidateQueries({
      queryKey: ["delivery-release-context", projectId, sessionId],
    });
    await qc.invalidateQueries({
      queryKey: [
        view === "quality"
          ? "delivery-quality-catalogue"
          : "delivery-release-page",
        projectId,
        sessionId,
      ],
    });
    if (scopeEnabled)
      void qc.invalidateQueries({
        queryKey: ["delivery-quality-scope", projectId, sessionId],
      });
  };
  const saved = (ack: DeliveryCommandAck) => {
    onSaved(ack);
    for (const key of [
      "delivery-release-context",
      "delivery-release-page",
      "delivery-release-evidence",
      "delivery-quality-catalogue",
      "delivery-quality-scope",
      "delivery-release-detail",
    ])
      void qc.invalidateQueries({ queryKey: [key, projectId, sessionId] });
  };
  const pending = (id: string, value: boolean) => {
    exit.setPending(id, value);
    onUnresolvedChange?.(id, value);
  };
  const toggle = (
    kind: "requirement" | "task",
    id: string,
    checked: boolean,
  ) => {
    const field = kind === "requirement" ? "requirementIds" : "taskIds";
    if (checked && route[field].length >= 200) return;
    navigate({
      [field]: checked
        ? [...new Set([...route[field], id])]
        : route[field].filter((value) => value !== id),
    });
  };
  const detailIdentity = useDrawerIdentity(
      `${projectId}:${sessionId}`,
      route.qualityId,
    ),
    evidenceIdentity = useDrawerIdentity(
      `${projectId}:${sessionId}`,
      route.evidenceId,
    );
  return (
    <section className="delivery-release-workbench" aria-label={tr(view)}>
      <header className="delivery-release-header">
        <div>
          <h2>{tr(view)}</h2>
          <p>{tr("boundedIntro")}</p>
        </div>
        <div className="delivery-release-actions">
          <Button
            onClick={refresh}
            disabled={exit.pending}
            loading={context.isFetching || active.isFetching}
          >
            {tr("refresh")}
          </Button>
          <Button
            disabled={!writable || !context.data?.permissions.can_configure}
            onClick={() => setEditor("policy")}
          >
            {tr("configure")}
          </Button>
          <Button
            disabled={
              !writable ||
              !context.data?.permissions.can_import ||
              !selectedCount
            }
            onClick={() => setEditor("ci")}
          >
            {tr("import")}
          </Button>
          <Button
            type="primary"
            disabled={
              !writable ||
              !context.data?.permissions.can_create ||
              !selectedCount
            }
            onClick={() => setEditor("candidate")}
          >
            {tr("create")}
          </Button>
        </div>
      </header>
      <Alert type="info" showIcon title={tr("approvalHint")} />
      {recoveries.map((identity) => (
        <ReleaseRecovery
          key={identity}
          projectId={projectId}
          identity={identity}
          onPending={(value) => pending("recovery:" + identity, value)}
          onResolved={(ack) => {
            saved(ack);
            setRecoveries((items) => items.filter((item) => item !== identity));
          }}
        />
      ))}
      {exit.blocked && <Alert type="warning" title={tr("unknownRequest")} />}
      {workspace.project.status === "archived" && (
        <Alert type="info" title={tr("archived")} />
      )}
      {(readError || mixed) && (
        <Alert
          type="error"
          showIcon
          title={tr(
            mixed
              ? "generationChanged"
              : releaseProblem(readError).forbidden
                ? "forbiddenRead"
                : "staleRead",
          )}
          description={readError ? String(readError) : tr("refreshContext")}
          action={
            <Button
              disabled={exit.pending}
              onClick={() => {
                navigate(
                  view === "quality"
                    ? { qualityCursor: "" }
                    : { [cursorKey]: "" },
                );
                refresh();
              }}
            >
              {tr("firstPage")}
            </Button>
          }
        />
      )}
      {context.isPending || active.isPending ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : null}
      {view === "quality" && catalogue.data && (
        <div
          className="delivery-release-metrics"
          role="group"
          aria-label={tr("projectTotals")}
        >
          {[
            {
              label: "requirement",
              count: catalogue.data.totals.requirements,
              kind: "requirement",
            },
            {
              label: "task",
              count: catalogue.data.totals.independent_tasks,
              kind: "task",
            },
          ].map((item) => (
            <button
              key={item.kind}
              onClick={() =>
                navigate({
                  kind: item.kind as "requirement" | "task",
                  state: "all",
                })
              }
            >
              <strong>{item.count}</strong>
              <span>{tr(item.label)}</span>
            </button>
          ))}
        </div>
      )}
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
            disabled={!selectedCount || exit.pending}
            onClick={() => navigate({ requirementIds: [], taskIds: [] })}
          >
            {tr("clear")}
          </Button>
        </div>
        <p className="delivery-release-meta">{tr("crossPageSelection")}</p>
        {selectedCount > 0 && (
          <>
            <ol className="delivery-release-preparation" aria-label={tr("sourcePreparationSteps")}>
              <li><strong>1 · {tr("sourceAcceptanceStep")}</strong><span>{tr(selectedQuality.data?.eligible ? "ready" : "notVerified")}</span></li>
              <li><strong>2 · {tr("sourceAssociationStep")}</strong><Button size="small"
                disabled={!writable || !context.data?.permissions.can_import || !context.data.policy || !selectedQuality.data?.eligible}
                onClick={() => {
                  if (context.data?.policy && selectedQuality.data?.eligible) setSourceEditor({
                    scope: `${projectId}:${sessionId}`, policy: structuredClone(context.data.policy), quality: structuredClone(selectedQuality.data) });
                }}>{tr("sourcePrepare")}</Button></li>
              <li><strong>3 · {tr("sourceCiStep")}</strong><span>{tr("sourceCiStepHint")}</span></li>
              <li><strong>4 · {tr("sourceApprovalStep")}</strong><span>{tr("sourceApprovalStepHint")}</span></li>
            </ol>
            <div className="delivery-release-selected">
              {route.requirementIds.map((id) => (
                <Tag
                  key={"r:" + id}
                  closable={!exit.pending}
                  onClose={() => toggle("requirement", id, false)}
                >
                  {id}
                </Tag>
              ))}
              {route.taskIds.map((id) => (
                <Tag
                  key={"t:" + id}
                  closable={!exit.pending}
                  onClose={() => toggle("task", id, false)}
                >
                  {id}
                </Tag>
              ))}
            </div>
            <ReleaseDigest
              title={tr("scopeBasis")}
              value={selectedQuality.data?.scope_basis || null}
            />
            {selectedQuality.data && (
              <ReleaseReasons
                reasons={selectedQuality.data.reasons}
                background={background}
              />
            )}
          </>
        )}
      </section>
      {view === "quality" ? (
        <>
          <div className="delivery-release-toolbar">
            <ReleaseSearch
              key={route.query}
              value={route.query}
              label={tr("query")}
              onApply={(query) => navigate({ query })}
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
          <div className="delivery-release-quality-list">
            {catalogue.data?.items.map((item) => (
              <article
                className="delivery-release-quality-row"
                key={item.kind + ":" + item.id}
              >
                <div className="delivery-release-row-heading">
                  <Checkbox
                    checked={(item.kind === "requirement"
                      ? route.requirementIds
                      : route.taskIds
                    ).includes(item.id)}
                    disabled={exit.pending}
                    aria-label={`${tr("scope")}: ${item.title} (${item.id})`}
                    onChange={(event) =>
                      toggle(item.kind, item.id, event.target.checked)
                    }
                  />
                  <div>
                    <strong>{item.title}</strong>
                    <p className="delivery-release-meta">
                      {tr(item.kind)} · {item.id} · {tr("issues")}:{" "}
                      {item.issue_count}
                    </p>
                  </div>
                  <span>
                    <Tag color={item.ready ? "success" : "warning"}>
                      {tr(item.ready ? "ready" : "notVerified")}
                    </Tag>
                    {item.attention && (
                      <Tag color="warning">{tr("attention")}</Tag>
                    )}
                  </span>
                  <Button
                    onClick={() =>
                      navigate({ qualityId: item.id, qualityKind: item.kind })
                    }
                  >
                    {tr("inspectQuality")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {catalogue.isSuccess && !catalogue.data.items.length && (
            <Empty
              description={tr(
                catalogue.data.total ? "emptyFilter" : "emptyQuality",
              )}
            />
          )}
        </>
      ) : (
        <>
          <div className="delivery-release-directory-tabs">
            {(["candidate", "evidence", "legacy"] as ReleasePageKind[]).map(
              (kind) => (
                <Button
                  key={kind}
                  aria-pressed={directory === kind}
                  onClick={() => navigate({ directory: kind })}
                >
                  {tr(
                    kind === "candidate"
                      ? "releases"
                      : kind === "evidence"
                        ? "evidence"
                        : "historicalManual",
                  )}{" "}
                  · {context.data?.totals[kind] ?? "—"}
                </Button>
              ),
            )}
          </div>
          <ReleaseSearch
            key={directory + route[queryKey]}
            value={route[queryKey]}
            label={tr("query")}
            onApply={(query) => navigate({ [queryKey]: query })}
          />
          <p className="delivery-release-meta">{tr("directoryValidityHint")}</p>
          <div className="delivery-release-candidate-list">
            {pages.data?.items.map((item) => (
              <article className="delivery-release-candidate-row" key={item.id}>
                <div className="delivery-release-inline">
                  <strong>{item.title}</strong>
                  {item.environment && <Tag>{item.environment}</Tag>}
                  <Tag>
                    {tr(
                      item.status === "passed"
                        ? "recordedPassed"
                        : item.status === "failed"
                          ? "recordedFailed"
                          : item.status === "manual_history"
                            ? "historicalManual"
                            : item.status,
                    )}
                  </Tag>
                </div>
                <p className="delivery-release-meta">
                  {item.id} · {releaseTime(item.at, i18n.language)}
                </p>
                {item.commit_sha && (
                  <code className="delivery-release-id">{item.commit_sha}</code>
                )}
                {item.summary && <p>{item.summary}</p>}
                {item.kind !== "legacy" && (
                  <Button
                    onClick={() =>
                      navigate(
                        item.kind === "candidate"
                          ? { releaseId: item.id }
                          : { evidenceId: item.id },
                      )
                    }
                  >
                    {tr("inspect")}
                  </Button>
                )}
              </article>
            ))}
          </div>
          {pages.isSuccess && !pages.data.items.length && (
            <Empty description={tr("emptyFilter")} />
          )}
          {directory === "legacy" && (
            <Alert type="info" title={tr("historicalHint")} />
          )}
        </>
      )}
      {active.data && (
        <div className="delivery-release-pager">
          <span>
            {t("deliveryRelease.pageCoverage", {
              loaded: active.data.items.length,
              total: active.data.total,
            })}
          </span>
          <Button
            disabled={
              !(view === "quality" ? route.qualityCursor : route[cursorKey]) ||
              exit.pending
            }
            onClick={() =>
              navigate(
                view === "quality"
                  ? { qualityCursor: "" }
                  : { [cursorKey]: "" },
              )
            }
          >
            {tr("firstPage")}
          </Button>
          <Button
            disabled={!active.data.next_cursor || exit.pending}
            onClick={() =>
              navigate(
                view === "quality"
                  ? { qualityCursor: active.data!.next_cursor! }
                  : { [cursorKey]: active.data!.next_cursor! },
              )
            }
          >
            {tr("nextPage")}
          </Button>
        </div>
      )}
      <p className="delivery-release-meta">
        {tr("observed")}:{" "}
        {releaseTime(
          active.data?.as_of || context.data?.as_of || null,
          i18n.language,
        )}{" "}
        · {tr("projectTotals")}
      </p>
      <Drawer
        open={Boolean(route.qualityId)}
        title={tr("inspectQuality")}
        size="min(900px, 100vw)"
        rootClassName="delivery-release-drawer"
        onClose={() => navigate({ qualityId: "" })}
        afterOpenChange={detailIdentity.afterOpenChange}
      >
        {detailIdentity.displayId && (
          <QualityDetail
            key={projectId + sessionId + detailIdentity.displayId}
            id={detailIdentity.displayId}
            kind={route.qualityKind}
            projectId={projectId}
            sessionId={sessionId}
            generation={generation}
            background={background}
          />
        )}
      </Drawer>
      <Drawer
        open={Boolean(route.evidenceId)}
        title={tr("evidence")}
        size="min(780px, 100vw)"
        rootClassName="delivery-release-drawer"
        onClose={() => navigate({ evidenceId: "" })}
        afterOpenChange={evidenceIdentity.afterOpenChange}
      >
        {evidenceIdentity.displayId && (
          <EvidenceDetail
            key={projectId + sessionId + evidenceIdentity.displayId}
            id={evidenceIdentity.displayId}
            projectId={projectId}
            sessionId={sessionId}
            generation={generation}
          />
        )}
      </Drawer>
      <DeliveryReleaseDetail
        releaseId={
          route.deploymentId ||
          deploymentPreparation ||
          recoveries.includes("review:" + route.releaseId)
            ? ""
            : route.releaseId
        }
        projectId={projectId}
        sessionId={sessionId}
        generation={generation}
        background={background}
        onSaved={saved}
        onPending={(value) => pending("review", value)}
        onClose={() => navigate({ releaseId: "" })}
        onPrepareDeployment={(candidateId) =>
          setDeploymentPreparation({ candidateId, rollbackOf: "" })
        }
        onOpenDeployment={(deploymentId) => navigate({ deploymentId })}
      />
      {view === "releases" && (
        <DeliveryDeploymentWorkbench
          projectId={projectId}
          sessionId={sessionId}
          releaseId={route.releaseId}
          deploymentId={route.deploymentId}
          preparation={deploymentPreparation}
          background={background}
          readOnly={!writable}
          onSaved={saved}
          onClosePreparation={() => setDeploymentPreparation(null)}
          onRollback={(id) =>
            setDeploymentPreparation({ candidateId: "", rollbackOf: id })
          }
          onOpenDeployment={(deploymentId, releaseId) =>
            navigate({ deploymentId, releaseId })
          }
          onCloseDeployment={() => navigate({ deploymentId: "" })}
        />
      )}
      {editor === "candidate" && context.data && (
        <DeliveryReleaseEditor
          key={projectId + sessionId + ":candidate"}
          projectId={projectId}
          initial={context.data}
          selected={selected}
          readOnly={!writable}
          onPending={(value) => pending("candidate", value)}
          onSaved={saved}
          onClose={() => {
            if (exit.canNavigate()) setEditor(null);
          }}
        />
      )}
      {sourceEditor?.scope === `${projectId}:${sessionId}` && <DeliveryReleaseSourceEditor key={projectId + sessionId + ":sources"}
        projectId={projectId} quality={sourceEditor.quality} policy={sourceEditor.policy}
        onExitGuard={(check) => {
          if (check) sourceExit.current = { scope: sourceEditor.scope, check };
          else if (sourceExit.current?.scope === sourceEditor.scope) sourceExit.current = null;
        }}
        readOnly={!writable || !context.data?.permissions.can_import} onClose={() => setSourceEditor(null)} />}
      {(editor === "policy" || (editor === "ci" && selectedQuality.data)) &&
        context.data && (
          <DeliveryReleaseEvidenceEditor
            key={projectId + sessionId + editor}
            projectId={projectId}
            initial={context.data}
            quality={selectedQuality.data}
            mode={editor}
            readOnly={!writable}
            onPending={(value) => pending("evidence", value)}
            onSaved={saved}
            onClose={() => {
              if (exit.canNavigate()) setEditor(null);
            }}
          />
        )}
      {editor === "ci" && !selectedQuality.data && (
        <Drawer open title={tr("import")} onClose={() => setEditor(null)}>
          {selectedQuality.error ? (
            <Alert
              type="warning"
              title={tr("readFailed")}
              description={String(selectedQuality.error)}
            />
          ) : (
            <Skeleton active />
          )}
        </Drawer>
      )}
    </section>
  );
}
function ReleaseRecovery({
  projectId,
  identity,
  onPending,
  onResolved,
}: {
  projectId: string;
  identity: string;
  onPending: (pending: boolean) => void;
  onResolved: (ack: DeliveryCommandAck) => void;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryRelease.${key}`),
    command = useReleaseCommand(projectId, identity, onPending);
  return (
    <section className="delivery-release-selection">
      <Alert
        type="warning"
        title={tr("unknownRequest")}
        description={
          command.state.error
            ? t(`deliveryRelease.${command.state.error}`, {
                defaultValue: command.state.error,
              })
            : identity
        }
      />
      {command.state.original && (
        <pre className="delivery-release-raw">
          {JSON.stringify(command.state.original, null, 2)}
        </pre>
      )}
      <Button
        type="primary"
        disabled={command.state.phase !== "unknown" || !command.state.original}
        onClick={async () => {
          const ack = await command.replay();
          if (ack) {
            command.reset();
            onResolved(ack);
          }
        }}
      >
        {tr("replayOriginal")}
      </Button>
    </section>
  );
}
function ReleaseSearch({
  value,
  label,
  onApply,
}: {
  value: string;
  label: string;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <Input.Search
      aria-label={label}
      placeholder={label}
      value={draft}
      maxLength={200}
      allowClear
      onChange={(event) => setDraft(event.target.value)}
      onSearch={() => onApply(draft.trim())}
    />
  );
}
export function QualityDetail({
  projectId,
  sessionId,
  generation,
  id,
  kind,
  background,
}: {
  projectId: string;
  sessionId: string;
  generation: number | null;
  id: string;
  kind: "requirement" | "task";
  background: string;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryRelease.${key}`);
  const query = useQuery({
    queryKey: [
      "delivery-quality-detail",
      projectId,
      sessionId,
      generation,
      kind,
      id,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryQuality(
        projectId,
        {
          requirement_ids: kind === "requirement" ? [id] : [],
          task_ids: kind === "task" ? [id] : [],
        },
        signal,
        generation,
      ),
    retry: false,
    gcTime: 0,
  });
  if (query.isPending) return <Skeleton active />;
  if (query.error || !query.data)
    return (
      <Alert
        type="warning"
        title={tr(
          releaseProblem(query.error).forbidden
            ? "forbiddenRead"
            : "readFailed",
        )}
        description={String(query.error)}
        action={
          <Button onClick={() => void query.refetch()}>{tr("retry")}</Button>
        }
      />
    );
  const req = query.data.requirements.find((row) => row.id === id),
    task =
      query.data.tasks.find((row) => row.id === id) ||
      query.data.independent_tasks.find((row) => row.id === id);
  if ((kind === "requirement" && !req) || (kind === "task" && !task))
    return <Empty description={tr("qualityMissing")} />;
  return (
    <div className="delivery-release-detail">
      <ReleaseReasons reasons={query.data.reasons} background={background} />
      {req && (
        <>
          <h3>{req.title}</h3>
          <ol>
            {req.acceptance_criteria.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ol>
          <Button href={releaseTargetHref(req.target, background)}>
            {tr("openEntity")}
          </Button>
        </>
      )}
      {(kind === "task" ? [task!] : query.data.tasks).map((row) => (
        <QualityTaskFacts key={row.id} task={row} background={background} />
      ))}
    </div>
  );
}
export function EvidenceDetail({
  projectId,
  sessionId,
  generation,
  id,
}: {
  projectId: string;
  sessionId: string;
  generation: number | null;
  id: string;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryRelease.${key}`);
  const query = useQuery({
    queryKey: [
      "delivery-release-evidence",
      projectId,
      sessionId,
      generation,
      id,
    ],
    queryFn: ({ signal }) =>
      fetchReleaseEvidence(projectId, id, signal, generation),
    retry: false,
    gcTime: 0,
  });
  if (query.isPending) return <Skeleton active />;
  if (query.error || !query.data)
    return (
      <Alert
        type="warning"
        title={tr(
          releaseProblem(query.error).missing
            ? "evidenceMissing"
            : releaseProblem(query.error).forbidden
              ? "forbiddenRead"
              : "readFailed",
        )}
        description={String(query.error)}
        action={
          <Button onClick={() => void query.refetch()}>{tr("retry")}</Button>
        }
      />
    );
  return (
    <>
      <CiEvidenceFacts evidence={query.data.evidence} />
      <details>
        <summary>{tr("envelope")}</summary>
        <pre className="delivery-release-raw">{query.data.envelope}</pre>
      </details>
    </>
  );
}
