import { useMutation } from "@tanstack/react-query";
import { Bubble, Prompts, Sender, Welcome, type BubbleItemType } from "@ant-design/x";
import { UserOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { formatCopilotResponse } from "../../lib/copilotFormat";
import { getProjectId } from "../../lib/authStorage";
import { MarkdownView } from "../MarkdownView";

type Turn = { role: "user" | "assistant"; content: string; error?: boolean };

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

export function CopilotChatPanel({
  module,
  context,
  initialPrompt = "",
  placeholder,
  withProject = true,
  compact = false,
  maxTurns = 12,
  showWelcome = true,
  sessionId: sessionIdProp,
  runId: runIdProp,
  onMessageSent,
  onTurn,
  listHeight: listHeightProp,
}: {
  module: string;
  context?: Record<string, unknown>;
  initialPrompt?: string;
  placeholder?: string;
  withProject?: boolean;
  compact?: boolean;
  maxTurns?: number;
  showWelcome?: boolean;
  sessionId?: string;
  runId?: string;
  onMessageSent?: (text: string) => void;
  onTurn?: (payload: {
    query: string;
    response?: unknown;
    error?: string;
    sessionId: string;
    runId: string;
  }) => void;
  listHeight?: number;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialPrompt);
  const [sessionIdInternal] = useState(() => sessionIdProp || newId("cp"));
  const [runId, setRunId] = useState(() => runIdProp || newId("run"));
  const [turns, setTurns] = useState<Turn[]>([]);
  const sessionId = sessionIdProp || sessionIdInternal;

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (runIdProp) setRunId(runIdProp);
  }, [runIdProp]);

  const ask = useMutation({
    mutationFn: async (text: string) => {
      const base = {
        module,
        source: "manager-web",
        session_id: sessionId,
        run_id: runId,
        ...context,
      };
      const ctx = withProject ? { ...base, project_id: getProjectId() } : base;
      return api.copilotAsk(text, ctx, sessionId, runId);
    },
    onSuccess: (data, text) => {
      onMessageSent?.(text);
      onTurn?.({ query: text, response: data, sessionId, runId });
      setTurns((prev) => [
        ...prev.slice(-(maxTurns - 1)),
        { role: "user", content: text },
        { role: "assistant", content: formatCopilotResponse(data) },
      ]);
      setRunId(newId("run"));
      setInput("");
    },
    onError: (err, text) => {
      onMessageSent?.(text);
      onTurn?.({ query: text, error: (err as Error).message, sessionId, runId });
      setTurns((prev) => [
        ...prev.slice(-(maxTurns - 1)),
        { role: "user", content: text },
        { role: "assistant", content: (err as Error).message, error: true },
      ]);
      setRunId(newId("run"));
    },
  });

  const submit = (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    ask.mutate(q);
  };

  const bubbleItems: BubbleItemType[] = useMemo(
    () =>
      turns.map((turn, idx) => ({
        key: `${idx}-${turn.role}`,
        role: turn.role === "user" ? "user" : "ai",
        content: turn.content,
        status: turn.error ? "error" : "success",
      })),
    [turns],
  );

  const promptItems = useMemo(
    () => [
      { key: "sum", label: t("aiAssist.hintSummarize"), description: t("aiAssist.hintSummarize") },
      { key: "next", label: t("aiAssist.hintNext"), description: t("aiAssist.hintNext") },
      { key: "risk", label: t("aiAssist.hintRisks"), description: t("aiAssist.hintRisks") },
    ],
    [t],
  );

  const listHeight = listHeightProp ?? (compact ? 192 : 288);

  return (
    <div className="flex flex-col gap-3">
      <div style={{ height: listHeight }} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]">
        {turns.length === 0 && showWelcome ? (
          <div className="flex h-full items-center justify-center p-4">
            <Welcome
              variant="borderless"
              icon={<UserOutlined />}
              title={t("aiAssist.title")}
              description={t("aiAssist.empty")}
            />
          </div>
        ) : (
          <Bubble.List
            autoScroll
            items={bubbleItems}
            role={{
              ai: {
                placement: "start",
                variant: "filled",
                contentRender: (c) => <MarkdownView content={String(c ?? "")} />,
              },
              user: { placement: "end", variant: "outlined" },
            }}
            style={{ height: listHeight, padding: 12, overflow: "auto" }}
          />
        )}
        {ask.isPending ? (
          <Bubble.List
            items={[{ key: "loading", role: "ai", content: "", loading: true }]}
            style={{ padding: "0 12px 12px" }}
          />
        ) : null}
      </div>

      {!compact ? (
        <Prompts
          title={t("aiAssist.quickPrompts")}
          items={promptItems}
          onItemClick={(info) => {
            const desc = String((info.data as { description?: string })?.description ?? "");
            if (desc) setInput(desc);
          }}
          wrap
        />
      ) : null}

      <Sender
        loading={ask.isPending}
        value={input}
        onChange={(v) => setInput(v)}
        onSubmit={(msg) => submit(msg)}
        placeholder={placeholder ?? t("copilot.placeholder")}
        autoSize={compact ? { minRows: 2, maxRows: 4 } : { minRows: 2, maxRows: 6 }}
      />
    </div>
  );
}

