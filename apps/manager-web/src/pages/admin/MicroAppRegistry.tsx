import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Cpu,
  GitBranch,
  Globe2,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Network,
  PlugZap,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { MICRO_APPS, filterNavByMicroApp, type MicroAppDefinition } from "../../microApps";
import { NAV, type NavGroupKey, type NavItem } from "../../navigation";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";

type RegistryApp = MicroAppDefinition & {
  backend?: any;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const statusMap: Record<MicroAppDefinition["status"], { label: string; className: string }> = {
  ready: { label: "可用", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  migrating: { label: "迁移中", className: "bg-amber-50 text-amber-700 border-amber-200" },
  planned: { label: "规划中", className: "bg-slate-50 text-slate-700 border-slate-200" },
};

const backendStatusMap: Record<string, { label: string; className: string }> = {
  healthy: { label: "健康", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  watch: { label: "观察", className: "bg-amber-50 text-amber-700 border-amber-200" },
  risk: { label: "风险", className: "bg-red-50 text-red-700 border-red-200" },
};

const modeMap: Record<MicroAppDefinition["mode"], string> = {
  native: "主应用原生",
  standalone: "独立微应用",
};

export function MicroAppRegistry() {
  const { t } = useTranslation();
  const microAppsQuery = useQuery({ queryKey: ["systemPagesMicroApps"], queryFn: api.systemPagesMicroApps, retry: false });
  const [selected, setSelected] = useState<RegistryApp | null>(null);
  const [query, setQuery] = useState("");

  const groupLabel = (key: NavGroupKey) => t(`nav.group.${key}`, { defaultValue: key });
  const labelOf = (item: NavItem) => t(`nav.${item.key}`, { defaultValue: item.key });

  const backendById = useMemo(() => {
    const rows = Array.isArray(microAppsQuery.data?.apps) ? microAppsQuery.data.apps : [];
    return new Map(rows.map((app: any) => [String(app.id), app]));
  }, [microAppsQuery.data?.apps]);

  const apps = useMemo<RegistryApp[]>(() => {
    const keyword = query.trim().toLowerCase();
    return MICRO_APPS.map((app) => ({ ...app, backend: backendById.get(app.id) as any })).filter((app) => {
      const backend = app.backend as any;
      const responsibilities = Array.isArray(backend?.responsibilities) ? backend.responsibilities.join(" ") : "";
      const haystack = [backend?.name || app.name, app.shortName, backend?.owner || app.owner, app.description, app.mode, app.status, responsibilities, app.highlights.join(" "), app.capabilities.map((capability) => capability.name).join(" ")]
        .join(" ")
        .toLowerCase();
      return !keyword || haystack.includes(keyword);
    });
  }, [backendById, query]);

  const totalModules = Number(microAppsQuery.data?.summary?.module_count) || MICRO_APPS.reduce((sum, app) => sum + filterNavByMicroApp(app.id, NAV).length, 0);

  return (
    <WorkbenchShell
      title="子应用注册管理"
      description="统一管理 5 个微应用的运行模式、菜单边界、能力域、沙箱配置和通信契约。"
      actions={
        <input
          className="min-w-[18rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索子应用、负责人、能力标签"
        />
      }
      metrics={
        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="子应用" value={MICRO_APPS.length} icon={<Boxes size={18} />} />
          <Metric label="注册模块" value={totalModules} icon={<Layers3 size={18} />} />
          <Metric label="独立运行" value={microAppsQuery.data?.summary?.standalone ?? MICRO_APPS.filter((app) => app.mode === "standalone").length} icon={<Globe2 size={18} />} />
          <Metric label="健康/观察" value={`${microAppsQuery.data?.summary?.healthy ?? MICRO_APPS.filter((app) => app.status === "ready").length}/${microAppsQuery.data?.summary?.watch ?? MICRO_APPS.filter((app) => app.status === "migrating").length}`} icon={<Activity size={18} />} />
        </div>
      }
    >
      <section className="grid gap-4 xl:grid-cols-3">
        <ArchitectureCard icon={<Network size={20} />} title="主应用门户" description="负责登录态、租户/业务/项目上下文、子应用发现、全局菜单契约与权限矩阵。" />
        <ArchitectureCard icon={<PlugZap size={20} />} title="微应用运行" description="每个子应用拥有独立菜单和业务工作台，可由门户打开，也可独立部署和独立运行。" />
        <ArchitectureCard icon={<MessageSquareText size={20} />} title="通信协议" description="统一使用 SSO 上下文、能力码、导航 manifest、事件总线和 URL 协议完成跨应用协作。" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {apps.map((app) => {
          const modules = filterNavByMicroApp(app.id, NAV);
          const status = backendStatusMap[String(app.backend?.status || "")] ?? statusMap[app.status];
          const moduleCount = Number(app.backend?.module_count) || modules.length;
          return (
            <button
              key={app.id}
              type="button"
              className="group rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-lg"
              onClick={() => setSelected(app)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Layers3 size={24} />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--text)]">{app.backend?.name || app.name}</h3>
                    <p className="text-sm text-[var(--muted)]">{app.backend?.owner || app.owner}</p>
                  </div>
                </div>
                <ChevronRight className="text-[var(--muted)] transition group-hover:translate-x-1" size={18} />
              </div>
              <p className="mt-4 line-clamp-2 text-sm text-[var(--muted)]">{app.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={cn("rounded-full border px-2 py-1 text-xs font-medium", status.className)}>{status.label}</span>
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted)]">{modeMap[app.mode]}</span>
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--muted)]">{moduleCount} 模块</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {app.groups.map((group) => (
                  <span key={group} className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted)]">
                    {groupLabel(group)}
                  </span>
                ))}
              </div>
              <div className="mt-4 grid gap-2">
                {app.highlights.slice(0, 3).map((highlight) => (
                  <div key={highlight} className="flex items-center gap-2 text-sm text-[var(--text)]">
                    <Sparkles size={15} className="text-[var(--accent)]" />
                    {highlight}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </section>

      {selected ? (
        <DetailDrawer
              app={selected}
          modules={filterNavByMicroApp(selected.id, NAV)}
          labelOf={labelOf}
          groupLabel={groupLabel}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </WorkbenchShell>
  );
}

function Metric({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">{icon}{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

function ArchitectureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="flex items-center gap-2 font-semibold text-[var(--text)]">
        <span className="text-[var(--accent)]">{icon}</span>
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}

function DetailDrawer({
  app,
  modules,
  labelOf,
  groupLabel,
  onClose,
}: {
  app: RegistryApp;
  modules: NavItem[];
  labelOf: (item: NavItem) => string;
  groupLabel: (key: NavGroupKey) => string;
  onClose: () => void;
}) {
  const topModules = modules.filter((item) => !item.parentKey);
  const backendModules = Array.isArray(app.backend?.modules) ? app.backend.modules : [];
  const childCount = (key: string) => modules.filter((item) => item.parentKey === key).length;
  const status = backendStatusMap[String(app.backend?.status || "")] ?? statusMap[app.status];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-3xl overflow-auto border-l border-[var(--border)] bg-[var(--surface-raised)] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Micro App Detail</p>
            <h3 className="mt-1 text-2xl font-semibold text-[var(--text)]">{app.backend?.name || app.name}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{app.description}</p>
          </div>
          <button className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)]" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className={cn("rounded-full border px-2 py-1 text-xs font-medium", status.className)}>{status.label}</span>
          <span className="rounded-full border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]">{modeMap[app.mode]}</span>
          <span className="rounded-full border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]">{modules.length} 个注册菜单</span>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <InfoSection title="基础信息" icon={<CheckCircle2 size={18} />}>
            <InfoRow label="应用 ID" value={app.id} mono />
            <InfoRow label="Owner" value={String(app.backend?.owner || app.owner)} />
            <InfoRow label="Route" value={app.route} mono />
            <InfoRow label="Base Path" value={app.basePath} mono />
            <InfoRow label="Env Key" value={app.envKey} mono />
          </InfoSection>

          <InfoSection title="沙箱配置" icon={<LockKeyhole size={18} />}>
            <InfoRow label="Production" value={app.prodUrl} mono />
            <InfoRow label="Local Dev" value={app.devUrl} mono />
            <InfoRow label="SSO" value="复用主应用会话与三码上下文" />
            <InfoRow label="Permission" value="按能力码和角色矩阵裁决" />
            <InfoRow label="Menu Manifest" value="独立菜单树 + 主应用注册契约" />
          </InfoSection>
        </div>

        <InfoSection title="菜单模块列表" icon={<Layers3 size={18} />} className="mt-4">
          <div className="grid gap-2 md:grid-cols-2">
            {topModules.map((item) => (
              <div key={item.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <item.icon size={16} className="text-[var(--accent)]" />
                    <span className="truncate font-medium text-[var(--text)]">{labelOf(item)}</span>
                  </div>
                  <span className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{childCount(item.key)}</span>
                </div>
                <div className="mt-2 truncate font-mono text-xs text-[var(--muted)]">{item.capability ?? item.key}</div>
              </div>
            ))}
            {backendModules
              .filter((row: any) => !topModules.some((item) => item.key === row.id))
              .map((row: any) => (
                <div key={String(row.id)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Layers3 size={16} className="text-[var(--accent)]" />
                      <span className="truncate font-medium text-[var(--text)]">{String(row.name || row.id)}</span>
                    </div>
                    <span className="rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{row.maturity ?? "-"}</span>
                  </div>
                  <div className="mt-2 truncate font-mono text-xs text-[var(--muted)]">{String(row.path || row.id)}</div>
                </div>
              ))}
          </div>
        </InfoSection>

        <InfoSection title="核心能力" icon={<Cpu size={18} />} className="mt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {app.capabilities.map((capability) => (
              <div key={capability.name} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-[var(--text)]">{capability.name}</h4>
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent)]">{capability.maturity}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{capability.scope}</p>
                <div className="mt-3 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-medium text-[var(--text)]">{capability.kpi}</div>
              </div>
            ))}
          </div>
        </InfoSection>

        <InfoSection title="工作流与治理动作" icon={<GitBranch size={18} />} className="mt-4">
          <div className="space-y-3">
            {app.workflows.map((workflow) => (
              <div key={workflow.phase} className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-sm font-semibold text-[var(--accent)]">{workflow.phase}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--text)]">{workflow.detail}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{workflow.metric}</div>
                </div>
              </div>
            ))}
            {app.actions.map((action) => (
              <div key={action.title} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <ShieldCheck size={16} className="text-[var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--text)]">{action.title}</div>
                  <div className="text-xs text-[var(--muted)]">{action.owner} · {action.due} · {action.priority}</div>
                </div>
                <ArrowRight size={16} className="text-[var(--muted)]" />
              </div>
            ))}
          </div>
        </InfoSection>

        <InfoSection title="能力域" icon={<Globe2 size={18} />} className="mt-4">
          <div className="flex flex-wrap gap-2">
            {app.groups.map((group) => (
              <span key={group} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
                {groupLabel(group)}
              </span>
            ))}
          </div>
        </InfoSection>
      </div>
    </div>
  );
}

function InfoSection({ title, icon, children, className }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4", className)}>
      <div className="mb-3 flex items-center gap-2 font-semibold text-[var(--text)]">
        <span className="text-[var(--accent)]">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b border-[var(--border)] py-2 text-sm last:border-b-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={cn("truncate text-[var(--text)]", mono && "font-mono")}>{value}</span>
    </div>
  );
}
