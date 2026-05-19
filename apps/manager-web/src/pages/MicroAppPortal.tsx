import WujieReact from "wujie-react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Layers3,
  Network,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  getBusinessCode,
  getProjectCode,
  getProjectId,
  getTenantCode,
  getToken,
  getWorkspaceScope,
} from "../lib/authStorage";
import {
  filterNavByMicroApp,
  getMicroApp,
  getMicroAppRuntimeUrl,
  type MicroAppId,
  type MicroAppStatus,
} from "../microApps";
import { NAV } from "../navigation";
import { MicroAppRuntime } from "../../subapps/shared/MicroAppRuntime";

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
  if (status === "migrating") return "Wujie 就绪";
  return "规划中";
}

function createWujieLoadingNode(appName: string) {
  const node = document.createElement("div");
  node.style.cssText =
    "display:flex;min-height:180px;width:100%;align-items:center;justify-content:center;gap:10px;color:var(--muted-strong);font-size:14px;background:var(--surface-muted);";
  const marker = document.createElement("span");
  marker.style.cssText = "width:10px;height:10px;border-radius:999px;background:var(--brand);box-shadow:0 0 0 6px color-mix(in srgb,var(--brand) 14%,transparent);";
  const text = document.createElement("span");
  text.textContent = `正在加载 ${appName}`;
  node.append(marker, text);
  return node;
}

function isSameOriginRuntime(runtimeUrl: string) {
  try {
    return new URL(runtimeUrl, window.location.origin).origin === window.location.origin;
  } catch {
    return true;
  }
}

export function MicroAppPortal({ appId }: MicroAppPortalProps) {
  const { t, i18n } = useTranslation();
  const app = getMicroApp(appId);
  const runtimeUrl = getMicroAppRuntimeUrl(app);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const modules = useMemo(
    () => filterNavByMicroApp(appId, NAV).filter((item) => !item.hidden && !item.parentKey),
    [appId],
  );
  const leafCount = useMemo(() => filterNavByMicroApp(appId, NAV).filter((item) => item.hidden || item.parentKey).length, [appId]);
  const sameOriginRuntime = runtimeUrl ? isSameOriginRuntime(runtimeUrl) : true;
  const remoteEnabled = app.mode === "wujie" && runtimeUrl && !remoteFailed && !sameOriginRuntime;
  const workspaceScope = getWorkspaceScope();
  const loadingNode = useMemo(() => createWujieLoadingNode(app.name), [app.name]);

  if (app.mode === "wujie" && runtimeUrl && sameOriginRuntime && !remoteFailed) {
    return (
      <section className="min-h-[70vh] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">LOCAL MICRO APP</p>
            <h2 className="mt-0.5 text-lg font-semibold text-[var(--text)]">{app.name}</h2>
          </div>
          <a
            href={runtimeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          >
            <ExternalLink className="h-4 w-4" />
            打开独立应用
          </a>
        </div>
        <div className="min-h-[calc(100vh-12rem)]">
          <MicroAppRuntime appId={appId} />
        </div>
      </section>
    );
  }

  if (remoteEnabled) {
    return (
      <section className="min-h-[70vh] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Wujie Micro App</p>
            <h2 className="mt-0.5 text-lg font-semibold text-[var(--text)]">{app.name}</h2>
          </div>
          <a
            href={runtimeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          >
            <ExternalLink className="h-4 w-4" />
            打开独立应用
          </a>
        </div>
        <WujieReact
          width="100%"
          height="calc(100vh - 12rem)"
          name={app.id}
          url={runtimeUrl}
          sync
          alive
          loading={loadingNode as unknown as ReactElement}
          props={{
            token: getToken(),
            locale: i18n.language,
            tenantCode: getTenantCode(),
            businessCode: getBusinessCode(),
            projectId: getProjectId(),
            projectCode: getProjectCode(),
            workspaceScope,
            shell: "hermes-manager",
          }}
          loadError={(_url: string, error: unknown) => {
            console.error(`[wujie] ${app.id} load failed`, error);
            setRemoteFailed(true);
          }}
        />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="grid gap-6 p-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ring-1 ${statusTone[app.status]}`}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {statusLabel(app.status)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-medium text-[var(--muted-strong)] ring-1 ring-[var(--border)]">
                <Network className="h-3.5 w-3.5" />
                {app.mode === "wujie" ? "Wujie 子应用" : "主应用原生"}
              </span>
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-[var(--text)]">{app.name}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--muted-strong)]">{app.description}</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {app.highlights.map((item) => (
                <div key={item} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                  <Sparkles className="mb-2 h-4 w-4 text-[var(--brand)]" />
                  <p className="text-sm font-semibold text-[var(--text)]">{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">应用职责</p>
            <dl className="mt-3 grid gap-3 text-sm">
              <div>
                <dt className="text-[var(--muted)]">负责团队</dt>
                <dd className="mt-0.5 font-semibold text-[var(--text)]">{app.owner}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">运行方式</dt>
                <dd className="mt-0.5 font-semibold text-[var(--text)]">{app.mode === "wujie" ? "独立子应用" : "主应用控制面"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">核心边界</dt>
                <dd className="mt-0.5 text-[var(--text)]">{app.highlights.slice(0, 2).join(" / ")}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">管理定位</dt>
                <dd className="mt-0.5 text-[var(--text)]">{app.mode === "wujie" ? "专业能力独立运营，统一接入权限与审计" : "统一承载登录、权限、组织与服务治理"}</dd>
              </div>
            </dl>
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
          <p className="text-2xl font-bold text-[var(--text)]">统一</p>
          <p className="text-sm text-[var(--muted)]">登录态、权限、三码作用域与审计</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text)]">专业模块入口</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">当前阶段以主应用本地页面兜底；配置远程 URL 后自动切换为 Wujie 嵌入。</p>
          </div>
          {remoteFailed ? (
            <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300">
              远程子应用不可达，已回退到本地工作台
            </span>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.key}
                href={item.path}
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
                    进入模块 <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
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
