/**
 * 子应用注册管理工作台
 * 支持：子应用列表、状态监控、菜单分组、SSO/权限/菜单契约
 */
import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Settings,
  Layers3,
  Network,
  ShieldCheck,
  Cpu,
  GitBranch,
  X,
  ChevronDown,
  ChevronRight,
  Activity,
} from "lucide-react";
import { MICRO_APPS, filterNavByMicroApp, type MicroAppId } from "../../../../../src/microApps";
import { NAV } from "../../../../../src/navigation";
import { WorkbenchShell } from "../../../../../src/pages/shared/WorkbenchShell";

const STATUS_CONFIG = {
  ready: { icon: CheckCircle2, label: "运行中", cls: "text-emerald-600 bg-emerald-500/10 ring-emerald-500/25" },
  migrating: { icon: Activity, label: "迁移中", cls: "text-sky-600 bg-sky-500/10 ring-sky-500/25" },
  planned: { icon: Clock, label: "规划中", cls: "text-amber-600 bg-amber-500/10 ring-amber-500/25" },
};

const MODE_CONFIG = {
  standalone: { label: "独立微应用", cls: "text-violet-600 bg-violet-500/10 ring-violet-500/25" },
  native: { label: "主应用原生", cls: "text-[var(--muted-strong)] bg-[var(--surface-muted)] ring-[var(--border)]" },
};

function AppDetailDrawer({ appId, onClose }: { appId: MicroAppId; onClose: () => void }) {
  const app = MICRO_APPS.find((a) => a.id === appId)!;
  const modules = filterNavByMicroApp(appId, NAV).filter((n) => !n.hidden && !n.parentKey && !n.key.startsWith("microApp"));
  const [expandedSection, setExpandedSection] = useState<string | null>("modules");

  const toggle = (s: string) => setExpandedSection((v) => (v === s ? null : s));

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="flex h-full w-[520px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_CONFIG[app.status].cls}`}>
                {app.status === "ready" ? <CheckCircle2 className="h-3 w-3" /> : app.status === "migrating" ? <Activity className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {STATUS_CONFIG[app.status].label}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${MODE_CONFIG[app.mode].cls}`}>
                {MODE_CONFIG[app.mode].label}
              </span>
            </div>
            <h3 className="mt-2 text-base font-semibold text-[var(--text)]">{app.name}</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{app.owner}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-muted)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
          {/* 基础信息 */}
          <div className="p-5 space-y-3">
            <p className="text-sm text-[var(--muted-strong)]">{app.description}</p>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <dt className="text-[var(--muted)]">入口路由</dt>
                <dd className="mt-1 font-mono font-medium text-[var(--text)]">{app.route}</dd>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <dt className="text-[var(--muted)]">基础路径</dt>
                <dd className="mt-1 font-mono font-medium text-[var(--text)]">{app.basePath}</dd>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <dt className="text-[var(--muted)]">生产 URL</dt>
                <dd className="mt-1 font-mono font-medium text-[var(--text)] truncate">{app.prodUrl}</dd>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <dt className="text-[var(--muted)]">开发 URL</dt>
                <dd className="mt-1 font-mono font-medium text-[var(--text)] truncate">{app.devUrl}</dd>
              </div>
            </dl>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs">
              <dt className="text-[var(--muted)]">环境变量 Key</dt>
              <dd className="mt-1 font-mono font-medium text-[var(--brand)]">{app.envKey}</dd>
            </div>
          </div>

          {/* 菜单分组 */}
          <div>
            <button type="button" onClick={() => toggle("modules")} className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]">
              <span className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-[var(--brand)]" />
                菜单模块 ({modules.length})
              </span>
              {expandedSection === "modules" ? <ChevronDown className="h-4 w-4 text-[var(--muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--muted)]" />}
            </button>
            {expandedSection === "modules" && (
              <div className="px-5 pb-4 grid gap-1.5">
                {modules.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--text)]">{item.key}</p>
                        <p className="truncate font-mono text-[10px] text-[var(--muted)]">{item.capability ?? item.path}</p>
                      </div>
                      {item.badge && (
                        <span className="rounded px-1 py-px text-[9px] font-bold uppercase ring-1 bg-emerald-500/15 text-emerald-600 ring-emerald-500/30">{item.badge}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 接入契约 */}
          <div>
            <button type="button" onClick={() => toggle("sandbox")} className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
                接入契约与治理能力
              </span>
              {expandedSection === "sandbox" ? <ChevronDown className="h-4 w-4 text-[var(--muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--muted)]" />}
            </button>
            {expandedSection === "sandbox" && (
              <div className="px-5 pb-4 space-y-2 text-xs">
                {[
                  { label: "运行方式", value: app.mode === "standalone" ? "独立窗口 / 独立部署" : "主应用原生", enabled: true },
                  { label: "统一身份", value: "SSO / 登录态共享", enabled: true },
                  { label: "权限契约", value: "能力码 + 角色策略 + 页面动作", enabled: true },
                  { label: "菜单契约", value: "manifest + 多级分组 + 偏好配置", enabled: true },
                  { label: "嵌入方式", value: "不使用 iframe 内嵌", enabled: app.mode === "standalone" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                    <span className="text-[var(--muted-strong)]">{row.label}</span>
                    <span className={`font-medium ${row.enabled ? "text-[var(--text)]" : "text-[var(--muted)]"}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 能力亮点 */}
          <div>
            <button type="button" onClick={() => toggle("caps")} className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]">
              <span className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-[var(--brand)]" />
                核心能力 ({app.capabilities.length})
              </span>
              {expandedSection === "caps" ? <ChevronDown className="h-4 w-4 text-[var(--muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--muted)]" />}
            </button>
            {expandedSection === "caps" && (
              <div className="px-5 pb-4 space-y-2">
                {app.capabilities.map((cap) => (
                  <div key={cap.name} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-[var(--text)]">{cap.name}</p>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1 ${
                        cap.maturity === "leading" ? "bg-violet-500/15 text-violet-600 ring-violet-500/30" :
                        cap.maturity === "advanced" ? "bg-sky-500/15 text-sky-600 ring-sky-500/30" :
                        "bg-[var(--surface-muted)] text-[var(--muted-strong)] ring-[var(--border)]"
                      }`}>{cap.maturity}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">{cap.scope}</p>
                    <p className="mt-1 text-[11px] font-medium text-[var(--brand)]">{cap.kpi}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-[var(--border)] px-5 py-4">
          {app.mode === "standalone" && (
            <a
              href={app.devUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--control-bg)] px-4 py-2.5 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
            >
              <ExternalLink className="h-4 w-4" />
              独立打开
            </a>
          )}
          <button type="button" className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
            <Settings className="h-4 w-4" />
            编辑配置
          </button>
        </div>
      </div>
    </div>
  );
}

export function MicroAppRegistry() {
  const [detailApp, setDetailApp] = useState<MicroAppId | null>(null);

  const stats = {
    total: MICRO_APPS.length,
    ready: MICRO_APPS.filter((a) => a.status === "ready").length,
    standalone: MICRO_APPS.filter((a) => a.mode === "standalone").length,
    totalModules: NAV.filter((n) => !n.hidden && !n.parentKey && !n.key.startsWith("microApp")).length,
  };

  return (
    <div className="space-y-5">
      {detailApp && <AppDetailDrawer appId={detailApp} onClose={() => setDetailApp(null)} />}

      <WorkbenchShell
        title="子应用注册管理"
        description="管理独立微应用的注册信息、SSO 接入、菜单分组、权限契约与运行状态。"
      />

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "子应用总数", value: stats.total, icon: Layers3 },
          { label: "运行中", value: stats.ready, icon: CheckCircle2 },
          { label: "独立应用", value: stats.standalone, icon: Network },
          { label: "注册模块数", value: stats.totalModules, icon: GitBranch },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <Icon className="mb-2 h-4 w-4 text-[var(--brand)]" />
              <p className="text-2xl font-bold text-[var(--text)]">{s.value}</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* 子应用卡片列表 */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MICRO_APPS.map((app) => {
          const statusCfg = STATUS_CONFIG[app.status];
          const modeCfg = MODE_CONFIG[app.mode];
          const StatusIcon = statusCfg.icon;
          const modules = filterNavByMicroApp(app.id, NAV).filter((n) => !n.hidden && !n.parentKey && !n.key.startsWith("microApp"));

          return (
            <div
              key={app.id}
              className="group flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusCfg.cls}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusCfg.label}
                  </span>
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${modeCfg.cls}`}>
                    {modeCfg.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailApp(app.id)}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--surface-muted)] hover:text-[var(--brand)]"
                  title="查看详情"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>

              <h3 className="mt-3 text-base font-semibold text-[var(--text)]">{app.name}</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">{app.owner}</p>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted-strong)]">{app.description}</p>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                  <p className="text-[var(--muted)]">模块数</p>
                  <p className="mt-0.5 text-lg font-bold text-[var(--text)]">{modules.length}</p>
                </div>
                <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
                  <p className="text-[var(--muted)]">能力域</p>
                  <p className="mt-0.5 text-lg font-bold text-[var(--text)]">{app.groups.length}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {app.highlights.slice(0, 3).map((h) => (
                  <span key={h} className="rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--brand)]">{h}</span>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
                <span className="font-mono text-[10px] text-[var(--muted)]">{app.route}</span>
                <button
                  type="button"
                  onClick={() => setDetailApp(app.id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline"
                >
                  详情 <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 架构说明 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-5">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Network className="h-4 w-4 text-[var(--brand)]" />
          微前端架构说明
        </h4>
        <div className="grid gap-3 text-xs text-[var(--muted-strong)] sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="font-semibold text-[var(--text)]">基础管理中心 (main-admin)</p>
            <p className="mt-1">独立微应用模式，统一承载账号、权限、组织与模块治理，并由门户集中注册和发现。</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="font-semibold text-[var(--text)]">独立微应用</p>
            <p className="mt-1">独立部署、独立打开，不在主应用内 iframe 嵌入；复用统一 SSO、权限和菜单 manifest。</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="font-semibold text-[var(--text)]">通信协议</p>
            <p className="mt-1">主应用提供注册表、能力码、菜单和作用域参数；子应用通过 API/manifest 消费，不依赖嵌入式事件总线。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
