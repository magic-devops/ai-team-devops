import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Database, Layers, Plug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const MODULES = [
  { id: "connectors", path: "#/data/ingest/connectors", icon: Plug, labelKey: "page.dataIngest.modules.connectors.label", descKey: "page.dataIngest.modules.connectors.desc", fallbackLabel: "连接器管理", fallbackDesc: "数据库/消息队列/API 连接器" },
  { id: "schema", path: "#/data/ingest/schema", icon: Layers, labelKey: "page.dataIngest.modules.schema.label", descKey: "page.dataIngest.modules.schema.desc", fallbackLabel: "Schema Registry", fallbackDesc: "数据结构注册与版本管理" },
  { id: "cdc", path: "#/data/ingest/cdc", icon: Activity, labelKey: "page.dataIngest.modules.cdc.label", descKey: "page.dataIngest.modules.cdc.desc", fallbackLabel: "CDC 实时接入", fallbackDesc: "游标、运行历史与进度回写" },
  { id: "batch", path: "#/data/ingest/batch", icon: Database, labelKey: "page.dataIngest.modules.batch.label", descKey: "page.dataIngest.modules.batch.desc", fallbackLabel: "批量接入作业", fallbackDesc: "批处理接入、运行和完成回写" },
];

export function DataIngestHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["dataIngestSummary"], queryFn: () => api.dataIngestSummary(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.dataIngest.hubTitle", "数据接入中心")}
        description={t("page.dataIngest.hubDesc", "连接器管理、Schema Registry、CDC 实时接入与批量作业统一控制面")}
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: t("page.dataIngest.metrics.connectors", "连接器"), value: s.connectors ?? 0 },
            { label: t("page.dataIngest.metrics.activeJobs", "运行中作业"), value: s.active_jobs ?? 0, trend: "up" },
            { label: t("page.dataIngest.metrics.rowsToday", "今日接入行数"), value: s.rows_today ?? 0 },
            { label: t("page.dataIngest.metrics.cdcStreams", "CDC 流"), value: s.cdc_streams ?? 0 },
          ]} />
        }
      />
      <Card title={t("page.dataIngest.modulesTitle", "功能模块")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map(({ id, path, icon: Icon, labelKey, descKey, fallbackLabel, fallbackDesc }) => (
            <a key={id} href={path} className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
              <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">{t(labelKey, fallbackLabel)}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{t(descKey, fallbackDesc)}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
