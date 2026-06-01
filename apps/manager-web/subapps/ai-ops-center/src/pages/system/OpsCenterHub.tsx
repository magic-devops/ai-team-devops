import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BellRing, BookOpen, Container, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const MODULES = [
  { id: "pipeline", path: "#/system/ops-center/pipeline", icon: Container, metric: "pipelines" },
  { id: "alerts", path: "#/system/ops-center/alerts", icon: BellRing, metric: "external_open_alerts" },
  { id: "rca", path: "#/system/ops-center/rca", icon: AlertTriangle, metric: "rca_open" },
  { id: "runbook", path: "#/system/ops-center/runbook", icon: BookOpen, metric: "runbooks" },
  { id: "self-heal", path: "#/system/ops-center/self-heal", icon: Zap, metric: "self_heal_actions" },
];

export function OpsCenterHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["opsCenterSummary"], queryFn: () => api.opsCenterSummary(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.opsCenter.hubTitle", "智能运维中心")}
        description={t("page.opsCenter.hubDesc", "生产运维轻量中枢：看健康、找风险、进专业模块处理。")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href="#/copilot?module=ops-center" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]">
              {t("page.opsCenter.aiAction", "AI 分析")}
            </a>
            <RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />
          </div>
        }
        metrics={
          <WorkbenchStats items={[
            { label: t("page.opsCenter.metrics.pipelines", "流水线"), value: s.pipelines ?? 0 },
            { label: t("page.opsCenter.metrics.openAlerts", "开放告警"), value: s.external_open_alerts ?? 0, trend: s.external_high_alerts > 0 ? "down" : "neutral" },
            { label: t("page.opsCenter.metrics.rcaOpen", "待处理 RCA"), value: s.rca_open ?? 0, trend: s.rca_open > 0 ? "down" : "neutral" },
            { label: t("page.opsCenter.metrics.runbooks", "Runbook"), value: s.runbooks ?? 0 },
            { label: t("page.opsCenter.metrics.guardrailActions", "护栏动作"), value: s.self_heal_actions ?? 0, trend: s.self_heal_approval_queue > 0 ? "down" : "neutral" },
          ]} />
        }
      />
      <Card title={t("page.opsCenter.modulesTitle", "专业入口")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {MODULES.map(({ id, path, icon: Icon, metric }) => (
            <a key={id} href={path} className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
              <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">
                  {t(`page.opsCenter.modules.${id}.label`)}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{t(`page.opsCenter.modules.${id}.desc`)}</span>
                <span className="mt-3 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
                  {t("page.opsCenter.metricBadge", "{{count}} 条运行信号", { count: s[metric] ?? 0 })}
                </span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
