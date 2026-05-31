import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bot, GitBranch, Layers, Network, Search, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";

type Tab = "build" | "query" | "lineage" | "profile";

const ENTITY_TYPES = ["requirement", "task", "issue", "code_file", "spec", "design_doc", "agent", "metric", "tag", "knowledge"];
const EDGE_TYPES = ["", "depends_on", "mentions", "co_occurs"];

const TABS: Array<{ id: Tab; label: string; icon: typeof Layers }> = [
  { id: "build", label: "图谱构建", icon: Layers },
  { id: "query", label: "图谱查询", icon: Search },
  { id: "lineage", label: "血缘关联", icon: GitBranch },
  { id: "profile", label: "实体画像", icon: UserRound },
];

function shortDate(value?: string | null) {
  return value ? value.slice(0, 19).replace("T", " ") : "—";
}

function badgeClass(type?: string) {
  if (type === "requirement") return "bg-blue-50 text-blue-700";
  if (type === "task") return "bg-green-50 text-green-700";
  if (type === "issue") return "bg-red-50 text-red-700";
  if (type === "code_file") return "bg-purple-50 text-purple-700";
  if (type === "agent") return "bg-yellow-50 text-yellow-700";
  return "bg-[var(--surface-muted)] text-[var(--muted)]";
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 text-center text-sm text-[var(--muted)]">
      {text}
    </div>
  );
}

export function KnowledgeGraphWorkbench({ focused: _focused, initialTab = "build" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [aiOpen, setAiOpen] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<any>(null);
  const [lineageEntityId, setLineageEntityId] = useState("");
  const [profileEntityId, setProfileEntityId] = useState("");
  const [profileMemoryQuery, setProfileMemoryQuery] = useState("");
  const [profileResult, setProfileResult] = useState<any>(null);
  const [lineageDepth, setLineageDepth] = useState(2);
  const [lineageResult, setLineageResult] = useState<any>(null);
  const [edgeType, setEdgeType] = useState("");
  const [buildForm, setBuildForm] = useState({
    entity_types: ["requirement", "task", "code_file", "spec", "design_doc", "agent", "tag"],
    rebuild: false,
    allowed_sources: "",
    denied_sources: "",
  });

  const summaryQ = useQuery({ queryKey: ["knowledgeGraphSummary"], queryFn: api.knowledgeGraphSummary, enabled: authed });
  const entitiesQ = useQuery({
    queryKey: ["knowledgeGraphEntities"],
    queryFn: () => api.knowledgeGraphEntities(300),
    enabled: authed && tab === "lineage",
  });
  const edgesQ = useQuery({
    queryKey: ["knowledgeGraphEdges", edgeType],
    queryFn: () => api.knowledgeGraphEdges(300, edgeType),
    enabled: authed && tab === "lineage",
  });

  const buildMut = useMutation({
    mutationFn: () => api.knowledgeGraphBuild({
      entity_types: buildForm.entity_types,
      rebuild: buildForm.rebuild,
      allowed_sources: buildForm.allowed_sources.split(",").map((item) => item.trim()).filter(Boolean),
      denied_sources: buildForm.denied_sources.split(",").map((item) => item.trim()).filter(Boolean),
    }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["knowledgeGraphSummary"] });
      void qc.invalidateQueries({ queryKey: ["knowledgeGraphEntities"] });
      void qc.invalidateQueries({ queryKey: ["knowledgeGraphEdges"] });
      const firstEntity = data?.graph?.entities?.[0]?.id;
      if (firstEntity && !lineageEntityId) setLineageEntityId(firstEntity);
      if (firstEntity && !profileEntityId) setProfileEntityId(firstEntity);
    },
  });

  const queryMut = useMutation({
    mutationFn: () => api.knowledgeGraphQuery({ query: queryText.trim(), top_k: 10 }),
    onSuccess: (data) => {
      setQueryResult(data);
      const firstEntity = data?.results?.[0]?.entity?.id;
      if (firstEntity) setLineageEntityId(firstEntity);
      if (firstEntity) setProfileEntityId(firstEntity);
    },
  });

  const lineageMut = useMutation({
    mutationFn: () => api.knowledgeGraphLineage({ entity_id: lineageEntityId.trim(), depth: lineageDepth }),
    onSuccess: setLineageResult,
  });
  const profileMut = useMutation({
    mutationFn: () => api.knowledgeGraphEntityProfileMerge({
      entity_id: profileEntityId.trim(),
      memory_query: profileMemoryQuery.trim(),
      memory_limit: 10,
      depth: 2,
    }),
    onSuccess: setProfileResult,
  });

  const typeCounts = summaryQ.data?.summary?.type_counts ?? {};
  const topTypes = useMemo(
    () => Object.entries(typeCounts).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 6),
    [typeCounts],
  );
  const entities = entitiesQ.data?.items ?? [];
  const edges = edgesQ.data?.items ?? [];

  if (!authed) return <NeedLogin />;

  const summary = summaryQ.data?.summary ?? {};
  const buildSummary = buildMut.data?.summary;
  const canQuery = queryText.trim().length > 0 && !queryMut.isPending;
  const canLineage = lineageEntityId.trim().length > 0 && !lineageMut.isPending;
  const canMergeProfile = profileEntityId.trim().length > 0 && !profileMut.isPending;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title="知识图谱"
        description="构建代码、需求、规约、Agent 与运行证据的统一图谱，支持 Graph RAG 查询和影响分析"
        actions={
          <>
            <AiAssistButton onClick={() => setAiOpen(true)} />
            <RefreshButton onClick={() => void summaryQ.refetch()} pending={summaryQ.isFetching} />
          </>
        }
        metrics={
          <WorkbenchStats items={[
            { label: "节点数", value: summary.nodes ?? 0 },
            { label: "关系边", value: summary.edges ?? 0 },
            { label: "实体类型", value: summary.entity_types ?? 0 },
            { label: "知识源", value: summaryQ.data?.source_documents ?? summary.documents ?? 0 },
          ]} />
        }
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--border)]">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "build" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.85fr)_minmax(420px,1.15fr)]">
          <WorkbenchPanel title="构建配置" actions={<Network className="h-4 w-4 text-[var(--muted)]" />}>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">实体类型</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ENTITY_TYPES.map((et) => (
                    <label key={et} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={buildForm.entity_types.includes(et)}
                        onChange={(e) => setBuildForm((f) => ({
                          ...f,
                          entity_types: e.target.checked ? [...f.entity_types, et] : f.entity_types.filter((x) => x !== et),
                        }))}
                      />
                      <span>{et}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={buildForm.rebuild} onChange={(e) => setBuildForm((f) => ({ ...f, rebuild: e.target.checked }))} />
                强制重建并覆盖当前项目图谱
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">允许来源</span>
                  <input
                    className="input-base w-full"
                    placeholder="trusted.docs, sql.tasks"
                    value={buildForm.allowed_sources}
                    onChange={(e) => setBuildForm((f) => ({ ...f, allowed_sources: e.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">阻断来源</span>
                  <input
                    className="input-base w-full"
                    placeholder="restricted.docs"
                    value={buildForm.denied_sources}
                    onChange={(e) => setBuildForm((f) => ({ ...f, denied_sources: e.target.value }))}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => buildMut.mutate()}
                disabled={buildForm.entity_types.length === 0 || buildMut.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-5 py-2 text-sm text-white disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {buildMut.isPending ? "构建中..." : "开始构建图谱"}
              </button>
              {buildMut.isError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(buildMut.error as Error).message}</div>
              ) : null}
              {buildMut.data?.permission ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted-strong)]">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--text)]">
                    <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
                    来源权限检查
                  </div>
                  已检查 {buildMut.data.permission.checked ?? 0} 个来源，允许 {buildMut.data.permission.accepted_documents ?? 0} 个，阻断 {buildMut.data.permission.denied_documents ?? 0} 个。
                </div>
              ) : null}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="图谱资产概览">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">最近构建</p>
                <p className="mt-1 text-sm font-semibold">{shortDate(summary.last_built_at)}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">构建文档</p>
                <p className="mt-1 text-lg font-semibold">{summaryQ.data?.documents ?? 0}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">图谱状态</p>
                <p className="mt-1 text-sm font-semibold">{summaryQ.data?.graph_built ? "已构建" : "待构建"}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {(buildSummary ? Object.entries(buildSummary.type_counts ?? {}) : topTypes).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">
                  <span>{key}</span>
                  <span className="font-semibold">{String(value)}</span>
                </div>
              ))}
            </div>
            {!topTypes.length && !buildSummary ? <EmptyBlock text="还没有图谱资产，先执行一次构建。" /> : null}
          </WorkbenchPanel>
        </div>
      ) : null}

      {tab === "query" ? (
        <WorkbenchPanel title="Graph RAG 查询" actions={<Bot className="h-4 w-4 text-[var(--muted)]" />}>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="input-base flex-1"
                placeholder="输入查询，如：哪些任务依赖知识图谱需求？"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canQuery) queryMut.mutate();
                }}
              />
              <button
                type="button"
                onClick={() => queryMut.mutate()}
                disabled={!canQuery}
                className="rounded-lg bg-[var(--brand)] px-5 py-2 text-sm text-white disabled:opacity-50"
              >
                {queryMut.isPending ? "查询中..." : "查询"}
              </button>
            </div>
            {queryMut.isError ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(queryMut.error as Error).message}</div> : null}
            {queryResult ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--muted)]">找到 {queryResult.results?.length ?? 0} 个相关实体，点击实体 ID 可进入血缘分析。</p>
                {(queryResult.results ?? []).map((row: any) => (
                  <div key={row.entity.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button type="button" onClick={() => { setLineageEntityId(row.entity.id); setProfileEntityId(row.entity.id); setTab("lineage"); }} className="text-left text-sm font-semibold text-[var(--text)] hover:text-[var(--brand)]">
                          {row.entity.label}
                        </button>
                        <p className="mt-1 break-all text-xs text-[var(--muted)]">{row.entity.id}</p>
                      </div>
                      <span className={`rounded px-2 py-0.5 text-xs ${badgeClass(row.entity.type)}`}>{row.entity.type} · {(row.score * 100).toFixed(0)}%</span>
                    </div>
                    {row.entity.content ? <p className="mt-3 line-clamp-2 text-sm text-[var(--muted-strong)]">{row.entity.content}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(row.neighbors ?? []).slice(0, 6).map((n: any) => (
                        <span key={n.id} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted-strong)]">{n.type}: {n.label}</span>
                      ))}
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--muted)]">证据链 {row.evidence_count ?? row.evidence?.length ?? 0}</p>
                        <button type="button" onClick={() => { setProfileEntityId(row.entity.id); setProfileMemoryQuery(queryText); setTab("profile"); }} className="text-xs font-medium text-[var(--brand)]">
                          合并画像
                        </button>
                      </div>
                      {(row.evidence ?? []).slice(0, 3).map((ev: any, idx: number) => (
                        <div key={`${row.entity.id}-evidence-${idx}`} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--muted-strong)]">
                          {ev.relationship ? `${ev.relationship}: ${ev.from} → ${ev.to}` : `${ev.source}${ev.path ? ` · ${ev.path}` : ""}`}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyBlock text="输入问题后，将返回实体、邻居节点和关联关系。" />}
          </div>
        </WorkbenchPanel>
      ) : null}

      {tab === "lineage" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]">
          <WorkbenchPanel title="实体血缘分析">
            <div className="space-y-3">
              <input
                className="input-base w-full"
                placeholder="输入实体 ID，如 task:TASK-kg"
                value={lineageEntityId}
                onChange={(e) => setLineageEntityId(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <select className="input-base" value={lineageDepth} onChange={(e) => setLineageDepth(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d} 层</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => lineageMut.mutate()}
                  disabled={!canLineage}
                  className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {lineageMut.isPending ? "分析中..." : "分析血缘"}
                </button>
              </div>
              <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                {entities.slice(0, 80).map((entity: any) => (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => setLineageEntityId(entity.id)}
                    className="block w-full rounded-lg border border-[var(--border)] p-2 text-left text-xs hover:border-[var(--brand)]"
                  >
                    <span className={`mr-2 rounded px-1.5 py-0.5 ${badgeClass(entity.type)}`}>{entity.type}</span>
                    <span className="font-medium">{entity.label}</span>
                    <span className="mt-1 block break-all text-[var(--muted)]">{entity.id}</span>
                  </button>
                ))}
              </div>
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="影响范围与关系证据">
            <div className="space-y-4">
              {lineageResult?.nodes?.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {lineageResult.nodes.map((node: any) => (
                    <div key={node.id} className="rounded-lg border border-[var(--border)] p-3">
                      <span className={`rounded px-2 py-0.5 text-xs ${badgeClass(node.type)}`}>{node.type}</span>
                      <p className="mt-2 text-sm font-semibold">{node.label}</p>
                      <p className="mt-1 break-all text-xs text-[var(--muted)]">{node.id}</p>
                    </div>
                  ))}
                </div>
              ) : <EmptyBlock text="选择实体并运行血缘分析后，会展示上游/下游影响节点。" />}

              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">关系边</p>
                <select className="input-base text-xs" value={edgeType} onChange={(e) => setEdgeType(e.target.value)}>
                  {EDGE_TYPES.map((type) => <option key={type || "all"} value={type}>{type || "全部关系"}</option>)}
                </select>
              </div>
              <div className="overflow-auto rounded-lg border border-[var(--border)]">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-[var(--surface-muted)] text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2">类型</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lineageResult?.edges?.length ? lineageResult.edges : edges).slice(0, 80).map((edge: any) => (
                      <tr key={edge.id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2 font-medium">{edge.type}</td>
                        <td className="max-w-[220px] truncate px-3 py-2">{edge.source}</td>
                        <td className="max-w-[220px] truncate px-3 py-2">{edge.target}</td>
                      </tr>
                    ))}
                    {!(lineageResult?.edges?.length || edges.length) ? (
                      <tr><td colSpan={3} className="px-3 py-8 text-center text-[var(--muted)]">暂无关系边，请先构建图谱。</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </WorkbenchPanel>
        </div>
      ) : null}

      {tab === "profile" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.8fr)_minmax(460px,1.2fr)]">
          <WorkbenchPanel title="实体画像合并">
            <div className="space-y-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">实体 ID</span>
                <input
                  className="input-base w-full"
                  placeholder="knowledge:DOC-public"
                  value={profileEntityId}
                  onChange={(e) => setProfileEntityId(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">记忆检索词</span>
                <input
                  className="input-base w-full"
                  placeholder="默认使用实体标题，也可输入运行证据关键词"
                  value={profileMemoryQuery}
                  onChange={(e) => setProfileMemoryQuery(e.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => profileMut.mutate()}
                disabled={!canMergeProfile}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-5 py-2 text-sm text-white disabled:opacity-50"
              >
                <UserRound className="h-4 w-4" />
                {profileMut.isPending ? "合并中..." : "合并实体画像"}
              </button>
              {profileMut.isError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(profileMut.error as Error).message}</div>
              ) : null}
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel title="画像上下文包">
            {profileResult?.profile ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${badgeClass(profileResult.profile.entity?.type)}`}>{profileResult.profile.entity?.type}</span>
                  <p className="mt-2 text-sm font-semibold">{profileResult.profile.entity?.label}</p>
                  <p className="mt-1 break-all text-xs text-[var(--muted)]">{profileResult.profile.entity?.id}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-xs text-[var(--muted)]">邻居节点</p>
                    <p className="mt-1 text-lg font-semibold">{profileResult.profile.neighbors?.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-xs text-[var(--muted)]">记忆证据</p>
                    <p className="mt-1 text-lg font-semibold">{profileResult.profile.memory_items?.length ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                    <p className="text-xs text-[var(--muted)]">证据链</p>
                    <p className="mt-1 text-lg font-semibold">{profileResult.profile.evidence_links?.length ?? 0}</p>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-sm font-semibold">关联记忆</p>
                    <div className="max-h-64 space-y-2 overflow-auto pr-1">
                      {(profileResult.profile.memory_items ?? []).map((item: any) => (
                        <div key={item.id} className="rounded-lg border border-[var(--border)] p-3 text-xs">
                          <p className="line-clamp-2 text-[var(--muted-strong)]">{item.content}</p>
                          <p className="mt-1 text-[var(--muted)]">{item.kind} · {(item.metadata?.lifecycle_state ?? "active")}</p>
                        </div>
                      ))}
                      {!(profileResult.profile.memory_items ?? []).length ? <EmptyBlock text="暂无可合并记忆。" /> : null}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold">证据链接</p>
                    <div className="max-h-64 space-y-2 overflow-auto pr-1">
                      {(profileResult.profile.evidence_links ?? []).map((ev: any, idx: number) => (
                        <div key={`profile-evidence-${idx}`} className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--muted-strong)]">
                          {ev.relationship ? `${ev.relationship}: ${ev.from} → ${ev.to}` : `${ev.source}${ev.path ? ` · ${ev.path}` : ""}`}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : <EmptyBlock text="选择实体并合并画像后，会输出 Graph RAG 可直接消费的上下文包。" />}
          </WorkbenchPanel>
        </div>
      ) : null}

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="knowledge-graph"
        title="AI 知识图谱助手"
        context={{ entity_types: buildForm.entity_types, summary, query: queryText, lineage_entity_id: lineageEntityId }}
        initialPrompt="分析当前项目知识图谱，找出关键实体、依赖风险和可以任务化的治理建议。"
      />
    </div>
  );
}
