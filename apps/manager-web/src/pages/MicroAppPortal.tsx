import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  KeyRound,
  Layers3,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getBusinessCode, getProjectCode, getProjectId, getTenantCode, getWorkspaceScope } from "../lib/authStorage";
import { filterNavByMicroApp, getMicroApp, getMicroAppRuntimeUrl, type MicroAppDefinition, type MicroAppId, type MicroAppStatus } from "../microApps";
import { NAV } from "../navigation";

type MicroAppPortalProps = {
  appId: MicroAppId;
};

const statusTone: Record<MicroAppStatus, string> = {
  ready: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  migrating: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  planned: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
};

function statusLabel(status: MicroAppStatus) {
  if (status === "ready") return "可用";
  if (status === "migrating") return "独立化中";
  return "规划中";
}

function standaloneModeLabel(app: MicroAppDefinition) {
  return app.mode === "native" ? "主应用控制面" : "独立微应用";
}

function normalizeRuntimeUrl(app: MicroAppDefinition) {
  const runtimeUrl = getMicroAppRuntimeUrl(app);
  if (!runtimeUrl || app.mode === "native") return app.route;
  return runtimeUrl;
}

function withHash(url: string, hashPath?: string) {
  const targetHash = hashPath?.startsWith("#") ? hashPath : "";
  if (!targetHash) return url;
  const [base] = url.split("#");
  return `${base}${targetHash}`;
}

function withScopeQuery(url: string) {
  const workspaceScope = getWorkspaceScope();
  const scope = {
    tenant: getTenantCode(),
    business: getBusinessCode(),
    projectId: getProjectId(),
    project: getProjectCode(),
    workspace: JSON.stringify(workspaceScope),
    shell: "hermes-portal",
  };
  try {
    const parsed = new URL(url, window.location.origin);
    for (const [key, value] of Object.entries(scope)) {
      if (value) parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function MicroAppPortal({ appId }: MicroAppPortalProps) {
  const { t } = useTranslation();
  const app = getMicroApp(appId);
  const [keyword, setKeyword] = useState("");
  const runtimeUrl = normalizeRuntimeUrl(app);
  const standaloneUrl = app.mode === "native" ? runtimeUrl : withScopeQuery(runtimeUrl);
  const modules = useMemo(
    () => filterNavByMicroApp(appId, NAV).filter((item) => !item.hidden && !item.parentKey && !item.key.startsWith("microApp")),
    [appId],
  );
  const leafCount = useMemo(() => filterNavByMicroApp(appId, NAV).filter((item) => item.hidden || item.parentKey).length, [appId]);
  const matchedModules = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return modules;
    return modules.filter((item) => {
      const label = t(`nav.${item.key}`, { defaultValue: item.key });
      return `${label} ${item.description || ""} ${item.capability || ""}`.toLowerCase().includes(needle);
    });
  }, [keyword, modules, t]);

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid gap-6 p-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ring-1 ${statusTone[app.status]}`}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {statusLabel(app.status)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-medium text-[var(--muted-strong)] ring-1 ring-[var(--border)]">
                <Network className="h-3.5 w-3.5" />
                {standaloneModeLabel(app)}
              </span>
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-[var(--text)]">{app.name}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted-strong)]">{app.description}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href={standaloneUrl}
                target={app.mode === "native" ? undefined : "_blank"}
                rel={app.mode === "native" ? undefined : "noreferrer"}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              >
                <ExternalLink className="h-4 w-4" />
                {app.mode === "native" ? "进入主应用控制面" : "打开独立微应用"}
              </a>
              <a
                href="#/admin/micro-app-registry"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2.5 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
              >
                <Layers3 className="h-4 w-4" />
                应用注册与菜单契约
              </a>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {app.highlights.map((item) => (
                <div key={item} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                  <Sparkles className="mb-2 h-4 w-4 text-[var(--brand)]" />
                  <p className="text-sm font-semibold text-[var(--text)]">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            {[
              { icon: KeyRound, title: "统一身份与 SSO", desc: "主应用只负责登录、租户、项目与业务上下文，子应用独立运行时复用同一作用域。" },
              { icon: ShieldCheck, title: "权限与能力码", desc: "能力码、角色策略、页面权限由主应用集中治理，子应用按 manifest 消费。" },
              { icon: GitBranch, title: "独立菜单体系", desc: "每个微应用拥有自己的多级菜单、收藏、最近访问、快捷入口与显示偏好。" },
            ].map((item) => {
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
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <Layers3 className="mb-3 h-5 w-5 text-[var(--brand)]" />
          <p className="text-2xl font-bold text-[var(--text)]">{modules.length}</p>
          <p className="text-sm text-[var(--muted)]">专业主模块</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <Workflow className="mb-3 h-5 w-5 text-[var(--brand)]" />
          <p className="text-2xl font-bold text-[var(--text)]">{leafCount}</p>
          <p className="text-sm text-[var(--muted)]">细化子能力</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <ShieldCheck className="mb-3 h-5 w-5 text-[var(--brand)]" />
          <p className="text-2xl font-bold text-[var(--text)]">门户</p>
          <p className="text-sm text-[var(--muted)]">主应用不再内嵌 iframe，仅管理入口与契约</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text)]">微应用模块入口</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">从门户直接打开独立微应用对应模块，主应用只保留治理、授权、注册和发现能力。</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted)]" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索微应用模块"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] py-2 pl-8 pr-3 text-sm outline-none ring-[var(--brand)] focus:ring"
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {matchedModules.map((item) => {
            const Icon = item.icon;
            const target = app.mode === "native" ? item.path : withScopeQuery(withHash(runtimeUrl, item.path));
            return (
              <a
                key={item.key}
                href={target}
                target={app.mode === "native" ? undefined : "_blank"}
                rel={app.mode === "native" ? undefined : "noreferrer"}
                className="group flex min-h-28 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-md"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--text)]">{t(`nav.${item.key}`, { defaultValue: item.key })}</span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--muted)]">
                    {item.description || t(`page.${item.key}.desc`, { defaultValue: item.capability || item.path })}
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
                    打开模块 <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
