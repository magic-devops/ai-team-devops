import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, BarChart3, Globe, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const MODULES = [
  { id: "catalog", path: "#/data/metrics/workbench", icon: BarChart3, label: "指标目录", desc: "原子/派生/复合指标注册" },
  { id: "semantic", path: "#/data/metrics/semantic", icon: Layers, label: "语义层", desc: "业务口径与维度统一定义" },
  { id: "api-publish", path: "#/data/metrics/api-publish", icon: Globe, label: "API 发布", desc: "指标 REST/GraphQL API 发布" },
  { id: "monitor", path: "#/data/metrics/monitor", icon: Activity, label: "指标监控", desc: "指标异常检测与告警" },
];

export function MetricsCenterHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["metricsCenterSummary"], queryFn: () => api.metricsSummary(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.metricsCenter.hubTitle", "指标中心")}
        description="指标语义层、目录管理、API 发布与监控告警"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "指标总数", value: s.total ?? 0 },
            { label: "已发布 API", value: s.published ?? 0, trend: "up" },
            { label: "业务域", value: (s.domains ?? []).length },
            { label: "今日 API 调用", value: s.api_calls_today ?? 0 },
          ]} />
        }
      />
      <Card title="功能模块">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map(({ id, path, icon: Icon, label, desc }) => (
            <a key={id} href={path} className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
              <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">{label}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{desc}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
