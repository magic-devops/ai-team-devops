import { useQuery } from "@tanstack/react-query";
import { ArrowRight, GitBranch, Layers, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const MODULES = [
  { id: "build", path: "#/ai/knowledge-graph/workbench", icon: Layers, label: "图谱构建", desc: "从代码/需求/规约构建知识图谱" },
  { id: "query", path: "#/ai/knowledge-graph/query", icon: Search, label: "图谱查询", desc: "图谱语义检索与推理" },
  { id: "lineage", path: "#/ai/knowledge-graph/lineage", icon: GitBranch, label: "血缘关联", desc: "实体间依赖与影响分析" },
];

export function KnowledgeGraphHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["knowledgeGraphSummary"], queryFn: () => Promise.resolve({ summary: { nodes: 0, edges: 0, entity_types: 0, last_built_at: null } }), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.knowledgeGraph.hubTitle", "知识图谱")}
        description="构建代码、需求、规约与运行证据的统一知识图谱，支持 Graph RAG 推理"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "节点数", value: s.nodes ?? 0 },
            { label: "边数", value: s.edges ?? 0 },
            { label: "实体类型", value: s.entity_types ?? 0 },
            { label: "最近构建", value: s.last_built_at ?? "—" },
          ]} />
        }
      />
      <Card title="功能模块">
        <div className="grid gap-3 sm:grid-cols-3">
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
