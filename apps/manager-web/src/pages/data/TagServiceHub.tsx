import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Filter, Globe, Network, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const MODULES = [
  { id: "catalog", path: "#/data/tags/workbench", icon: Tag, label: "标签目录", desc: "标签定义与分类管理" },
  { id: "rules", path: "#/data/tags/rules", icon: Filter, label: "标签规则", desc: "基于条件的自动打标规则" },
  { id: "ontology", path: "#/data/tags/ontology", icon: Network, label: "画像本体", desc: "实体/关系/属性本体建模" },
  { id: "api", path: "#/data/tags/api", icon: Globe, label: "标签 API", desc: "标签查询与画像服务接口" },
];

export function TagServiceHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["tagServiceSummary"], queryFn: () => api.tagSummary(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.tagService.hubTitle", "标签服务")}
        description="标签目录、自动打标规则、画像本体与标签 API 服务"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "标签总数", value: s.tags_total ?? 0 },
            { label: "活跃规则", value: s.rules_active ?? 0, trend: "up" },
            { label: "本体实体", value: s.entities ?? 0 },
            { label: "已构建画像", value: s.profiles_built ?? 0 },
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
