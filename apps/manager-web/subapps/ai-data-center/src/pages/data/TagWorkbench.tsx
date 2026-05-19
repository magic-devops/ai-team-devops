import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "catalog" | "rules" | "ontology";

export function TagWorkbench({ focused: _focused, initialTab = "catalog" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [tagForm, setTagForm] = useState({ name: "", category: "general", description: "", value_type: "string", owner: "" });
  const [ruleForm, setRuleForm] = useState({ tag_id: "", priority: 0 });
  const [entityForm, setEntityForm] = useState({ entity_type: "", name: "" });

  const tagsQ = useQuery({ queryKey: ["tagCatalog"], queryFn: () => api.tagCatalog(), enabled: authed });
  const rulesQ = useQuery({ queryKey: ["tagRules"], queryFn: () => api.tagRules(), enabled: authed && tab === "rules" });
  const ontologyQ = useQuery({ queryKey: ["tagOntology"], queryFn: () => api.tagOntology(), enabled: authed && tab === "ontology" });

  const createTag = useMutation({
    mutationFn: () => api.tagCreate(tagForm),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tagCatalog"] }); setShowForm(false); },
  });
  const deleteTag = useMutation({
    mutationFn: (id: string) => api.tagDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tagCatalog"] }),
  });
  const createRule = useMutation({
    mutationFn: () => api.tagRuleCreate(ruleForm),
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

  if (!authed) return <NeedLogin />;
  const tags = tagsQ.data?.items ?? [];
  const rules = rulesQ.data?.items ?? [];
  const entities = ontologyQ.data?.entities ?? [];

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title="标签服务" description="标签目录、自动打标规则与画像本体管理">
        <div className="flex gap-1 border-b border-[var(--border)] mb-4">
          {(["catalog", "rules", "ontology"] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
              {t === "catalog" ? `标签目录 (${tags.length})` : t === "rules" ? "打标规则" : "画像本体"}
            </button>
          ))}
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
	                  <th className="pb-2 pr-4">标签 ID</th><th className="pb-2 pr-4">优先级</th><th className="pb-2 pr-4">状态</th><th className="pb-2">操作</th>
                </tr></thead>
                <tbody>
	                  {rules.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-[var(--muted)]">暂无规则</td></tr>}
                  {rules.map((r: any) => (
                    <tr key={r.id} className="border-b border-[var(--border)]">
	                      <td className="py-2 pr-4 font-mono text-xs">{r.tag_id?.slice(0, 8)}...</td>
	                      <td className="py-2 pr-4">{r.priority}</td>
	                      <td className="py-2 text-[var(--muted)]">{r.status}</td>
	                      <td className="py-2"><button onClick={() => deleteRule.mutate(r.id)} className="text-xs text-red-500 hover:underline">删除</button></td>
	                    </tr>
                  ))}
                </tbody>
              </table>
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
	                  <button onClick={() => deleteEntity.mutate(e.id)} className="mt-3 text-xs text-red-500 hover:underline">删除</button>
	                </div>
              ))}
            </div>
          </WorkbenchPanel>
        )}
      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="tag-service" title="AI 智能助手" initialPrompt="分析标签体系，建议优化标签分类和打标规则" />
      </WorkbenchShell>
    </div>
  );
}
