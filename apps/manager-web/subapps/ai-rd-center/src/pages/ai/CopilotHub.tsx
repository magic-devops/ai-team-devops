import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, ClipboardCheck, Command, Gauge, MessageSquareText, Network, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  chat: Bot,
  commands: Command,
  "tool-plan": Network,
};

const DOMAIN_I18N: Record<string, string> = {
  chat: "nav.copilot",
  commands: "nav.copilotCommands",
  "tool-plan": "nav.copilotToolPlan",
};

const DOMAIN_DESC: Record<string, string> = {
  chat: "持续会话、项目上下文注入、会话记录和模块 AI 追问。",
  commands: "统一检索导航、运营动作和 AI 命令，适合快速到达与执行。",
  "tool-plan": "把自然语言目标转成工具调用计划，再预览或生成任务。",
};

const DOMAIN_USAGE: Record<string, string> = {
  chat: "用于连续追问、分析上下文、保留会话证据。",
  commands: "用于快速找页面、预览操作、执行低风险平台动作。",
  "tool-plan": "用于把目标拆成工具调用和任务中心可跟进事项。",
};

const DOMAIN_ACTION_LABEL: Record<string, string> = {
  chat: "继续对话",
  commands: "查找命令",
  "tool-plan": "生成计划",
};

const DOMAIN_OUTCOME: Record<string, string> = {
  chat: "上下文、问答证据、transcript",
  commands: "命令、dry-run、执行证据",
  "tool-plan": "工具调用计划、任务预览、任务落库",
};

const CONTROL_BOARD_LANES = [
  { label: "AI 指挥台", role: "看全局、做分流", action: "进入最合适的专业工作区", evidence: "会话数、命令数、最近证据", href: "#/copilot", tone: "border-violet-200 bg-violet-50/70 dark:border-violet-900/50 dark:bg-violet-950/20" },
  { label: "AI 会话", role: "连续问答与上下文沉淀", action: "追问、总结、转工具计划", evidence: "session / run / transcript", href: "#/copilot/chat", tone: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20" },
  { label: "命令中心", role: "平台能力搜索与受控操作", action: "检索、预览、执行、留证", evidence: "dry-run / audit hash", href: "#/copilot/commands", tone: "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20" },
  { label: "工具计划", role: "复杂目标拆解与任务化", action: "生成计划、预览任务、创建任务", evidence: "plan / commands / task items", href: "#/copilot/tool-plan", tone: "border-sky-200 bg-sky-50/70 dark:border-sky-900/50 dark:bg-sky-950/20" },
];

export function CopilotHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hubQ = useQuery({ queryKey: ["copilotHub"], queryFn: api.copilotHub, enabled: authed });
  const commandsQ = useQuery({ queryKey: ["copilotHubCommands"], queryFn: () => api.copilotCommands("", 100), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (hubQ.isLoading) return <LoadingBlock />;
  if (hubQ.error) return <ErrorBlock message={(hubQ.error as Error).message} />;

  const summary = hubQ.data?.summary ?? {};
  const domains = hubQ.data?.domains ?? [];
  const recent = hubQ.data?.recent_sessions ?? [];
  const commandTotal = commandsQ.data?.total ?? summary.commands ?? 0;
  const cockpitTiles = [
    { label: "AI 会话", value: summary.sessions ?? 0, hint: "沉淀项目上下文和问答证据", icon: MessageSquareText, href: "#/copilot/chat" },
    { label: "命令中心", value: commandTotal, hint: "统一导航、操作和 AI 命令", icon: Command, href: "#/copilot/commands" },
    { label: "工具计划", value: summary.skills ?? 0, hint: "把目标转为计划和任务", icon: ClipboardCheck, href: "#/copilot/tool-plan" },
    { label: "当前作用域", value: summary.scope || "default", hint: "权限与审计按作用域隔离", icon: Gauge, href: "#/system-map" },
  ];
  const decisionLanes = [
    { id: "chat", label: "AI 会话", path: "#/copilot/chat", intent: "问、解释、总结、追问", outcome: DOMAIN_OUTCOME.chat, icon: MessageSquareText },
    { id: "commands", label: "命令中心", path: "#/copilot/commands", intent: "找入口、预览操作、执行低风险动作", outcome: DOMAIN_OUTCOME.commands, icon: Command },
    { id: "tool-plan", label: "工具计划", path: "#/copilot/tool-plan", intent: "把目标拆成计划并任务化", outcome: DOMAIN_OUTCOME["tool-plan"], icon: ClipboardCheck },
  ];
  const recommendations = [
    {
      title: recent.length ? "继续最近会话" : "先建立 AI 上下文",
      desc: recent.length ? "延续已有 transcript，继续追问和总结。" : "没有会话时先让 AI 了解当前项目和目标。",
      href: "#/copilot/chat",
      action: "进入会话",
    },
    {
      title: commandTotal ? "快速找平台动作" : "等待命令注册",
      desc: commandTotal ? "命令中心适合查入口、dry-run 和低风险执行。" : "命令目录为空时先检查后端命令注册表。",
      href: "#/copilot/commands",
      action: "查命令",
    },
    {
      title: "复杂目标转计划",
      desc: "涉及多步骤、多工具或需要任务跟进时，直接进入工具计划。",
      href: "#/copilot/tool-plan",
      action: "生成计划",
    },
  ];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.copilot.hubTitle", { defaultValue: "AI 指挥台" })}
        description={t("page.copilot.hubDesc", { defaultValue: "总览 AI 会话、快捷命令、工具计划和最近运行证据；指挥台只做态势和分流，具体操作进入对应专业工作区。" })}
        actions={
          <>
            <a
              href="#/copilot/chat"
              className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {t("page.copilot.openChat")}
            </a>
            <a
              href="#/copilot/commands"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-1.5 text-sm font-medium text-[var(--text)]"
            >
              <Command className="h-4 w-4" />
              {t("nav.copilotCommands")}
            </a>
            <RefreshButton onClick={() => void hubQ.refetch()} pending={hubQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.copilot.hubSessions"), value: summary.sessions ?? 0 },
              { label: t("page.copilot.hubSkills"), value: summary.skills ?? 0 },
              { label: t("page.copilot.hubCommands", { defaultValue: "命令数" }), value: commandTotal },
              { label: t("page.copilot.hubRecent", { defaultValue: "最近会话" }), value: recent.length },
            ]}
          />
        }
      />

      <div className="copilotHubRoleBoard grid gap-3 lg:grid-cols-4">
        {CONTROL_BOARD_LANES.map((lane) => (
          <a key={lane.label} href={lane.href} className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:border-[var(--brand)] ${lane.tone}`}>
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--text)]">{lane.label}</span>
              <ArrowRight className="h-4 w-4 text-[var(--muted)] opacity-60 transition group-hover:opacity-100" />
            </span>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{lane.role}</p>
            <div className="mt-3 rounded-lg bg-[var(--surface-muted)] px-3 py-2">
              <p className="text-[11px] font-semibold text-[var(--muted)]">核心动作</p>
              <p className="mt-1 text-xs text-[var(--muted-strong)]">{lane.action}</p>
            </div>
            <p className="mt-3 truncate font-mono text-[11px] text-[var(--muted)]">{lane.evidence}</p>
          </a>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cockpitTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <a
              key={tile.label}
              href={tile.href}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="rounded-lg bg-[var(--surface-muted)] p-2 text-[var(--brand)]">
                  <Icon className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-[var(--muted)]" />
              </span>
              <span className="mt-4 block text-xs text-[var(--muted)]">{tile.label}</span>
              <span className="mt-1 block truncate text-xl font-semibold text-[var(--text)]">{tile.value}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{tile.hint}</span>
            </a>
          );
        })}
      </div>

      <Card title={t("page.copilot.nextBestAction", { defaultValue: "推荐下一步" })}>
        <div className="copilotHubNextActions grid gap-3 lg:grid-cols-3">
          {recommendations.map((item) => (
            <a
              key={item.title}
              href={item.href}
              className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                    <Sparkles className="h-4 w-4 text-[var(--brand)]" />
                    {item.title}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">{item.desc}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)] opacity-60 transition group-hover:opacity-100" />
              </span>
              <span className="mt-3 inline-flex rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-strong)]">
                {item.action}
              </span>
            </a>
          ))}
        </div>
      </Card>

      <Card title={t("page.copilot.decisionTitle", { defaultValue: "入口分工" })}>
        <div className="grid gap-3 lg:grid-cols-3">
          {decisionLanes.map((lane) => {
            const Icon = lane.icon;
            return (
              <a
                key={lane.id}
                href={lane.path}
                className="copilotHubDecisionLane group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                    <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]">
                      <Icon className="h-4 w-4" />
                    </span>
                    {lane.label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[var(--muted)] opacity-60 transition group-hover:opacity-100" />
                </span>
                <span className="mt-3 block text-xs text-[var(--muted)]">{lane.intent}</span>
                <span className="mt-2 block rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-strong)]">{lane.outcome}</span>
              </a>
            );
          })}
        </div>
      </Card>

      <Card title={t("page.copilot.domainsTitle", { defaultValue: "专业入口" })}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain: { id: string; path: string; description?: string; primary_action?: string }) => {
            const Icon = DOMAIN_ICONS[domain.id] ?? Bot;
            const labelKey = DOMAIN_I18N[domain.id];
            return (
              <a
                key={domain.id}
                href={domain.path}
                className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
              >
                <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">
                    {labelKey ? t(labelKey) : domain.id}
                    <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{domain.description || DOMAIN_DESC[domain.id] || domain.path}</span>
                  <span className="mt-2 block text-xs leading-5 text-[var(--muted-strong)]">{DOMAIN_USAGE[domain.id] || domain.primary_action}</span>
                  <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                    <Sparkles className="h-3 w-3" />
                    {DOMAIN_ACTION_LABEL[domain.id] || domain.primary_action || "打开"}
                  </span>
                  <span className="mt-2 block font-mono text-[11px] text-[var(--muted)]">{domain.path}</span>
                </span>
              </a>
            );
          })}
        </div>
      </Card>
      {recent.length ? (
        <Card title={t("page.copilot.recentSessions")}>
          <ul className="divide-y divide-[var(--border)]">
            {recent.map((s: { session_id: string; title?: string; updated_at?: string }) => (
              <li key={s.session_id} className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
                <a href="#/copilot/chat" className="font-medium text-[var(--brand)] hover:underline">
                  {s.title || s.session_id}
                </a>
                <span className="text-xs text-[var(--muted)]">{s.updated_at}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
