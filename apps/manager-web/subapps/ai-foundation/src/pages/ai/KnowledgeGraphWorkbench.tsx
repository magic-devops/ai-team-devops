import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";

type Tab = "build" | "query" | "lineage";

const ENTITY_TYPES = ["requirement", "task", "code_file", "spec", "design_doc", "agent", "metric", "tag"];

export function KnowledgeGraphWorkbench({ focused: _focused, initialTab = "build" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [tab, setTab] = useState<Tab>(initialTab);
  const [aiOpen, setAiOpen] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<any>(null);
  const [buildForm, setBuildForm] = useState({ entity_types: ["requirement", "task", "code_file"], rebuild: false });

  // Use RAG/knowledge endpoints for graph operations
  const kbQ = useQuery({
    queryKey: ["kgSummary"],
    queryFn: () => fetch("/api/v1/workspace/knowledge").then(r => r.ok ? r.json() : { total: 0, by_category: {} }),
    enabled: authed,
  });

  const buildMut = useMutation({
    mutationFn: () => fetch("/api/v1/rag/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildForm),
    }).then(r => r.json()),
  });

  const queryMut = useMutation({
    mutationFn: () => fetch("/api/v1/rag/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: queryText, top_k: 10, use_graph: true }),
    }).then(r => r.json()),
    onSuccess: (data) => setQueryResult(data),
  });

  if (!authed) return <NeedLogin />;
  const s = kbQ.data ?? {};

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="知识图谱"
        description="构建代码、需求、规约与运行证据的统一知识图谱，支持 Graph RAG 推理"
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton onClick={() => void kbQ.refetch()} pending={kbQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats items={[
            { label: "知识条目", value: s.total ?? 0 },
            { label: "实体类型", value: Object.keys(s.by_category ?? {}).length },
            { label: "图谱状态", value: s.graph_built ? "已构建" : "未构建" },
            { label: "最近更新", value: s.last_updated?.slice(0, 10) ?? "—" },
          ]} />
        }
      />

      <div className="flex gap-1 border-b border-[var(--border)]">
        {(["build", "query", "lineage"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {t === "build" ? "图谱构建" : t === "query" ? "图谱查询" : "血缘关联"}
          </button>
        ))}
      </div>

      {tab === "build" && (
        <WorkbenchPanel title="图谱构建配置">
          <div className="space-y-4 max-w-lg">
            <div>
              <p className="text-sm font-medium mb-2">选择实体类型</p>
              <div className="flex flex-wrap gap-2">
                {ENTITY_TYPES.map(et => (
                  <label key={et} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox"
                      checked={buildForm.entity_types.includes(et)}
                      onChange={e => setBuildForm(f => ({
                        ...f,
                        entity_types: e.target.checked ? [...f.entity_types, et] : f.entity_types.filter(x => x !== et)
                      }))} />
                    {et}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={buildForm.rebuild} onChange={e => setBuildForm(f => ({ ...f, rebuild: e.target.checked }))} />
              强制重建（清除现有图谱）
            </label>
            <button
              onClick={() => buildMut.mutate()}
              disabled={buildForm.entity_types.length === 0 || buildMut.isPending}
              className="rounded-lg bg-[var(--brand)] px-6 py-2 text-sm text-white disabled:opacity-50 hover:opacity-90"
            >
              {buildMut.isPending ? "构建中..." : "开始构建图谱"}
            </button>
            {buildMut.isSuccess && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                图谱构建任务已提交，后台处理中
              </div>
            )}
            {buildMut.isError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                构建失败，请检查知识库数据后重试
              </div>
            )}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "query" && (
        <WorkbenchPanel title="图谱语义查询">
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                className="input-base flex-1"
                placeholder="输入查询（如：哪些需求依赖用户认证模块？）"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && queryText.trim() && queryMut.mutate()}
              />
              <button
                onClick={() => queryMut.mutate()}
                disabled={!queryText.trim() || queryMut.isPending}
                className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {queryMut.isPending ? "查询中..." : "查询"}
              </button>
            </div>
            {queryResult && (
              <div className="space-y-2">
                <p className="text-xs text-[var(--muted)]">找到 {queryResult.results?.length ?? 0} 条相关结果</p>
                {(queryResult.results ?? []).map((r: any, i: number) => (
                  <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium line-clamp-2">{r.title || r.content?.slice(0, 80)}</p>
                      <span className="shrink-0 rounded bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">
                        {(r.score * 100).toFixed(0)}%
                      </span>
                    </div>
                    {r.category && <p className="mt-1 text-xs text-[var(--muted)]">{r.category}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </WorkbenchPanel>
      )}

      {tab === "lineage" && (
        <WorkbenchPanel title="实体血缘关联">
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">血缘图谱展示实体间的依赖与影响关系，帮助分析变更影响范围。</p>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-center">
              <p className="text-sm text-[var(--muted)]">血缘可视化需要先完成图谱构建</p>
              <button onClick={() => setTab("build")} className="mt-3 text-sm text-[var(--brand)] hover:underline">
                前往构建图谱 →
              </button>
            </div>
          </div>
        </WorkbenchPanel>
      )}

      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="knowledge-graph"
        title="AI 知识图谱助手"
        context={{ entity_types: buildForm.entity_types, kb_total: s.total }}
        initialPrompt="分析当前知识图谱结构，找出关键实体和关联关系" />
    </div>
  );
}
