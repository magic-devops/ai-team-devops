import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Command,
  DatabaseZap,
  ExternalLink,
  Gauge,
  GitBranch,
  KeyRound,
  Layers3,
  Network,
  PanelTop,
  Route,
  ShieldCheck,
  Sparkles,
  UserCircle2,
} from "lucide-react";
import { api } from "../lib/api";
import { getWorkspaceScope } from "../lib/authStorage";
import { filterNavByMicroApp, getMicroAppRuntimeUrl, MICRO_APPS, type MicroAppDefinition, type MicroAppStatus } from "../microApps";
import { NAV, NAV_GROUPS, validateNavRegistry, type NavItem } from "../navigation";

type QueryRecord = Record<string, any>;

const statusTone: Record<MicroAppStatus, string> = {
  ready: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  migrating: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  planned: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
};

function asRecord(value: unknown): QueryRecord {
  return value && typeof value === "object" ? (value as QueryRecord) : {};
}

function numberFrom(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function statusLabel(status: MicroAppStatus) {
  if (status === "ready") return "已就绪";
  if (status === "migrating") return "独立化中";
  return "规划中";
}

function appModeLabel(app: MicroAppDefinition) {
  return app.mode === "standalone" ? "独立微应用" : "主应用原生";
}

function StatCard({ title, value, detail, icon, tone = "text-[var(--brand)]" }: { title: string; value: string | number; detail: string; icon: typeof Layers3; tone?: string }) {
  const Icon = icon;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <Icon className={`mb-3 h-5 w-5 ${tone}`} />
      <p className="text-2xl font-bold text-[var(--text)]">{value}</p>
      <p className="mt-1 text-sm font-medium text-[var(--muted-strong)]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function localAppModules(app: MicroAppDefinition) {
  return filterNavByMicroApp(app.id, NAV).filter((item) => !item.hidden && !item.key.startsWith("microApp"));
}

function localTopModules(app: MicroAppDefinition) {
  return localAppModules(app).filter((item) => !item.parentKey);
}

export function HermesPortal() {
  const { t } = useTranslation();
  const scope = getWorkspaceScope();
  const meQuery = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, retry: false });
  const portalQuery = useQuery({ queryKey: ["systemPagesHub"], queryFn: api.systemPagesHub, retry: false });
  const healthQuery = useQuery({ queryKey: ["systemPagesHealth"], queryFn: api.systemPagesHealth, retry: false });
  const validationQuery = useQuery({ queryKey: ["systemPagesValidate"], queryFn: api.systemPagesValidate, retry: false });
  const microAppsQuery = useQuery({ queryKey: ["systemPagesMicroApps"], queryFn: api.systemPagesMicroApps, retry: false });
  const capabilitiesQuery = useQuery({ queryKey: ["systemPagesCapabilitiesMe"], queryFn: api.systemPagesCapabilitiesMe, retry: false });

  const portal = asRecord(portalQuery.data);
  const portalMeta = asRecord(portal.portal);
  const portalIdentity = asRecord(portal.identity);
  const portalContracts = asRecord(portal.contracts);
  const portalMenuContract = asRecord(portalContracts.menu);
  const portalPermissionContract = asRecord(portalContracts.permission);
  const portalReadiness = asRecord(portal.readiness);
  const user = { ...portalIdentity, ...asRecord(meQuery.data) };
  const health = asRecord(asRecord(healthQuery.data).health ?? healthQuery.data);
  const backendApps = asRecord(microAppsQuery.data);
  const backendAppItems = Array.isArray(backendApps.items) ? backendApps.items : Array.isArray(backendApps.apps) ? backendApps.apps : [];
  const validation = asRecord(asRecord(validationQuery.data).validation ?? validationQuery.data);
  const backendIssues = Array.isArray(validation.issues) ? validation.issues : [];
  const localIssues = useMemo(() => validateNavRegistry(NAV), []);
  const issueSummary = useMemo(
    () => ({
      error: localIssues.filter((issue) => issue.level === "error").length + backendIssues.filter((issue: QueryRecord) => issue.level === "error").length,
      warn: localIssues.filter((issue) => issue.level === "warn").length + backendIssues.filter((issue: QueryRecord) => issue.level === "warn").length,
      total: localIssues.length + backendIssues.length,
    }),
    [backendIssues, localIssues],
  );

  const appStats = useMemo(
    () =>
      MICRO_APPS.map((app) => {
        const modules = localAppModules(app);
        const topModules = modules.filter((item) => !item.parentKey);
        const capabilities = modules.filter((item) => item.capability).length;
        return {
          app,
          modules,
          topModules,
          capabilities,
          runtimeUrl: getMicroAppRuntimeUrl(app),
        };
      }),
    [],
  );

  const totalModules = NAV.filter((item) => !item.hidden && !item.key.startsWith("microApp")).length;
  const totalCapabilities = NAV.filter((item) => item.capability).length;
  const healthScore = numberFrom(portalMenuContract.health_score ?? health.score ?? health.summary?.score, issueSummary.error ? 72 : issueSummary.warn ? 88 : 96);
  const role = String(user.role ?? "super_admin");
  const tenant = scope.tenantCode || user.tenant_slug || user.tenant_code || "default";
  const business = scope.businessCode || user.default_business_code || "all";
  const project = scope.projectCode || scope.projectId || user.default_project_code || "default";
  const username = String(user.username ?? user.email ?? "admin");
  const capabilitySummary = asRecord(capabilitiesQuery.data);
  const visibleCapabilityCount = numberFrom(portalPermissionContract.visible ?? capabilitySummary.summary?.visible ?? capabilitySummary.visible_count, totalCapabilities);
  const backendGovernanceActions = Array.isArray(portal.governance_actions) ? portal.governance_actions : [];
  const portalName = String(portalMeta.name || t("nav.hermesPortal", { defaultValue: "门户管理" }));

  const contractRows = [
    { label: "统一身份", value: username, detail: `${role} · ${tenant}`, icon: UserCircle2 },
    { label: "统一上下文", value: String(project), detail: `业务域 ${business} · 租户 ${tenant}`, icon: KeyRound },
    { label: "菜单权限契约", value: `${numberFrom(portalMenuContract.nav_items, totalModules)}`, detail: `${numberFrom(portalPermissionContract.total, totalCapabilities)} 个能力码 · ${numberFrom(portalMenuContract.domains, NAV_GROUPS.length)} 个域`, icon: ShieldCheck },
    { label: "运行治理", value: `${healthScore}%`, detail: issueSummary.total ? `${issueSummary.error} error / ${issueSummary.warn} warn` : "本地与后端校验通过", icon: Gauge },
  ];

  const governanceLinks = backendGovernanceActions.length ? backendGovernanceActions.map((item: QueryRecord, index: number) => ({
    title: String(item.title || item.id || "治理动作"),
    desc: String(item.description || item.metric || "来自门户管理后端治理控制面。"),
    href: String(item.path || "#/admin/menu"),
    icon: [PanelTop, ShieldCheck, Layers3][index % 3],
    metric: String(item.metric || item.priority || ""),
  })) : [
    { title: "菜单管理工作台", desc: "统一维护页面树、能力码、域、隐藏状态与健康检查。", href: "#/admin/menu", icon: PanelTop },
    { title: "权限矩阵", desc: "按角色横向对比 read/write/admin 权限点。", href: "#/admin/permissions", icon: ShieldCheck },
    { title: "微应用注册管理", desc: "注册 5 个独立微应用，管理运行模式、模块清单与沙箱配置。", href: "#/admin/micro-app-registry", icon: Layers3 },
  ];

  const protocolCards = [
    { title: "SSO 与身份令牌", desc: "主应用发放登录态、租户与项目上下文；微应用仅消费契约，不自行复制账号体系。", icon: KeyRound },
    { title: "菜单权限 Manifest", desc: "页面、能力码、角色策略、隐藏状态和多级菜单由注册表生成，支持健康校验。", icon: Route },
    { title: "运行时通信协议", desc: "统一 shell、tenant、business、project、workspace 参数，后续可扩展事件总线和操作审计。", icon: GitBranch },
    { title: "运行治理与观测", desc: "集中展示健康分、错误/告警、模块数、能力域和独立微应用状态。", icon: Activity },
  ];
  const readinessRows = [
    { label: "身份会话", ready: Boolean(portalReadiness.identity_context), desc: "登录态、角色、租户与 SSO 状态", href: "#/settings" },
    { label: "上下文传播", ready: Boolean(portalReadiness.workspace_context), desc: "tenant/business/project/workspace 注入", href: "#/portal" },
    { label: "菜单契约", ready: Boolean(portalReadiness.menu_contract), desc: "页面树、域、路径与能力码健康", href: "#/admin/menu" },
    { label: "权限矩阵", ready: Boolean(portalReadiness.permission_contract), desc: "角色与 read/write/admin 权限点", href: "#/admin/permissions" },
    { label: "微应用注册", ready: Boolean(portalReadiness.micro_apps), desc: "独立应用入口、模块归属与运行模式", href: "#/admin/micro-app-registry" },
  ];
  const managementTracks = [
    { title: "统一身份管理", desc: "查看当前角色、租户会话、SSO 来源和可见能力范围。", metric: role, href: "#/settings", icon: UserCircle2 },
    { title: "上下文管理", desc: "确认 tenant、business、project 和 workspace 参数在各微应用间一致传递。", metric: String(project), href: "#/portal", icon: KeyRound },
    { title: "菜单权限治理", desc: "检查导航注册表、能力码、i18n、隐藏策略和批量治理任务。", metric: `${healthScore}%`, href: "#/admin/menu", icon: ClipboardCheck },
    { title: "微应用运行治理", desc: "维护 5 个独立微应用的入口、模块清单、沙箱配置和通信协议。", metric: `${MICRO_APPS.length} apps`, href: "#/admin/micro-app-registry", icon: Network },
  ];

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--brand)]">
              <Network className="h-4 w-4" />
              {portalName}
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-[var(--text)]">门户管理控制台</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
              主应用定位为门户管理和控制面：统一身份、统一上下文、统一菜单权限契约、统一微应用注册与运行治理；各业务能力进入独立微应用承载，权限隔离和菜单体系按应用边界独立演进。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="#/admin/micro-app-registry"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
            >
              <Layers3 className="h-4 w-4" />
              微应用注册
            </a>
            <a
              href="#/admin/menu"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Command className="h-4 w-4" />
              菜单权限契约
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {contractRows.map((item) => (
          <StatCard key={item.label} title={item.label} value={item.value} detail={item.detail} icon={item.icon} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-[var(--text)]">门户管理能力</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">把主应用职责收敛为可配置、可检查、可追踪的控制面能力。</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-xs font-semibold text-[var(--brand)]">
              <ShieldCheck className="h-4 w-4" />
              {portalReadiness.score ? `${portalReadiness.score}% ready` : "实时校验"}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {managementTracks.map((item) => {
              const Icon = item.icon;
              return (
                <a key={item.title} href={item.href} className="group rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--muted-strong)]">{item.metric}</span>
                  </div>
                  <h4 className="mt-3 text-sm font-semibold text-[var(--text)]">{item.title}</h4>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{item.desc}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
                    进入管理 <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                  </span>
                </a>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="text-xl font-bold text-[var(--text)]">控制面就绪度</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">后端 `/system/pages/hub` 返回的门户管理运行状态。</p>
          <div className="mt-4 space-y-2">
            {readinessRows.map((item) => (
              <a key={item.label} href={item.href} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 hover:bg-[var(--surface-muted)]">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.ready ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                  {item.ready ? <CheckCircle2 className="h-4 w-4" /> : <Gauge className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--text)]">{item.label}</span>
                  <span className="line-clamp-1 text-xs text-[var(--muted)]">{item.desc}</span>
                </span>
                <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${item.ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                  {item.ready ? "已就绪" : "待治理"}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-[var(--text)]">微应用运行地图</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                主应用统一纳管 {MICRO_APPS.length} 个应用；后端注册表返回 {backendAppItems.length || MICRO_APPS.length} 个应用实例。
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted-strong)] ring-1 ring-[var(--border)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--brand)]" />
              门户控制面
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {appStats.map(({ app, topModules, modules, capabilities, runtimeUrl }) => (
              <div key={app.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ring-1 ${statusTone[app.status]}`}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {statusLabel(app.status)}
                    </span>
                    <h4 className="mt-3 text-lg font-bold text-[var(--text)]">{app.name}</h4>
                    <p className="mt-1 text-xs text-[var(--muted)]">{app.owner} · {appModeLabel(app)}</p>
                  </div>
                  <a
                    href={app.route}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]"
                  >
                    管理台
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--muted-strong)]">{app.description}</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-lg font-bold text-[var(--text)]">{topModules.length}</p>
                    <p className="text-[11px] text-[var(--muted)]">主模块</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-lg font-bold text-[var(--text)]">{modules.length}</p>
                    <p className="text-[11px] text-[var(--muted)]">总菜单</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-lg font-bold text-[var(--text)]">{capabilities}</p>
                    <p className="text-[11px] text-[var(--muted)]">能力码</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {app.highlights.slice(0, 3).map((highlight) => (
                    <span key={highlight} className="rounded-md bg-[var(--brand-soft)] px-2 py-1 text-xs font-medium text-[var(--brand)]">
                      {highlight}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
                  <span className="truncate">{app.envKey}</span>
                  <a href={runtimeUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-semibold text-[var(--brand)]">
                    运行入口
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <h3 className="text-lg font-bold text-[var(--text)]">控制面职责边界</h3>
            <div className="mt-4 space-y-3">
              {protocolCards.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                    <Icon className="mb-2 h-5 w-5 text-[var(--brand)]" />
                    <p className="text-sm font-semibold text-[var(--text)]">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <h3 className="text-lg font-bold text-[var(--text)]">治理入口</h3>
            <div className="mt-4 space-y-3">
              {governanceLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <a key={item.href} href={item.href} className="group flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 hover:border-[var(--brand)]/40 hover:shadow-sm">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--text)]">{item.title}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--muted)]">{item.desc}</span>
                      {"metric" in item && item.metric ? <span className="mt-2 inline-flex rounded-md bg-[var(--brand-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--brand)]">{item.metric}</span> : null}
                    </span>
                    <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-[var(--muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-[var(--text)]">统一契约快照</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">用于产品、权限、研发和运维共同确认边界，避免菜单分散、权限漂移和微应用入口失控。</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--muted-strong)] ring-1 ring-[var(--border)]">
            <DatabaseZap className="h-4 w-4 text-[var(--brand)]" />
            {visibleCapabilityCount} 可见能力
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "身份来源", value: role, desc: "统一角色、用户、租户与 SSO" },
            { label: "上下文来源", value: `${tenant}/${business}/${project}`, desc: "微应用打开时注入同一 workspace" },
            { label: "菜单来源", value: `${totalModules} modules`, desc: "主应用注册，子应用消费自己的切片" },
            { label: "运行状态", value: portalReadiness.score ? `${portalReadiness.score}%` : issueSummary.total ? "需处理" : "健康", desc: issueSummary.total ? `${issueSummary.total} 个校验项` : "导航注册表校验通过" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{item.label}</p>
              <p className="mt-2 truncate text-lg font-bold text-[var(--text)]">{item.value}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {MICRO_APPS.map((app) => {
            const top = localTopModules(app).slice(0, 5);
            return (
              <div key={app.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[var(--brand)]" />
                  <p className="text-sm font-semibold text-[var(--text)]">{app.shortName}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {top.map((item: NavItem) => (
                    <span key={item.key} className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted-strong)]">
                      {t(`nav.${item.key}`, { defaultValue: item.key })}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
