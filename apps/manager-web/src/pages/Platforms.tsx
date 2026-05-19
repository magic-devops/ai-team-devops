import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, BrainCircuit, Copy, Cpu, ListChecks, Network, Plus, RotateCw, Server, ShieldCheck, Terminal, Trash2, Users, Wrench } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { FlashMessage } from "../components/FlashMessage";
import { LoadingBlock, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "./shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
const EChartsBarLazy = lazy(() =>
  import("../components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

type Flash = { kind: "ok" | "err"; message: string } | null;
type PlatformModule = "tools" | "mcp" | "agents" | "models" | "ops";

const inputClass =
  "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

export function Platforms({ initialModule = "tools" }: { initialModule?: PlatformModule; focused?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [flash, setFlash] = useState<Flash>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<PlatformModule>(initialModule);
  const [opsResult, setOpsResult] = useState<any>(null);
  const [providerDraft, setProviderDraft] = useState({ name: "openai", api_key: "", base_url: "", enabled: true });
  const [customDraft, setCustomDraft] = useState({ id: "", provider: "openai", name: "", context: "32000" });
  const [roleDraft, setRoleDraft] = useState({ role: "developer", model_id: "" });
  const [providerTest, setProviderTest] = useState<Record<string, any>>({});
  const [agentDraft, setAgentDraft] = useState({
    id: "",
    name: "",
    role: "developer",
    model: "claude-opus-4-7",
    tools: "sop-cli",
    mcp_servers: "tasks,knowledge",
    a2a_enabled: true,
  });
  const [groupDraft, setGroupDraft] = useState({
    id: "delivery-squad",
    name: "Delivery Squad",
    mode: "review-gate",
    agents: "",
  });
  const [agentProfile, setAgentProfile] = useState<any>(null);
  const [runFilter, setRunFilter] = useState({ agent: "", status: "" });
  const [mcpDraft, setMcpDraft] = useState({
    name: "",
    command: "python3",
    args: "",
    description: "",
    env: "",
    tags: "sop",
    enabled: true,
  });
  const [mcpProfile, setMcpProfile] = useState<any>(null);

  const q = useQuery({
    queryKey: ["platforms"],
    queryFn: api.platformsList,
    enabled: authed,
  });
  const platformSummary = useQuery({
    queryKey: ["platformsSummary"],
    queryFn: api.platformsSummary,
    enabled: authed,
  });
  const platformCharts = useQuery({
    queryKey: ["platformsCharts"],
    queryFn: api.platformsCharts,
    enabled: authed,
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: api.models,
    enabled: authed && activeModule === "models",
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents,
    enabled: authed && activeModule === "agents",
  });
  const agentSummary = useQuery({
    queryKey: ["agents-summary"],
    queryFn: api.agentsSummary,
    enabled: authed && activeModule === "agents",
  });
  const agentGroups = useQuery({
    queryKey: ["agent-groups"],
    queryFn: api.agentGroups,
    enabled: authed && activeModule === "agents",
  });
  const agentRunsSummary = useQuery({
    queryKey: ["agent-runs-summary"],
    queryFn: api.agentRunsSummary,
    enabled: authed && activeModule === "agents",
  });
  const agentRuns = useQuery({
    queryKey: ["agent-runs", runFilter.agent, runFilter.status],
    queryFn: () => api.agentRuns(runFilter.agent, runFilter.status, 80),
    enabled: authed && activeModule === "agents",
  });
  const agentSlo = useQuery({
    queryKey: ["agent-slo"],
    queryFn: api.agentRunsSlo,
    enabled: authed && activeModule === "agents",
  });
  const builtinAgents = useQuery({
    queryKey: ["agents-builtin"],
    queryFn: api.agentsBuiltin,
    enabled: authed && activeModule === "agents",
  });
  const mcpServers = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: api.mcpServers,
    enabled: authed && activeModule === "mcp",
  });
  const mcpSummary = useQuery({
    queryKey: ["mcp-summary"],
    queryFn: api.mcpSummary,
    enabled: authed && activeModule === "mcp",
  });
  const mcpBuiltin = useQuery({
    queryKey: ["mcp-builtin"],
    queryFn: api.mcpBuiltin,
    enabled: authed && activeModule === "mcp",
  });
  const platformOpsPlan = useQuery({
    queryKey: ["platformsOpsPlan"],
    queryFn: api.platformsOpsPlan,
    enabled: authed && activeModule === "ops",
  });

  const install = useMutation({
    mutationFn: (id: string) => api.platformsInstallShims(id),
    onMutate: (id) => setInstallingId(id),
    onSuccess: (data, id) => {
      const shim = (data as { shim?: string })?.shim;
      setFlash({
        kind: "ok",
        message: t("page.platforms.installOk", { id, shim: shim || "—" }),
      });
      void qc.invalidateQueries({ queryKey: ["platforms"] });
    },
    onError: (err) => {
      setFlash({ kind: "err", message: (err as Error).message });
    },
    onSettled: () => setInstallingId(null),
  });
  const setDefaultModel = useMutation({
    mutationFn: (modelId: string) => api.modelsSetDefault(modelId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["models"] }),
  });
  const saveProvider = useMutation({
    mutationFn: () => api.modelsUpsertProvider(providerDraft.name.trim(), providerDraft),
    onSuccess: () => {
      setProviderDraft({ name: "openai", api_key: "", base_url: "", enabled: true });
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const deleteProvider = useMutation({
    mutationFn: (name: string) => api.modelsDeleteProvider(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["models"] }),
  });
  const testProvider = useMutation({
    mutationFn: (name: string) => api.modelsTestProvider(name),
    onSuccess: (data, name) => setProviderTest((v) => ({ ...v, [name]: data })),
  });
  const addCustom = useMutation({
    mutationFn: () => api.modelsAddCustom({
      id: customDraft.id.trim(),
      provider: customDraft.provider.trim(),
      name: customDraft.name.trim(),
      context: Number(customDraft.context || 32000),
    }),
    onSuccess: () => {
      setCustomDraft({ id: "", provider: "openai", name: "", context: "32000" });
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const deleteCustom = useMutation({
    mutationFn: (modelId: string) => api.modelsDeleteCustom(modelId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["models"] }),
  });
  const setRoleModel = useMutation({
    mutationFn: () => api.modelsSetRole(roleDraft),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["models"] }),
  });
  const refreshAgents = () => {
    void qc.invalidateQueries({ queryKey: ["agents"] });
    void qc.invalidateQueries({ queryKey: ["agents-summary"] });
    void qc.invalidateQueries({ queryKey: ["agent-groups"] });
    void qc.invalidateQueries({ queryKey: ["agent-runs-summary"] });
    void qc.invalidateQueries({ queryKey: ["agent-runs"] });
    void qc.invalidateQueries({ queryKey: ["agent-slo"] });
  };
  const agentRebalanceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.agentRunsRebalanceTasks({ dry_run: dryRun, priority: "P1", assigned_to: "Coder" }),
    onSuccess: (data, dryRun) => {
      setFlash({
        kind: "ok",
        message: dryRun
          ? t("page.platforms.rebalancePreviewOk", { count: data?.summary?.planned ?? 0 })
          : t("page.platforms.rebalanceApplyOk", { count: data?.summary?.created ?? 0 }),
      });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const bootstrapAgents = useMutation({
    mutationFn: () => api.agentBootstrapBuiltin(false),
    onSuccess: (data) => {
      setFlash({ kind: "ok", message: t("page.platforms.agentBootstrapOk", { count: (data?.created ?? []).length }) });
      refreshAgents();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const createAgent = useMutation({
    mutationFn: () => api.agentCreate({
      id: agentDraft.id.trim(),
      name: agentDraft.name.trim(),
      role: agentDraft.role.trim(),
      description: "",
      model: agentDraft.model.trim(),
      tools: splitCsv(agentDraft.tools),
      mcp_servers: splitCsv(agentDraft.mcp_servers),
      a2a_enabled: agentDraft.a2a_enabled,
      enabled: true,
    }),
    onSuccess: () => {
      setAgentDraft((v) => ({ ...v, id: "", name: "" }));
      refreshAgents();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const deleteAgent = useMutation({
    mutationFn: (id: string) => api.agentDelete(id),
    onSuccess: refreshAgents,
  });
  const createGroup = useMutation({
    mutationFn: () => api.agentGroupCreate({
      id: groupDraft.id.trim(),
      name: groupDraft.name.trim(),
      mode: groupDraft.mode,
      agents: splitCsv(groupDraft.agents),
      description: "",
      entry_agent: splitCsv(groupDraft.agents)[0] ?? "",
    }),
    onSuccess: refreshAgents,
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const deleteGroup = useMutation({
    mutationFn: (id: string) => api.agentGroupDelete(id),
    onSuccess: refreshAgents,
  });
  const loadProfile = useMutation({
    mutationFn: (id: string) => api.agentProfile(id),
    onSuccess: (data) => setAgentProfile(data?.profile ?? data),
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const refreshMcp = () => {
    void qc.invalidateQueries({ queryKey: ["mcp-servers"] });
    void qc.invalidateQueries({ queryKey: ["mcp-summary"] });
    void qc.invalidateQueries({ queryKey: ["mcp-builtin"] });
  };
  const upsertMcp = useMutation({
    mutationFn: () => api.mcpUpsert({
      name: mcpDraft.name.trim(),
      command: mcpDraft.command.trim(),
      args: splitArgs(mcpDraft.args),
      description: mcpDraft.description.trim(),
      env: parseEnvLines(mcpDraft.env),
      tags: splitCsv(mcpDraft.tags),
      enabled: mcpDraft.enabled,
    }),
    onSuccess: () => {
      setMcpDraft((v) => ({ ...v, name: "", description: "", args: "", env: "" }));
      refreshMcp();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const deleteMcp = useMutation({
    mutationFn: (name: string) => api.mcpDelete(name),
    onSuccess: refreshMcp,
  });
  const installMcp = useMutation({
    mutationFn: (name: string) => api.mcpInstallBuiltin(name),
    onSuccess: refreshMcp,
  });
  const installAllMcp = useMutation({
    mutationFn: api.mcpInstallAllBuiltin,
    onSuccess: (data) => {
      setFlash({ kind: "ok", message: t("page.platforms.mcpInstallAllOk", { count: (data?.created ?? []).length }) });
      refreshMcp();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const loadMcpProfile = useMutation({
    mutationFn: api.mcpProfile,
    onSuccess: (data) => setMcpProfile(data),
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });
  const platformOpsTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.platformsOpsTasks({ dry_run: dryRun, priority: "P1", assigned_to: "DevOps" }),
    onSuccess: (data) => {
      setOpsResult(data);
      setFlash({
        kind: "ok",
        message: t("page.platforms.opsTaskResult", {
          planned: data?.summary?.planned ?? 0,
          created: data?.summary?.created ?? 0,
          skipped: data?.summary?.skipped ?? 0,
        }),
      });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void platformOpsPlan.refetch();
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });

  useEffect(() => {
    setActiveModule(initialModule);
  }, [initialModule]);

  useEffect(() => {
    if (!flash) return;
    const tmr = window.setTimeout(() => setFlash(null), 8000);
    return () => window.clearTimeout(tmr);
  }, [flash]);

  const platformScores = useMemo(
    () =>
      (platformCharts.data?.platforms ?? []).map((p) => ({
        name: p.label || p.id,
        value: p.score,
      })),
    [platformCharts.data],
  );

  if (!authed) {
    return <div className="text-sm text-rose-600">{t("auth.dashboardNeedLogin")}</div>;
  }

  const rows = q.data?.platforms ?? [];
  const summary = platformSummary.data;
  const modelRows = [...(models.data?.builtin ?? []), ...(models.data?.custom ?? [])];
  const modules: Array<{ id: PlatformModule; title: string; desc: string; icon: ReactNode }> = [
    { id: "tools", title: t("page.platforms.moduleTools"), desc: t("page.platforms.moduleToolsDesc"), icon: <Wrench className="h-5 w-5" /> },
    { id: "mcp", title: t("page.platforms.moduleMcp"), desc: t("page.platforms.moduleMcpDesc"), icon: <Server className="h-5 w-5" /> },
    { id: "agents", title: t("page.platforms.moduleAgents"), desc: t("page.platforms.moduleAgentsDesc"), icon: <Bot className="h-5 w-5" /> },
    { id: "models", title: t("page.platforms.moduleModels"), desc: t("page.platforms.moduleModelsDesc"), icon: <BrainCircuit className="h-5 w-5" /> },
    { id: "ops", title: t("page.platforms.moduleOps"), desc: t("page.platforms.moduleOpsDesc"), icon: <ShieldCheck className="h-5 w-5" /> },
  ];

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.platforms.title")}
        description={t("page.platforms.hint")}
        actions={
          <RefreshButton
            onClick={() => {
              void q.refetch();
              void platformSummary.refetch();
              void platformCharts.refetch();
              void platformOpsPlan.refetch();
            }}
            pending={q.isFetching || platformSummary.isFetching || platformCharts.isFetching || platformOpsPlan.isFetching}
          />
        }
        metrics={
          <WorkbenchStats
            items={[
              { label: t("page.platforms.platformsTotal"), value: summary?.platforms_total ?? rows.length },
              { label: t("page.platforms.readyCount"), value: summary?.ready ?? 0 },
              { label: t("page.platforms.cliAvailable"), value: summary?.cli_available ?? 0 },
              { label: t("page.platforms.hookShim"), value: summary?.hook_shim_present ?? 0 },
            ]}
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {Object.keys(pieToRecord(platformCharts.data?.readiness)).length ? (
            <WorkbenchPanel title={t("page.platforms.readinessChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(platformCharts.data?.readiness)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(platformCharts.data?.cli)).length ? (
            <WorkbenchPanel title={t("page.platforms.cliChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(platformCharts.data?.cli)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
          {Object.keys(pieToRecord(platformCharts.data?.hooks)).length ? (
            <WorkbenchPanel title={t("page.platforms.hooksChart")}>
              <Suspense fallback={<LoadingBlock />}>
                <EChartsDonutLazy data={pieToRecord(platformCharts.data?.hooks)} height={200} />
              </Suspense>
            </WorkbenchPanel>
          ) : null}
        </div>
        {platformScores.length ? (
          <WorkbenchPanel title={t("page.platforms.healthScore")} className="mt-4">
            <Suspense fallback={<LoadingBlock />}>
              <EChartsBarLazy
                categories={platformScores.map((p) => p.name)}
                series={[{ name: t("page.platforms.healthScore"), data: platformScores.map((p) => p.value) }]}
                height={Math.min(320, 80 + platformScores.length * 28)}
              />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
      </WorkbenchShell>

    <div className="grid w-full gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-4 xl:self-start">
        <Card title={t("page.platforms.modules")}>
          <div className="space-y-2">
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveModule(m.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                  activeModule === m.id
                    ? "border-[var(--brand)] bg-[var(--brand-softer)] text-[var(--text)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">{m.icon}</span>
                <span>
                  <span className="block text-sm font-semibold">{m.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{m.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </aside>
      <section className="min-w-0 space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {activeModule === "tools"
          ? t("page.platforms.hint")
          : activeModule === "mcp"
            ? t("page.platforms.mcpHint")
            : activeModule === "agents"
              ? t("page.platforms.agentsHint")
              : activeModule === "models"
                ? t("page.platforms.modelsHint")
                : t("page.platforms.opsHint")}
      </p>
      {flash ? (
        <FlashMessage kind={flash.kind} message={flash.message} onDismiss={() => setFlash(null)} />
      ) : null}
      {activeModule === "tools" ? (
      <Card title={t("page.platforms.list")}>
        {q.isLoading ? <p className="text-sm text-slate-500">…</p> : null}
        {q.error ? <p className="text-sm text-rose-600">{(q.error as Error).message}</p> : null}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {rows.map((p: any) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-xs text-slate-500">{p.id}</span>
                <div className="text-xs text-slate-500">
                  {p.category} · {p.integration}
                  {p.cli_available ? " · CLI ✓" : ""}
                  {p.hook_shim_present ? " · shim ✓" : ""}
                </div>
              </div>
              {p.integration === "hooks" && !p.hook_shim_present ? (
                <button
                  type="button"
                  className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600"
                  disabled={install.isPending}
                  onClick={() => install.mutate(p.id)}
                >
                  {installingId === p.id
                    ? t("page.platforms.installing")
                    : t("page.platforms.installShim")}
                </button>
              ) : p.hook_shim_present ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {t("page.platforms.shimReady")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      ) : null}

      {activeModule === "ops" ? (
        <div className="space-y-4">
          {platformOpsPlan.isLoading ? <LoadingBlock /> : null}
          {platformOpsPlan.isError ? <p className="text-sm text-rose-600">{(platformOpsPlan.error as Error).message}</p> : null}
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label={t("page.platforms.opsHealth")} value={platformOpsPlan.data?.health?.score ?? 0} />
            <Metric label={t("page.platforms.opsRisks")} value={(platformOpsPlan.data?.health?.risks ?? []).length} />
            <Metric label={t("page.platforms.opsTasks")} value={(platformOpsPlan.data?.task_candidates ?? []).length} />
            <Metric label={t("page.platforms.opsCommands")} value={(platformOpsPlan.data?.commands ?? []).length} />
          </div>
          <Card
            title={t("page.platforms.opsRunbook")}
            actions={
              <div className="flex flex-wrap gap-2">
                <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" disabled={platformOpsTasks.isPending} onClick={() => platformOpsTasks.mutate(true)}>
                  <ListChecks className="h-4 w-4" />{t("page.platforms.previewOpsTasks")}
                </button>
                <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={platformOpsTasks.isPending} onClick={() => platformOpsTasks.mutate(false)}>
                  <Plus className="h-4 w-4" />{t("page.platforms.createOpsTasks")}
                </button>
              </div>
            }
          >
            <div className="grid gap-3 lg:grid-cols-2">
              {(platformOpsPlan.data?.commands ?? []).map((cmd: any) => (
                <div key={cmd.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text)]">{cmd.title}</p>
                      <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{cmd.command}</p>
                    </div>
                    <button type="button" className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:text-[var(--brand)]" onClick={() => copyText(cmd.command, () => setFlash({ kind: "ok", message: t("common.copied") }))}>
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <Tag>{cmd.category}</Tag>
                    <Tag><Terminal className="mr-1 inline h-3 w-3" />CLI</Tag>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
            <Card title={t("page.platforms.opsTasks")}>
              <div className="space-y-3">
                {(platformOpsPlan.data?.task_candidates ?? []).map((task: any) => (
                  <div key={task.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">{task.title}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{task.description}</p>
                      </div>
                      <Tag>{task.priority}</Tag>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <Tag>{task.category}</Tag>
                      <Tag>{task.assigned_to}</Tag>
                      <Tag>{task.estimate}</Tag>
                    </div>
                  </div>
                ))}
                {opsResult ? (
                  <pre className="max-h-40 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(opsResult.summary ?? opsResult, null, 2)}</pre>
                ) : null}
              </div>
            </Card>
            <div className="space-y-4">
              <Card title={t("page.platforms.opsRisks")}>
                <div className="space-y-2">
                  {(platformOpsPlan.data?.health?.risks ?? []).length ? (platformOpsPlan.data?.health?.risks ?? []).map((risk: any, idx: number) => (
                    <div key={`${risk.platform_id}-${idx}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs text-[var(--muted)]">{risk.platform_id}</p>
                        <Tag>{risk.level}</Tag>
                      </div>
                      <p className="mt-1 text-sm text-[var(--text)]">{risk.message}</p>
                    </div>
                  )) : <p className="text-sm text-[var(--muted)]">{t("page.platforms.noRisks")}</p>}
                </div>
              </Card>
              <Card title={t("page.platforms.aiPacket")}>
                <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(platformOpsPlan.data?.ai_packet ?? {}, null, 2)}</pre>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {activeModule === "mcp" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label={t("page.platforms.mcpTotal")} value={mcpSummary.data?.total ?? 0} />
            <Metric label={t("page.platforms.mcpEnabled")} value={mcpSummary.data?.enabled ?? 0} />
            <Metric label={t("page.platforms.mcpAvailable")} value={mcpSummary.data?.available ?? 0} />
            <Metric label={t("page.platforms.mcpWithEnv")} value={mcpSummary.data?.with_env ?? 0} />
          </div>
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_28rem]">
            <div className="space-y-4">
              <Card
                title={t("page.platforms.mcpRegistry")}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" disabled={installAllMcp.isPending} onClick={() => installAllMcp.mutate()}>
                      <Plus className="h-4 w-4" />{t("page.platforms.installBuiltinMcp")}
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" disabled={loadMcpProfile.isPending} onClick={() => loadMcpProfile.mutate()}>
                      <Copy className="h-4 w-4" />{t("page.platforms.mcpProfile")}
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={refreshMcp}>
                      <RotateCw className="h-4 w-4" />{t("common.refresh")}
                    </button>
                  </div>
                }
              >
                {mcpServers.isLoading ? <p className="text-sm text-[var(--muted)]">…</p> : null}
                {mcpServers.isError ? <p className="text-sm text-rose-600">{(mcpServers.error as Error).message}</p> : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  {(mcpServers.data ?? []).map((s: any) => (
                    <div key={s.name} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{s.name}</p>
                          <p className="truncate font-mono text-xs text-[var(--muted)]">{s.command} {(s.args ?? []).join(" ")}</p>
                        </div>
                        <span className={s.command_available ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600" : "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600"}>
                          {s.command_available ? t("page.platforms.mcpCommandOk") : t("page.platforms.mcpCommandMissing")}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{s.description || "-"}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {(s.tags ?? []).map((x: string) => <Tag key={x}>{x}</Tag>)}
                        {Object.keys(s.env ?? {}).length ? <Tag>env</Tag> : null}
                        <Tag>{s.runtime || "runtime"}</Tag>
                      </div>
                      <button type="button" className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-600" disabled={deleteMcp.isPending} onClick={() => deleteMcp.mutate(s.name)}>
                        <Trash2 className="h-3.5 w-3.5" />{t("common.delete")}
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
              {mcpProfile ? (
                <Card
                  title={t("page.platforms.mcpProfile")}
                  actions={<button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => copyText(JSON.stringify(mcpProfile, null, 2), () => setFlash({ kind: "ok", message: t("common.copied") }))}><Copy className="h-4 w-4" />{t("common.copy")}</button>}
                >
                  <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(mcpProfile, null, 2)}</pre>
                </Card>
              ) : null}
            </div>
            <div className="space-y-4">
              <Card title={t("page.platforms.mcpCreate")}>
                <div className="space-y-2">
                  <input className={`${inputClass} w-full`} placeholder="server name" value={mcpDraft.name} onChange={(e) => setMcpDraft((v) => ({ ...v, name: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="command" value={mcpDraft.command} onChange={(e) => setMcpDraft((v) => ({ ...v, command: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="args, shell-like" value={mcpDraft.args} onChange={(e) => setMcpDraft((v) => ({ ...v, args: e.target.value }))} />
                  <textarea className={`${inputClass} min-h-20 w-full`} placeholder={t("page.platforms.mcpDescription")} value={mcpDraft.description} onChange={(e) => setMcpDraft((v) => ({ ...v, description: e.target.value }))} />
                  <textarea className={`${inputClass} min-h-20 w-full`} placeholder="ENV_KEY=${ENV_KEY}" value={mcpDraft.env} onChange={(e) => setMcpDraft((v) => ({ ...v, env: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="tags" value={mcpDraft.tags} onChange={(e) => setMcpDraft((v) => ({ ...v, tags: e.target.value }))} />
                  <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={mcpDraft.enabled} onChange={(e) => setMcpDraft((v) => ({ ...v, enabled: e.target.checked }))} />enabled</label>
                  <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!mcpDraft.name.trim() || !mcpDraft.command.trim() || upsertMcp.isPending} onClick={() => upsertMcp.mutate()}>
                    <Server className="h-4 w-4" />{t("common.save")}
                  </button>
                </div>
              </Card>
              <Card title={t("page.platforms.mcpBuiltin")}>
                <div className="space-y-2">
                  {(mcpBuiltin.data ?? []).map((s: any) => (
                    <div key={s.name} className="rounded-xl border border-[var(--border)] px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--text)]">{s.name}</p>
                          <p className="line-clamp-2 text-xs text-[var(--muted)]">{s.description}</p>
                        </div>
                        <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs" disabled={installMcp.isPending} onClick={() => installMcp.mutate(s.name)}>
                          {t("page.platforms.install")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {activeModule === "agents" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label={t("page.platforms.agentTotal")} value={agentSummary.data?.agents ?? 0} />
            <Metric label={t("page.platforms.agentEnabled")} value={agentSummary.data?.enabled ?? 0} />
            <Metric label={t("page.platforms.a2aEnabled")} value={agentSummary.data?.a2a_enabled ?? 0} />
            <Metric label={t("page.platforms.agentGroups")} value={agentSummary.data?.groups ?? 0} />
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            <Metric label={t("page.platforms.runActiveClaims")} value={agentRunsSummary.data?.summary?.active_claims ?? 0} />
            <Metric label={t("page.platforms.runReports")} value={agentRunsSummary.data?.summary?.reports ?? 0} />
            <Metric label={t("page.platforms.runCompleted")} value={agentRunsSummary.data?.summary?.completed ?? 0} />
            <Metric label={t("page.platforms.runBlocked")} value={agentRunsSummary.data?.summary?.blocked ?? 0} />
            <Metric label={t("page.platforms.runSuccessRate")} value={agentRunsSummary.data?.summary?.success_rate ?? 0} />
          </div>
          <Card
            title={t("page.platforms.agentSloCenter")}
            actions={
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" disabled={agentRebalanceTasks.isPending} onClick={() => agentRebalanceTasks.mutate(true)}>
                  {t("page.platforms.previewRebalance")}
                </button>
                <button type="button" className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={agentRebalanceTasks.isPending} onClick={() => agentRebalanceTasks.mutate(false)}>
                  {t("page.platforms.createRebalanceTasks")}
                </button>
              </div>
            }
          >
            <div className="grid gap-3 md:grid-cols-5">
              <Metric label={t("page.platforms.sloScore")} value={agentSlo.data?.summary?.slo_score ?? 100} />
              <Metric label={t("page.platforms.healthyAgents")} value={agentSlo.data?.summary?.healthy_agents ?? 0} />
              <Metric label={t("page.platforms.watchAgents")} value={agentSlo.data?.summary?.watch_agents ?? 0} />
              <Metric label={t("page.platforms.riskAgents")} value={agentSlo.data?.summary?.risk_agents ?? 0} />
              <Metric label={t("page.platforms.rebalanceSuggestions")} value={agentSlo.data?.summary?.recommendations ?? 0} />
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
                <div className="grid grid-cols-[1fr_7rem_6rem_1fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                  <span>{t("page.platforms.runAgent")}</span>
                  <span>{t("page.platforms.runStatus")}</span>
                  <span>{t("page.platforms.sloScore")}</span>
                  <span>{t("page.platforms.sloIssues")}</span>
                </div>
                {(agentSlo.data?.agents ?? []).slice(0, 8).map((row: any) => (
                  <div key={row.agent} className="grid grid-cols-[1fr_7rem_6rem_1fr] items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                    <span className="truncate font-medium text-[var(--text)]">{row.name || row.agent}</span>
                    <span className={row.slo_status === "healthy" ? "w-fit rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600" : row.slo_status === "risk" ? "w-fit rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-600" : "w-fit rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600"}>
                      {row.slo_status}
                    </span>
                    <span className="font-mono text-[var(--text)]">{row.slo_score}</span>
                    <span className="truncate text-[var(--muted)]">{(row.issues ?? []).join(", ") || "-"}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {(agentSlo.data?.recommendations ?? []).slice(0, 4).map((item: any) => (
                  <div key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text)]">{item.title}</p>
                      <span className="rounded bg-[var(--control-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">{item.severity}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{item.summary}</p>
                    <code className="mt-2 block truncate rounded bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--brand)]">
                      {item.agent_packet?.commands?.[0] || "sop platforms agent-slo --json"}
                    </code>
                  </div>
                ))}
                {!(agentSlo.data?.recommendations ?? []).length ? (
                  <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted)]">{t("page.platforms.noRebalanceSuggestions")}</p>
                ) : null}
              </div>
            </div>
          </Card>
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_28rem]">
            <div className="space-y-4">
              <Card
                title={t("page.platforms.agentRunCenter")}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <input className={`${inputClass} w-44`} placeholder="agent" value={runFilter.agent} onChange={(e) => setRunFilter((v) => ({ ...v, agent: e.target.value }))} />
                    <select className={`${inputClass} w-40`} value={runFilter.status} onChange={(e) => setRunFilter((v) => ({ ...v, status: e.target.value }))}>
                      <option value="">{t("page.platforms.runAllStatus")}</option>
                      {["claimed", "running", "heartbeat", "reported", "completed", "blocked"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                }
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                        <th className="py-2 pr-3">{t("page.platforms.runAgent")}</th>
                        <th className="py-2 pr-3">{t("page.platforms.runTask")}</th>
                        <th className="py-2 pr-3">{t("page.platforms.runStatus")}</th>
                        <th className="py-2 pr-3">{t("page.platforms.runProgress")}</th>
                        <th className="py-2 pr-3">{t("page.platforms.runUpdated")}</th>
                        <th className="py-2 pr-3">{t("page.platforms.runSummary")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(agentRuns.data?.items ?? []).map((row: any) => (
                        <tr key={`${row.kind}-${row.id}-${row.updated_at}`} className="border-b border-[var(--border)] align-top">
                          <td className="py-2 pr-3 font-mono text-xs text-[var(--text)]">{row.agent}</td>
                          <td className="py-2 pr-3 font-mono text-xs text-[var(--muted)]">{row.task_id || "-"}</td>
                          <td className="py-2 pr-3">
                            <span className={row.active ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600" : "rounded-full bg-slate-500/10 px-2 py-0.5 text-xs text-[var(--muted)]"}>
                              {row.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-[var(--text)]">{row.progress ?? 0}%</td>
                          <td className="py-2 pr-3 text-xs text-[var(--muted)]">{row.updated_at || "-"}</td>
                          <td className="max-w-[26rem] py-2 pr-3 text-xs text-[var(--muted)]">
                            <span className="line-clamp-2">{row.summary || row.heartbeat_message || "-"}</span>
                          </td>
                        </tr>
                      ))}
                      {!agentRuns.isLoading && !(agentRuns.data?.items ?? []).length ? (
                        <tr><td className="py-4 text-sm text-[var(--muted)]" colSpan={6}>{t("page.platforms.noAgentRuns")}</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card
                title={t("page.platforms.agentRegistry")}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => bootstrapAgents.mutate()} disabled={bootstrapAgents.isPending}>
                      <Plus className="h-4 w-4" />{t("page.platforms.bootstrapAgents")}
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={refreshAgents}>
                      <RotateCw className="h-4 w-4" />{t("common.refresh")}
                    </button>
                  </div>
                }
              >
                {agents.isLoading ? <p className="text-sm text-[var(--muted)]">…</p> : null}
                {agents.isError ? <p className="text-sm text-rose-600">{(agents.error as Error).message}</p> : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  {(agents.data ?? []).map((a: any) => (
                    <div key={a.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">{a.name}</p>
                          <p className="font-mono text-xs text-[var(--muted)]">{a.id} · {a.role}</p>
                        </div>
                        <span className={a.a2a_enabled ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600" : "rounded-full bg-slate-500/10 px-2 py-0.5 text-xs text-[var(--muted)]"}>
                          {a.a2a_enabled ? "A2A" : "local"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{a.description || "-"}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {(a.tools ?? []).slice(0, 4).map((x: string) => <Tag key={x}>{x}</Tag>)}
                        {(a.mcp_servers ?? []).slice(0, 4).map((x: string) => <Tag key={x}>mcp:{x}</Tag>)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs" onClick={() => loadProfile.mutate(a.id)}>
                          <Copy className="h-3.5 w-3.5" />{t("page.platforms.agentProfile")}
                        </button>
                        <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-600" disabled={deleteAgent.isPending} onClick={() => deleteAgent.mutate(a.id)}>
                          <Trash2 className="h-3.5 w-3.5" />{t("common.delete")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title={t("page.platforms.agentGroups")}>
                <div className="grid gap-3 lg:grid-cols-2">
                  {(agentGroups.data ?? []).map((g: any) => (
                    <div key={g.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--text)]">{g.name}</p>
                          <p className="font-mono text-xs text-[var(--muted)]">{g.id} · {g.mode}</p>
                        </div>
                        <Network className="h-5 w-5 text-[var(--brand)]" />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {(g.agents ?? []).map((x: string) => <Tag key={x}>{x}</Tag>)}
                      </div>
                      <button type="button" className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-600" disabled={deleteGroup.isPending} onClick={() => deleteGroup.mutate(g.id)}>
                        <Trash2 className="h-3.5 w-3.5" />{t("common.delete")}
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div className="space-y-4">
              <Card title={t("page.platforms.createAgent")}>
                <div className="space-y-2">
                  <input className={`${inputClass} w-full`} placeholder="agent id" value={agentDraft.id} onChange={(e) => setAgentDraft((v) => ({ ...v, id: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder={t("page.platforms.agentName")} value={agentDraft.name} onChange={(e) => setAgentDraft((v) => ({ ...v, name: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="role" value={agentDraft.role} onChange={(e) => setAgentDraft((v) => ({ ...v, role: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="model" value={agentDraft.model} onChange={(e) => setAgentDraft((v) => ({ ...v, model: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="tools: sop-cli,pnpm" value={agentDraft.tools} onChange={(e) => setAgentDraft((v) => ({ ...v, tools: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="mcp: tasks,knowledge" value={agentDraft.mcp_servers} onChange={(e) => setAgentDraft((v) => ({ ...v, mcp_servers: e.target.value }))} />
                  <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={agentDraft.a2a_enabled} onChange={(e) => setAgentDraft((v) => ({ ...v, a2a_enabled: e.target.checked }))} />A2A</label>
                  <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!agentDraft.id.trim() || !agentDraft.name.trim() || createAgent.isPending} onClick={() => createAgent.mutate()}>
                    <Bot className="h-4 w-4" />{t("common.save")}
                  </button>
                </div>
              </Card>
              <Card title={t("page.platforms.createGroup")}>
                <div className="space-y-2">
                  <input className={`${inputClass} w-full`} placeholder="group id" value={groupDraft.id} onChange={(e) => setGroupDraft((v) => ({ ...v, id: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder={t("page.platforms.groupName")} value={groupDraft.name} onChange={(e) => setGroupDraft((v) => ({ ...v, name: e.target.value }))} />
                  <select className={`${inputClass} w-full`} value={groupDraft.mode} onChange={(e) => setGroupDraft((v) => ({ ...v, mode: e.target.value }))}>
                    {["sequential", "parallel", "review-gate", "swarm"].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input className={`${inputClass} w-full`} placeholder="orchestrator,planner,coder-frontend" value={groupDraft.agents} onChange={(e) => setGroupDraft((v) => ({ ...v, agents: e.target.value }))} />
                  <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!groupDraft.id.trim() || !groupDraft.agents.trim() || createGroup.isPending} onClick={() => createGroup.mutate()}>
                    <Users className="h-4 w-4" />{t("common.save")}
                  </button>
                </div>
              </Card>
              <Card title={t("page.platforms.builtinAgents")}>
                <div className="space-y-2">
                  {(builtinAgents.data ?? []).map((a: any) => (
                    <div key={a.id} className="rounded-xl border border-[var(--border)] px-3 py-2">
                      <p className="text-sm font-medium text-[var(--text)]">{a.name}</p>
                      <p className="text-xs text-[var(--muted)]">{a.role} · {(a.tools ?? []).join(", ")}</p>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title={t("page.platforms.agentProfiles")}>
                <div className="space-y-2">
                  {(agentRunsSummary.data?.agents ?? []).map((a: any) => (
                    <div key={a.agent} className="rounded-xl border border-[var(--border)] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--text)]">{a.name || a.agent}</p>
                        <span className="rounded-full bg-[var(--control-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">{a.success_rate}%</span>
                      </div>
                      <p className="text-xs text-[var(--muted)]">{a.role || "-"} · active {a.active_claims} · reports {a.reports} · avg {a.avg_progress}%</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
          {agentProfile ? (
            <Card
              title={t("page.platforms.agentProfile")}
              actions={<button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => copyText(JSON.stringify(agentProfile, null, 2), () => setFlash({ kind: "ok", message: t("common.copied") }))}><Copy className="h-4 w-4" />{t("common.copy")}</button>}
            >
              <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(agentProfile, null, 2)}</pre>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeModule === "models" ? (
        <div className="space-y-4">
          <Card
            title={t("page.platforms.modelCatalog")}
            actions={<button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => void models.refetch()}><RotateCw className="h-4 w-4" />{t("common.refresh")}</button>}
          >
            {models.isError ? <p className="text-sm text-rose-600">{(models.error as Error).message}</p> : null}
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {modelRows.map((m: any) => (
                <div key={m.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--text)]">{m.name}</p>
                      <p className="truncate font-mono text-xs text-[var(--muted)]">{m.id}</p>
                    </div>
                    <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{m.provider}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
                    <span>{t("page.platforms.context")}: {m.context}</span>
                    {models.data?.default === m.id ? <span className="text-emerald-600 dark:text-emerald-300">{t("page.platforms.defaultModel")}</span> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs" disabled={setDefaultModel.isPending} onClick={() => setDefaultModel.mutate(m.id)}>{t("page.platforms.setDefault")}</button>
                    {(models.data?.custom ?? []).some((x: any) => x.id === m.id) ? (
                      <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-600" disabled={deleteCustom.isPending} onClick={() => deleteCustom.mutate(m.id)}><Trash2 className="h-3.5 w-3.5" />{t("common.delete")}</button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card title={t("page.platforms.providers")}>
              <div className="grid gap-3 lg:grid-cols-2">
                {Object.entries(models.data?.providers ?? {}).map(([name, p]: [string, any]) => (
                  <div key={name} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">{p.name || name}</p>
                        <p className="text-xs text-[var(--muted)]">{p.base_url || "default endpoint"} · {p.has_api_key ? t("page.platforms.keyConfigured") : t("page.platforms.keyMissing")}</p>
                      </div>
                      <span className={p.enabled ? "text-xs text-emerald-600" : "text-xs text-slate-500"}>{p.enabled ? "enabled" : "disabled"}</span>
                    </div>
                    {providerTest[name] ? (
                      <pre className="mt-3 max-h-28 overflow-auto rounded-xl bg-slate-950 p-2 text-[11px] text-slate-100">{JSON.stringify(providerTest[name], null, 2)}</pre>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs" disabled={testProvider.isPending} onClick={() => testProvider.mutate(name)}>{t("page.platforms.testProvider")}</button>
                      <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs text-rose-600" disabled={deleteProvider.isPending} onClick={() => deleteProvider.mutate(name)}><Trash2 className="h-3.5 w-3.5" />{t("common.delete")}</button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <div className="space-y-4">
              <Card title={t("page.platforms.providerCreate")}>
                <div className="space-y-2">
                  <input className={`${inputClass} w-full`} placeholder="provider" value={providerDraft.name} onChange={(e) => setProviderDraft((v) => ({ ...v, name: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="api key" value={providerDraft.api_key} onChange={(e) => setProviderDraft((v) => ({ ...v, api_key: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="base url" value={providerDraft.base_url} onChange={(e) => setProviderDraft((v) => ({ ...v, base_url: e.target.value }))} />
                  <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={providerDraft.enabled} onChange={(e) => setProviderDraft((v) => ({ ...v, enabled: e.target.checked }))} />enabled</label>
                  <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!providerDraft.name.trim() || saveProvider.isPending} onClick={() => saveProvider.mutate()}><Plus className="h-4 w-4" />{t("common.save")}</button>
                </div>
              </Card>
              <Card title={t("page.platforms.customCreate")}>
                <div className="space-y-2">
                  <input className={`${inputClass} w-full`} placeholder="model id" value={customDraft.id} onChange={(e) => setCustomDraft((v) => ({ ...v, id: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="provider" value={customDraft.provider} onChange={(e) => setCustomDraft((v) => ({ ...v, provider: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="display name" value={customDraft.name} onChange={(e) => setCustomDraft((v) => ({ ...v, name: e.target.value }))} />
                  <input className={`${inputClass} w-full`} placeholder="context" value={customDraft.context} onChange={(e) => setCustomDraft((v) => ({ ...v, context: e.target.value }))} />
                  <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!customDraft.id.trim() || !customDraft.name.trim() || addCustom.isPending} onClick={() => addCustom.mutate()}><Cpu className="h-4 w-4" />{t("common.save")}</button>
                </div>
              </Card>
              <Card title={t("page.platforms.roleModel")}>
                <div className="space-y-2">
                  <input className={`${inputClass} w-full`} placeholder="role" value={roleDraft.role} onChange={(e) => setRoleDraft((v) => ({ ...v, role: e.target.value }))} />
                  <select className={`${inputClass} w-full`} value={roleDraft.model_id} onChange={(e) => setRoleDraft((v) => ({ ...v, model_id: e.target.value }))}>
                    <option value="">{t("page.platforms.pickModel")}</option>
                    {modelRows.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={!roleDraft.role.trim() || !roleDraft.model_id || setRoleModel.isPending} onClick={() => setRoleModel.mutate()}><Bot className="h-4 w-4" />{t("page.platforms.bindRole")}</button>
                </div>
                <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(models.data?.role_models ?? {}, null, 2)}</pre>
              </Card>
            </div>
          </div>
        </div>
      ) : null}
      </section>
    </div>
    </div>
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitArgs(value: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function parseEnvLines(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const idx = text.indexOf("=");
    if (idx <= 0) continue;
    out[text.slice(0, idx).trim()] = text.slice(idx + 1).trim();
  }
  return out;
}

function copyText(value: string, onOk: () => void) {
  void navigator.clipboard.writeText(value).then(onOk).catch(() => undefined);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] text-[var(--brand)]">
      {children}
    </span>
  );
}
