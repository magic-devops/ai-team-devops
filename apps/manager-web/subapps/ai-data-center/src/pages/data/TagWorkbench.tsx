import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "catalog" | "rules" | "ontology" | "profiles";
const TAB_KEYS: Tab[] = ["catalog", "rules", "ontology", "profiles"];
const TAB_META: Record<Tab, { labelKey: string; titleKey: string; descriptionKey: string; focusKey: string }> = {
  catalog: {
    labelKey: "page.tagService.tabs.catalog",
    titleKey: "page.tagService.modules.catalog.title",
    descriptionKey: "page.tagService.modules.catalog.description",
    focusKey: "page.tagService.modules.catalog.focus",
  },
  rules: {
    labelKey: "page.tagService.tabs.rules",
    titleKey: "page.tagService.modules.rules.title",
    descriptionKey: "page.tagService.modules.rules.description",
    focusKey: "page.tagService.modules.rules.focus",
  },
  ontology: {
    labelKey: "page.tagService.tabs.ontology",
    titleKey: "page.tagService.modules.ontology.title",
    descriptionKey: "page.tagService.modules.ontology.description",
    focusKey: "page.tagService.modules.ontology.focus",
  },
  profiles: {
    labelKey: "page.tagService.tabs.profiles",
    titleKey: "page.tagService.modules.profiles.title",
    descriptionKey: "page.tagService.modules.profiles.description",
    focusKey: "page.tagService.modules.profiles.focus",
  },
};

const DEFAULT_PROFILE_RECORDS = `[
  {"agent_id":"a-1","quality_score":92,"tier":"gold"},
  {"agent_id":"a-2","quality_score":55,"tier":"silver"}
]`;

function splitList(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

export function TagWorkbench({ focused = false, initialTab = "catalog" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [tagForm, setTagForm] = useState({ name: "", category: "general", description: "", value_type: "string", owner: "", applies_to: "" });
  const [ruleForm, setRuleForm] = useState({ tag_id: "", entity_type: "", field: "", operator: ">=", value: "", output_value: "true", priority: 0 });
  const [entityForm, setEntityForm] = useState({ entity_type: "", name: "" });
  const [evaluateForm, setEvaluateForm] = useState({ entity_type: "agent", sample: "{\"quality_score\":92,\"tier\":\"gold\"}" });
  const [profileForm, setProfileForm] = useState({ entity_type: "agent", profile_name: "Agent Readiness Profile", records: DEFAULT_PROFILE_RECORDS, publish: true });
  const [jsonError, setJsonError] = useState("");
  const [evaluateResult, setEvaluateResult] = useState<any>(null);
  const [buildResult, setBuildResult] = useState<any>(null);
  const [contractResult, setContractResult] = useState<any>(null);

  const tagsQ = useQuery({ queryKey: ["tagCatalog"], queryFn: () => api.tagCatalog(), enabled: authed });
  const rulesQ = useQuery({ queryKey: ["tagRules"], queryFn: () => api.tagRules(), enabled: authed && tab === "rules" });
  const ontologyQ = useQuery({ queryKey: ["tagOntology"], queryFn: () => api.tagOntology(), enabled: authed && tab === "ontology" });
  const profileBuildsQ = useQuery({ queryKey: ["tagProfileBuilds", profileForm.entity_type], queryFn: () => api.tagProfileBuilds(profileForm.entity_type), enabled: authed && tab === "profiles" });

  function parseJson(value: string, fallback: any) {
    try {
      setJsonError("");
      return JSON.parse(value);
    } catch (err: any) {
      const message = err?.message || "JSON 格式不正确";
      setJsonError(message);
      return fallback;
    }
  }

  const createTag = useMutation({
    mutationFn: () => api.tagCreate({ ...tagForm, applies_to: splitList(tagForm.applies_to) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tagCatalog"] }); setShowForm(false); },
  });
  const deleteTag = useMutation({
    mutationFn: (id: string) => api.tagDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tagCatalog"] }),
  });
  const createRule = useMutation({
    mutationFn: () => api.tagRuleCreate({
      tag_id: ruleForm.tag_id,
      entity_type: ruleForm.entity_type,
      condition: { field: ruleForm.field, operator: ruleForm.operator, value: Number.isNaN(Number(ruleForm.value)) || ruleForm.value.trim() === "" ? ruleForm.value : Number(ruleForm.value) },
      output_value: ruleForm.output_value === "true" ? true : ruleForm.output_value === "false" ? false : ruleForm.output_value,
      priority: ruleForm.priority,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tagRules"] }); setShowForm(false); },
  });
  const createEntity = useMutation({
    mutationFn: () => api.tagEntityCreate(entityForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tagOntology"] }); setShowForm(false); },
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api.tagRuleDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tagRules"] }),
  });
  const deleteEntity = useMutation({
    mutationFn: (id: string) => api.tagEntityDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tagOntology"] }),
  });
  const evaluateRule = useMutation({
    mutationFn: () => api.tagRuleEvaluate({ entity_type: evaluateForm.entity_type, sample: parseJson(evaluateForm.sample, {}) }),
    onSuccess: (data) => setEvaluateResult(data),
  });
  const buildProfile = useMutation({
    mutationFn: () => api.tagProfileBuild({
      entity_type: profileForm.entity_type,
      profile_name: profileForm.profile_name,
      records: parseJson(profileForm.records, []),
      publish: profileForm.publish,
    }),
    onSuccess: (data) => {
      setBuildResult(data);
      void qc.invalidateQueries({ queryKey: ["tagProfileBuilds", profileForm.entity_type] });
    },
  });
  const publishContract = useMutation({
    mutationFn: (id: string) => api.tagPublishContract(id),
    onSuccess: (data) => setContractResult(data),
  });

  if (!authed) return <NeedLogin />;
  const tags = tagsQ.data?.items ?? [];
  const rules = rulesQ.data?.items ?? [];
  const entities = ontologyQ.data?.entities ?? [];
  const builds = profileBuildsQ.data?.items ?? [];
  const activeMetaDef = TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };
  const tabLabel = (tabId: Tab) => tabId === "catalog" ? `${t(TAB_META[tabId].labelKey)} (${tags.length})` : t(TAB_META[tabId].labelKey);

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title={focused ? activeMeta.title : t("page.tagService.workbenchTitle")} description={focused ? activeMeta.description : t("page.tagService.workbenchDesc")}>
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          {focused ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.tagService.focusedTag")}</span>
                <span className="text-xs font-medium text-[var(--text)]">{activeMeta.focus}</span>
                <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.tagService.focusedHint")}</span>
              </div>
              <a href="#/data/tags" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.tagService.backToHub")}</a>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {TAB_KEYS.map(tabId => (
                <button key={tabId} onClick={() => { setTab(tabId); setShowForm(false); }}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === tabId ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"}`}>
                  {tabLabel(tabId)}
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === "catalog" && (
          <WorkbenchPanel title="标签目录" actions={
            <div className="flex gap-2">
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void tagsQ.refetch()} pending={tagsQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建标签</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="标签名称 *" value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))} />
                  <input className="input-base" placeholder="分类 (如 user, product)" value={tagForm.category} onChange={e => setTagForm(f => ({ ...f, category: e.target.value }))} />
                  <select className="input-base" value={tagForm.value_type} onChange={e => setTagForm(f => ({ ...f, value_type: e.target.value }))}>
                    {["string", "number", "boolean", "enum"].map(t => <option key={t}>{t}</option>)}
                  </select>
                  <input className="input-base" placeholder="负责人" value={tagForm.owner} onChange={e => setTagForm(f => ({ ...f, owner: e.target.value }))} />
                  <input className="input-base" placeholder="适用实体，逗号分隔" value={tagForm.applies_to} onChange={e => setTagForm(f => ({ ...f, applies_to: e.target.value }))} />
                  <input className="input-base sm:col-span-2" placeholder="描述" value={tagForm.description} onChange={e => setTagForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createTag.mutate()} disabled={!tagForm.name || createTag.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createTag.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tags.length === 0 && <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">暂无标签</p>}
              {tags.map((t: any) => (
                <div key={t.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
                      <p className="text-xs text-[var(--muted)] mt-0.5">{t.category} · {t.value_type}</p>
                    </div>
                    <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs text-[var(--brand)]">{t.status}</span>
                  </div>
                  {t.description && <p className="mt-2 text-xs text-[var(--muted)] line-clamp-2">{t.description}</p>}
                  {t.applies_to?.length > 0 && <p className="mt-2 text-xs text-[var(--muted)]">实体：{t.applies_to.join(", ")}</p>}
                  <button onClick={() => deleteTag.mutate(t.id)} className="mt-3 text-xs text-red-500 hover:underline">删除</button>
                </div>
              ))}
            </div>
          </WorkbenchPanel>
        )}

        {tab === "rules" && (
          <WorkbenchPanel title="打标规则" actions={
            <div className="flex gap-2">
              <RefreshButton onClick={() => void rulesQ.refetch()} pending={rulesQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 新建规则</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <select className="input-base" value={ruleForm.tag_id} onChange={e => setRuleForm(f => ({ ...f, tag_id: e.target.value }))}>
                    <option value="">选择标签 *</option>
                    {tags.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <input className="input-base" placeholder="实体类型，如 agent/customer" value={ruleForm.entity_type} onChange={e => setRuleForm(f => ({ ...f, entity_type: e.target.value }))} />
                  <input className="input-base" placeholder="字段，如 quality_score" value={ruleForm.field} onChange={e => setRuleForm(f => ({ ...f, field: e.target.value }))} />
                  <select className="input-base" value={ruleForm.operator} onChange={e => setRuleForm(f => ({ ...f, operator: e.target.value }))}>
                    {["==", "!=", ">=", ">", "<=", "<", "contains", "in", "exists"].map(op => <option key={op}>{op}</option>)}
                  </select>
                  <input className="input-base" placeholder="匹配值" value={ruleForm.value} onChange={e => setRuleForm(f => ({ ...f, value: e.target.value }))} />
                  <input className="input-base" placeholder="输出值" value={ruleForm.output_value} onChange={e => setRuleForm(f => ({ ...f, output_value: e.target.value }))} />
                  <input className="input-base" type="number" placeholder="优先级" value={ruleForm.priority} onChange={e => setRuleForm(f => ({ ...f, priority: Number(e.target.value) }))} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createRule.mutate()} disabled={!ruleForm.tag_id || createRule.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createRule.isPending ? "创建中..." : "创建"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
	                  <th className="pb-2 pr-4">标签 ID</th><th className="pb-2 pr-4">实体</th><th className="pb-2 pr-4">条件</th><th className="pb-2 pr-4">优先级</th><th className="pb-2 pr-4">状态</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
	                  {rules.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">暂无规则</td></tr>}
                  {rules.map((r: any) => (
                    <tr key={r.id} className="border-b border-[var(--border)]">
	                      <td className="py-2 pr-4 font-mono text-xs">{r.tag_id?.slice(0, 8)}...</td>
	                      <td className="py-2 pr-4 text-[var(--muted)]">{r.entity_type || "全部"}</td>
	                      <td className="py-2 pr-4 max-w-[260px] truncate font-mono text-xs text-[var(--muted)]">{JSON.stringify(r.condition || {})}</td>
	                      <td className="py-2 pr-4">{r.priority}</td>
	                      <td className="py-2 text-[var(--muted)]">{r.status}</td>
	                      <td className="py-2"><button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-red-500 hover:underline">删除</button></td>
	                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="mb-3 text-sm font-semibold">规则测试</div>
              <div className="grid gap-3 lg:grid-cols-[220px_1fr_auto]">
                <input className="input-base" placeholder="实体类型" value={evaluateForm.entity_type} onChange={e => setEvaluateForm(f => ({ ...f, entity_type: e.target.value }))} />
                <textarea className="input-base min-h-[82px] font-mono text-xs" value={evaluateForm.sample} onChange={e => setEvaluateForm(f => ({ ...f, sample: e.target.value }))} />
                <button onClick={() => evaluateRule.mutate()} disabled={evaluateRule.isPending} className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm disabled:opacity-50">测试</button>
              </div>
              {jsonError && <div className="mt-2 text-xs text-red-600">{jsonError}</div>}
              {evaluateResult && <div className="mt-3 text-sm text-[var(--muted)]">命中 {evaluateResult.matched_count} 个标签：{evaluateResult.matches?.map((m: any) => m.tag_name).join(", ") || "无"}</div>}
            </div>
          </WorkbenchPanel>
        )}

        {tab === "ontology" && (
          <WorkbenchPanel title="画像本体" actions={
            <div className="flex gap-2">
              <RefreshButton onClick={() => void ontologyQ.refetch()} pending={ontologyQ.isFetching} />
              <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm text-white hover:opacity-90">+ 注册实体</button>
            </div>
          }>
            {showForm && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="实体类型 (如 User, Product)" value={entityForm.entity_type} onChange={e => setEntityForm(f => ({ ...f, entity_type: e.target.value }))} />
                  <input className="input-base" placeholder="实体名称 *" value={entityForm.name} onChange={e => setEntityForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createEntity.mutate()} disabled={!entityForm.name || createEntity.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">
                    {createEntity.isPending ? "注册中..." : "注册"}
                  </button>
                  <button onClick={() => setShowForm(false)} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm">取消</button>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {entities.length === 0 && <p className="col-span-3 py-8 text-center text-sm text-[var(--muted)]">暂无本体实体</p>}
                  {entities.map((e: any) => (
                <div key={e.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
	                  <p className="font-semibold text-sm">{e.name}</p>
	                  <p className="text-xs text-[var(--muted)] mt-0.5">{e.entity_type}</p>
	                  <div className="mt-3 flex gap-2">
	                    <button onClick={() => publishContract.mutate(e.id)} className="text-xs text-[var(--brand)] hover:underline">发布契约</button>
	                    <button onClick={() => deleteEntity.mutate(e.id)} className="text-xs text-red-500 hover:underline">删除</button>
	                  </div>
	                </div>
              ))}
            </div>
            {contractResult && (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm">
                <div className="font-semibold">发布契约：{contractResult.entity_name}</div>
                <div className="mt-1 font-mono text-xs text-[var(--brand)]">{contractResult.endpoint}</div>
                <div className="mt-2 text-xs text-[var(--muted)]">标签：{contractResult.tags?.join(", ") || "无"}</div>
              </div>
            )}
          </WorkbenchPanel>
        )}

        {tab === "profiles" && (
          <WorkbenchPanel title="画像构建" actions={<RefreshButton onClick={() => void profileBuildsQ.refetch()} pending={profileBuildsQ.isFetching} />}>
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input className="input-base" placeholder="实体类型" value={profileForm.entity_type} onChange={e => setProfileForm(f => ({ ...f, entity_type: e.target.value }))} />
                  <input className="input-base" placeholder="画像名称" value={profileForm.profile_name} onChange={e => setProfileForm(f => ({ ...f, profile_name: e.target.value }))} />
                </div>
                <textarea className="input-base min-h-[170px] w-full font-mono text-xs" value={profileForm.records} onChange={e => setProfileForm(f => ({ ...f, records: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input type="checkbox" checked={profileForm.publish} onChange={e => setProfileForm(f => ({ ...f, publish: e.target.checked }))} />
                  构建后发布画像
                </label>
                <button onClick={() => buildProfile.mutate()} disabled={buildProfile.isPending} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">构建画像</button>
                {buildResult && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                    <div className="font-semibold">{buildResult.profile_name}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">记录 {buildResult.records_total} · 命中 {buildResult.tagged_records} · 覆盖率 {(Number(buildResult.coverage || 0) * 100).toFixed(1)}%</div>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="mb-3 text-sm font-semibold">构建历史</div>
                <div className="space-y-2">
                  {builds.length === 0 && <div className="text-sm text-[var(--muted)]">暂无构建记录</div>}
                  {builds.map((b: any) => (
                    <div key={b.id} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                      <div className="font-medium text-[var(--text)]">{b.profile_name}</div>
                      <div className="mt-1 text-[var(--muted)]">{b.status} · {b.tagged_records}/{b.records_total} 命中</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </WorkbenchPanel>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="tag-service" title="AI 智能助手" initialPrompt="分析标签体系，建议优化标签分类和打标规则" />
      </WorkbenchShell>
    </div>
  );
}
