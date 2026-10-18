import { currentDiscussionHash } from "@/lib/deliveryDiscussionNavigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  fetchDiscussionSources,
  type DiscussionScope,
  type DiscussionSourcePage,
} from "@/lib/deliveryDiscussions";
import {
  discussionObjectHref,
  sourceLinkHref,
} from "@/lib/deliveryDiscussionNavigation";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";
import { createDiscussionGate } from "@/lib/deliveryDiscussionDraft";
import {
  DiscussionEmpty,
  DiscussionPager,
  DiscussionProblem,
  DiscussionReferences,
} from "./DeliveryDiscussionCommon";
import "./delivery-discussion.css";
export function useDiscussionNavigation(
  identity: string,
  onNavigate?: (href: string) => void,
) {
  const exit = useExecutionExitGuard();
  const gate = useRef(createDiscussionGate());
  const key = JSON.stringify([
    projectSessionKey(),
    identity,
    currentDiscussionHash(),
  ]);
  gate.current.enter(key);
  const [state, setState] = useState<{
    epoch: number;
    busy: boolean;
    error: unknown;
  }>({ epoch: gate.current.epoch(), busy: false, error: null });
  useEffect(() => {
    gate.current.enter(key);
    return () => gate.current.leave();
  }, [key]);
  const origin = projectSessionKey();
  const navigate = (href: string) => {
    if (origin !== projectSessionKey() || !exit.canNavigate()) return false;
    if (onNavigate) onNavigate(href);
    else {
      history.pushState(null, "", href);
      window.dispatchEvent(new Event("hashchange"));
    }
    return true;
  };
  async function open(projectId: string, target: DiscussionScope) {
    if (!exit.canNavigate()) return;
    const ticket = gate.current.start();
    setState({ epoch: ticket.epoch, busy: true, error: null });
    try {
      const href = await discussionObjectHref(
        projectId,
        target,
        currentDiscussionHash(),
      );
      if (gate.current.current(ticket) && origin === projectSessionKey())
        navigate(href);
    } catch (error) {
      if (gate.current.current(ticket) && origin === projectSessionKey())
        setState({ epoch: ticket.epoch, busy: false, error });
    } finally {
      if (gate.current.current(ticket) && origin === projectSessionKey())
        setState((value) =>
          value.epoch === ticket.epoch ? { ...value, busy: false } : value,
        );
    }
  }
  return {
    navigate,
    open,
    busy: state.epoch === gate.current.epoch() && state.busy,
    error: state.epoch === gate.current.epoch() ? state.error : null,
  };
}
export function DeliverySourceRecords({
  projectId,
  page,
  identity,
  onNavigate,
}: {
  projectId: string;
  page: DiscussionSourcePage;
  identity: string;
  onNavigate?: (href: string) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryDiscussion.${key}`);
  const nav = useDiscussionNavigation(identity, onNavigate);
  return (
    <div className="discussion-source-list">
      {Boolean(nav.error) && <DiscussionProblem error={nav.error} />}{" "}
      {!page.items.length && !page.legacy_sources.length && (
        <DiscussionEmpty sources />
      )}
      {page.items.map((link) => (
        <article className="discussion-source-row" key={link.id}>
          <div className="discussion-actions">
            <Tag color={link.relation === "adopted" ? "success" : undefined}>
              {tr(link.relation)}
            </Tag>
            {link.source_changed && <Tag color="warning">{tr("changed")}</Tag>}
          </div>
          <strong>{link.source_snapshot.thread.title}</strong>
          <p className="discussion-text">{link.source_snapshot.message.body}</p>
          <small>
            {link.source_snapshot.message.author.name ||
              link.source_snapshot.message.author.id}{" "}
            ·{" "}
            {t("deliveryDiscussion.revision", {
              revision: link.message_revision,
            })}
          </small>
          <DiscussionReferences refs={link.source_snapshot.message.refs} />
          <p className="discussion-meta">
            {tr("appliedBy")} {link.applied_by.name || link.applied_by.id} ·{" "}
            {link.created_at}
          </p>
          {Boolean(link.applied_fields?.length) && (
            <p className="discussion-meta">
              {tr("appliedFields")} {link.applied_fields.join(" · ")}
            </p>
          )}
          <div className="discussion-actions">
            <Button
              size="small"
              onClick={() => nav.navigate(sourceLinkHref(projectId, link))}
            >
              {tr("openSource")}
            </Button>
            <Button
              size="small"
              disabled={link.target_missing || nav.busy}
              loading={nav.busy}
              onClick={() =>
                void nav.open(projectId, {
                  kind: link.target_kind,
                  id: link.target_id,
                })
              }
            >
              {tr("openTarget")} · {link.target_title || link.target_id}
            </Button>
          </div>
        </article>
      ))}
      {page.legacy_sources.map((source, index) => (
        <article
          key={`${source.kind}:${source.id}:${index}`}
          className="discussion-source-row"
        >
          <Tag>{source.kind}</Tag>
          {source.label}
          {source.unavailable || !source.target ? (
            <p>{tr("unavailable")}</p>
          ) : (
            <Button
              size="small"
              onClick={() => {
                const target = source.target!;
                if (target.project_id !== projectId) return;
                const kind = target.task_id
                  ? "task"
                  : target.issue_id
                    ? "issue"
                    : "requirement";
                const id =
                  target.task_id || target.issue_id || target.requirement_id;
                if (id) void nav.open(projectId, { kind, id });
              }}
            >
              {tr("openTarget")}
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}
export function DeliverySourceSummary({
  projectId,
  sessionId,
  target,
  enabled = true,
  onNavigate,
}: {
  projectId: string;
  sessionId: string;
  target: DiscussionScope;
  enabled?: boolean;
  onNavigate?: (href: string) => void;
}) {
  const { t } = useTranslation();
  const [window, setWindow] = useState({ cursor: "", page: 1 });
  const query = useQuery({
    queryKey: [
      "discussion-sources",
      projectId,
      sessionId,
      projectSessionKey(),
      target.kind,
      target.id,
      window.cursor,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionSources(projectId, target, window.cursor, signal),
    enabled,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <section
      className="delivery-discussion"
      aria-label={t("deliveryDiscussion.sources")}
    >
      <h3>{t("deliveryDiscussion.sources")}</h3>
      {query.isPending && <Skeleton active />}
      {query.error ? (
        <DiscussionProblem
          error={query.error}
          onRetry={() => void query.refetch()}
          onReset={() => setWindow({ cursor: "", page: 1 })}
        />
      ) : (
        query.data && (
          <>
            <DeliverySourceRecords
              projectId={projectId}
              page={query.data}
              identity={`${sessionId}:${target.kind}:${target.id}:${window.cursor}`}
              onNavigate={onNavigate}
            />
            <DiscussionPager
              page={window.page}
              total={query.data.total}
              hasMore={query.data.has_more}
              busy={query.isFetching}
              onFirst={() => {
                setWindow({ cursor: "", page: 1 });
                void query.refetch();
              }}
              onNext={() =>
                query.data?.next_cursor &&
                setWindow({
                  cursor: query.data.next_cursor,
                  page: window.page + 1,
                })
              }
            />
          </>
        )
      )}
    </section>
  );
}
