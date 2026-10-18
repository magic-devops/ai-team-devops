import { currentDiscussionHash } from "@/lib/deliveryDiscussionNavigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Collapse,
  Input,
  Modal,
  Select,
  Skeleton,
  Tag,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDiscussionDraft } from "@/lib/deliveryDiscussionDraft";
import {
  discussionSource,
  fetchDiscussion,
  fetchDiscussionLinks,
  fetchDiscussionMessage,
  fetchDiscussionMessages,
  fetchDiscussionReference,
  fetchDiscussionVersion,
  fetchDiscussionVersions,
  type DiscussionAck,
  type DiscussionAdoption,
  type DiscussionKind,
  type DiscussionMessage,
  type DiscussionOperation,
  type DiscussionRoute,
  type DiscussionScope,
  type DiscussionThread,
} from "@/lib/deliveryDiscussions";
import {
  DeliverySourceRecords,
  useDiscussionNavigation,
} from "./DeliverySourceSummary";
import { DiscussionObjectSelect } from "./DeliveryDiscussionObjectSelect";
import { DiscussionComposer } from "./DeliveryDiscussionComposer";
import {
  DiscussionEmpty,
  DiscussionPager,
  DiscussionProblem,
  DiscussionReferences,
} from "./DeliveryDiscussionCommon";
export type DiscussionAdoptAction =
  | "requirement"
  | "task"
  | "plan"
  | "issue"
  | "diagnosis";
type Props = {
  projectId: string;
  sessionId: string;
  threadId: string;
  scope?: DiscussionScope;
  route: DiscussionRoute;
  onRoute: (patch: Partial<DiscussionRoute>) => void;
  onBack: () => void;
  onAdopt?: (
    action: DiscussionAdoptAction,
    adoption: DiscussionAdoption,
  ) => void;
  onUnresolvedChange?: (value: boolean) => void;
  onNavigate?: (href: string) => void;
};
function MessageHistory({
  projectId,
  threadId,
  messageId,
}: {
  projectId: string;
  threadId: string;
  messageId: string;
}) {
  const { t } = useTranslation();
  const [window, setWindow] = useState({ page: 1, cursor: "" });
  const query = useQuery({
    queryKey: [
      "discussion-versions",
      projectId,
      projectSessionKey(),
      threadId,
      messageId,
      window.cursor,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionVersions(
        projectId,
        threadId,
        messageId,
        window.cursor,
        signal,
      ),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <>
      {query.isPending && <Skeleton active />}
      {query.error ? (
        <DiscussionProblem
          error={query.error}
          onRetry={() => void query.refetch()}
          onReset={() => setWindow({ page: 1, cursor: "" })}
        />
      ) : (
        query.data && (
          <>
            {query.data.items.map((version) => (
              <article key={version.revision}>
                <small>
                  {t("deliveryDiscussion.revision", {
                    revision: version.revision,
                  })}{" "}
                  · {version.editor.name || version.editor.id} ·{" "}
                  {version.created_at}
                </small>
                <p className="discussion-text">
                  {version.body || t("deliveryDiscussion.withdrawn")}
                </p>
                <DiscussionReferences refs={version.refs} />
              </article>
            ))}
            <DiscussionPager
              page={window.page}
              total={query.data.total}
              hasMore={query.data.has_more}
              onFirst={() => setWindow({ page: 1, cursor: "" })}
              onNext={() =>
                query.data?.next_cursor &&
                setWindow({
                  page: window.page + 1,
                  cursor: query.data.next_cursor,
                })
              }
            />
          </>
        )
      )}
    </>
  );
}
function MessageCard({
  message,
  projectId,
  threadId,
  disabled,
  onReply,
  onEdit,
  onAction,
}: {
  message: DiscussionMessage;
  projectId: string;
  threadId: string;
  disabled: boolean;
  onReply: () => void;
  onEdit: () => void;
  onAction: (operation: "resolve" | "withdraw") => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryDiscussion.${key}`);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <article className="discussion-message" data-message-id={message.id}>
      <header className="discussion-message-heading">
        <strong>
          {tr("author")} · {message.author.name || message.author.id}
        </strong>
        <small>{message.created_at}</small>
        <Tag>
          {t("deliveryDiscussion.revision", { revision: message.revision })}
        </Tag>
      </header>
      {message.parent_message_id && (
        <small>
          {t("deliveryDiscussion.replyTo", { id: message.parent_message_id })}
        </small>
      )}
      <p className="discussion-text">
        {message.state === "withdrawn" ? tr("withdrawn") : message.body}
      </p>
      {message.reason && <p>{message.reason}</p>}
      <DiscussionReferences refs={message.refs} />
      <div className="discussion-actions">
        <Button size="small" disabled={disabled} onClick={onReply}>
          {tr("reply")}
        </Button>
        {message.can_edit && message.state === "active" && (
          <Button size="small" disabled={disabled} onClick={onEdit}>
            {tr("edit")}
          </Button>
        )}
        {message.can_withdraw && message.state === "active" && (
          <Button
            size="small"
            disabled={disabled}
            onClick={() => onAction("withdraw")}
          >
            {tr("withdraw")}
          </Button>
        )}
        {message.state === "active" && (
          <Button
            size="small"
            disabled={disabled}
            onClick={() => onAction("resolve")}
          >
            {tr("resolve")}
          </Button>
        )}
      </div>
      <Collapse
        size="small"
        ghost
        onChange={(keys) => setHistoryOpen(keys.includes("history"))}
        items={[
          {
            key: "history",
            label: tr("history"),
            children: historyOpen ? (
              <MessageHistory
                projectId={projectId}
                threadId={threadId}
                messageId={message.id}
              />
            ) : null,
          },
        ]}
      />
    </article>
  );
}
export function DeliveryDiscussionThread(props: Props) {
  const {
    projectId,
    sessionId,
    threadId,
    scope,
    route,
    onRoute,
    onBack,
    onAdopt,
    onUnresolvedChange,
    onNavigate,
  } = props;
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryDiscussion.${key}`);
  const qc = useQueryClient();
  const identity = JSON.stringify([
    sessionId,
    scope,
    threadId,
    route.state,
    route.cursor,
    route.messageCursor,
    route.message,
  ]);
  const session = projectSessionKey();
  const nav = useDiscussionNavigation(identity, onNavigate);
  const detailQuery = useQuery({
    queryKey: ["discussion-detail", projectId, sessionId, session, threadId],
    queryFn: ({ signal }) => fetchDiscussion(projectId, threadId, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const detail = !detailQuery.error ? detailQuery.data : undefined;
  const thread = detail?.thread;
  const messagesQuery = useQuery({
    queryKey: [
      "discussion-messages",
      projectId,
      sessionId,
      session,
      threadId,
      thread?.version,
      route.messageCursor,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionMessages(projectId, threadId, route.messageCursor, signal),
    enabled: Boolean(thread),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const exactQuery = useQuery({
    queryKey: [
      "discussion-message",
      projectId,
      sessionId,
      session,
      threadId,
      thread?.version,
      route.message,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionMessage(projectId, threadId, route.message, signal),
    enabled: Boolean(thread && route.message),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const resolution = thread?.current_resolution;
  const resolutionQuery = useQuery({
    queryKey: [
      "discussion-resolution-message",
      projectId,
      sessionId,
      session,
      threadId,
      thread?.version,
      resolution?.message_id,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionMessage(
        projectId,
        threadId,
        resolution!.message_id,
        signal,
      ),
    enabled: Boolean(resolution),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const revision = Number(
    new URLSearchParams(currentDiscussionHash().split("?")[1]).get(
      "discussion_revision",
    ) || 0,
  );
  const originalQuery = useQuery({
    queryKey: [
      "discussion-source-message-version",
      projectId,
      sessionId,
      session,
      threadId,
      route.message,
      revision,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionVersion(
        projectId,
        threadId,
        route.message,
        revision,
        signal,
      ),
    enabled: Boolean(
      route.message && Number.isSafeInteger(revision) && revision > 0,
    ),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [linkWindow, setLinkWindow] = useState({ page: 1, cursor: "" });
  const links = useQuery({
    queryKey: [
      "discussion-links",
      projectId,
      sessionId,
      session,
      threadId,
      thread?.version,
      linkWindow.cursor,
    ],
    queryFn: ({ signal }) =>
      fetchDiscussionLinks(projectId, threadId, linkWindow.cursor, "", signal),
    enabled: Boolean(thread),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const operation = useDiscussionDraft(
    projectId,
    undefined,
    threadId,
    "",
    "actions",
    identity,
  );
  const [action, setAction] = useState<{
      operation: DiscussionOperation;
      thread: DiscussionThread;
      message?: DiscussionMessage;
    } | null>(null),
    [edit, setEdit] = useState<DiscussionMessage | null>(null),
    [replyTo, setReplyTo] = useState<string | null>(null),
    [field, setField] = useState<DiscussionAdoption["field"]>("description");
  const [targetKind, setTargetKind] = useState<DiscussionKind>("task"),
    [targetId, setTargetId] = useState(""),
    [targetBasis, setTargetBasis] = useState<string | null>(null),
    [targetTitle, setTargetTitle] = useState(""),
    [targetBusy, setTargetBusy] = useState(false),
    [targetError, setTargetError] = useState<unknown>();
  const targetSerial = useRef(0),
    origin = useRef(session),
    pending = useRef(new Map<string, boolean>()),
    callback = useRef(onUnresolvedChange);
  callback.current = onUnresolvedChange;
  const [composerPending, setComposerPending] = useState(false);
  const setPending = (key: string, value: boolean) => {
    pending.current.set(key, value);
    if (key === "composer") setComposerPending(value);
    callback.current?.([...pending.current.values()].some(Boolean));
  };
  useEffect(() => {
    setPending("action", operation.busy || operation.unknown);
  }, [operation.busy, operation.unknown]);
  useEffect(
    () => () => {
      targetSerial.current++;
      callback.current?.(false);
    },
    [],
  );
  const mismatch = Boolean(
    thread &&
    scope &&
    (thread.subject.kind !== scope.kind || thread.subject.id !== scope.id),
  );
  const messages =
    messagesQuery.data?.thread_version === thread?.version &&
    !messagesQuery.error
      ? messagesQuery.data
      : undefined;
  const selected =
    exactQuery.data?.thread_version === thread?.version && !exactQuery.error
      ? exactQuery.data?.message
      : undefined;
  const conclusion =
    resolutionQuery.data?.thread_version === thread?.version &&
    !resolutionQuery.error
      ? resolutionQuery.data?.message
      : undefined;
  const blocked = operation.busy || operation.unknown || composerPending;
  const refresh = async () => {
    if (blocked) return;
    await detailQuery.refetch();
    await Promise.all([
      messagesQuery.refetch(),
      route.message ? exactQuery.refetch() : undefined,
      links.refetch(),
    ]);
  };
  const saved = (ack: DiscussionAck) => {
    if (
      origin.current !== projectSessionKey() ||
      ack.project_id !== projectId ||
      ack.thread_id !== threadId
    )
      return;
    for (const key of [
      "discussion-detail",
      "discussion-page",
      "discussion-messages",
      "discussion-message",
      "discussion-resolution-message",
      "discussion-sources",
      "discussion-links",
    ])
      void qc.invalidateQueries({ queryKey: [key, projectId] });
    setPending("composer", false);
    setPending("action", false);
    setEdit(null);
    setReplyTo(null);
    setAction(null);
    onRoute({
      message: ack.message_id || route.message,
      messageCursor: "",
      messagePage: 1,
    });
  };
  async function submitAction(retry = false) {
    if (!action && !retry) return;
    const frozen = action;
    const message = frozen?.message;
    const command = frozen
      ? {
          operation: frozen.operation,
          threadId,
          messageId: message?.id,
          body: {
            ...(frozen.operation === "withdraw"
              ? {
                  expected_message_revision: message!.revision,
                  reason: operation.draft.body,
                }
              : {
                  expected_thread_version: frozen.thread.version,
                  ...(frozen.operation === "resolve"
                    ? {
                        message_id: message!.id,
                        message_revision: message!.revision,
                        note: operation.draft.body,
                      }
                    : frozen.operation === "link"
                      ? {
                          resolution_event_id:
                            frozen.thread.current_resolution!.event_id,
                          message_id:
                            frozen.thread.current_resolution!.message_id,
                          message_revision:
                            frozen.thread.current_resolution!.message_revision,
                          target_kind: targetKind,
                          target_id: targetId.trim(),
                          target_content_basis: targetBasis,
                        }
                      : { reason: operation.draft.body }),
                }),
          },
        }
      : undefined;
    const ack = await operation.run(command, retry);
    if (ack) saved(ack);
  }
  const [latestAction, setLatestAction] = useState<typeof action>(null);
  const [actionReadBusy, setActionReadBusy] = useState(false);
  async function readActionLatest() {
    if (!action || blocked) return;
    const serial = ++targetSerial.current;
    setActionReadBusy(true);
    setTargetError(undefined);
    try {
      const fresh = await fetchDiscussion(projectId, threadId);
      const operationName = action.operation;
      if (
        operationName !== "withdraw" &&
        !(fresh.capabilities as Record<string, boolean>)[
          operationName === "link" ? "resolve" : operationName
        ]
      )
        throw new Error("HTTP 403: action unavailable");
      const currentMessage = action.message
        ? await fetchDiscussionMessage(projectId, threadId, action.message.id)
        : undefined;
      if (
        currentMessage &&
        (currentMessage.thread_version !== fresh.thread.version ||
          currentMessage.message.state !== "active" ||
          (operationName === "withdraw" &&
            !currentMessage.message.can_withdraw))
      )
        throw new Error("discussion_source_changed");
      if (operationName === "link" && !fresh.thread.current_resolution)
        throw new Error("discussion_source_changed");
      if (
        serial === targetSerial.current &&
        origin.current === projectSessionKey()
      )
        setLatestAction({
          operation: operationName,
          thread: fresh.thread,
          message: currentMessage?.message,
        });
    } catch (error) {
      if (
        serial === targetSerial.current &&
        origin.current === projectSessionKey()
      )
        setTargetError(error);
    } finally {
      if (
        serial === targetSerial.current &&
        origin.current === projectSessionKey()
      )
        setActionReadBusy(false);
    }
  }
  const chooseAction = (
    kind: DiscussionOperation,
    message?: DiscussionMessage,
  ) => {
    if (!thread || blocked) return;
    targetSerial.current++;
    setLatestAction(null);
    setTargetError(undefined);
    setAction({ operation: kind, thread: structuredClone(thread), message });
    setTargetKind(thread.subject.kind);
    setTargetId(thread.subject.id);
    setTargetBasis(null);
    setTargetTitle("");
    operation.patch({ body: "" });
  };
  async function loadTarget() {
    const serial = ++targetSerial.current;
    setTargetBusy(true);
    setTargetError(undefined);
    try {
      const value = await fetchDiscussionReference(projectId, {
        kind: targetKind,
        id: targetId.trim(),
        field: "title",
      });
      if (
        serial === targetSerial.current &&
        origin.current === projectSessionKey()
      ) {
        setTargetBasis(
          value.reference.status === "available"
            ? value.target_content_basis
            : null,
        );
        setTargetTitle(value.reference.text || "");
      }
    } catch (error) {
      if (
        serial === targetSerial.current &&
        origin.current === projectSessionKey()
      )
        setTargetError(error);
    } finally {
      if (
        serial === targetSerial.current &&
        origin.current === projectSessionKey()
      )
        setTargetBusy(false);
    }
  }
  function adopt(kind: DiscussionAdoptAction) {
    if (!thread || !conclusion || !onAdopt || blocked) return;
    onAdopt(kind, {
      reference: discussionSource(thread, conclusion),
      thread: structuredClone(thread),
      message: structuredClone(conclusion),
      field,
    });
  }
  if (detailQuery.isPending) return <Skeleton active />;
  if (detailQuery.error)
    return (
      <DiscussionProblem
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  if (!thread || mismatch)
    return <DiscussionProblem error={new Error("discussion_scope_changed")} />;
  const editable =
    detail.permissions.write &&
    !thread.subject.missing &&
    thread.state !== "archived";
  return (
    <section className="delivery-discussion">
      <div className="discussion-heading">
        <Button onClick={onBack} disabled={blocked}>
          {tr("back")}
        </Button>
        <Button
          loading={detailQuery.isFetching}
          disabled={blocked}
          onClick={() => void refresh()}
        >
          {tr("refresh")}
        </Button>
      </div>
      <header>
        <h3>{thread.title}</h3>
        <Tag>{tr(thread.state)}</Tag>
        <p className="discussion-meta">
          {tr(thread.subject.kind)} ·{" "}
          {thread.subject.title || thread.subject.id} ·{" "}
          {thread.created_by.name || thread.created_by.id} · {thread.created_at}
        </p>
        <Button
          size="small"
          disabled={thread.subject.missing || nav.busy || blocked}
          onClick={() => void nav.open(projectId, thread.subject)}
        >
          {tr("openTarget")}
        </Button>
      </header>
      {thread.subject.missing && (
        <Alert type="warning" title={tr("missingSubject")} />
      )}{" "}
      {Boolean(nav.error) && <DiscussionProblem error={nav.error} />}
      {operation.failure && (
        <DiscussionProblem
          error={
            new Error(
              `HTTP ${operation.failure.status}: ${JSON.stringify({ detail: { code: operation.failure.code, message: operation.failure.message } })}`,
            )
          }
          onRetry={() => void refresh()}
        />
      )}
      {operation.unknown && (
        <Alert
          type="warning"
          title={tr("unknown")}
          action={
            <Button
              loading={operation.busy}
              onClick={() => void submitAction(true)}
            >
              {tr("retryOriginal")}
            </Button>
          }
        />
      )}
      <div className="discussion-actions">
        {(["reopen", "archive", "restore"] as const)
          .filter((value) => detail.capabilities[value])
          .map((value) => (
            <Button
              key={value}
              disabled={blocked}
              onClick={() => chooseAction(value)}
            >
              {tr(value)}
            </Button>
          ))}
      </div>
      {resolution && (
        <section className="discussion-resolution">
          <h4>{tr("conclusion")}</h4>
          {resolutionQuery.error ? (
            <DiscussionProblem
              error={resolutionQuery.error}
              onRetry={() => void resolutionQuery.refetch()}
            />
          ) : !conclusion ? (
            <Alert type="warning" title={tr("sourceChanged")} />
          ) : (
            <>
              <p className="discussion-text">{conclusion.body}</p>
              <small>
                {conclusion.author.name || conclusion.author.id} ·{" "}
                {t("deliveryDiscussion.revision", {
                  revision: conclusion.revision,
                })}
              </small>
              <DiscussionReferences refs={conclusion.refs} />
              <p className="discussion-help">{tr("resolveHint")}</p>
              {editable && (
                <>
                  <label>
                    {tr("adoptField")}
                    <Select
                      aria-label={tr("adoptField")}
                      value={field}
                      onChange={setField}
                      options={["description", "acceptance_criteria"].map(
                        (value) => ({ value, label: tr(value) }),
                      )}
                    />
                  </label>
                  <p className="discussion-help">{tr("adoptHint")}</p>
                  <div className="discussion-actions">
                    <Button
                      disabled={blocked}
                      onClick={() => chooseAction("link")}
                    >
                      {tr("link")}
                    </Button>
                    {onAdopt && thread.subject.kind === "requirement" && (
                      <Button
                        disabled={blocked}
                        onClick={() => adopt("requirement")}
                      >
                        {tr("adoptRequirement")}
                      </Button>
                    )}
                    {onAdopt && thread.subject.kind === "task" && (
                      <Button disabled={blocked} onClick={() => adopt("task")}>
                        {tr("adoptTask")}
                      </Button>
                    )}
                    {onAdopt &&
                      (thread.subject.kind === "requirement" ||
                        (thread.subject.kind === "task" &&
                          thread.subject.current_requirement_id)) && (
                        <Button
                          disabled={blocked}
                          onClick={() => adopt("plan")}
                        >
                          {tr("adoptPlan")}
                        </Button>
                      )}
                    {onAdopt && thread.subject.kind === "issue" && (
                      <>
                        <Button
                          disabled={blocked}
                          onClick={() => adopt("issue")}
                        >
                          {tr("adoptIssue")}
                        </Button>
                        <Button
                          disabled={blocked}
                          onClick={() => adopt("diagnosis")}
                        >
                          {tr("adoptDiagnosis")}
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}
      <Collapse
        size="small"
        items={[
          {
            key: "links",
            label: tr("adoptionRecords"),
            children: links.error ? (
              <DiscussionProblem
                error={links.error}
                onRetry={() => void links.refetch()}
                onReset={() => setLinkWindow({ page: 1, cursor: "" })}
              />
            ) : links.data ? (
              <>
                <DeliverySourceRecords
                  projectId={projectId}
                  page={links.data}
                  identity={`${identity}:links`}
                  onNavigate={onNavigate}
                />
                <DiscussionPager
                  page={linkWindow.page}
                  total={links.data.total}
                  hasMore={links.data.has_more}
                  onFirst={() => {
                    setLinkWindow({ page: 1, cursor: "" });
                    void links.refetch();
                  }}
                  onNext={() =>
                    links.data?.next_cursor &&
                    setLinkWindow({
                      page: linkWindow.page + 1,
                      cursor: links.data.next_cursor,
                    })
                  }
                />
              </>
            ) : (
              <Skeleton active />
            ),
          },
        ]}
      />
      {originalQuery.data && (
        <aside className="discussion-fixed-source">
          <h4>{tr("originalVersion")}</h4>
          <small>
            {t("deliveryDiscussion.revision", {
              revision: originalQuery.data.version.revision,
            })}{" "}
            · {originalQuery.data.version.editor.name}
          </small>
          <p className="discussion-text">
            {originalQuery.data.version.body || tr("withdrawn")}
          </p>
          <DiscussionReferences refs={originalQuery.data.version.refs} />
        </aside>
      )}
      {originalQuery.error && (
        <DiscussionProblem
          error={originalQuery.error}
          onRetry={() => void originalQuery.refetch()}
        />
      )}
      {route.message && exactQuery.error && (
        <DiscussionProblem
          error={exactQuery.error}
          onRetry={() => void exactQuery.refetch()}
        />
      )}{" "}
      {selected && !messages?.items.some((item) => item.id === selected.id) && (
        <>
          <h4>{tr("selectedMessage")}</h4>
          <MessageCard
            message={selected}
            projectId={projectId}
            threadId={threadId}
            disabled={!editable || blocked}
            onReply={() => {
              setReplyTo(selected.id);
              setEdit(null);
            }}
            onEdit={() => setEdit(selected)}
            onAction={(kind) => chooseAction(kind, selected)}
          />
        </>
      )}
      {messagesQuery.isPending && <Skeleton active />}
      {messagesQuery.error ? (
        <DiscussionProblem
          error={messagesQuery.error}
          onRetry={() => void messagesQuery.refetch()}
          onReset={() => onRoute({ messageCursor: "", messagePage: 1 })}
        />
      ) : messages ? (
        <>
          <div className="discussion-messages">
            {!messages.items.length && <DiscussionEmpty />}
            {messages.items.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                projectId={projectId}
                threadId={threadId}
                disabled={!editable || blocked}
                onReply={() => {
                  setReplyTo(message.id);
                  setEdit(null);
                }}
                onEdit={() => setEdit(message)}
                onAction={(kind) => chooseAction(kind, message)}
              />
            ))}
          </div>
          <DiscussionPager
            page={route.messagePage}
            total={messages.total}
            hasMore={messages.has_more}
            busy={messagesQuery.isFetching}
            onFirst={() => {
              onRoute({ messageCursor: "", messagePage: 1 });
              void messagesQuery.refetch();
            }}
            onNext={() =>
              messages.next_cursor &&
              onRoute({
                messageCursor: messages.next_cursor,
                messagePage: route.messagePage + 1,
              })
            }
          />
        </>
      ) : (
        thread && <Alert type="warning" title={tr("stale")} />
      )}
      {editable && (
        <DiscussionComposer
          key={`${threadId}:${edit?.id || "reply"}:${replyTo || ""}`}
          projectId={projectId}
          subject={thread.subject}
          threadId={threadId}
          message={edit || undefined}
          replyTo={replyTo}
          identity={identity}
          readOnly={
            operation.busy ||
            operation.unknown ||
            (!detail.capabilities.reply && !edit)
          }
          onSaved={saved}
          onCancel={
            edit || replyTo
              ? () => {
                  setEdit(null);
                  setReplyTo(null);
                }
              : undefined
          }
          onUnresolvedChange={(value) => setPending("composer", value)}
        />
      )}
      {action && (
        <Modal
          open
          title={tr(action.operation)}
          onCancel={() => {
            if (!blocked) {
              targetSerial.current++;
              setAction(null);
              setLatestAction(null);
            }
          }}
          maskClosable={false}
          keyboard={!blocked}
          closable={!blocked}
          confirmLoading={operation.busy}
          okText={tr("confirm")}
          okButtonProps={{
            disabled:
              operation.unknown ||
              Boolean(operation.failure?.conflict) ||
              (action.operation === "link" && !targetBasis),
          }}
          onOk={() => void submitAction()}
          cancelButtonProps={{ disabled: blocked }}
        >
          {operation.failure?.conflict && (
            <>
              <DiscussionProblem
                error={new Error(`HTTP 409: ${operation.failure.message}`)}
              />
              <Button
                loading={actionReadBusy}
                onClick={() => void readActionLatest()}
              >
                {tr("loadLatest")}
              </Button>
              {Boolean(targetError) && (
                <DiscussionProblem error={targetError} />
              )}{" "}
              {latestAction && (
                <>
                  <p>
                    {latestAction.thread.title} · v{latestAction.thread.version}
                  </p>
                  {latestAction.message && (
                    <p className="discussion-text">
                      {latestAction.message.body}
                    </p>
                  )}
                  <Button
                    onClick={() => {
                      setAction(latestAction);
                      setLatestAction(null);
                      setTargetBasis(null);
                      operation.resetFailure();
                    }}
                  >
                    {tr("adoptLatest")}
                  </Button>
                </>
              )}
            </>
          )}
          <p className="discussion-help">
            {tr(action.operation === "link" ? "linkHint" : "resolveHint")}
          </p>
          {action.operation === "link" ? (
            <div className="discussion-reference-form">
              <label>
                {tr("kind")}
                <Select
                  value={targetKind}
                  disabled={blocked}
                  options={["requirement", "task", "issue"].map((value) => ({
                    value,
                    label: tr(value),
                  }))}
                  onChange={(value) => {
                    targetSerial.current++;
                    setTargetKind(value);
                    setTargetBasis(null);
                  }}
                />
              </label>
              <label>
                {tr("subject")}
                <DiscussionObjectSelect
                  key={`${projectId}:${targetKind}`}
                  projectId={projectId}
                  kind={targetKind}
                  disabled={blocked}
                  value={targetId}
                  onChange={(value) => {
                    targetSerial.current++;
                    setTargetId(value);
                    setTargetBasis(null);
                    setTargetTitle("");
                  }}
                />
              </label>
              <Button
                disabled={blocked}
                loading={targetBusy}
                onClick={() => void loadTarget()}
              >
                {tr("readTarget")}
              </Button>
              {targetTitle && <p>{targetTitle}</p>}
              {Boolean(targetError) && (
                <DiscussionProblem error={targetError} />
              )}
            </div>
          ) : (
            <label>
              {tr("reason")}
              <Input.TextArea
                maxLength={2000}
                value={operation.draft.body}
                disabled={blocked}
                onChange={(event) =>
                  operation.patch({ body: event.target.value })
                }
              />
            </label>
          )}
        </Modal>
      )}
    </section>
  );
}
