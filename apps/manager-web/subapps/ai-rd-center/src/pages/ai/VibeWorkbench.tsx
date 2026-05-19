import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Flex, Form, Input, List, Modal, Popconfirm, Select, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchQueryGate, WorkbenchStats } from "@/pages/shared/workbenchUi";

type VibeMessage = { role?: string; content?: string; text?: string };

function renderMessageText(msg: VibeMessage): string {
  return String(msg.content ?? msg.text ?? JSON.stringify(msg));
}

export function VibeWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tool, setTool] = useState("claude");
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ title: string }>();

  const sessionsQ = useQuery({ queryKey: ["vibeSessions"], queryFn: api.vibeSessions });
  const templatesQ = useQuery({ queryKey: ["vibeTemplates"], queryFn: api.vibeTemplates });
  const sessionQ = useQuery({
    queryKey: ["vibeSession", sessionId],
    queryFn: () => api.vibeSession(sessionId),
    enabled: Boolean(sessionId),
  });

  const sessions = sessionsQ.data?.sessions ?? [];
  const templates = templatesQ.data ?? [];

  useEffect(() => {
    if (!sessionId && sessions[0]?.id) setSessionId(String(sessions[0].id));
  }, [sessions, sessionId]);

  const createMut = useMutation({
    mutationFn: (title: string) => api.vibeCreateSession({ title: title || t("page.vibe.newSession") }),
    onSuccess: (data) => {
      setCreateOpen(false);
      form.resetFields();
      const id = String(data?.session?.id || "");
      if (id) setSessionId(id);
      message.success(t("page.vibe.sessionCreated"));
      void qc.invalidateQueries({ queryKey: ["vibeSessions"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.vibeDeleteSession(id),
    onSuccess: (_, id) => {
      message.success(t("page.vibe.sessionDeleted"));
      if (sessionId === id) setSessionId("");
      void qc.invalidateQueries({ queryKey: ["vibeSessions"] });
      void qc.invalidateQueries({ queryKey: ["vibeSession", id] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const runMut = useMutation({
    mutationFn: () =>
      api.vibeRun({
        tool,
        prompt,
        memory_context: sessionQ.data?.memory || undefined,
      }),
    onSuccess: (data) => {
      setPrompt("");
      if (data?.ok === false) message.warning(String(data.error || t("common.error", { msg: "run failed" })));
      else message.success(t("page.vibe.runDone"));
      void qc.invalidateQueries({ queryKey: ["vibeSession", sessionId] });
      void qc.invalidateQueries({ queryKey: ["vibeSessions"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const messages: VibeMessage[] = useMemo(() => {
    const raw = sessionQ.data?.messages;
    return Array.isArray(raw) ? raw : [];
  }, [sessionQ.data?.messages]);

  const lastOutput = runMut.data?.output ? String(runMut.data.output) : "";

  return (
    <WorkbenchShell
      title={t("page.vibe.title")}
      description={focused ? t("page.vibe.focusedHint") : t("page.vibe.desc")}
      actions={
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          {t("page.vibe.newSession")}
        </Button>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.vibe.sessions"), value: sessions.length },
            { label: t("page.vibe.messages"), value: messages.length },
            { label: t("page.vibe.tool"), value: tool },
          ]}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <WorkbenchPanel title={t("page.vibe.sessionList")}>
          <List
            size="small"
            loading={sessionsQ.isLoading}
            dataSource={sessions}
            locale={{ emptyText: <Empty description={t("page.vibe.noSessions")} /> }}
            renderItem={(item: { id?: string; title?: string }) => (
              <List.Item
                className={`cursor-pointer rounded-lg !px-2 ${sessionId === item.id ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-muted)]"}`}
                onClick={() => setSessionId(String(item.id))}
                actions={[
                  <Popconfirm
                    key="del"
                    title={t("page.vibe.deleteConfirm")}
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      deleteMut.mutate(String(item.id));
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={deleteMut.isPending && deleteMut.variables === item.id}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("page.vibe.deleteSession")}
                    />
                  </Popconfirm>,
                ]}
              >
                <Typography.Text ellipsis>{item.title || item.id}</Typography.Text>
              </List.Item>
            )}
          />
        </WorkbenchPanel>

        <WorkbenchPanel
          title={sessionQ.data?.title || t("page.vibe.chat")}
          actions={
            <Select
              size="small"
              className="min-w-36"
              placeholder={t("page.vibe.template")}
              allowClear
              options={templates.map((tpl: { id: string; name: string }) => ({ value: tpl.id, label: tpl.name }))}
              onChange={(id) => {
                const tpl = templates.find((x: { id: string }) => x.id === id);
                if (tpl?.template) setPrompt(String(tpl.template));
              }}
            />
          }
        >
          <WorkbenchQueryGate query={sessionQ}>
            <div className="mb-4 max-h-[42vh] min-h-[12rem] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              {messages.length ? (
                <List
                  size="small"
                  dataSource={messages}
                  renderItem={(msg, i) => (
                    <List.Item key={i} className="!border-0 !px-0 !py-2">
                      <div className="w-full rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
                        {msg.role ? <TagMini role={msg.role} /> : null}
                        <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-xs">{renderMessageText(msg)}</Typography.Paragraph>
                      </div>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("page.vibe.emptyChat")} />
              )}
              {lastOutput ? (
                <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-3">
                  <Typography.Text type="secondary" className="text-xs">
                    {t("page.vibe.lastOutput")}
                  </Typography.Text>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{lastOutput}</pre>
                </div>
              ) : null}
            </div>

            <Flex vertical gap="middle">
              <Select
                value={tool}
                onChange={setTool}
                options={["claude", "codex", "aider", "opencode", "direct-llm"].map((x) => ({ value: x, label: x }))}
              />
              <Input.TextArea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("page.vibe.promptPh")} />
              <Button type="primary" block loading={runMut.isPending} disabled={!prompt.trim()} onClick={() => runMut.mutate()}>
                {t("page.vibe.run")}
              </Button>
            </Flex>
          </WorkbenchQueryGate>
        </WorkbenchPanel>
      </div>

      <Modal
        title={t("page.vibe.newSession")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v.title)}>
          <Form.Item name="title" label={t("page.vibe.sessionTitlePh")}>
            <Input placeholder={t("page.vibe.sessionTitlePh")} />
          </Form.Item>
        </Form>
      </Modal>
    </WorkbenchShell>
  );
}

function TagMini({ role }: { role: string }) {
  return (
    <span className="mb-1 inline-block rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--brand)]">
      {role}
    </span>
  );
}
