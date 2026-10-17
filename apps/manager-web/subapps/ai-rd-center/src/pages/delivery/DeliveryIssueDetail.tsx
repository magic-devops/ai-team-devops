import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Skeleton, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryWorkspace } from "@/lib/delivery";
import {
  fetchDeliveryIssue,
  fetchIssueDiagnosis,
  fetchIssueDiagnosisHistory,
  issueEvidenceHref,
  issueProblem,
  type DiagnosisView,
} from "@/lib/deliveryIssue";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { IssueDiagnosisPanel } from "./DeliveryIssueDiagnosis";
import { IssueReviewPanel } from "./DeliveryIssueReview";
import {
  IssueEvidenceList,
  IssueProposalFacts,
  IssueReasons,
  IssueTime,
} from "./DeliveryIssueFacts";

type DetailProps = {
  projectId: string;
  sessionId: string;
  issueId: string;
  workspaceVersion?: number;
  background: string;
  readOnly: boolean;
  onSaved: (workspace: DeliveryWorkspace) => void;
  onBusyChange?: (busy: boolean) => void;
  onUnresolvedChange?: (unresolved: boolean) => void;
};
export function DeliveryIssueDetail(
  props: DetailProps & { onClose: () => void },
) {
  const { t } = useTranslation();
  const identity = useDrawerIdentity(
    `${props.projectId}:${props.sessionId}`,
    props.issueId,
  );
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const blocked = busy || unknown;
  return (
    <Drawer
      open={Boolean(props.issueId)}
      title={t("deliveryIssue.detailTitle")}
      width={760}
      className="delivery-inspector issue-inspector"
      destroyOnHidden
      onClose={() => !blocked && props.onClose()}
      maskClosable={!blocked}
      keyboard={!blocked}
      afterOpenChange={identity.afterOpenChange}
    >
      {identity.displayId && (
        <IssueDetailContent
          key={`${props.projectId}:${props.sessionId}:${identity.displayId}`}
          {...props}
          issueId={identity.displayId}
          onBusyChange={setBusy}
          onUnresolvedChange={setUnknown}
        />
      )}
    </Drawer>
  );
}
export function IssueDetailContent({
  projectId,
  sessionId,
  issueId,
  workspaceVersion,
  initialDiagnosisId = "",
  background,
  readOnly,
  onSaved,
  onBusyChange,
  onUnresolvedChange,
}: DetailProps & { initialDiagnosisId?: string }) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryIssue.${key}`),
    qc = useQueryClient();
  const routeDiagnosis = () => {
    const params = new URLSearchParams(location.hash.split("?")[1]);
    return params.get("issue") === issueId &&
      (!params.get("project_id") || params.get("project_id") === projectId)
      ? params.get("diagnosis_id") || ""
      : "";
  };
  const [selectedId, setSelectedId] = useState(
    () => initialDiagnosisId || routeDiagnosis(),
  );
  const [mode, setMode] = useState<"facts" | "generate" | "proposal">(() =>
    initialDiagnosisId || routeDiagnosis() ? "proposal" : "facts",
  );
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [older, setOlder] = useState<DiagnosisView[]>([]),
    [nextCursor, setNextCursor] = useState<string | null | undefined>(
      undefined,
    );
  const [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState("");
  const [received, setReceived] = useState<DiagnosisView | null>(null);
  const origin = useRef(projectSessionKey()),
    reading = useRef(false);
  const query = useQuery({
    queryKey: ["delivery-issue-detail", projectId, sessionId, issueId],
    queryFn: ({ signal }) => fetchDeliveryIssue(projectId, issueId, signal),
    enabled: Boolean(issueId),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data =
    query.data?.project_id === projectId && query.data.issue.id === issueId
      ? query.data
      : undefined;
  const exactQuery = useQuery({
    queryKey: [
      "delivery-issue-diagnosis",
      projectId,
      sessionId,
      issueId,
      selectedId,
    ],
    queryFn: ({ signal }) =>
      fetchIssueDiagnosis(projectId, issueId, selectedId, signal),
    enabled: Boolean(selectedId),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const exact =
    exactQuery.data?.issue_id === issueId && exactQuery.data.id === selectedId
      ? exactQuery.data
      : undefined;
  useEffect(() => {
    const sync = () => {
      const id = routeDiagnosis();
      setSelectedId(id);
      if (id) setMode("proposal");
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [projectId, issueId]);
  const blocked = busy || unknown;
  const setChildBusy = (value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  };
  const setChildUnknown = (value: boolean) => {
    setUnknown(value);
    onUnresolvedChange?.(value);
  };
  const choose = (id: string) => {
    if (blocked) return;
    setSelectedId(id);
    setMode("proposal");
    const params = new URLSearchParams(location.hash.split("?")[1]);
    params.set("view", "issues");
    params.set("issue", issueId);
    params.set("project_id", projectId);
    params.set("diagnosis_id", id);
    history.replaceState(null, "", `#/dev-flow?${params}`);
  };
  const proposalHistory = [
    ...new Map(
      [...(data?.diagnoses || []), ...older].map((item) => [item.id, item]),
    ).values(),
  ];
  const selected = selectedId
    ? exact ||
      (received?.id === selectedId
        ? received
        : proposalHistory.find((item) => item.id === selectedId))
    : undefined;
  const cursor = nextCursor === undefined ? data?.next_cursor : nextCursor;
  async function loadHistory() {
    if (
      !cursor ||
      reading.current ||
      blocked ||
      origin.current !== projectSessionKey()
    )
      return;
    reading.current = true;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const page = await fetchIssueDiagnosisHistory(projectId, issueId, cursor);
      if (origin.current !== projectSessionKey()) return;
      if (page.project_id !== projectId || page.issue_id !== issueId)
        throw new Error("scopeChanged");
      if (page.next_cursor === cursor) throw new Error("historyUnavailable");
      setOlder((current) => [
        ...new Map(
          [...current, ...page.items].map((item) => [item.id, item]),
        ).values(),
      ]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      if (origin.current === projectSessionKey())
        setHistoryError(issueProblem(cause).message);
    } finally {
      reading.current = false;
      if (origin.current === projectSessionKey()) setHistoryBusy(false);
    }
  }
  const saved = (workspace: DeliveryWorkspace) => {
    if (
      origin.current !== projectSessionKey() ||
      workspace.project.id !== projectId
    )
      return;
    onSaved(workspace);
    void qc.invalidateQueries({
      queryKey: ["delivery-issue-detail", projectId, sessionId, issueId],
    });
    void qc.invalidateQueries({
      queryKey: ["delivery-issue-diagnosis", projectId, sessionId, issueId],
    });
    void query.refetch();
  };
  const refresh = () => {
    if (blocked || origin.current !== projectSessionKey()) return;
    setReceived(null);
    void query.refetch();
    if (selectedId) void exactQuery.refetch();
  };
  if (query.isPending) return <Skeleton active />;
  if (!data && exact)
    return (
      <section className="issue-detail">
        <Alert
          type="warning"
          showIcon
          title={tr("issueMissing")}
          description={tr("orphanHint")}
        />
        <Button
          loading={query.isFetching || exactQuery.isFetching}
          disabled={blocked}
          onClick={refresh}
        >
          {tr("refresh")}
        </Button>
        <IssueProposalFacts diagnosis={exact} />
        {exact.snapshot && (
          <details className="issue-captured">
            <summary>{tr("capturedEvidence")}</summary>
            <IssueEvidenceList
              evidence={exact.snapshot.evidence}
              projectId={projectId}
              captured
            />
          </details>
        )}
        <IssueReviewPanel
          key={`${projectId}:${issueId}:${exact.id}:orphan`}
          projectId={projectId}
          detail={null}
          workspaceVersion={workspaceVersion}
          diagnosis={exact}
          background={background}
          readOnly={readOnly || exactQuery.isError}
          onSaved={saved}
          onBusyChange={setChildBusy}
          onUnresolvedChange={setChildUnknown}
        />
      </section>
    );
  if (!data)
    return (
      <Alert
        type="warning"
        showIcon
        title={tr("issueMissing")}
        description={query.isError ? tr("readFailed") : issueId}
        action={
          <Button disabled={blocked} onClick={refresh}>
            {tr("refresh")}
          </Button>
        }
      />
    );
  const unavailable = readOnly || query.isError;
  const requirementId = data.requirement_id || selected?.review?.requirement_id;
  const requirementHref = requirementId
    ? issueEvidenceHref(
        projectId,
        {
          project_id: projectId,
          requirement_id: requirementId,
          view: "list",
          detail: "details",
        },
        background,
      )
    : null;
  return (
    <section className="issue-detail" aria-label={tr("detailTitle")}>
      <header className="issue-detail-heading">
        <h2>{data.issue.title}</h2>
        <div className="issue-tags">
          <Tag
            color={
              ["P0", "P1"].includes(data.issue.severity) ? "red" : "default"
            }
          >
            {data.issue.severity}
          </Tag>
          <Tag>
            {t(`deliveryIssue.issueStatuses.${data.issue.status}`, {
              defaultValue: data.issue.status,
            })}
          </Tag>
          <span className="issue-meta">{data.issue.id}</span>
        </div>
        <p className="issue-meta">
          <IssueTime value={data.issue.created_at} /> · {data.issue.reported_by}
        </p>
      </header>
      {query.isError && <Alert type="error" title={tr("staleRead")} />}
      {readOnly && <Alert type="info" title={tr("readOnly")} />}
      <div className="issue-actions">
        <Button loading={query.isFetching} disabled={blocked} onClick={refresh}>
          {tr("refresh")}
        </Button>
        {requirementHref && (
          <Button href={requirementHref}>{tr("openRequirement")}</Button>
        )}
      </div>
      <IssueReasons reasons={data.reasons} />
      <nav className="issue-section-tabs" aria-label={tr("detailSections")}>
        {(["facts", "generate", "proposal"] as const).map((value) => (
          <Button
            key={value}
            type={mode === value ? "primary" : "default"}
            aria-pressed={mode === value}
            disabled={
              blocked ||
              (value === "generate" &&
                (unavailable || !data.permissions.can_generate))
            }
            onClick={() => setMode(value)}
          >
            {tr(`${value}Tab`)}
          </Button>
        ))}
      </nav>
      <div hidden={mode !== "facts"}>
        <h3>{tr("observedFacts")}</h3>
        <p className="issue-description">
          {data.issue.description || tr("noDescription")}
        </p>
        {data.issue.resolution && (
          <blockquote>{data.issue.resolution}</blockquote>
        )}
        <IssueEvidenceList
          evidence={data.evidence}
          projectId={projectId}
          background={background}
        />
      </div>
      <div hidden={mode !== "generate"}>
        <IssueDiagnosisPanel
          key={`${projectId}:${issueId}:generation`}
          projectId={projectId}
          detail={data}
          readOnly={unavailable}
          onBusyChange={setChildBusy}
          onUnresolvedChange={setChildUnknown}
          onGenerated={(value) => {
            if (origin.current !== projectSessionKey()) return;
            setReceived(value);
            setSelectedId(value.id);
            const params = new URLSearchParams(location.hash.split("?")[1]);
            params.set("diagnosis_id", value.id);
            history.replaceState(null, "", `#/dev-flow?${params}`);
            void query.refetch();
          }}
        />
      </div>
      <div hidden={mode !== "proposal"}>
        {selected ? (
          <>
            <IssueProposalFacts diagnosis={selected} />
            {selected.snapshot && (
              <details className="issue-captured">
                <summary>{tr("capturedEvidence")}</summary>
                <IssueEvidenceList
                  evidence={selected.snapshot.evidence}
                  projectId={projectId}
                  captured
                />
              </details>
            )}
            <IssueReviewPanel
              key={`${projectId}:${issueId}:${selected.id}`}
              projectId={projectId}
              detail={data}
              diagnosis={selected}
              background={background}
              readOnly={unavailable}
              onSaved={saved}
              onBusyChange={setChildBusy}
              onUnresolvedChange={setChildUnknown}
            />
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            title={tr(selectedId ? "diagnosisMissing" : "chooseDiagnosis")}
          />
        )}
      </div>
      <section className="issue-history">
        <h3>{tr("history")}</h3>
        <p className="issue-meta">{tr("historyHint")}</p>
        {proposalHistory.length ? (
          <ol>
            {proposalHistory.map((item) => (
              <li key={item.id}>
                <Button
                  className="issue-history-trigger"
                  type={selectedId === item.id ? "primary" : "default"}
                  disabled={blocked}
                  onClick={() => choose(item.id)}
                >
                  <span>
                    {tr(item.generator)} · {tr(`statuses.${item.status}`)}
                  </span>
                  <span>
                    {item.requested_by.name || item.requested_by.id} ·{" "}
                    <IssueTime value={item.created_at} />
                  </span>
                  {item.review && (
                    <span>{tr(`reviews.${item.review.decision}`)}</span>
                  )}
                  {!item.current && <span>{tr("historical")}</span>}
                  {item.restricted && <span>{tr("restricted")}</span>}
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={tr("noHistory")}
          />
        )}
        {historyError && (
          <Alert
            type="error"
            title={tr("readFailed")}
            description={historyError}
          />
        )}
        {cursor && (
          <Button
            loading={historyBusy}
            disabled={blocked || historyBusy}
            onClick={loadHistory}
          >
            {tr("moreHistory")}
          </Button>
        )}
      </section>
    </section>
  );
}
