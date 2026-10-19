import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Empty, Skeleton, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchIssueOrigins,
  issueEvidenceHref,
  issueProblem,
  type IssueOrigin,
} from "@/lib/deliveryIssue";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { IssueTime } from "./DeliveryIssueFacts";

export type IssueOriginDirectoryProps = {
  projectId: string;
  issueId: string;
  background: string;
  disabled?: boolean;
  persistRoute?: boolean;
  selectedIds?: string[];
  selectionCount?: number;
  onSelection?: (origin: IssueOrigin, selected: boolean) => void;
  onUnavailable?: () => void;
};
export function IssueOriginDirectory({
  projectId,
  issueId,
  background,
  disabled = false,
  persistRoute = false,
  selectedIds = [],
  selectionCount = 0,
  onSelection,
  onUnavailable,
}: IssueOriginDirectoryProps) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryIssue.origins.${key}`);
  const session = projectSessionKey(),
    owner = useRef(session);
  const initial = new URLSearchParams(background.split("?")[1]);
  const [cursor, setCursor] = useState(() =>
    persistRoute ? initial.get("issue_origin_cursor") || "" : "",
  );
  const [page, setPage] = useState(() =>
    persistRoute
      ? Math.max(1, Number(initial.get("issue_origin_page")) || 1)
      : 1,
  );
  const current = () => owner.current === projectSessionKey();
  const query = useQuery({
    queryKey: ["delivery-issue-origins", projectId, session, issueId, cursor],
    queryFn: async ({ signal }) => {
      if (!current()) throw new Error("scopeChanged");
      try {
        const value = await fetchIssueOrigins(
          projectId,
          issueId,
          { cursor, limit: 20 },
          signal,
        );
        if (!current() || signal.aborted) throw new Error("scopeChanged");
        return value;
      } catch (cause) {
        if (
          current() &&
          !signal.aborted &&
          /^HTTP (403|404):/.test(
            String(cause instanceof Error ? cause.message : cause),
          )
        )
          onUnavailable?.();
        throw cause;
      }
    },
    enabled: Boolean(projectId && issueId) && current(),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!persistRoute) return;
    const sync = () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      if (
        params.get("project_id") !== projectId ||
        params.get("issue") !== issueId
      )
        return;
      setCursor(params.get("issue_origin_cursor") || "");
      setPage(Math.max(1, Number(params.get("issue_origin_page")) || 1));
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [projectId, issueId, persistRoute]);
  const change = (next: string, number: number) => {
    if (disabled || !current()) return;
    setCursor(next);
    setPage(number);
    if (persistRoute) {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      params.set("view", "issues");
      params.set("project_id", projectId);
      params.set("issue", issueId);
      params.set("issue_origins", "1");
      if (next) params.set("issue_origin_cursor", next);
      else params.delete("issue_origin_cursor");
      params.set("issue_origin_page", String(number));
      history.replaceState(null, "", `#/dev-flow?${params}`);
    }
  };
  const data =
    !query.isError &&
    current() &&
    query.data?.project_id === projectId &&
    query.data.issue_id === issueId
      ? query.data
      : undefined;
  const next =
    data?.next_cursor && data.next_cursor !== cursor ? data.next_cursor : null;
  const returnHash =
    typeof location === "undefined" ? background : location.hash;
  return (
    <section className="issue-origin-directory" aria-label={tr("title")}>
      <header className="issue-origin-heading">
        <h3>{tr("title")}</h3>
        <Button
          size="small"
          disabled={disabled || !current()}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {tr("refresh")}
        </Button>
      </header>
      <p className="issue-meta">{tr("hint")}</p>
      {onSelection && (
        <p className="issue-meta" role="status">
          {t("deliveryIssue.origins.selectedCount", {
            count: selectionCount,
            limit: 32,
          })}
        </p>
      )}
      {query.isPending && <Skeleton active />}
      {query.isError && (
        <Alert
          type="warning"
          showIcon
          title={tr("readFailed")}
          description={t(
            `deliveryIssue.reasons.${issueProblem(query.error).code}`,
            { defaultValue: tr("readFailedHint") },
          )}
        />
      )}
      {data && (
        <>
          {!data.issue_available && (
            <Alert type="info" showIcon title={tr("issueDeleted")} />
          )}
          <p className="issue-meta" role="status">
            {t("deliveryIssue.origins.pageCount", {
              page,
              count: data.items.length,
              total: data.total,
            })}
          </p>
          {!data.items.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={tr("empty")}
            />
          )}
          <ol className="issue-origin-list">
            {data.items.map((origin) => {
              const selected = selectedIds.includes(origin.evidence.id);
              const unavailable =
                !origin.available ||
                origin.evidence.missing ||
                origin.evidence.restricted;
              const href = !unavailable
                ? issueEvidenceHref(
                    projectId,
                    origin.evidence.target,
                    returnHash,
                  )
                : null;
              return (
                <li key={origin.id} className="issue-origin-card">
                  <header>
                    <div className="issue-tags">
                      <Tag>{tr(`operations.${origin.operation}`)}</Tag>
                      <strong>
                        {origin.event_type || tr("originalUnavailable")}
                      </strong>
                      <Tag color={unavailable ? "orange" : "default"}>
                        {tr(unavailable ? "unavailable" : "available")}
                      </Tag>
                    </div>
                  </header>
                  <dl className="issue-facts">
                    <div>
                      <dt>{tr("producer")}</dt>
                      <dd>
                        {origin.producer
                          ? `${origin.producer.name || origin.producer.id}${origin.producer.name ? ` · ${origin.producer.id}` : ""}`
                          : tr("originalUnavailable")}
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("processedAt")}</dt>
                      <dd>
                        <IssueTime value={origin.processed_at} />
                      </dd>
                    </div>
                    <div>
                      <dt>{tr("source")}</dt>
                      <dd>{origin.source || "—"}</dd>
                    </div>
                    <div>
                      <dt>{tr("receipt")}</dt>
                      <dd>{origin.receipt_id}</dd>
                    </div>
                  </dl>
                  {unavailable && (
                    <p className="issue-meta">
                      {t(`deliveryIssue.reasons.${origin.unavailable_reason}`, {
                        defaultValue: tr("unavailableHint"),
                      })}
                    </p>
                  )}
                  <details className="issue-technical">
                    <summary>{tr("recordDetails")}</summary>
                    <dl className="issue-facts">
                      {[
                        ["originId", origin.id],
                        ["eventId", origin.event_id || "—"],
                        ["attemptId", origin.attempt_id],
                        ["digest", origin.digest],
                        ["basis", origin.basis],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{tr(label)}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <div className="issue-actions">
                    {href && (
                      <Button
                        size="small"
                        disabled={disabled || !current()}
                        href={disabled || !current() ? undefined : href}
                      >
                        {tr("openReceipt")}
                      </Button>
                    )}
                    {onSelection && (
                      <Checkbox
                        checked={selected}
                        disabled={
                          disabled ||
                          !current() ||
                          unavailable ||
                          (!selected && selectionCount >= 32)
                        }
                        onChange={(event) => {
                          if (
                            !disabled &&
                            current() &&
                            !unavailable &&
                            (selected || selectionCount < 32)
                          )
                            onSelection(origin, event.target.checked);
                        }}
                      >
                        {tr("selectEvidence")}
                      </Checkbox>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {data.next_cursor === cursor && cursor && (
            <Alert type="warning" title={tr("cursorInvalid")} />
          )}
        </>
      )}
      <nav className="issue-actions" aria-label={tr("pagination")}>
        <Button
          disabled={disabled || !current() || query.isFetching}
          onClick={() => {
            change("", 1);
            if (!cursor && current()) void query.refetch();
          }}
        >
          {tr("first")}
        </Button>
        <Button
          disabled={disabled || !current() || query.isFetching || !next}
          onClick={() => next && change(next, page + 1)}
        >
          {tr("next")}
        </Button>
      </nav>
    </section>
  );
}
