import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, FileText, Play, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const MODULES = [
  { id: "rules", path: "#/data/quality/workbench", icon: ShieldCheck, label: "质量规则", desc: "完整性/新鲜度/唯一性/有效性规则" },
  { id: "runs", path: "#/data/quality/runs", icon: Play, label: "质量运行", desc: "规则执行记录与得分" },
  { id: "alerts", path: "#/data/quality/alerts", icon: BellRing, label: "告警处置", desc: "质量告警与修复任务" },
  { id: "reports", path: "#/data/quality/reports", icon: FileText, label: "质量报告", desc: "质量趋势与归因分析" },
];

export function DataQualityHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["dataQualitySummary"], queryFn: () => api.dataQualitySummary(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.dataQuality.hubTitle", "数据质量中心")}
        description="质量规则目录、运行记录、告警处置与质量报告"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "规则总数", value: s.rules_total ?? 0 },
            { label: "今日运行", value: s.runs_today ?? 0 },
            { label: "未处置告警", value: s.alerts_open ?? 0, trend: s.alerts_open > 0 ? "down" : "neutral" },
            { label: "平均质量分", value: s.avg_score ?? "—" },
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
