import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowRight, Layers3, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { ErrorBlock, LoadingBlock, NeedLogin } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { useCapabilities } from "@/lib/capabilities";

type ViewMode = "react" | "legacy" | "all";

function MaturityBar({ value }: { value: number }) {
  const tone = value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-xs text-[var(--muted-strong)]">{value}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : status === "legacy"
        ? "bg-rose-500/10 text-rose-700 dark:text-rose-200"
        : status === "migrating"
          ? "bg-sky-500/10 text-sky-700 dark:text-sky-200"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return <span className={`inline-flex h-6 w-fit items-center rounded-full px-2.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export function SystemMap() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [mode, setMode] = useState<ViewMode>("react");
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [selectedBacklogIds, setSelectedBacklogIds] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ["systemPages", mode, domain, status, keyword],
    queryFn: () => api.systemPages({ view: mode, domain, status, q: keyword.trim() }),
    enabled: authed,
  });
  const validateQ = useQuery({
    queryKey: ["systemPagesValidate"],
    queryFn: api.systemPagesValidate,
    enabled: authed,
  });
  const healthQ = useQuery({
    queryKey: ["systemPagesHealth"],
    queryFn: api.systemPagesHealth,
    enabled: authed,
  });
  const manifestQ = useQuery({
    queryKey: ["systemPagesManifestMe"],
    queryFn: api.systemPagesManifestMe,
    enabled: authed,
  });
  const actionsQ = useQuery({
    queryKey: ["systemPagesActionsMe"],
    queryFn: api.systemPagesActionsMe,
    enabled: authed,
  });
  const actionRunsQ = useQuery({
    queryKey: ["systemPagesActionRuns"],
    queryFn: () => api.systemPagesActionRuns(20),
    enabled: authed,
  });
  const capabilitiesQ = useQuery({
    queryKey: ["systemPagesCapabilities"],
    queryFn: api.systemPagesCapabilities,
    enabled: authed,
  });
  const migrationPlanQ = useQuery({
    queryKey: ["systemPagesLegacyMigrationPlan"],
    queryFn: api.systemPagesLegacyMigrationPlan,
    enabled: authed,
  });
  const me = useQuery({
    queryKey: ["authMe"],
    queryFn: api.authMe,
    enabled: authed,
    retry: false,
  });
  const caps = useCapabilities();
  const [taskResult, setTaskResult] = useState<any>(null);
  const [actionPlan, setActionPlan] = useState<any>(null);
  const [actionResult, setActionResult] = useState<any>(null);
  const backlogTasks = useMutation({
    mutationFn: ({ dryRun, ids }: { dryRun: boolean; ids: string[] }) =>
      api.systemPagesBacklogTasks({ ids, dry_run: dryRun, priority: "P1", assigned_to: "Coder" }),
    onSuccess: (data) => {
      setTaskResult(data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const planAction = useMutation({
    mutationFn: ({ moduleId, actionId }: { moduleId: string; actionId: string }) =>
      api.systemPagesActionPlan({ module_id: moduleId, action_id: actionId, dry_run: true }),
    onSuccess: setActionPlan,
  });
  const executeAction = useMutation({
    mutationFn: ({ moduleId, actionId }: { moduleId: string; actionId: string }) =>
      api.systemPagesActionExecute({ module_id: moduleId, action_id: actionId, dry_run: false, priority: "P1", assigned_to: "Coder" }),
    onSuccess: (data) => {
      setActionResult(data);
      void qc.invalidateQueries({ queryKey: ["systemPagesActionRuns"] });
      if (data?.result?.type === "copilot_prefill") {
        sessionStorage.setItem("sop-copilot-prefill", String(data.result.prompt || ""));
        window.location.hash = "#/copilot";
      } else if (data?.result?.type === "navigate" && data.result.target) {
        window.location.hash = String(data.result.target).replace(/^#/, "#");
      } else if (data?.result?.type === "task" || data?.result?.type === "legacy_migration_tasks") {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
  });

  const domainLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of q.data?.domains ?? []) map.set(String(item.id), String(item.name || item.id));
    return map;
  }, [q.data]);

  const domainLabel = (id: string) => domainLabels.get(id) || id;

  const rows = useMemo(() => {
    const base = mode === "react" ? q.data?.react : mode === "legacy" ? q.data?.legacy : q.data?.items;
    return base ?? [];
  }, [mode, q.data]);
  const backlogRows = useMemo(() => q.data?.migration?.backlog ?? [], [q.data]);
  const runBacklogTasks = (dryRun: boolean) => {
    const ids = selectedBacklogIds.length > 0 ? selectedBacklogIds : backlogRows.map((item: any) => String(item.id)).filter(Boolean);
    backlogTasks.mutate({ dryRun, ids });
  };

  const domains = useMemo(() => {
    const values = new Set<string>();
    for (const row of q.data?.items ?? []) values.add(String(row.domain));
    return Array.from(values).sort((a, b) => (q.data?.domains ?? []).findIndex((d: any) => d.id === a) - (q.data?.domains ?? []).findIndex((d: any) => d.id === b));
  }, [q.data]);
  const capabilityRows = useMemo(() => {
    const rows = capabilitiesQ.data?.items ?? q.data?.capability_registry ?? [];
    return domain === "all" ? rows : rows.filter((item: any) => item.domain === domain);
  }, [capabilitiesQ.data, domain, q.data]);
  const currentRole = caps.role || String(me.data?.role || "viewer");
  const canWriteSystemPages = caps.can("governance.system-map", "write") || caps.can("system.pages", "write");
  const canReadMigrationBacklog = caps.can("governance.system-map.migration.read", "read") || caps.can("governance.system-map.migration", "read") || canWriteSystemPages;
  const canWriteMigrationBacklog = caps.can("governance.system-map.migration.write", "write") || caps.can("governance.system-map.migration", "write") || canWriteSystemPages;
  const canRunModuleAction = (item: any) => {
    const action = String(item.required_action || "read") as "read" | "write" | "admin";
    const capability = String(item.capability || "");
    return Boolean(item.allowed) && (caps.can(`${capability}.${action}`, action) || caps.can(capability, action));
  };
  const pageColumns: ColumnsType<any> = [
    {
      title: t("page.systemMap.page"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <a className="truncate text-sm font-semibold text-[var(--text)] hover:text-[var(--brand)]" href={row.path}>{row.name}</a>
            {row.target ? (
              <>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                <a className="truncate text-xs text-[var(--brand)]" href={row.target}>{row.target}</a>
              </>
            ) : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{row.id} · {domainLabel(row.domain)}</p>
          {Array.isArray(row.capabilities) ? <p className="mt-1 line-clamp-1 text-xs text-[var(--muted-strong)]">{row.capabilities.join(" / ")}</p> : null}
        </div>
      ),
    },
    {
      title: t("page.systemMap.status"),
      dataIndex: "status",
      width: 120,
      render: (value) => <StatusBadge status={String(value || "-")} />,
    },
    {
      title: t("page.systemMap.maturity"),
      dataIndex: "maturity",
      width: 160,
      render: (value) => <MaturityBar value={Number(value ?? 0)} />,
    },
    {
      title: t("page.systemMap.next"),
      dataIndex: "next",
      render: (value) => (
        <Space size={[4, 4]} wrap>
          {(value ?? []).slice(0, 3).map((item: string) => <Tag key={item}>{item}</Tag>)}
        </Space>
      ),
    },
  ];
  const backlogColumns: ColumnsType<any> = [
    {
      title: t("page.systemMap.legacyEntry"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--text)]">{row.name}</p>
          <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{row.id} {"->"} {row.target}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.target ? (
              <a className="text-xs font-medium text-[var(--brand)] hover:underline" href={row.target}>
                {t("page.systemMap.openTarget")}
              </a>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      title: t("page.systemMap.status"),
      dataIndex: "status",
      width: 120,
      render: (value) => <StatusBadge status={String(value || "-")} />,
    },
    {
      title: t("page.systemMap.maturity"),
      dataIndex: "maturity",
      width: 160,
      render: (value) => <MaturityBar value={Number(value ?? 0)} />,
    },
    {
      title: t("page.systemMap.next"),
      dataIndex: "next",
      render: (value) => (
        <Space size={[4, 4]} wrap>
          {(value ?? []).slice(0, 3).map((item: string) => <Tag key={item}>{item}</Tag>)}
        </Space>
      ),
    },
  ];

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Layers3 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text)]">{t("page.systemMap.title")}</h1>
            <p className="text-sm text-[var(--muted)]">{t("page.systemMap.subtitle")}</p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
          onClick={() => void q.refetch()}
        >
          <RotateCw className="h-4 w-4" />
          {t("common.refresh")}
        </button>
      </div>

      {q.isLoading ? <LoadingBlock /> : null}
      {q.isError ? <ErrorBlock message={(q.error as Error).message} /> : null}

      <Card title={t("page.systemMap.whatIsThis")}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm leading-6 text-[var(--muted-strong)]">
              {q.data?.governance?.purpose || t("page.systemMap.purposeFallback")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--brand)]">{t("page.systemMap.notTaskPage")}</span>
              <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted-strong)]">{t("page.systemMap.governanceCenter")}</span>
              <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted-strong)]">{t("page.systemMap.legacyConvergence")}</span>
              <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted-strong)]">{t("page.systemMap.aiReady")}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label={t("page.systemMap.registryReady")} value={q.data?.governance?.completion_status?.registry_ready ? "yes" : "no"} />
            <Metric label={t("page.systemMap.reactReady")} value={q.data?.governance?.completion_status?.react_ready ?? 0} />
            <Metric label={t("page.systemMap.reactNeedImprove")} value={q.data?.governance?.completion_status?.react_need_improvement ?? 0} />
            <Metric label={t("page.systemMap.legacyNeedConverge")} value={q.data?.governance?.completion_status?.legacy_need_convergence ?? 0} />
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(q.data?.governance?.tasks ?? []).map((item: any) => (
            <article key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--text)]">{item.name}</p>
                <StatusBadge status={String(item.status || "-")} />
              </div>
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{item.description}</p>
              <p className="mt-3 text-xs font-medium text-[var(--muted-strong)]">{item.next_action}</p>
              <p className="mt-3 font-mono text-xs text-[var(--brand)]">{t("page.systemMap.metric")}: {item.metric}</p>
            </article>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile label={t("page.systemMap.reactPages")} value={q.data?.summary?.react?.total ?? 0} sub={`${q.data?.summary?.react?.avg_maturity ?? 0}%`} />
        <SummaryTile label={t("page.systemMap.legacyPages")} value={q.data?.summary?.legacy?.total ?? 0} sub={`${q.data?.summary?.legacy?.avg_maturity ?? 0}%`} />
        <SummaryTile label={t("page.systemMap.allPages")} value={q.data?.summary?.all?.total ?? 0} sub={`${q.data?.summary?.all?.avg_maturity ?? 0}%`} />
      </div>

      <Card title={t("page.systemMap.registryHealth")}>
        <div className="grid gap-3 lg:grid-cols-[18rem_1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-xs text-[var(--muted)]">{t("page.systemMap.registryScore")}</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-4xl font-semibold text-[var(--text)]">{validateQ.data?.validation?.score ?? q.data?.validation?.score ?? 0}</span>
              <span className="pb-1 text-sm text-[var(--muted)]">/ 100</span>
            </div>
            <p className={`mt-3 text-sm font-medium ${validateQ.data?.validation?.ok ?? q.data?.validation?.ok ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
              {validateQ.data?.validation?.ok ?? q.data?.validation?.ok ? t("page.systemMap.registryOk") : t("page.systemMap.registryWarn")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label={t("page.systemMap.navCount")} value={validateQ.data?.validation?.nav_count ?? q.data?.validation?.nav_count ?? 0} />
            <Metric label={t("page.systemMap.legacyConsoleCount")} value={validateQ.data?.validation?.legacy_console_count ?? q.data?.validation?.legacy_console_count ?? 0} />
            <Metric label={t("page.systemMap.missingNav")} value={(validateQ.data?.validation?.missing_nav ?? q.data?.validation?.missing_nav ?? []).length} />
            <Metric label={t("page.systemMap.missingLegacyConsole")} value={(validateQ.data?.validation?.missing_legacy_console ?? q.data?.validation?.missing_legacy_console ?? []).length} />
            <Metric label={t("page.systemMap.domainMismatch")} value={(validateQ.data?.validation?.domain_mismatches ?? q.data?.validation?.domain_mismatches ?? []).length} />
            <Metric label={t("page.systemMap.brokenTargets")} value={(validateQ.data?.validation?.broken_legacy_targets ?? q.data?.validation?.broken_legacy_targets ?? []).length} />
          </div>
        </div>
      </Card>

      <Card title={t("page.systemMap.menuHealth")}>
        <div className="grid gap-3 xl:grid-cols-[20rem_1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-xs text-[var(--muted)]">{t("page.systemMap.menuHealthScore")}</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-4xl font-semibold text-[var(--text)]">{healthQ.data?.health?.score ?? q.data?.menu_health?.score ?? 0}</span>
              <span className="pb-1 text-sm text-[var(--muted)]">/ 100</span>
            </div>
            <p className="mt-3 text-sm font-medium text-[var(--muted-strong)]">{t(`page.systemMap.healthStatus.${healthQ.data?.health?.status ?? q.data?.menu_health?.status ?? "critical"}`)}</p>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{healthQ.data?.health?.agent_consumption?.purpose}</p>
            <code className="mt-3 block rounded-lg bg-[var(--control-bg)] px-2.5 py-1 text-xs text-[var(--text)]">
              {healthQ.data?.health?.agent_consumption?.cli ?? "sop pages health --json"}
            </code>
          </div>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-6">
              <Metric label={t("page.systemMap.healthIssues")} value={healthQ.data?.health?.summary?.issues ?? q.data?.menu_health?.summary?.issues ?? 0} />
              <Metric label={t("page.systemMap.healthCritical")} value={healthQ.data?.health?.summary?.critical ?? q.data?.menu_health?.summary?.critical ?? 0} />
              <Metric label={t("page.systemMap.healthHigh")} value={healthQ.data?.health?.summary?.high ?? q.data?.menu_health?.summary?.high ?? 0} />
              <Metric label={t("page.systemMap.healthMedium")} value={healthQ.data?.health?.summary?.medium ?? q.data?.menu_health?.summary?.medium ?? 0} />
              <Metric label={t("page.systemMap.healthLow")} value={healthQ.data?.health?.summary?.low ?? q.data?.menu_health?.summary?.low ?? 0} />
              <Metric label={t("page.systemMap.healthModules")} value={healthQ.data?.health?.summary?.modules ?? q.data?.menu_health?.summary?.modules ?? 0} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <div className="grid grid-cols-[7rem_8rem_1fr_1fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
                <span>{t("page.systemMap.severity")}</span>
                <span>{t("page.systemMap.issueCategory")}</span>
                <span>{t("page.systemMap.module")}</span>
                <span>{t("page.systemMap.recommendation")}</span>
              </div>
              {(healthQ.data?.health?.top_issues ?? q.data?.menu_health?.top_issues ?? []).slice(0, 10).map((item: any) => (
                <div key={item.id} className="grid grid-cols-[7rem_8rem_1fr_1fr] items-start gap-3 border-b border-[var(--border)] px-4 py-3 text-xs last:border-0">
                  <span className={`w-fit rounded-full px-2 py-0.5 font-semibold ${
                    item.severity === "critical"
                      ? "bg-rose-500/10 text-rose-700 dark:text-rose-200"
                      : item.severity === "high"
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-200"
                        : "bg-sky-500/10 text-sky-700 dark:text-sky-200"
                  }`}>
                    {item.severity}
                  </span>
                  <span className="truncate font-mono text-[var(--muted-strong)]">{item.category}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--text)]">{item.module_id}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{item.path || item.capability}</p>
                    <p className="mt-1 line-clamp-1 text-[var(--muted-strong)]">{item.title}</p>
                  </div>
                  <p className="line-clamp-3 text-[var(--muted)]">{item.recommendation}</p>
                </div>
              ))}
              {!(healthQ.data?.health?.top_issues ?? q.data?.menu_health?.top_issues ?? []).length ? (
                <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.systemMap.noHealthIssues")}</div>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card title={t("page.systemMap.moduleManifest")}>
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label={t("page.systemMap.manifestVersion")} value={manifestQ.data?.version ?? "-"} />
            <Metric label={t("page.systemMap.visibleModules")} value={manifestQ.data?.quality?.visible_module_count ?? manifestQ.data?.modules?.length ?? 0} />
            <Metric label={t("page.systemMap.legacyModules")} value={manifestQ.data?.legacy_modules?.length ?? 0} />
            <Metric label={t("page.systemMap.codeSplitting")} value={manifestQ.data?.frontend?.code_splitting ? "on" : "off"} />
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.moduleManifestHint")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(manifestQ.data?.frontend?.chunk_strategy ?? []).map((chunk: string) => (
                <span key={chunk} className="rounded-full bg-[var(--control-bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]">
                  {chunk}
                </span>
              ))}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] md:grid-cols-2">
              <Info label={t("page.systemMap.registrySource")} value={manifestQ.data?.frontend?.module_registry_source ?? "-"} />
              <Info label={t("page.systemMap.securitySource")} value={manifestQ.data?.security?.capability_check ?? "-"} />
            </div>
          </div>
          {manifestQ.data?.ai?.agent_consumption ? (
            <div className="lg:col-span-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.agentConsumption")}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{manifestQ.data.ai.agent_consumption.purpose}</p>
                </div>
                <code className="rounded-lg bg-[var(--control-bg)] px-2.5 py-1 text-xs text-[var(--text)]">
                  {manifestQ.data.ai.agent_consumption.refresh_command}
                </code>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {Object.entries(manifestQ.data.ai.agent_consumption.local_files ?? {}).map(([key, value]) => (
                  <Info key={key} label={key} value={String(value)} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(manifestQ.data.ai.agent_consumption.selector_fields ?? []).map((field: string) => (
                  <span key={field} className="rounded-full bg-[var(--control-bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]">
                    {field}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title={t("page.systemMap.moduleActions")}>
        <div className="grid gap-3 xl:grid-cols-[20rem_1fr]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Metric label={t("page.systemMap.actionTotal")} value={actionsQ.data?.summary?.actions ?? 0} />
            <Metric label={t("page.systemMap.actionAllowed")} value={actionsQ.data?.summary?.allowed ?? 0} />
            <Metric label={t("page.systemMap.actionBlocked")} value={actionsQ.data?.summary?.blocked ?? 0} />
            <Metric label={t("page.systemMap.actionModules")} value={actionsQ.data?.summary?.modules ?? 0} />
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
            <div className="grid grid-cols-[1fr_1fr_8rem_10rem] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
              <span>{t("page.systemMap.action")}</span>
              <span>{t("page.systemMap.module")}</span>
              <span>{t("page.systemMap.actionType")}</span>
              <span>{t("page.systemMap.actionPlan")}</span>
            </div>
            {(actionsQ.data?.items ?? []).slice(0, 10).map((item: any) => {
              const runnable = canRunModuleAction(item);
              return (
                <div key={`${item.module_id}-${item.id}`} className="grid grid-cols-[1fr_1fr_8rem_10rem] items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text)]">{item.name}</p>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">{item.description}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--text)]">{item.module_name}</p>
                    <code className="mt-1 block truncate text-xs text-[var(--muted)]">{item.capability}</code>
                  </div>
                  <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${runnable ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-rose-500/10 text-rose-700 dark:text-rose-200"}`}>
                    {item.type}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={!runnable || planAction.isPending}
                      onClick={() => planAction.mutate({ moduleId: String(item.module_id), actionId: String(item.id) })}
                      title={!runnable ? t("capability.denied") : undefined}
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("page.systemMap.previewPlan")}
                    </button>
                    <button
                      type="button"
                      disabled={!runnable || executeAction.isPending}
                      onClick={() => executeAction.mutate({ moduleId: String(item.module_id), actionId: String(item.id) })}
                      title={!runnable ? t("capability.denied") : undefined}
                      className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("page.systemMap.executeAction")}
                    </button>
                  </div>
                </div>
              );
            })}
            {!actionsQ.data?.items?.length ? (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.systemMap.noActions")}</div>
            ) : null}
          </div>
        </div>
        {actionPlan ? (
          <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{actionPlan.action?.name}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{actionPlan.module?.name} · {actionPlan.action?.target}</p>
              </div>
              <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]">{actionPlan.role}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {(actionPlan.steps ?? []).map((step: any) => (
                <div key={step.order} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-xs font-semibold text-[var(--text)]">{step.order}. {step.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{step.detail}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {actionResult ? (
          <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.actionResult")}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {actionResult.executed ? t("page.systemMap.actionExecuted") : actionResult.reason || actionResult.result?.type || "-"}
            </p>
            <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted-strong)]">
              {JSON.stringify(actionResult.result ?? actionResult, null, 2)}
            </pre>
          </div>
        ) : null}
        <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.actionRuns")}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {t("page.systemMap.actionRunsHint", { total: actionRunsQ.data?.total ?? 0 })}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface)]"
              onClick={() => void actionRunsQ.refetch()}
            >
              {t("common.refresh")}
            </button>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="grid grid-cols-[1fr_9rem_7rem_8rem] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
              <span>{t("page.systemMap.module")}</span>
              <span>{t("page.systemMap.action")}</span>
              <span>{t("page.systemMap.runResult")}</span>
              <span>{t("page.systemMap.runTime")}</span>
            </div>
            {(actionRunsQ.data?.items ?? []).slice(0, 8).map((run: any) => (
              <div key={run.id} className="grid grid-cols-[1fr_9rem_7rem_8rem] items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--text)]">{run.module_name || run.module_id}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]">{run.id}</p>
                </div>
                <span className="truncate text-[var(--muted-strong)]">{run.action_name || run.action_id}</span>
                <span className={`w-fit rounded-full px-2 py-0.5 font-semibold ${run.executed ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-amber-500/10 text-amber-700 dark:text-amber-200"}`}>
                  {run.result_type || "-"}
                </span>
                <span className="truncate font-mono text-[11px] text-[var(--muted)]">{String(run.created_at || "").replace("T", " ").replace("Z", "")}</span>
              </div>
            ))}
            {!actionRunsQ.data?.items?.length ? (
              <div className="px-3 py-5 text-sm text-[var(--muted)]">{t("page.systemMap.noActionRuns")}</div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title={t("page.systemMap.capabilityGovernance")}>
        <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <Metric label={t("page.systemMap.capabilityTotal")} value={capabilitiesQ.data?.summary?.total ?? q.data?.capability_registry?.length ?? 0} />
            <Metric label={t("page.systemMap.submoduleTotal")} value={capabilitiesQ.data?.summary?.submodules ?? "-"} />
            <Metric label={t("page.systemMap.actionPermissionTotal")} value={capabilitiesQ.data?.summary?.actions ?? "-"} />
            <Metric label={t("page.systemMap.aiEnabled")} value={capabilitiesQ.data?.summary?.ai_enabled ?? q.data?.capability_registry?.filter?.((x: any) => x.ai?.enabled)?.length ?? 0} />
            <Metric label={t("page.systemMap.roleCount")} value={capabilitiesQ.data?.roles?.length ?? 5} />
            <Metric label={t("page.systemMap.currentRole")} value={currentRole} />
            <Metric label={t("page.systemMap.visibleCapabilities")} value={caps.summary?.visible ?? "-"} />
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
            <div className="grid grid-cols-[1fr_1fr_1.2fr_1.2fr_1.3fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
              <span>{t("page.systemMap.module")}</span>
              <span>{t("page.systemMap.capabilityCode")}</span>
              <span>{t("page.systemMap.submodules")}</span>
              <span>{t("page.systemMap.permissionRoles")}</span>
              <span>{t("page.systemMap.aiSurfaces")}</span>
            </div>
            {capabilityRows.slice(0, 10).map((item: any) => {
              const canRead = (item.permission?.read ?? []).includes(currentRole);
              const canWrite = (item.permission?.write ?? []).includes(currentRole);
              const canAdmin = (item.permission?.admin ?? []).includes(currentRole);
              return (
              <div key={item.id} className="grid grid-cols-[1fr_1fr_1.2fr_1.2fr_1.3fr] items-start gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <a href={item.path} className="truncate text-sm font-semibold text-[var(--text)] hover:text-[var(--brand)]">{item.name}</a>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">{item.domain_name}</p>
                </div>
                <code className="truncate rounded-lg bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--brand)]">{item.capability}</code>
                <div className="flex flex-wrap gap-1">
                  {(item.submodules ?? []).slice(0, 4).map((sub: any) => (
                    <span key={sub.id} className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] text-[var(--muted-strong)]">{sub.name}</span>
                  ))}
                  {(item.submodules ?? []).length > 4 ? <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]">+{(item.submodules ?? []).length - 4}</span> : null}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex flex-wrap gap-1">
                    <PermissionBadge active={canRead} label={t("page.systemMap.read")} />
                    <PermissionBadge active={canWrite} label={t("page.systemMap.write")} />
                    <PermissionBadge active={canAdmin} label={t("page.systemMap.admin")} />
                  </div>
                  <p className="line-clamp-1 text-[var(--muted)]">{(item.permission?.read ?? []).join(", ")}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(item.ai?.surfaces ?? []).slice(0, 5).map((surface: string) => (
                    <span key={surface} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]">{surface}</span>
                  ))}
                </div>
              </div>
            );
            })}
            {!capabilityRows.length ? (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.systemMap.noCapabilities")}</div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title={t("page.systemMap.domainModules")}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(q.data?.domain_matrix ?? []).map((item: any) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDomain(domain === item.id ? "all" : item.id)}
              className={`rounded-2xl border p-4 text-left transition hover:border-[var(--brand)] hover:bg-[var(--surface-muted)] ${
                domain === item.id ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{domainLabel(item.id)}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{item.description}</p>
                </div>
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--muted-strong)]">
                  {item.avg_maturity}%
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Metric label={t("page.systemMap.reactShort")} value={item.react_count ?? 0} />
                <Metric label={t("page.systemMap.legacyShort")} value={item.legacy_count ?? 0} />
                <Metric label={t("page.systemMap.totalShort")} value={item.total ?? 0} />
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card title={t("page.systemMap.strategy")}>
        <p className="text-sm leading-6 text-[var(--muted-strong)]">{q.data?.migration?.strategy}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Info label={t("page.systemMap.defaultEntry")} value={q.data?.migration?.default_entry_target ?? "-"} />
          <Info label={t("page.systemMap.legacyEntry")} value={q.data?.migration?.legacy_entry ?? "-"} />
        </div>
      </Card>

      <Card title={t("page.systemMap.pageList")}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented
            value={mode}
            onChange={(value) => setMode(value as ViewMode)}
            options={(["react", "legacy", "all"] as const).map((value) => ({
              label: t(`page.systemMap.mode.${value}`),
              value,
            }))}
          />
          <Select
            className="min-w-44"
            value={domain}
            onChange={setDomain}
            options={[
              { value: "all", label: t("page.systemMap.allDomains") },
              ...domains.map((value) => ({ value, label: domainLabel(value) })),
            ]}
          />
          <Select
            className="min-w-40"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: t("page.systemMap.allStatuses") },
              { value: "active", label: "active" },
              { value: "migrating", label: "migrating" },
              { value: "legacy", label: "legacy" },
            ]}
          />
          <Input.Search
            className="min-w-[18rem] flex-1"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("page.systemMap.searchPh")}
          />
          {(domain !== "all" || status !== "all" || keyword.trim()) ? (
            <Button
              onClick={() => {
                setDomain("all");
                setStatus("all");
                setKeyword("");
              }}
            >
              {t("common.reset")}
            </Button>
          ) : null}
        </div>
        <Table
          rowKey="id"
          columns={pageColumns}
          dataSource={rows}
          size="middle"
          scroll={{ x: 900 }}
          pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}` }}
        />
      </Card>

      <Card
        title={t("page.systemMap.migrationBacklog")}
        actions={
          <div className="flex flex-wrap gap-2">
	            <button
	              type="button"
	              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
	              onClick={() => runBacklogTasks(true)}
	              disabled={backlogTasks.isPending || backlogRows.length === 0 || !canReadMigrationBacklog}
	              title={!canReadMigrationBacklog ? t("capability.denied") : undefined}
	            >
	              {t("page.systemMap.previewTasks")}
	            </button>
            <button
	              type="button"
	              className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
	              onClick={() => runBacklogTasks(false)}
	              disabled={backlogTasks.isPending || backlogRows.length === 0 || !canWriteMigrationBacklog}
	              title={!canWriteMigrationBacklog ? t("capability.denied") : undefined}
	            >
              {t("page.systemMap.createTasks")}
            </button>
          </div>
        }
      >
        <div className="mb-4 grid gap-3 lg:grid-cols-[20rem_1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.migrationPlan")}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{migrationPlanQ.data?.strategy || t("page.systemMap.migrationPlanHint")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label={t("page.systemMap.planTotal")} value={migrationPlanQ.data?.plan?.total ?? 0} />
              <Metric label={t("page.systemMap.planCovered")} value={migrationPlanQ.data?.plan?.covered ?? 0} />
              <Metric label={t("page.systemMap.planPartial")} value={migrationPlanQ.data?.plan?.partial ?? 0} />
              <Metric label={t("page.systemMap.planMissing")} value={migrationPlanQ.data?.plan?.missing_target ?? 0} />
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
            <div className="grid grid-cols-[1fr_6rem_6rem_7rem_1fr] gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
              <span>{t("page.systemMap.legacyEntry")}</span>
              <span>{t("page.systemMap.priority")}</span>
              <span>{t("page.systemMap.coverage")}</span>
              <span>{t("page.systemMap.target")}</span>
              <span>{t("page.systemMap.next")}</span>
            </div>
            {(migrationPlanQ.data?.plan?.items ?? []).slice(0, 8).map((item: any) => (
              <div key={item.id} className="grid grid-cols-[1fr_6rem_6rem_7rem_1fr] gap-2 border-b border-[var(--border)] px-3 py-2 text-xs last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--text)]">{item.name}</p>
                  <p className="truncate font-mono text-[var(--muted)]">{item.source_path}</p>
                </div>
                <span className="font-mono text-[var(--brand)]">{item.priority}</span>
                <span className="text-[var(--muted-strong)]">{item.coverage}</span>
                <a className="truncate text-[var(--brand)] hover:underline" href={item.target}>{item.target_module || item.target}</a>
                <span className="truncate text-[var(--muted)]">{(item.next ?? []).join(" / ")}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <p className="text-sm text-[var(--muted-strong)]">
            {t("page.systemMap.backlogSelection", {
              selected: selectedBacklogIds.length,
              total: backlogRows.length,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="small"
              onClick={() => setSelectedBacklogIds(backlogRows.map((item: any) => String(item.id)).filter(Boolean))}
            >
              {t("page.systemMap.selectAllBacklog")}
            </Button>
            <Button
              size="small"
              onClick={() => setSelectedBacklogIds([])}
            >
              {t("page.systemMap.clearSelection")}
            </Button>
          </div>
        </div>
        {taskResult ? (
          <div className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted-strong)]">
            {t("page.systemMap.taskResult", {
              planned: taskResult.summary?.planned ?? 0,
              created: taskResult.summary?.created ?? 0,
              skipped: taskResult.summary?.skipped ?? 0,
            })}
          </div>
        ) : null}
        <Table
          rowKey="id"
          columns={backlogColumns}
          dataSource={backlogRows}
          size="middle"
          scroll={{ x: 900 }}
          rowSelection={{
            selectedRowKeys: selectedBacklogIds,
            onChange: (keys) => setSelectedBacklogIds(keys.map(String)),
          }}
          pagination={{ pageSize: 12, showSizeChanger: true, pageSizeOptions: [12, 24, 48, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}` }}
        />
      </Card>
    </div>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted-strong)]">{sub}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-mono text-xs text-[var(--text)]">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-2">
      <p className="font-mono text-sm font-semibold text-[var(--text)]">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">{label}</p>
    </div>
  );
}

function PermissionBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        active
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
          : "bg-[var(--surface-muted)] text-[var(--muted)]"
      }`}
    >
      {label}
    </span>
  );
}
