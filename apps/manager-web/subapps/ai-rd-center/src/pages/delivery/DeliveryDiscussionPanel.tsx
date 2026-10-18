import { currentDiscussionHash } from "@/lib/deliveryDiscussionNavigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Collapse, Select, Skeleton, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  fetchDiscussionPage,
  parseDiscussionRoute,
  discussionHash,
  type DiscussionAdoption,
  type DiscussionKind,
  type DiscussionScope,
} from "@/lib/deliveryDiscussions";
import {
  useDiscussionNavigation,
  DeliverySourceSummary,
} from "./DeliverySourceSummary";
import { DiscussionComposer } from "./DeliveryDiscussionComposer";
import {
  DeliveryDiscussionThread,
  type DiscussionAdoptAction,
} from "./DeliveryDiscussionThread";
import {
  DiscussionEmpty,
  DiscussionPager,
  DiscussionProblem,
} from "./DeliveryDiscussionCommon";
import { DiscussionObjectSelect } from "./DeliveryDiscussionObjectSelect";
import "./delivery-discussion.css";
export function DeliveryDiscussionPanel({
  projectId,
  sessionId,
  subject,
  readOnly = false,
  onAdopt,
  onNavigate,
  onUnresolvedChange,
  enabled = true,
}: {
  projectId: string;
  sessionId: string;
  subject?: DiscussionScope;
  readOnly?: boolean;
  onAdopt?: (
    action: DiscussionAdoptAction,
    adoption: DiscussionAdoption,
  ) => void;
  onNavigate?: (href: string) => void;
  onUnresolvedChange?: (value: boolean) => void;
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryDiscussion.${key}`);
  const qc = useQueryClient();
  const [route, setRoute] = useState(() =>
      parseDiscussionRoute(currentDiscussionHash()),
    ),
    [creating, setCreating] = useState(false),
    [kind, setKind] = useState<DiscussionKind>("requirement"),
    [objectId, setObjectId] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const callback = useRef(onUnresolvedChange);
  callback.current = onUnresolvedChange;
  const scope = subject || { kind, id: objectId.trim() };
  const session = projectSessionKey();
  const identity = JSON.stringify([projectId, sessionId, subject, route]);
  const nav = useDiscussionNavigation(identity, onNavigate);
  useEffect(() => {
    const sync = () => setRoute(parseDiscussionRoute(currentDiscussionHash()));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  useEffect(() => () => callback.current?.(false), []);
  const markPending = (value: boolean) => {
    pendingRef.current = value;
    setPending(value);
    callback.current?.(value);
  };
  const change = (patch: Parameters<typeof discussionHash>[1]) => {
    if (pendingRef.current) return;
    const href = discussionHash(currentDiscussionHash(), patch);
    if (nav.navigate(href)) setRoute(parseDiscussionRoute(href));
  };
  const query = useQuery({
    queryKey: [
      "discussion-page",
      projectId,
      sessionId,
      session,
      subject?.kind,
      subject?.id,
      route.state,
      route.cursor,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionPage(
        projectId,
        subject,
        route.state,
        route.cursor,
        signal,
      ),
    enabled: enabled && !route.thread,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (route.thread)
    return (
      <DeliveryDiscussionThread
        key={`${projectId}:${sessionId}:${route.thread}`}
        projectId={projectId}
        sessionId={sessionId}
        threadId={route.thread}
        scope={subject}
        route={route}
        onRoute={change}
        onBack={() => change({ thread: "", message: "" })}
        onAdopt={onAdopt}
        onNavigate={onNavigate}
        onUnresolvedChange={markPending}
      />
    );
  return (
    <section className="delivery-discussion" aria-label={tr("title")}>
      <div className="discussion-heading">
        <h3>{tr("title")}</h3>
        <div className="discussion-actions">
          <Select
            aria-label={tr("state")}
            value={route.state}
            disabled={pending}
            options={["all", "open", "resolved", "archived"].map((value) => ({
              value,
              label: tr(value),
            }))}
            onChange={(state) => change({ state, cursor: "", page: 1 })}
          />
          <Button
            disabled={pending}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {tr("refresh")}
          </Button>
          <Button
            type="primary"
            disabled={readOnly || pending}
            onClick={() => setCreating((value) => !value)}
          >
            {tr("new")}
          </Button>
        </div>
      </div>
      {creating && (
        <section>
          {!subject && (
            <div className="discussion-reference-form">
              <label>
                {tr("kind")}
                <Select
                  value={kind}
                  disabled={pending}
                  aria-label={tr("kind")}
                  options={["requirement", "task", "issue"].map((value) => ({
                    value,
                    label: tr(value),
                  }))}
                  onChange={(value) => {
                    setKind(value);
                    setObjectId("");
                  }}
                />
              </label>
              <label>
                {tr("subject")}
                <DiscussionObjectSelect
                  key={`${projectId}:${kind}`}
                  projectId={projectId}
                  kind={kind}
                  disabled={pending}
                  value={objectId}
                  onChange={setObjectId}
                />
              </label>
            </div>
          )}
          {scope.id && (
            <DiscussionComposer
              key={`${projectId}:${sessionId}:${scope.kind}:${scope.id}`}
              projectId={projectId}
              subject={scope}
              identity={identity}
              readOnly={readOnly}
              onUnresolvedChange={markPending}
              onCancel={() => setCreating(false)}
              onSaved={(ack) => {
                if (ack.project_id !== projectId) return;
                markPending(false);
                for (const key of ["discussion-page", "discussion-detail"])
                  void qc.invalidateQueries({ queryKey: [key, projectId] });
                setCreating(false);
                const href = discussionHash(currentDiscussionHash(), {
                  thread: ack.thread_id,
                  message: ack.message_id || "",
                  messageCursor: "",
                  messagePage: 1,
                });
                if (nav.navigate(href)) setRoute(parseDiscussionRoute(href));
              }}
            />
          )}
        </section>
      )}
      {query.isPending && <Skeleton active />}
      {query.error ? (
        <DiscussionProblem
          error={query.error}
          onRetry={() => void query.refetch()}
          onReset={() => change({ cursor: "", page: 1 })}
        />
      ) : (
        query.data && (
          <>
            <div className="discussion-list">
              {!query.data.items.length && <DiscussionEmpty />}
              {query.data.items.map((thread) => (
                <article className="discussion-row" key={thread.id}>
                  <Tag>{tr(thread.state)}</Tag>
                  <Button
                    type="link"
                    className="discussion-row-trigger"
                    disabled={pending}
                    onClick={() =>
                      change({
                        thread: thread.id,
                        message: "",
                        messageCursor: "",
                        messagePage: 1,
                      })
                    }
                  >
                    {thread.title}
                  </Button>
                  <p className="discussion-meta">
                    {tr(thread.subject.kind)} ·{" "}
                    {thread.subject.title || thread.subject.id} ·{" "}
                    {thread.created_by.name || thread.created_by.id} ·{" "}
                    {thread.last_activity_at}
                  </p>
                </article>
              ))}
            </div>
            <DiscussionPager
              page={route.page}
              total={query.data.total}
              hasMore={query.data.has_more}
              busy={query.isFetching || pending}
              onFirst={() => {
                change({ cursor: "", page: 1 });
                void query.refetch();
              }}
              onNext={() =>
                query.data?.next_cursor &&
                change({ cursor: query.data.next_cursor, page: route.page + 1 })
              }
            />
          </>
        )
      )}
    </section>
  );
}
export function DeliveryObjectCollaboration(
  props: Parameters<typeof DeliveryDiscussionPanel>[0] & {
    subject: DiscussionScope;
  },
) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string[]>(() =>
    parseDiscussionRoute(currentDiscussionHash()).thread ? ["discussion"] : [],
  );
  return (
    <div className="discussion-object-collaboration">
      <Collapse
        size="small"
        activeKey={open}
        onChange={(value) => setOpen(Array.isArray(value) ? value : [value])}
        items={[
          {
            key: "discussion",
            label: t("deliveryDiscussion.title"),
            children: open.includes("discussion") ? (
              <DeliveryDiscussionPanel {...props} />
            ) : null,
          },
          {
            key: "sources",
            label: t("deliveryDiscussion.sources"),
            children: open.includes("sources") ? (
              <DeliverySourceSummary
                key={`${props.projectId}:${props.sessionId}:${props.subject.kind}:${props.subject.id}`}
                projectId={props.projectId}
                sessionId={props.sessionId}
                target={props.subject}
                onNavigate={props.onNavigate}
              />
            ) : null,
          },
        ]}
      />
    </div>
  );
}
