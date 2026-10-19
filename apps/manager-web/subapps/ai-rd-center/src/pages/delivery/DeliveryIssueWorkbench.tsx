import { useQuery } from "@tanstack/react-query";
import { fetchIssuePage } from "@/lib/deliveryQuery";
import { DeliveryPageControls, DeliveryQueryError } from "./DeliveryQueryViews";
import type { DeliveryCommandAck } from "@/lib/deliveryQuery";
import { Alert, Button, Empty, Input, Select, Tag } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryContext } from "@/lib/delivery";
import { safeExecutionReturn } from "@/lib/executionCommands";
import { safePortfolioReturn } from "@/lib/projectPortfolioRoute";
import { DeliveryIssueDetail } from "./DeliveryIssueDetail";
import "./delivery-issue.css";
export type DeliveryIssueWorkbenchProps = {
  workspace: DeliveryContext;
  projectId: string;
  sessionId: string;
  issueId: string;
  background: string;
  readOnly: boolean;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onOpenIssue: (id: string) => void;
  onCloseIssue: () => void;
};
export function DeliveryIssueWorkbench({
  workspace,
  projectId,
  sessionId,
  issueId,
  background,
  readOnly,
  onSaved,
  onOpenIssue,
  onCloseIssue,
}: DeliveryIssueWorkbenchProps) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryIssue.${key}`);
  const initial = new URLSearchParams(background.split("?")[1]);
  const [search, setSearch] = useState(initial.get("issue_q") || ""),
    [status, setStatus] = useState(initial.get("issue_status") || "all"),
    [severity, setSeverity] = useState(initial.get("issue_severity") || "all"),
    [source, setSource] = useState(initial.get("issue_source") || "all");
  const filterChanged = (key: string, value: string) => {
    const params = new URLSearchParams(location.hash.split("?")[1]);
    params.delete("issue_cursor");
    params.delete("issue_page");
    setCursor("");
    setPage(1);
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    history.replaceState(null, "", `#/dev-flow?${params}`);
  };
  const [cursor, setCursor] = useState(initial.get("issue_cursor") || "");
  const [page, setPage] = useState(Number(initial.get("issue_page")) || 1);
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      setSearch(params.get("issue_q") || "");
      setStatus(params.get("issue_status") || "all");
      setSeverity(params.get("issue_severity") || "all");
      setSource(params.get("issue_source") || "all");
      setCursor(params.get("issue_cursor") || "");
      setPage(Number(params.get("issue_page")) || 1);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const query = useQuery({
    queryKey: [
      "delivery-issues-page",
      projectId,
      sessionId,
      search,
      status,
      severity,
      source,
      cursor,
      workspace.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchIssuePage(
        projectId,
        {
          q: search,
          status: status === "all" ? "" : status,
          severity: severity === "all" ? "" : severity,
          source: source === "all" ? "" : source,
          cursor,
          limit: 20,
        },
        signal,
        workspace.query_generation,
      ),
    retry: false,
    gcTime: 0,
  });
  const visible = query.data?.items || [];
  const back =
    safeExecutionReturn(initial.get("return_to") || "") ||
    safePortfolioReturn(initial.get("return_to") || "");
  return (
    <section className="issue-workbench" aria-label={tr("title")}>
      <header className="issue-workbench-heading">
        <div>
          <h2>{tr("title")}</h2>
          <p className="issue-meta">{tr("queueHint")}</p>
        </div>
        {back && <Button href={back}>{tr("back")}</Button>}
      </header>
      {readOnly && <Alert type="info" showIcon title={tr("readOnly")} />}
      <div className="issue-filters">
        <Input.Search
          aria-label={tr("search")}
          placeholder={tr("search")}
          value={search}
          allowClear
          onChange={(event) => {
            setSearch(event.target.value);
            filterChanged("issue_q", event.target.value);
          }}
        />
        <Select
          aria-label={tr("statusFilter")}
          value={status}
          onChange={(value) => {
            setStatus(value);
            filterChanged("issue_status", value);
          }}
          options={["all", "open", "resolved", "closed"].map((value) => ({
            value,
            label: tr(`issueStatuses.${value}`),
          }))}
        />
        <Select
          aria-label={tr("severityFilter")}
          value={severity}
          onChange={(value) => {
            setSeverity(value);
            filterChanged("issue_severity", value);
          }}
          options={["all", "P0", "P1", "P2", "P3"].map((value) => ({
            value,
            label: value === "all" ? tr("allSeverities") : value,
          }))}
        />
        <Select
          aria-label={tr("sourceFilter")}
          value={source}
          onChange={(value) => {
            setSource(value);
            filterChanged("issue_source", value);
          }}
          options={["all", "execution", "deployment", "event", "other"].map(
            (value) => ({
              value,
              label: tr(`sources.${value}`),
            }),
          )}
        />
      </div>
      <p className="issue-meta" role="status">
        {tr("visibleCount")} {visible.length} / {query.data?.total ?? "—"}
      </p>
      {query.error && (
        <DeliveryQueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          onReset={() => {
            setCursor("");
            setPage(1);
            filterChanged("issue_cursor", "");
          }}
        />
      )}
      {visible.length ? (
        <div className="issue-queue">
          {visible.map((issue) => {
            const requirement = issue.linked_requirement_id;
            return (
              <article
                className={`issue-row${issueId === issue.id ? " is-selected" : ""}`}
                key={issue.id}
              >
                <Button
                  type="text"
                  className="issue-row-trigger"
                  data-issue-id={issue.id}
                  onClick={() => onOpenIssue(issue.id)}
                >
                  <span className="issue-row-main">
                    <span className="issue-row-title">{issue.title}</span>
                    <span className="issue-row-id">{issue.id}</span>
                  </span>
                  <span className="issue-row-state">
                    <Tag
                      color={
                        ["P0", "P1"].includes(issue.severity)
                          ? "red"
                          : "default"
                      }
                    >
                      {issue.severity}
                    </Tag>
                    <Tag>
                      {t(`deliveryIssue.issueStatuses.${issue.status}`, {
                        defaultValue: issue.status,
                      })}
                    </Tag>
                    {(issue.source_kinds || []).map((kind) => (
                      <Tag key={kind}>{tr(`sources.${kind}`)}</Tag>
                    ))}
                    {requirement && (
                      <Tag color="blue">{tr("requirementLinked")}</Tag>
                    )}
                  </span>
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={tr(query.data?.total ? "noMatchingIssues" : "noIssues")}
        />
      )}
      {query.data && (
        <DeliveryPageControls
          page={page}
          cursor={cursor}
          next={query.data.next_cursor}
          total={query.data.total}
          loading={query.isFetching}
          onPage={(nextPage, nextCursor) => {
            setPage(nextPage);
            setCursor(nextCursor);
            const params = new URLSearchParams(location.hash.split("?")[1]);
            params.set("issue_page", String(nextPage));
            if (nextCursor) params.set("issue_cursor", nextCursor);
            else params.delete("issue_cursor");
            history.pushState(null, "", `#/dev-flow?${params}`);
          }}
        />
      )}
      <DeliveryIssueDetail
        projectId={projectId}
        sessionId={sessionId}
        issueId={issueId}
        workspaceVersion={workspace.version}
        background={background}
        readOnly={readOnly}
        onSaved={onSaved}
        onClose={onCloseIssue}
      />
    </section>
  );
}
