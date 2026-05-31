import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Empty, Input, Segmented, Space, Steps, Switch, Table, Tag } from "antd";
import { Bot, CheckCircle2, ClipboardCheck, Command, FileSearch, Loader2, MessageSquareText, Network, Plus, SearchCheck, ShieldCheck, Workflow } from "lucide-react";
import { CopilotChatPanel } from "@/components/ai/CopilotChatPanel";
import { Card } from "@/components/Card";
import { MarkdownView } from "@/components/MarkdownView";
import { NeedLogin } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { api } from "@/lib/api";
import { formatCopilotResponse } from "@/lib/copilotFormat";
import { getProjectId, getToken } from "@/lib/authStorage";

type Turn = { ts: string; sessionId: string; runId: string; query: string; response?: unknown; error?: string };
type CopilotMode = "chat" | "commands" | "tool-plan";
type CommandTypeFilter = "all" | "navigate" | "operation" | "copilot";
type CommandCandidate = { id?: string; label?: string; description?: string; type?: string; target?: string; prompt?: string };
const STORAGE_KEY = "sop-copilot-transcript-v1";

function loadTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function saveTurns(rows: Turn[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-200)));
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

const MODE_ROUTE: Record<CopilotMode, string> = {
  chat: "#/copilot/chat",
  commands: "#/copilot/commands",
  "tool-plan": "#/copilot/tool-plan",
};

const MODE_WORKFLOWS: Record<CopilotMode, Array<{ title: string; desc: string }>> = {
  chat: [
    { title: "持续对话", desc: "围绕项目上下文连续追问，沉淀 transcript。" },
    { title: "上下文开关", desc: "按需注入当前项目，避免跨作用域误用。" },
    { title: "转工具计划", desc: "把当前问题一键转为可执行计划。" },
  ],
  commands: [
    { title: "搜索命令", desc: "输入页面、动作或意图，快速定位能力。" },
    { title: "预览执行", desc: "运营动作先 dry-run，查看目标和证据。" },
    { title: "转计划", desc: "复杂命令进入工具计划，不在命令表里硬执行。" },
  ],
  "tool-plan": [
    { title: "描述目标", desc: "用自然语言说明要完成的业务结果。" },
    { title: "生成计划", desc: "系统匹配意图、目标和候选命令。" },
    { title: "任务化", desc: "预览后再写入任务中心，形成跟进闭环。" },
  ],
};

const MODE_SURFACE_CLASS: Record<CopilotMode, string> = {
  chat: "copilotChatSurface",
  commands: "copilotCommandSurface",
  "tool-plan": "copilotToolPlanSurface",
};

const MODE_SURFACE_TONE: Record<CopilotMode, string> = {
  chat: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20",
  commands: "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20",
  "tool-plan": "border-sky-200 bg-sky-50/70 dark:border-sky-900/50 dark:bg-sky-950/20",
};

const MODE_GUARDRAILS: Record<CopilotMode, Array<{ label: string; value: string }>> = {
  chat: [
    { label: "核心用途", value: "持续问答" },
    { label: "输出证据", value: "transcript" },
    { label: "下一步", value: "转工具计划" },
  ],
  commands: [
    { label: "核心用途", value: "查找与执行" },
    { label: "输出证据", value: "dry-run / audit" },
    { label: "下一步", value: "转计划或跳转" },
  ],
  "tool-plan": [
    { label: "核心用途", value: "目标拆解" },
    { label: "输出证据", value: "plan / tasks" },
    { label: "下一步", value: "预览或落库" },
  ],
};

const MODE_FOCUS: Record<CopilotMode, Array<{ label: string; value: string }>> = {
  chat: [
    { label: "适合", value: "追问、解释、总结、沉淀上下文" },
    { label: "不做", value: "直接执行平台动作" },
    { label: "交付物", value: "会话记录与可转计划的问题" },
  ],
  commands: [
    { label: "适合", value: "查入口、dry-run、低风险执行" },
    { label: "不做", value: "长链路推理拆解" },
    { label: "交付物", value: "命令证据、审计哈希和目标页面" },
  ],
  "tool-plan": [
    { label: "适合", value: "目标拆解、工具编排、任务化" },
    { label: "不做", value: "无确认的直接执行" },
    { label: "交付物", value: "计划、候选命令和任务中心事项" },
  ],
};

const CHAT_QUICK_PROMPTS = [
  "总结当前项目状态、主要风险和下一步行动",
  "解释当前模块如何接入 CLI / Agent 能力",
  "基于最近会话整理可执行待办",
];

const COMMAND_QUICK_FILTERS = ["任务", "审计", "健康", "计费", "页面地图"];
const COMMAND_TYPE_FILTERS: Array<{ label: string; value: CommandTypeFilter }> = [
  { label: "全部", value: "all" },
  { label: "页面导航", value: "navigate" },
  { label: "受控操作", value: "operation" },
  { label: "AI 命令", value: "copilot" },
];
const COMMAND_PLAYBOOK = [
  { title: "先找能力", desc: "按页面、业务动作或意图检索命令。" },
  { title: "再看风险", desc: "operation 类型必须先预览，确认影响范围。" },
  { title: "最后留证", desc: "执行后保留状态、目标、audit hash 和结果。" },
];
const PLAN_TEMPLATES = [
  {
    label: "交付推进",
    prompt: "基于当前项目上下文生成下一轮迭代推进计划，包含优先级、依赖、风险和可落库任务。",
  },
  {
    label: "治理闭环",
    prompt: "把当前治理目标拆成可执行工具计划，先预览影响范围，再生成任务中心可跟进事项。",
  },
  {
    label: "生产排障",
    prompt: "针对当前生产风险生成排障工具计划，覆盖健康检查、审计验证、任务分派和恢复证据。",
  },
];

export function Copilot({ initialMode = "chat" }: { initialMode?: CopilotMode }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [mode, setMode] = useState<CopilotMode>(initialMode);
  const [q, setQ] = useState("");
  const [commandSearch, setCommandSearch] = useState("");
  const [commandTypeFilter, setCommandTypeFilter] = useState<CommandTypeFilter>("all");
  const [sessionId, setSessionId] = useState(() => newId("cp"));
  const [runId, setRunId] = useState(() => newId("run"));
  const [withProject, setWithProject] = useState(true);
  const [turns, setTurns] = useState<Turn[]>(() => loadTurns());
  const [planResult, setPlanResult] = useState<any>(null);
  const [planTaskResult, setPlanTaskResult] = useState<any>(null);
  const [commandResult, setCommandResult] = useState<any>(null);
  const [selectedCommandId, setSelectedCommandId] = useState("");
  const sessionsQuery = useQuery({ queryKey: ["copilotSessions"], queryFn: () => api.copilotSessions(100), enabled: authed });
  const commandsQuery = useQuery({
    queryKey: ["copilotCommandsPage", commandSearch],
    queryFn: () => api.copilotCommands(commandSearch, 60),
    enabled: authed && mode === "commands",
  });
  const sessionQuery = useQuery({
    queryKey: ["copilotSession", sessionId],
    queryFn: () => api.copilotSession(sessionId, 100),
    enabled: authed && Boolean(sessionId.trim()),
  });
  const localTurns = useMemo(() => turns.filter((x) => x.sessionId === sessionId).slice(-30), [turns, sessionId]);
  const currentTurns = useMemo(() => {
    const remote = (sessionQuery.data?.items ?? []).map((x: any) => ({
      ts: String(x.ts ?? ""),
      sessionId: String(x.session_id ?? sessionId),
      runId: String(x.run_id ?? ""),
      query: String(x.query ?? ""),
      response: x.response,
      error: x.error,
    })) as Turn[];
    return remote.length ? remote : localTurns;
  }, [localTurns, sessionId, sessionQuery.data?.items]);

  const handleTurn = (payload: {
    query: string;
    response?: unknown;
    error?: string;
    sessionId: string;
    runId: string;
  }) => {
    setQ(payload.query);
    const next = [
      ...turns,
      {
        ts: new Date().toISOString(),
        sessionId: payload.sessionId,
        runId: payload.runId,
        query: payload.query,
        response: payload.response,
        error: payload.error,
      },
    ];
    setTurns(next);
    saveTurns(next);
    void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
    void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
    setRunId(newId("run"));
  };

  const plan = useMutation({
    mutationFn: async (text: string) => {
      const context = withProject ? { project_id: getProjectId(), session_id: sessionId, run_id: runId, source: "manager-web" } : { session_id: sessionId, run_id: runId };
      return api.copilotPlan({ query: text, context, session_id: sessionId, run_id: runId });
    },
    onSuccess: (data) => {
      setPlanResult(data);
      setPlanTaskResult(null);
      void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
      void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
    },
  });

  const planTasks = useMutation({
    mutationFn: async (dryRun: boolean) =>
      api.copilotPlanTasks({
        query: q,
        plan: planResult?.plan ?? {},
        commands: planResult?.commands ?? [],
        dry_run: dryRun,
        priority: "P1",
        assigned_to: "Coder",
        dev_tool: "copilot",
      }),
    onSuccess: (data) => {
      setPlanTaskResult(data);
      if (!data?.dry_run) {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      }
    },
  });

  const executeCommand = useMutation({
    mutationFn: async ({ commandId, dryRun }: { commandId: string; dryRun: boolean }) =>
      api.copilotExecuteCommand({
        command_id: commandId,
        dry_run: dryRun,
        context: withProject ? { project_id: getProjectId(), source: "manager-web" } : { source: "manager-web" },
        session_id: sessionId,
        run_id: runId,
      }),
    onSuccess: (data) => {
      setCommandResult(data);
      void qc.invalidateQueries({ queryKey: ["copilotSessions"] });
      void qc.invalidateQueries({ queryKey: ["copilotSession", sessionId] });
    },
  });

  useEffect(() => {
    if (!authed) return;
    const prefill = sessionStorage.getItem("sop-copilot-prefill");
    if (!prefill) return;
    sessionStorage.removeItem("sop-copilot-prefill");
    setQ(prefill);
  }, [authed]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  if (!authed) return <NeedLogin />;

  const switchMode = (next: CopilotMode) => {
    setMode(next);
    window.location.hash = MODE_ROUTE[next];
  };
  const runCommand = (item: any) => {
    const target = String(item?.target || "#/copilot/chat");
    const prompt = String(item?.prompt || item?.label || "");
    if (item?.type === "copilot") {
      sessionStorage.setItem("sop-copilot-prefill", prompt);
      window.location.hash = "#/copilot/chat";
      setQ(prompt);
      setMode("chat");
      return;
    }
    if (target.startsWith("#")) {
      window.location.hash = target;
      return;
    }
    const text = `请检查 ${item?.label || target}，目标接口：${target}`;
    setQ(text);
    setMode("tool-plan");
    window.location.hash = "#/copilot/tool-plan";
  };
  const createPlanFromCommand = (item: any) => {
    const text = String(item?.prompt || item?.label || item?.description || "");
    setQ(text);
    setMode("tool-plan");
    window.location.hash = "#/copilot/tool-plan";
    if (text.trim()) plan.mutate(text);
  };
  const modeMeta = {
    chat: {
      title: t("copilot.chatTitle", { defaultValue: t("page.copilot.title") }),
      description: t("copilot.chatIntro", { defaultValue: "持续对话、注入项目上下文，并保留会话记录。" }),
      icon: MessageSquareText,
      badge: t("copilot.chatBadge", { defaultValue: "上下文会话" }),
      action: t("copilot.chatPrimaryAction", { defaultValue: "继续追问" }),
    },
    commands: {
      title: t("copilot.commandTitle", { defaultValue: t("nav.copilotCommands") }),
      description: t("copilot.commandIntro", { defaultValue: "统一搜索页面导航、运营动作和 AI 命令，适合快速到达与转计划。" }),
      icon: Command,
      badge: t("copilot.commandBadge", { defaultValue: "可控动作目录" }),
      action: t("copilot.commandPrimaryAction", { defaultValue: "搜索命令" }),
    },
    "tool-plan": {
      title: t("copilot.toolPlanTitle", { defaultValue: t("nav.copilotToolPlan") }),
      description: t("copilot.toolPlanIntro", { defaultValue: "把自然语言目标转成工具调用计划，再预览或创建执行任务。" }),
      icon: ClipboardCheck,
      badge: t("copilot.toolPlanBadge", { defaultValue: "计划到任务" }),
      action: t("copilot.toolPlanPrimaryAction", { defaultValue: "生成计划" }),
    },
  }[mode];
  const commandRows = commandsQuery.data?.items ?? [];
  const filteredCommandRows = useMemo(
    () => (commandTypeFilter === "all" ? commandRows : commandRows.filter((x: any) => x.type === commandTypeFilter)),
    [commandRows, commandTypeFilter],
  );
  const selectedCommand = useMemo<CommandCandidate | null>(() => {
    const rows = filteredCommandRows.length ? filteredCommandRows : commandRows;
    return rows.find((item: any) => String(item.id || item.label) === selectedCommandId) ?? rows[0] ?? null;
  }, [commandRows, filteredCommandRows, selectedCommandId]);
  const commandStats = {
    navigate: commandRows.filter((x: any) => x.type === "navigate").length,
    operation: commandRows.filter((x: any) => x.type === "operation").length,
    copilot: commandRows.filter((x: any) => x.type === "copilot").length,
  };
  const workflow = MODE_WORKFLOWS[mode];
  const ModeIcon = modeMeta.icon;
  const modeCurrentStep = mode === "tool-plan" ? (planTaskResult ? 2 : planResult ? 1 : 0) : mode === "commands" ? (commandResult ? 2 : commandSearch ? 1 : 0) : currentTurns.length ? 2 : q.trim() ? 1 : 0;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={modeMeta.title}
        description={modeMeta.description}
        actions={
          <Space wrap>
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setSessionId(newId("cp"));
                setRunId(newId("run"));
                setPlanResult(null);
                setPlanTaskResult(null);
                setMode("chat");
                window.location.hash = "#/copilot/chat";
              }}
            >
              {t("copilot.newSession")}
            </Button>
          </Space>
        }
      />

      <div className={`copilotFocusedSurface ${MODE_SURFACE_CLASS[mode]} ${MODE_SURFACE_TONE[mode]} rounded-xl border p-4`}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand)]">
                <ModeIcon className="h-3.5 w-3.5" />
                {modeMeta.badge}
              </span>
              {MODE_GUARDRAILS[mode].map((item) => (
                <Tag key={item.label} bordered={false}>
                  {item.label}: {item.value}
                </Tag>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-lg font-semibold text-[var(--text)]">{modeMeta.title}</p>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">{modeMeta.description}</p>
              </div>
              <div className="max-w-full overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-1">
                <Segmented
                  value={mode}
                  onChange={(value) => switchMode(value as CopilotMode)}
                  options={[
                    { label: t("copilot.chatTab", { defaultValue: "AI 会话" }), value: "chat", icon: <Bot className="h-4 w-4" /> },
                    { label: t("copilot.commandsTab", { defaultValue: "命令中心" }), value: "commands", icon: <Command className="h-4 w-4" /> },
                    { label: t("copilot.toolPlanTab", { defaultValue: "工具计划" }), value: "tool-plan", icon: <Network className="h-4 w-4" /> },
                  ]}
                />
              </div>
            </div>
          </div>
          <div className="rounded-lg bg-[var(--surface-muted)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--text)]">{modeMeta.action}</p>
              <Tag color={mode === "commands" ? "orange" : mode === "tool-plan" ? "blue" : "green"}>{mode}</Tag>
            </div>
            <Steps
              className="copilotModeIdentity"
              size="small"
              direction="vertical"
              current={modeCurrentStep}
              items={workflow.map((item) => ({ title: item.title, description: item.desc }))}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {MODE_FOCUS[mode].map((item) => (
            <div key={item.label} className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm shadow-sm dark:border-white/10 dark:bg-slate-950/40">
              <p className="text-xs font-semibold text-[var(--muted)]">{item.label}</p>
              <p className="mt-1 text-[var(--text)]">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {mode === "commands" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card title={t("copilot.commandCatalog", { defaultValue: "命令目录" })}>
            <Alert
              className="mb-4"
              type="info"
              showIcon
              message={t("copilot.commandCenterIdentity", { defaultValue: "命令中心只负责找能力、预览操作和留存执行证据；需要推理拆解时转入工具计划。" })}
            />
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Input.Search
                allowClear
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
                placeholder={t("command.placeholder")}
                className="max-w-xl"
              />
              <Space wrap>
                <Tag color="green">{commandStats.navigate} nav</Tag>
                <Tag color="orange">{commandStats.operation} ops</Tag>
                <Tag color="blue">{commandStats.copilot} ai</Tag>
              </Space>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {COMMAND_QUICK_FILTERS.map((keyword) => (
                <Button key={keyword} size="small" icon={<SearchCheck className="h-3.5 w-3.5" />} onClick={() => setCommandSearch(keyword)}>
                  {keyword}
                </Button>
              ))}
            </div>
            <div className="copilotCommandTypeFilter mb-4 max-w-full overflow-x-auto">
              <Segmented
                value={commandTypeFilter}
                onChange={(value) => setCommandTypeFilter(value as CommandTypeFilter)}
                options={COMMAND_TYPE_FILTERS}
              />
            </div>
            <Table
              rowKey={(row: any) => String(row.id || row.label)}
              size="small"
              loading={commandsQuery.isLoading || commandsQuery.isFetching}
              dataSource={filteredCommandRows}
              rowClassName={(row: any) => (String(row.id || row.label) === String(selectedCommand?.id || selectedCommand?.label) ? "bg-[var(--brand-soft)]" : "")}
              onRow={(row: any) => ({
                onClick: () => setSelectedCommandId(String(row.id || row.label)),
              })}
              pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
              scroll={{ x: 820 }}
              locale={{ emptyText: t("command.empty") }}
              columns={[
                {
                  title: t("copilot.command", { defaultValue: "命令" }),
                  dataIndex: "label",
                  render: (value: string, row: any) => (
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text)]">{value}</div>
                      <div className="mt-1 truncate text-xs text-[var(--muted)]">{row.description}</div>
                    </div>
                  ),
                },
                {
                  title: t("copilot.intent", { defaultValue: "意图" }),
                  dataIndex: "type",
                  width: 120,
                  render: (value: string) => <Tag color={value === "navigate" ? "green" : value === "operation" ? "orange" : "blue"}>{value}</Tag>,
                },
                {
                  title: t("copilot.target", { defaultValue: "目标" }),
                  dataIndex: "target",
                  width: 220,
                  ellipsis: true,
                  render: (value: string) => <span className="font-mono text-xs">{value}</span>,
                },
                {
                  title: t("common.actions"),
                  width: 280,
                  render: (_: unknown, row: any) => (
                    <Space>
                      {row.type === "operation" ? (
                        <>
                          <Button size="small" loading={executeCommand.isPending} onClick={() => executeCommand.mutate({ commandId: String(row.id), dryRun: true })}>
                            {t("common.preview")}
                          </Button>
                          <Button size="small" type="primary" loading={executeCommand.isPending} onClick={() => executeCommand.mutate({ commandId: String(row.id), dryRun: false })}>
                            {t("copilot.execute", { defaultValue: "执行" })}
                          </Button>
                        </>
                      ) : (
                        <Button size="small" onClick={() => runCommand(row)}>
                          {row.type === "navigate" ? t("common.view") : t("copilot.execute", { defaultValue: "执行" })}
                        </Button>
                      )}
                      <Button size="small" type={row.type === "operation" ? "default" : "primary"} onClick={() => createPlanFromCommand(row)}>
                        {t("copilot.toPlan", { defaultValue: "转计划" })}
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
          <Card title={t("copilot.commandUsage", { defaultValue: "命令操作台" })}>
            <div className="space-y-3 text-sm text-[var(--muted)]">
              {executeCommand.error ? <Alert type="error" showIcon message={(executeCommand.error as Error).message} /> : null}
              {selectedCommand ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--text)]">{selectedCommand.label || selectedCommand.id}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{selectedCommand.description || "选择命令后可预览目标、执行低风险动作或转成工具计划。"}</p>
                    </div>
                    <Tag color={selectedCommand.type === "operation" ? "orange" : selectedCommand.type === "copilot" ? "blue" : "green"}>{selectedCommand.type || "navigate"}</Tag>
                  </div>
                  <p className="mt-3 break-all rounded bg-[var(--surface-muted)] px-2 py-1 font-mono text-[11px] text-[var(--muted)]">{selectedCommand.target || selectedCommand.prompt || "-"}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {selectedCommand.type === "operation" ? (
                      <>
                        <Button block icon={<ShieldCheck className="h-4 w-4" />} loading={executeCommand.isPending} onClick={() => executeCommand.mutate({ commandId: String(selectedCommand.id), dryRun: true })}>
                          {t("common.preview")}
                        </Button>
                        <Button block type="primary" loading={executeCommand.isPending} onClick={() => executeCommand.mutate({ commandId: String(selectedCommand.id), dryRun: false })}>
                          {t("copilot.execute", { defaultValue: "执行" })}
                        </Button>
                      </>
                    ) : (
                      <Button block icon={<FileSearch className="h-4 w-4" />} onClick={() => runCommand(selectedCommand)}>
                        {selectedCommand.type === "copilot" ? t("copilot.execute", { defaultValue: "执行" }) : t("common.view")}
                      </Button>
                    )}
                    <Button block icon={<Workflow className="h-4 w-4" />} onClick={() => createPlanFromCommand(selectedCommand)}>
                      {t("copilot.toPlan", { defaultValue: "转计划" })}
                    </Button>
                  </div>
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("command.empty")} />
              )}
              {commandResult ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--text)]">{commandResult.command?.label || commandResult.command?.id}</p>
                    <Tag color={commandResult.dry_run ? "blue" : "green"}>{commandResult.status}</Tag>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{commandResult.command?.target}</p>
                  {commandResult.evidence?.audit_chain?.hash ? (
                    <p className="mt-2 break-all rounded bg-[var(--surface-muted)] px-2 py-1 font-mono text-[11px] text-[var(--muted)]">audit: {commandResult.evidence.audit_chain.hash}</p>
                  ) : null}
                  <pre className="mt-2 max-h-52 overflow-auto rounded bg-[var(--surface-muted)] p-2 text-[11px] leading-5 text-[var(--muted)]">
                    {JSON.stringify(commandResult.evidence?.result || commandResult.evidence?.plan || {}, null, 2)}
                  </pre>
                </div>
              ) : null}
              <div className="copilotCommandPlaybook rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="mb-2 text-sm font-semibold text-[var(--text)]">命令执行路径</p>
                <div className="space-y-2">
                  {COMMAND_PLAYBOOK.map((item, index) => (
                    <div key={item.title} className="flex gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-semibold text-[var(--brand)]">
                        {index + 1}
                      </span>
                      <span>
                        <span className="block text-xs font-semibold text-[var(--text)]">{item.title}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{item.desc}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                <p className="font-semibold text-[var(--text)]">{t("command.short")}</p>
                <p className="mt-1">{t("copilot.commandUsagePalette", { defaultValue: "全局快捷键打开命令面板，适合快速跳页和查找动作。" })}</p>
              </div>
              <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                <p className="font-semibold text-[var(--text)]">{t("copilot.toPlan", { defaultValue: "转计划" })}</p>
                <p className="mt-1">{t("copilot.commandUsagePlan", { defaultValue: "复杂命令先转成工具计划，再确认是否任务化。" })}</p>
              </div>
              <Button block icon={<Network className="h-4 w-4" />} onClick={() => switchMode("tool-plan")}>
                {t("copilot.openToolPlan", { defaultValue: "打开工具计划" })}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {mode === "tool-plan" ? (
        <Card title={t("copilot.toolPlanInput", { defaultValue: "自然语言目标" })}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-start gap-2">
                  <ClipboardCheck className="mt-0.5 h-4 w-4 text-[var(--brand)]" />
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">计划不是聊天记录</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">这里专门处理“要达成什么目标”，生成可预览、可审计、可转任务的工具执行方案。</p>
                  </div>
                </div>
              </div>
              <div className="copilotPlanTemplates mb-3 grid gap-2 sm:grid-cols-3">
                {PLAN_TEMPLATES.map((item) => (
                  <Button key={item.label} className="h-auto whitespace-normal py-2 text-left" onClick={() => setQ(item.prompt)}>
                    {item.label}
                  </Button>
                ))}
              </div>
              <Input.TextArea
                value={q}
                rows={5}
                onChange={(event) => setQ(event.target.value)}
                placeholder={t("copilot.placeholder")}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="primary"
                  icon={plan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                  disabled={!q.trim() || plan.isPending}
                  onClick={() => plan.mutate(q)}
                >
                  {t("copilot.plan")}
                </Button>
                <Button onClick={() => setQ("基于当前项目上下文生成下一轮迭代推进计划")}>
                  {t("copilot.quickIterationPlan", { defaultValue: "迭代计划" })}
                </Button>
                <Button onClick={() => setQ("总结当前项目状态、主要风险和下一步行动")}>
                  {t("copilot.quickProjectSummary", { defaultValue: "项目总结" })}
                </Button>
              </div>
              {plan.error ? <Alert className="mt-3" type="error" showIcon message={(plan.error as Error).message} /> : null}
            </div>
            <div className="space-y-3 rounded-xl bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted)]">
              {[
                ["输入目标", Boolean(q.trim())],
                ["生成计划", Boolean(planResult)],
                ["预览/创建任务", Boolean(planTaskResult)],
              ].map(([label, done]) => (
                <div key={String(label)} className="flex items-center gap-2">
                  <CheckCircle2 className={`h-4 w-4 ${done ? "text-emerald-600" : "text-[var(--muted)]"}`} />
                  <span className={done ? "text-[var(--text)]" : ""}>{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Switch size="small" checked={withProject} onChange={(checked) => setWithProject(checked)} />
                <span>{t("copilot.withProject")}</span>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">{t("copilot.session")}</p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--text)]">{sessionId}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">run_id</p>
                <p className="mt-1 break-all font-mono text-xs text-[var(--text)]">{runId}</p>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {mode === "chat" ? (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="flex items-start gap-2">
              <MessageSquareText className="mt-0.5 h-4 w-4 text-[var(--brand)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">会话用于持续思考</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">适合追问、解释、总结和对齐上下文；需要执行时再转到工具计划或命令中心。</p>
              </div>
            </div>
          </div>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <label className="text-xs text-slate-500">
              {t("copilot.session")}
              <Input className="mt-1 font-mono text-xs" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">
              run_id
              <Input className="mt-1 font-mono text-xs" value={runId} onChange={(e) => setRunId(e.target.value)} />
            </label>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Switch size="small" checked={withProject} onChange={(checked) => setWithProject(checked)} />
            <span>{t("copilot.withProject")}</span>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {CHAT_QUICK_PROMPTS.map((prompt) => (
              <Button key={prompt} size="small" onClick={() => setQ(prompt)}>
                {prompt.slice(0, 16)}
              </Button>
            ))}
          </div>

          <CopilotChatPanel
            key={sessionId}
            module="copilot"
            sessionId={sessionId}
            runId={runId}
            withProject={withProject}
            listHeight={400}
            onMessageSent={setQ}
            onTurn={handleTurn}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2 text-sm font-semibold text-[var(--text)] shadow-sm transition hover:bg-[var(--surface-muted)] disabled:pointer-events-none disabled:opacity-50"
              disabled={!q.trim() || plan.isPending}
              onClick={() => {
                setMode("tool-plan");
                window.location.hash = "#/copilot/tool-plan";
                plan.mutate(q);
              }}
            >
              {plan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              {t("copilot.plan")}
            </button>
          </div>
          
          {plan.error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{(plan.error as Error).message}</div> : null}
        </Card>

        <Card title={t("copilot.sessions")}>
          <div className="space-y-2 text-sm">
            {[
              ...new Set([
                ...(sessionsQuery.data?.items ?? []).map((x: any) => String(x.session_id ?? "")),
                ...turns.map((x) => x.sessionId),
              ].filter(Boolean)),
            ].slice(-20).reverse().map((sid) => (
              <button key={sid} type="button" className={`block w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs ${sid === sessionId ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200"}`} onClick={() => setSessionId(sid)}>{sid}</button>
            ))}
            {sessionsQuery.isError ? <p className="text-xs text-amber-600">{(sessionsQuery.error as Error).message}</p> : null}
          </div>
        </Card>
      </div>
      ) : null}

      {mode === "tool-plan" && planResult ? (
        <Card title={t("copilot.planResult")}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-xs text-[var(--muted)]">{t("copilot.intent")}</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text)]">{planResult.plan?.intent || "-"}</p>
              <p className="mt-3 text-xs text-[var(--muted)]">{t("copilot.target")}</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--muted-strong)]">{planResult.plan?.target || "-"}</p>
              <p className="mt-3 text-sm text-[var(--muted-strong)]">{planResult.plan?.summary || "-"}</p>
            </div>
            <div className="space-y-2">
              {(planResult.commands ?? []).slice(0, 5).map((item: any) => (
                <a key={String(item.id)} href={String(item.target || "#/copilot").startsWith("#") ? String(item.target) : "#/copilot"} className="block rounded-xl border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-muted)]">
                  <span className="block text-sm font-semibold text-[var(--text)]">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">{item.description}</span>
                </a>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{t("copilot.executionTasks")}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{t("copilot.executionTasksHint")}</p>
              </div>
              <Space wrap>
                <Button loading={planTasks.isPending} onClick={() => planTasks.mutate(true)}>
                  {t("copilot.previewTasks")}
                </Button>
                <Button type="primary" loading={planTasks.isPending} onClick={() => planTasks.mutate(false)}>
                  {t("copilot.createTasks")}
                </Button>
              </Space>
            </div>
            {planTasks.error ? (
              <Alert className="mt-3" type="error" showIcon message={(planTasks.error as Error).message} />
            ) : null}
            {planTaskResult ? (
              <div className="mt-3">
                <Alert
                  className="mb-3"
                  type={planTaskResult.dry_run ? "info" : "success"}
                  showIcon
                  message={
                    planTaskResult.dry_run
                      ? t("copilot.taskPreviewReady", { count: planTaskResult.items?.length ?? 0 })
                      : t("copilot.taskCreated", { count: planTaskResult.created ?? 0 })
                  }
                />
                <Table
                  size="small"
                  rowKey={(row: any) => `${row.order}-${row.id || row.title}`}
                  pagination={false}
                  scroll={{ x: 760 }}
                  dataSource={planTaskResult.items ?? []}
                  columns={[
                    {
                      title: t("tasks.task"),
                      dataIndex: "title",
                      render: (value: string, row: any) => (
                        <div>
                          <div className="font-medium text-[var(--text)]">{value}</div>
                          {row.id ? <div className="mt-1 font-mono text-xs text-[var(--muted)]">{row.id}</div> : null}
                        </div>
                      ),
                    },
                    {
                      title: t("tasks.priority"),
                      dataIndex: "priority",
                      width: 100,
                      render: (value: string) => <Tag color={value === "P0" ? "red" : value === "P1" ? "orange" : "blue"}>{value}</Tag>,
                    },
                    { title: t("tasks.assignee"), dataIndex: "assigned_to", width: 140 },
                    { title: t("tasks.source"), dataIndex: "source", width: 150 },
                  ]}
                />
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {mode === "chat" ? (
      <Card title={t("copilot.transcript")}>
        <div className="space-y-3">
          {currentTurns.map((turn) => (
            <div key={`${turn.ts}-${turn.runId}`} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              <div className="mb-1 font-mono text-[11px] text-slate-500">{turn.ts} · {turn.runId}</div>
              <p className="whitespace-pre-wrap font-medium text-slate-900 dark:text-slate-100">{turn.query}</p>
              {turn.error ? (
                <p className="mt-2 text-sm text-rose-600">{turn.error}</p>
              ) : (
                <div className="mt-2 max-h-80 overflow-auto rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <MarkdownView content={formatCopilotResponse(turn.response)} />
                </div>
              )}
            </div>
          ))}
          {currentTurns.length === 0 ? <p className="text-sm text-slate-500">{t("copilot.empty")}</p> : null}
        </div>
      </Card>
      ) : null}
    </div>
  );
}
