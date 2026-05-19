import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BookOpen, Container, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const MODULES = [
  { id: "pipeline", path: "#/system/ops-center/workbench", icon: Container, label: "部署流水线", desc: "环境部署与发布管理" },
  { id: "rca", path: "#/system/ops-center/rca", icon: AlertTriangle, label: "根因分析", desc: "故障根因定位与处置" },
  { id: "runbook", path: "#/system/ops-center/runbook", icon: BookOpen, label: "Runbook", desc: "标准化运维操作手册" },
  { id: "self-heal", path: "#/system/ops-center/self-heal", icon: Zap, label: "自愈策略", desc: "自动检测与修复策略" },
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
        description="部署流水线、根因分析、Runbook 与自愈策略统一管理"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "流水线", value: s.pipelines ?? 0 },
            { label: "待处理 RCA", value: s.rca_open ?? 0, trend: s.rca_open > 0 ? "down" : "neutral" },
            { label: "Runbook", value: s.runbooks ?? 0 },
            { label: "自愈策略", value: s.self_heal_active ?? 0, trend: "up" },
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
