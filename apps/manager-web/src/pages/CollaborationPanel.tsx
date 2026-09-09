import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  App,
  Badge,
  Button,
  Collapse,
  Drawer,
  Empty,
  Form,
  Grid,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  Edit3,
  Hash,
  MessageSquare,
  Plus,
  RefreshCw,
  Reply,
  Settings,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  HermesUnavailableError,
  type HermesApiResponse,
  type HermesChannelConfigure,
  type HermesClient,
  type HermesCollaborationAction,
  type HermesEntity,
  type HermesMessageSend,
  type HermesThreadCreate,
} from "../lib/hermes";

type Draft =
  | { kind: "channel"; id: string; body: HermesChannelConfigure }
  | { kind: "thread"; body: HermesThreadCreate }
  | { kind: "message"; body: HermesMessageSend }
  | {
      kind: "edit";
      id: string;
      body: HermesCollaborationAction & { body: string; mentions: string[] };
    }
  | {
      kind: "archive";
      resource: "threads" | "messages";
      id: string;
      body: HermesCollaborationAction;
    };

type Editor = {
  kind: "channel" | "thread" | "edit" | "archive";
  entity?: HermesEntity;
  resource?: "threads" | "messages";
};
type Fields = {
  id: string;
  title: string;
  members: string[];
  description: string;
  archived: boolean;
  body: string;
  mentions: string[];
};
type Preview = {
  fingerprint: string;
  draft: Draft;
  response: HermesApiResponse;
};

export function collaborationFingerprint(draft: Draft) {
  return JSON.stringify({ ...draft, body: { ...draft.body, dry_run: true } });
}

export function canEditMessage(
  entity: HermesEntity,
  actor: string,
  permissions: Set<string>,
) {
  return (
    entity.status === "active" &&
    permissions.has("write") &&
    (entity.data.author === actor || permissions.has("config"))
  );
}

function title(entity?: HermesEntity) {
  return String(entity?.data.title || entity?.id || "");
}
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function stamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function key() {
  return `collaboration-${crypto.randomUUID()}`;
}

export function CollaborationPanel({
  client,
  workspaceReady,
  connected,
  permissions,
  scopeKey,
}: {
  client: HermesClient;
  workspaceReady: boolean;
  connected: boolean;
  permissions: Set<string>;
  scopeKey: string;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<Fields>();
  const [channelId, setChannelId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [tab, setTab] = useState("channels");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [preview, setPreview] = useState<Preview>();
  const [evidence, setEvidence] = useState<HermesApiResponse>();
  const [reply, setReply] = useState<HermesEntity>();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [requestKey, setRequestKey] = useState(key);
  const [error, setError] = useState<unknown>();
  const enabled = workspaceReady && connected && permissions.has("read");
  const canWrite = enabled && permissions.has("write");
  const canConfig = enabled && permissions.has("config");
  const queryKey = ["hermes", "collaboration", scopeKey];
  const channels = useQuery({
    queryKey: [...queryKey, "channels", includeArchived],
    queryFn: () => client.collaborationChannels(includeArchived),
    enabled,
    refetchInterval: enabled ? 10000 : false,
  });
  const members = useQuery({
    queryKey: [...queryKey, "members"],
    queryFn: () => client.collaborationMembers(),
    enabled,
  });
  const inbox = useQuery({
    queryKey: [...queryKey, "inbox"],
    queryFn: () => client.collaborationInbox(),
    enabled,
    refetchInterval: enabled ? 5000 : false,
  });
  const threads = useInfiniteQuery({
    queryKey: [...queryKey, "threads", channelId, includeArchived],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      client.collaborationThreads(channelId, {
        cursor: pageParam,
        limit: 100,
        include_archived: includeArchived,
      }),
    getNextPageParam: (last) =>
      last.items.length === 100
        ? String(last.summary?.cursor || "") || undefined
        : undefined,
    enabled: enabled && !!channelId,
    refetchInterval: enabled && channelId ? 5000 : false,
  });
  const messages = useInfiniteQuery({
    queryKey: [...queryKey, "messages", threadId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      client.collaborationMessages(threadId, pageParam),
    getNextPageParam: (last) =>
      last.items.length === 100
        ? Number(last.summary?.cursor || 0) || undefined
        : undefined,
    enabled: enabled && !!threadId,
    refetchInterval: enabled && threadId ? 5000 : false,
  });
  const actor = String(channels.data?.audit?.actor || "");
  const channel = channels.data?.items.find((item) => item.id === channelId);
  const threadRows = threads.data?.pages.flatMap((page) => page.items) || [];
  const thread = threadRows.find((item) => item.id === threadId);
  const messageRows = messages.data?.pages.flatMap((page) => page.items) || [];
  const channelMembers = stringList(channel?.data.members);
  const channelWritable = canWrite && channel?.status === "active";
  const writable = channelWritable && thread?.status === "active";
  const unread = inbox.data?.items || [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const resetPreview = () => {
    setPreview(undefined);
    setRequestKey(key());
    setError(undefined);
  };
  const openChannel = (id: string) => {
    setChannelId(id);
    setThreadId("");
    setReply(undefined);
    setBody("");
    setMentions([]);
    resetPreview();
  };
  const openThread = (id: string) => {
    setThreadId(id);
    setReply(undefined);
    setBody("");
    setMentions([]);
    resetPreview();
  };

  async function execute(draft: Draft, dryRun: boolean) {
    const actionBody = { ...draft.body, dry_run: dryRun };
    switch (draft.kind) {
      case "channel":
        return client.collaborationConfigureChannel(draft.id, {
          ...draft.body,
          dry_run: dryRun,
        });
      case "thread":
        return client.collaborationCreateThread({
          ...draft.body,
          dry_run: dryRun,
        });
      case "message":
        return client.collaborationSendMessage({
          ...draft.body,
          dry_run: dryRun,
        });
      case "edit":
        return client.collaborationEditMessage(draft.id, {
          ...draft.body,
          dry_run: dryRun,
        });
      case "archive":
        return client.collaborationArchive(
          draft.resource,
          draft.id,
          actionBody,
        );
    }
  }
  const mutation = useMutation({
    mutationFn: async ({
      draft,
      dryRun,
    }: {
      draft: Draft;
      dryRun: boolean;
    }) => ({ response: await execute(draft, dryRun), draft, dryRun }),
    onSuccess: ({ response, draft, dryRun }) => {
      setError(undefined);
      if (dryRun) {
        setPreview({
          fingerprint: collaborationFingerprint(draft),
          draft,
          response,
        });
        return;
      }
      setEvidence(response);
      setPreview(undefined);
      setRequestKey(key());
      setEditor(undefined);
      if (draft.kind === "message") {
        setBody("");
        setMentions([]);
        setReply(undefined);
      }
      if (draft.kind === "channel") {
        setChannelId(response.items[0]?.id || draft.id);
        setThreadId("");
      }
      if (draft.kind === "thread") setThreadId(response.items[0]?.id || "");
      if (draft.kind === "archive" && draft.resource === "threads")
        setThreadId("");
      void invalidate();
      message.success(t("collaboration.saved"));
    },
    onError: (err) => {
      setError(err);
      setPreview(undefined);
      if (err instanceof HermesUnavailableError && err.status === 409)
        void invalidate();
    },
  });
  const markRead = useMutation({
    mutationFn: (item: HermesEntity) =>
      client.collaborationMarkRead({
        channel_id: String(item.data.channel_id),
        thread_id: String(item.data.thread_id),
        cursor: Number(item.data.event_seq),
        idempotency_key: key(),
        dry_run: false,
      }),
    onSuccess: (response) => {
      setEvidence(response);
      void invalidate();
    },
    onError: setError,
  });
  const busy = mutation.isPending;

  function openEditor(next: Editor) {
    resetPreview();
    setEditor(next);
    form.resetFields();
    const data = next.entity?.data;
    form.setFieldsValue({
      id: next.entity?.id || "",
      title: title(next.entity),
      members: stringList(data?.members).length
        ? stringList(data?.members)
        : actor
          ? [actor]
          : [],
      description: String(data?.description || ""),
      archived: next.entity?.status === "archived",
      body: String(data?.body || ""),
      mentions: stringList(data?.mentions),
    });
  }

  async function editorDraft(): Promise<Draft> {
    const values = await form.validateFields();
    const action = {
      idempotency_key: requestKey,
      dry_run: true,
      expected_version: editor?.entity?.version,
    };
    if (editor?.kind === "channel")
      return {
        kind: "channel",
        id: values.id,
        body: {
          ...action,
          title: values.title.trim(),
          members: values.members,
          description: values.description || "",
          archived: !!values.archived,
        },
      };
    if (editor?.kind === "thread")
      return {
        kind: "thread",
        body: {
          ...action,
          channel_id: channelId,
          title: values.title.trim(),
          body: values.body || "",
          mentions: values.mentions || [],
        },
      };
    if (editor?.kind === "edit" && editor.entity)
      return {
        kind: "edit",
        id: editor.entity.id,
        body: {
          ...action,
          body: values.body.trim(),
          mentions: values.mentions || [],
        },
      };
    if (editor?.kind === "archive" && editor.entity && editor.resource)
      return {
        kind: "archive",
        id: editor.entity.id,
        resource: editor.resource,
        body: action,
      };
    throw new Error("No active collaboration action");
  }

  const messageDraft: Draft = {
    kind: "message",
    body: {
      channel_id: channelId,
      thread_id: threadId,
      parent_id: reply?.id || "",
      body: body.trim(),
      mentions,
      idempotency_key: requestKey,
      dry_run: true,
    },
  };
  const messagePreviewCurrent =
    preview?.draft.kind === "message" &&
    preview.fingerprint === collaborationFingerprint(messageDraft);
  async function submitEditor(apply: boolean) {
    try {
      const draft = await editorDraft();
      if (
        apply &&
        (!preview || preview.fingerprint !== collaborationFingerprint(draft))
      )
        return;
      mutation.mutate({ draft, dryRun: !apply });
    } catch (err) {
      if (err instanceof Error) setError(err);
    }
  }

  const failure =
    error ||
    channels.error ||
    threads.error ||
    messages.error ||
    inbox.error ||
    members.error;
  const errorMessage =
    failure instanceof Error ? failure.message : String(failure || "");
  const evidenceView = (result: HermesApiResponse) => (
    <Collapse
      size="small"
      items={[
        {
          key: "audit",
          label: t("collaboration.evidence"),
          children: (
            <>
              <Typography.Text copyable>{result.trace_id}</Typography.Text>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(
                  {
                    audit: result.audit,
                    summary: result.summary,
                    cli: result.cli,
                  },
                  null,
                  2,
                )}
              </pre>
            </>
          ),
        },
      ]}
    />
  );
  const empty = (label: string) => (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={t(`collaboration.${label}`)}
    />
  );
  const iconButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip title={t(`collaboration.${label}`)}>
      <Button
        aria-label={t(`collaboration.${label}`)}
        icon={icon}
        onClick={onClick}
        disabled={disabled}
      />
    </Tooltip>
  );

  if (!connected || !workspaceReady)
    return <Alert type="info" showIcon title={t("collaboration.offline")} />;
  if (!permissions.has("read"))
    return <Alert type="warning" showIcon title={t("collaboration.denied")} />;

  return (
    <section aria-label={t("collaboration.tab")}>
      {failure ? (
        <Alert
          className="mb-3"
          type="error"
          showIcon
          title={t("collaboration.error")}
          description={errorMessage}
          action={
            <Button
              onClick={() => {
                setError(undefined);
                void invalidate();
              }}
            >
              {t("collaboration.refresh")}
            </Button>
          }
        />
      ) : null}
      {!canWrite ? (
        <Alert
          className="mb-3"
          type="info"
          showIcon
          title={t("collaboration.readOnly")}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b">
        <Tabs
          activeKey={tab}
          onChange={(value) => {
            if (!busy) setTab(value);
          }}
          items={[
            { key: "channels", label: t("collaboration.channels") },
            {
              key: "inbox",
              label: (
                <Badge count={unread.length} size="small" offset={[10, 0]}>
                  {t("collaboration.inbox")}
                </Badge>
              ),
            },
          ]}
        />
        <Space>
          {iconButton(
            "refresh",
            <RefreshCw size={16} />,
            () => {
              void invalidate();
            },
            busy,
          )}
          {iconButton(
            "newChannel",
            <Plus size={16} />,
            () => openEditor({ kind: "channel" }),
            !canConfig || busy,
          )}
        </Space>
      </div>
      {tab === "inbox" ? (
        <div aria-live="polite" className="py-3">
          {inbox.isLoading ? (
            <Spin />
          ) : !unread.length ? (
            empty("noUnread")
          ) : (
            unread.map((item) => (
              <article
                key={item.id}
                className="flex items-start gap-3 border-b py-3"
              >
                <MessageSquare size={18} className="mt-1 shrink-0" />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    openChannel(String(item.data.channel_id));
                    openThread(String(item.data.thread_id));
                    setTab("channels");
                  }}
                >
                  <div className="flex flex-wrap gap-x-3 text-sm">
                    <strong>{String(item.data.author)}</strong>
                    <span className="text-[var(--text-secondary)]">
                      {stamp(item.created_at)}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm">
                    {String(item.data.body)}
                  </div>
                </button>
                {iconButton(
                  "read",
                  <CheckCheck size={16} />,
                  () => markRead.mutate(item),
                  !canWrite || markRead.isPending,
                )}
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="grid min-h-[400px] grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
          {screens.md || !channelId ? (
            <aside className="min-w-0 border-r p-3 pl-0">
              <Input.Search
                aria-label={t("collaboration.search")}
                placeholder={t("collaboration.search")}
                allowClear
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="my-3 flex items-center justify-between gap-2 text-sm">
                <span>{t("collaboration.archived")}</span>
                <Switch
                  size="small"
                  aria-label={t("collaboration.archived")}
                  checked={includeArchived}
                  disabled={busy}
                  onChange={(value) => {
                    setIncludeArchived(value);
                    setThreadId("");
                    resetPreview();
                  }}
                />
              </div>
              {channels.isLoading ? (
                <Spin />
              ) : !channels.data?.items.length ? (
                empty("noChannels")
              ) : (
                channels.data.items
                  .filter((item) =>
                    title(item)
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map((item) => (
                    <Button
                      key={item.id}
                      type={item.id === channelId ? "primary" : "text"}
                      block
                      className="mb-1 justify-start overflow-hidden"
                      icon={<Hash size={16} />}
                      disabled={busy}
                      onClick={() => openChannel(item.id)}
                    >
                      <span className="truncate">{title(item)}</span>
                    </Button>
                  ))
              )}
            </aside>
          ) : null}
          {screens.md || channelId ? (
            <main className="min-w-0 p-3">
              {!channel ? (
                empty("selectChannel")
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {!screens.md
                        ? iconButton("back", <ArrowLeft size={16} />, () =>
                            threadId ? openThread("") : openChannel(""),
                          )
                        : null}
                      <Typography.Text
                        strong
                        ellipsis={{ tooltip: title(channel) }}
                      >
                        {title(channel)}
                      </Typography.Text>
                      <Tag>
                        {t("collaboration.memberCount", {
                          count: channelMembers.length,
                        })}
                      </Tag>
                    </div>
                    <Space>
                      {iconButton(
                        "configure",
                        <Settings size={16} />,
                        () => openEditor({ kind: "channel", entity: channel }),
                        !canConfig || busy,
                      )}
                      <Button
                        icon={<Plus size={16} />}
                        disabled={!channelWritable || busy}
                        onClick={() => openEditor({ kind: "thread" })}
                      >
                        {t("collaboration.newThread")}
                      </Button>
                    </Space>
                  </div>
                  {channel.status !== "active" ? (
                    <Alert
                      className="mb-3"
                      type="info"
                      title={t("collaboration.channelArchived")}
                    />
                  ) : null}
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                    {!threadId || screens.xl ? (
                      <nav
                        aria-label={t("collaboration.threads")}
                        className="min-w-0"
                      >
                        {threads.isLoading ? (
                          <Spin />
                        ) : !threadRows.length ? (
                          empty("noThreads")
                        ) : (
                          threadRows.map((item) => (
                            <Button
                              key={item.id}
                              type={item.id === threadId ? "primary" : "text"}
                              block
                              className="mb-1 justify-start overflow-hidden"
                              disabled={busy}
                              onClick={() => openThread(item.id)}
                            >
                              <span className="truncate">{title(item)}</span>
                              {item.status === "archived" ? (
                                <Tag>{t("collaboration.archived")}</Tag>
                              ) : null}
                            </Button>
                          ))
                        )}
                        {threads.hasNextPage ? (
                          <Button
                            loading={threads.isFetchingNextPage}
                            onClick={() => {
                              void threads.fetchNextPage();
                            }}
                          >
                            {t("collaboration.more")}
                          </Button>
                        ) : null}
                      </nav>
                    ) : null}
                    {threadId ? (
                      <div className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
                          {!screens.xl && screens.md
                            ? iconButton("back", <ArrowLeft size={16} />, () =>
                                openThread(""),
                              )
                            : null}
                          <Typography.Text
                            strong
                            ellipsis={{ tooltip: title(thread) }}
                          >
                            {title(thread)}
                          </Typography.Text>
                          {thread &&
                          (thread.data.created_by === actor || canConfig)
                            ? iconButton(
                                "archive",
                                <Archive size={16} />,
                                () =>
                                  openEditor({
                                    kind: "archive",
                                    entity: thread,
                                    resource: "threads",
                                  }),
                                !writable || busy,
                              )
                            : null}
                        </div>
                        <div
                          aria-live="polite"
                          className="max-h-[480px] overflow-y-auto"
                        >
                          {messages.isLoading ? (
                            <Spin />
                          ) : !messageRows.length ? (
                            empty("noMessages")
                          ) : (
                            messageRows.map((item) => (
                              <article key={item.id} className="border-b py-3">
                                <header className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <strong>{String(item.data.author)}</strong>
                                    <time dateTime={item.created_at}>
                                      {stamp(item.created_at)}
                                    </time>
                                    {item.data.edited_at ? (
                                      <Tag>{t("collaboration.edited")}</Tag>
                                    ) : null}
                                  </div>
                                  <Space size={4}>
                                    {iconButton(
                                      "reply",
                                      <Reply size={14} />,
                                      () => {
                                        setReply(item);
                                        resetPreview();
                                      },
                                      !writable || busy,
                                    )}
                                    {canEditMessage(
                                      item,
                                      actor,
                                      permissions,
                                    ) ? (
                                      <>
                                        {iconButton(
                                          "edit",
                                          <Edit3 size={14} />,
                                          () =>
                                            openEditor({
                                              kind: "edit",
                                              entity: item,
                                            }),
                                          !writable || busy,
                                        )}
                                        {iconButton(
                                          "archive",
                                          <Archive size={14} />,
                                          () =>
                                            openEditor({
                                              kind: "archive",
                                              entity: item,
                                              resource: "messages",
                                            }),
                                          !writable || busy,
                                        )}
                                      </>
                                    ) : null}
                                  </Space>
                                </header>
                                {item.data.parent_id ? (
                                  <Typography.Text
                                    type="secondary"
                                    className="text-xs"
                                  >
                                    {t("collaboration.reply")} ·{" "}
                                    {String(item.data.parent_id).slice(0, 8)}
                                  </Typography.Text>
                                ) : null}
                                <p className="mb-1 mt-2 whitespace-pre-wrap break-words text-sm">
                                  {String(item.data.body)}
                                </p>
                                {stringList(item.data.mentions).map((name) => (
                                  <Tag key={name}>@{name}</Tag>
                                ))}
                              </article>
                            ))
                          )}
                          {messages.hasNextPage ? (
                            <Button
                              loading={messages.isFetchingNextPage}
                              onClick={() => {
                                void messages.fetchNextPage();
                              }}
                            >
                              {t("collaboration.more")}
                            </Button>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-2">
                          {reply ? (
                            <div className="flex items-center justify-between text-sm">
                              <span>
                                {t("collaboration.replyTo", {
                                  author: String(reply.data.author),
                                })}
                              </span>
                              {iconButton(
                                "clearReply",
                                <X size={14} />,
                                () => {
                                  setReply(undefined);
                                  resetPreview();
                                },
                                busy,
                              )}
                            </div>
                          ) : null}
                          <Input.TextArea
                            aria-label={t("collaboration.body")}
                            value={body}
                            maxLength={8000}
                            autoSize={{ minRows: 3, maxRows: 8 }}
                            disabled={!writable || busy}
                            onChange={(event) => {
                              setBody(event.target.value);
                              resetPreview();
                            }}
                          />
                          <Select
                            mode="multiple"
                            className="w-full"
                            aria-label={t("collaboration.mentions")}
                            placeholder={t("collaboration.mentions")}
                            value={mentions}
                            options={channelMembers.map((member) => ({
                              value: member,
                              label: member,
                            }))}
                            disabled={!writable || busy}
                            onChange={(value) => {
                              setMentions(value);
                              resetPreview();
                            }}
                          />
                          <Space wrap>
                            <Button
                              aria-label={t("collaboration.preview")}
                              disabled={!writable || !body.trim() || busy}
                              loading={
                                busy && preview?.draft.kind !== "message"
                              }
                              onClick={() =>
                                mutation.mutate({
                                  draft: messageDraft,
                                  dryRun: true,
                                })
                              }
                            >
                              {t("collaboration.preview")}
                            </Button>
                            <Button
                              aria-label={t("collaboration.send")}
                              type="primary"
                              disabled={
                                !writable || !messagePreviewCurrent || busy
                              }
                              onClick={() =>
                                mutation.mutate({
                                  draft: messageDraft,
                                  dryRun: false,
                                })
                              }
                            >
                              {t("collaboration.send")}
                            </Button>
                            {messagePreviewCurrent ? (
                              <Tag color="green">
                                {t("collaboration.previewReady")}
                              </Tag>
                            ) : null}
                          </Space>
                        </div>
                      </div>
                    ) : screens.xl ? (
                      empty("selectThread")
                    ) : null}
                  </div>
                </>
              )}
            </main>
          ) : null}
        </div>
      )}
      {evidence ? <div className="mt-3">{evidenceView(evidence)}</div> : null}
      <Drawer
        open={!!editor}
        width={520}
        title={
          editor?.kind === "archive"
            ? t("collaboration.archiveConfirm", { title: title(editor.entity) })
            : t(
                `collaboration.${editor?.kind === "channel" ? "configure" : editor?.kind === "thread" ? "newThread" : "edit"}`,
              )
        }
        onClose={() => {
          if (!busy) {
            setEditor(undefined);
            resetPreview();
          }
        }}
        closable={!busy}
        maskClosable={!busy}
        extra={
          <Space>
            <Button
              aria-label={t("collaboration.preview")}
              disabled={busy}
              onClick={() => {
                void submitEditor(false);
              }}
            >
              {t("collaboration.preview")}
            </Button>
            <Button
              aria-label={t("collaboration.apply")}
              type="primary"
              danger={editor?.kind === "archive"}
              loading={busy}
              disabled={!preview || busy}
              onClick={() => {
                void submitEditor(true);
              }}
            >
              {t("collaboration.apply")}
            </Button>
          </Space>
        }
      >
        {failure ? (
          <Alert className="mb-3" type="error" title={errorMessage} />
        ) : null}
        <Form
          name="hermes-collaboration-editor"
          form={form}
          layout="vertical"
          disabled={busy}
          onValuesChange={resetPreview}
        >
          {editor?.kind === "channel" ? (
            <>
              <Form.Item
                name="id"
                label={t("collaboration.channelId")}
                rules={[
                  {
                    required: true,
                    pattern: /^[A-Za-z0-9_-]{1,64}$/,
                    message: t("collaboration.invalidId"),
                  },
                ]}
              >
                <Input
                  aria-label={t("collaboration.channelId")}
                  disabled={!!editor.entity}
                  maxLength={64}
                />
              </Form.Item>
              <Form.Item
                name="title"
                label={t("collaboration.title")}
                rules={[{ required: true, whitespace: true }]}
              >
                <Input aria-label={t("collaboration.title")} maxLength={120} />
              </Form.Item>
              <Form.Item
                name="members"
                label={t("collaboration.members")}
                rules={[{ required: true }]}
              >
                <Select
                  mode="multiple"
                  loading={members.isLoading}
                  options={(members.data?.items || []).map((member) => ({
                    value: member.id,
                    label: member.id,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="description"
                label={t("collaboration.description")}
              >
                <Input.TextArea
                  maxLength={2000}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                />
              </Form.Item>
              <Form.Item
                name="archived"
                label={t("collaboration.archived")}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </>
          ) : null}
          {editor?.kind === "thread" ? (
            <Form.Item
              name="title"
              label={t("collaboration.title")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input aria-label={t("collaboration.title")} maxLength={160} />
            </Form.Item>
          ) : null}
          {editor?.kind === "thread" || editor?.kind === "edit" ? (
            <>
              <Form.Item
                name="body"
                label={t("collaboration.body")}
                rules={
                  editor.kind === "edit"
                    ? [{ required: true, whitespace: true }]
                    : []
                }
              >
                <Input.TextArea
                  aria-label={t("collaboration.body")}
                  maxLength={8000}
                  autoSize={{ minRows: 5, maxRows: 12 }}
                />
              </Form.Item>
              <Form.Item name="mentions" label={t("collaboration.mentions")}>
                <Select
                  mode="multiple"
                  options={channelMembers.map((member) => ({
                    value: member,
                    label: member,
                  }))}
                />
              </Form.Item>
            </>
          ) : null}
        </Form>
        {preview && preview.draft.kind !== "message" ? (
          <>
            <Alert
              className="mb-3"
              type="success"
              showIcon
              title={t("collaboration.previewReady")}
            />
            {evidenceView(preview.response)}
          </>
        ) : null}
      </Drawer>
    </section>
  );
}
