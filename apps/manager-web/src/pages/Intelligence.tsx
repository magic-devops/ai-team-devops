import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Progress, Space, Table, Tag } from "antd";
import { Activity, Ban, Brain, CheckCircle2, Cpu, Database, Gauge, GitBranch, Library, PlayCircle, Plus, RotateCw, Search, ShieldCheck, Sparkles, UploadCloud, XCircle } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { LoadingBlock, NeedLogin } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";
import { WorkbenchPanel } from "./shared/workbenchUi";

const EChartsDonutLazy = lazy(() =>
  import("../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);
const EChartsBarLazy = lazy(() =>
  import("../components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}

type Tab = "kb" | "rag" | "mem" | "rules" | "distill" | "worker" | "sync" | "db" | "events" | "usage";

const tabs: Array<{ key: Tab; icon: typeof Library; labelKey: string }> = [
  { key: "kb", icon: Library, labelKey: "page.intelligence.tabKb" },
  { key: "rag", icon: Search, labelKey: "page.intelligence.tabRag" },
  { key: "mem", icon: Brain, labelKey: "page.intelligence.tabMem" },
  { key: "rules", icon: ShieldCheck, labelKey: "page.intelligence.tabRules" },
  { key: "distill", icon: Sparkles, labelKey: "page.intelligence.tabDistill" },
  { key: "worker", icon: Cpu, labelKey: "page.intelligence.tabWorker" },
  { key: "sync", icon: GitBranch, labelKey: "page.intelligence.tabSync" },
  { key: "db", icon: Database, labelKey: "page.intelligence.tabDb" },
  { key: "events", icon: Activity, labelKey: "page.intelligence.tabEvents" },
  { key: "usage", icon: Gauge, labelKey: "page.intelligence.tabUsage" },
];

function Err({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </div>
  );
}

function MiniButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export function Intelligence({ initialTab = "kb", focused = false }: { initialTab?: Tab; focused?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [qKb, setQKb] = useState("");
  const [qRag, setQRag] = useState("");
  const [qMem, setQMem] = useState("");
  const [newMem, setNewMem] = useState("");
  const [kbDraft, setKbDraft] = useState({ title: "", content: "", category: "general", tags: "" });
  const [ruleDraft, setRuleDraft] = useState({ rule: "", category: "coding", confidence: "0.75" });
  const [distillDraft, setDistillDraft] = useState({ days: "30", category: "", limit: "100", dryRun: true });
  const [dbDraft, setDbDraft] = useState({ name: "", type: "postgres", role: "business", capability: "sql", host: "", port: "", database: "", username: "", secret_ref: "" });
  const [quotaDraft, setQuotaDraft] = useState("{}");
  const [testUrls, setTestUrls] = useState<Record<string, string>>({});
  const [workerDraft, setWorkerDraft] = useState({ type: "kb.index", payload: "{}" });
  const [workerFilter, setWorkerFilter] = useState({ status: "", type: "" });
  const [syncDraft, setSyncDraft] = useState({ modules: "tasks,requirements,issues,sprints,rules,specs,templates", cursor: "", limit: "50" });
  const [syncAssetDraft, setSyncAssetDraft] = useState({ module: "rules", path: "RULES.md", content: "" });
  const [usageTaskPreview, setUsageTaskPreview] = useState<any[]>([]);
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const memHealth = useQuery({ queryKey: ["memHealth"], queryFn: api.memoryHealth, enabled: authed });
  const memRecent = useQuery({ queryKey: ["memRecent"], queryFn: () => api.memoryRecent(40), enabled: authed && tab === "mem" });
  const memSearch = useQuery({ queryKey: ["memSearch", qMem], queryFn: () => api.memorySearch(qMem, 25), enabled: authed && tab === "mem" && qMem.trim().length >= 1 });
  const kbSearch = useQuery({ queryKey: ["kbSearch", qKb], queryFn: () => api.knowledgeSearch(qKb), enabled: authed && tab === "kb" && qKb.trim().length >= 1 });
  const ragSearch = useQuery({ queryKey: ["ragSearch", qRag], queryFn: () => api.ragSearch(qRag), enabled: authed && tab === "rag" && qRag.trim().length >= 1 });
  const rules = useQuery({ queryKey: ["rules"], queryFn: api.rules, enabled: authed && tab === "rules" });
  const proposals = useQuery({ queryKey: ["reflectionProposals"], queryFn: () => api.reflectionProposals(100), enabled: authed && tab === "distill" });
  const dbDrivers = useQuery({ queryKey: ["dbDrivers"], queryFn: api.dbDrivers, enabled: authed && tab === "db" });
  const dbConnections = useQuery({ queryKey: ["dbConnections"], queryFn: api.dbConnections, enabled: authed && tab === "db" });
  const events = useQuery({ queryKey: ["events"], queryFn: () => api.eventsList(100), enabled: authed && tab === "events" });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api.usageSummary(5000), enabled: authed && tab === "usage" });
  const usageCharts = useQuery({ queryKey: ["usageCharts"], queryFn: () => api.usageCharts(5000), enabled: authed && tab === "usage" });
  const quota = useQuery({ queryKey: ["quota"], queryFn: api.usageQuota, enabled: authed && tab === "usage" });
  const usageAlerts = useQuery({ queryKey: ["usageAlerts"], queryFn: () => api.usageAlerts(5000), enabled: authed && tab === "usage" });

  const usageTrend = useMemo(() => {
    const trend = usageCharts.data?.activity_trend;
    if (!trend?.days?.length) return null;
    return { categories: trend.days, series: trend.series ?? [] };
  }, [usageCharts.data]);
  const workerHealth = useQuery({ queryKey: ["workerHealth"], queryFn: api.workerHealth, enabled: authed && tab === "worker" });
  const workerTypes = useQuery({ queryKey: ["workerTypes"], queryFn: api.workerTypes, enabled: authed && tab === "worker" });
  const workerJobs = useQuery({ queryKey: ["workerJobs", workerFilter.status, workerFilter.type], queryFn: () => api.workerJobs(100, workerFilter.status, workerFilter.type), enabled: authed && tab === "worker" });
  const syncHealth = useQuery({ queryKey: ["syncHealth"], queryFn: api.syncHealth, enabled: authed && tab === "sync" });
  const syncModules = useQuery({ queryKey: ["syncModules"], queryFn: api.syncModules, enabled: authed && tab === "sync" });
  const syncSummary = useQuery({ queryKey: ["syncSummary"], queryFn: api.syncSummary, enabled: authed && tab === "sync" });
  const syncJournal = useQuery({ queryKey: ["syncJournal"], queryFn: () => api.syncJournal("", 80), enabled: authed && tab === "sync" });

  const indexKb = useMutation({ mutationFn: () => api.workerEnqueue("kb.index", {}) });
  const addMem = useMutation({
    mutationFn: () => api.memoryAdd({ content: newMem.trim(), kind: "long", metadata: { source: "manager-web" } }),
    onSuccess: () => {
      setNewMem("");
      void qc.invalidateQueries({ queryKey: ["memRecent"] });
    },
  });
  const addKb = useMutation({
    mutationFn: () => api.knowledgeCreate({
      title: kbDraft.title.trim(),
      content: kbDraft.content.trim(),
      category: kbDraft.category || "general",
      tags: kbDraft.tags.split(",").map((x) => x.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      setKbDraft({ title: "", content: "", category: "general", tags: "" });
      void qc.invalidateQueries({ queryKey: ["kbSearch"] });
    },
  });
  const addRule = useMutation({
    mutationFn: () => api.ruleCreate({
      rule: ruleDraft.rule.trim(),
      category: ruleDraft.category || "coding",
      source: "manager-web",
      confidence: Number(ruleDraft.confidence || 0.75),
    }),
    onSuccess: () => {
      setRuleDraft({ rule: "", category: "coding", confidence: "0.75" });
      void qc.invalidateQueries({ queryKey: ["rules"] });
    },
  });
  const runDistill = useMutation({
    mutationFn: () => api.reflectionDistill({
      days: Number(distillDraft.days || 30),
      category: distillDraft.category.trim(),
      limit: Number(distillDraft.limit || 100),
      dry_run: distillDraft.dryRun,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reflectionProposals"] });
    },
  });
  const reviewProposal = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) =>
      api.reflectionReviewProposal(id, { status, reviewer: "manager-web" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reflectionProposals"] });
      void qc.invalidateQueries({ queryKey: ["rules"] });
    },
  });
  const saveDb = useMutation({
    mutationFn: () => api.dbUpsertConnection(dbDraft.name.trim(), {
      name: dbDraft.name.trim(),
      type: dbDraft.type,
      role: dbDraft.role,
      capabilities: dbDraft.capability.split(",").map((x) => x.trim()).filter(Boolean),
      host: dbDraft.host.trim(),
      port: dbDraft.port ? Number(dbDraft.port) : null,
      database: dbDraft.database.trim(),
      username: dbDraft.username.trim(),
      secret_ref: dbDraft.secret_ref.trim(),
    }),
    onSuccess: () => {
      setDbDraft({ name: "", type: "postgres", role: "business", capability: "sql", host: "", port: "", database: "", username: "", secret_ref: "" });
      void qc.invalidateQueries({ queryKey: ["dbConnections"] });
    },
  });
  const testDb = useMutation({ mutationFn: ({ name, url }: { name: string; url: string }) => api.dbTestConnection(name, url) });
  const setQuota = useMutation({
    mutationFn: () => api.usageSetQuota(JSON.parse(quotaDraft) as Record<string, number>),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quota"] });
      void qc.invalidateQueries({ queryKey: ["usage"] });
      void qc.invalidateQueries({ queryKey: ["usageAlerts"] });
    },
  });
  const usageAlertTasks = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.usageAlertTasks({
        ids: (usageAlerts.data?.items ?? []).map((x: any) => String(x.id)).filter(Boolean),
        dry_run: dryRun,
        priority: "P1",
        assigned_to: "Ops",
        dev_tool: "copilot",
      }),
    onSuccess: (data) => {
      if (data?.dry_run) {
        setUsageTaskPreview(data.items ?? []);
      } else {
        void qc.invalidateQueries({ queryKey: ["tasks"] });
        void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
      }
    },
  });
  const enqueueWorker = useMutation({
    mutationFn: () => api.workerEnqueue(workerDraft.type, JSON.parse(workerDraft.payload || "{}") as Record<string, unknown>),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workerJobs"] });
      void qc.invalidateQueries({ queryKey: ["workerHealth"] });
    },
  });
  const cancelWorker = useMutation({
    mutationFn: (jobId: string) => api.workerCancel(jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workerJobs"] });
      void qc.invalidateQueries({ queryKey: ["workerHealth"] });
    },
  });
  const retryWorker = useMutation({
    mutationFn: (jobId: string) => api.workerRetry(jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workerJobs"] });
      void qc.invalidateQueries({ queryKey: ["workerHealth"] });
    },
  });
  const pullSync = useMutation({
    mutationFn: () => api.syncPull(syncDraft.modules, syncDraft.cursor, Number(syncDraft.limit || 50)),
    onSuccess: (data) => {
      if (data?.cursor) setSyncDraft((v) => ({ ...v, cursor: data.cursor }));
      void qc.invalidateQueries({ queryKey: ["syncSummary"] });
      void qc.invalidateQueries({ queryKey: ["syncJournal"] });
    },
  });
  const pushSyncAsset = useMutation({
    mutationFn: () =>
      api.syncPush({
        module: syncAssetDraft.module,
        action: "upsert",
        record: { path: syncAssetDraft.path, content: syncAssetDraft.content },
        idempotency_key: `web-${syncAssetDraft.module}-${syncAssetDraft.path}`,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["syncSummary"] });
      void qc.invalidateQueries({ queryKey: ["syncJournal"] });
    },
  });

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-700 dark:text-brand-300">
          <Brain className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("page.intelligence.title")}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("page.intelligence.subtitle")}</p>
        </div>
      </div>

      {!hasProject ? <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p> : null}

      {!focused ? (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
          {tabs.map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === key ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
              onClick={() => setTab(key)}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {t(labelKey)}
            </button>
          ))}
        </div>
      ) : (
        <div className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
          {t(tabs.find((item) => item.key === tab)?.labelKey ?? "page.intelligence.title")}
        </div>
      )}

      {tab === "kb" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]">
          <Card title={t("page.intelligence.kbSearch")}>
            <div className="flex flex-wrap gap-2">
              <input className={`${inputClass} min-w-[14rem] flex-1`} placeholder={t("page.intelligence.kbPh")} value={qKb} onChange={(e) => setQKb(e.target.value)} />
              <MiniButton disabled={indexKb.isPending} onClick={() => indexKb.mutate()}><RotateCw className="h-4 w-4" />{t("page.intelligence.indexKb")}</MiniButton>
            </div>
            {indexKb.data?.job_id ? <p className="mt-2 text-xs text-slate-500">job: {indexKb.data.job_id}</p> : null}
            {kbSearch.isError ? <Err message={(kbSearch.error as Error).message} /> : null}
            <ul className="mt-4 space-y-2 text-sm">
              {(kbSearch.data ?? []).map((row: any) => (
                <li key={String(row.id ?? row.path)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{row.category ?? "-"}</span>
                  <span className="ml-2 text-slate-500">{row.path}</span>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{row.content}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t("page.intelligence.kbCreate")}>
            <div className="space-y-2">
              <input className={`${inputClass} w-full`} placeholder={t("page.intelligence.titlePh")} value={kbDraft.title} onChange={(e) => setKbDraft((v) => ({ ...v, title: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} placeholder="category" value={kbDraft.category} onChange={(e) => setKbDraft((v) => ({ ...v, category: e.target.value }))} />
                <input className={inputClass} placeholder="tags" value={kbDraft.tags} onChange={(e) => setKbDraft((v) => ({ ...v, tags: e.target.value }))} />
              </div>
              <textarea className={`${inputClass} min-h-[9rem] w-full`} placeholder={t("page.intelligence.contentPh")} value={kbDraft.content} onChange={(e) => setKbDraft((v) => ({ ...v, content: e.target.value }))} />
              <PrimaryButton disabled={!kbDraft.title.trim() || !kbDraft.content.trim() || addKb.isPending} onClick={() => addKb.mutate()}><Plus className="h-4 w-4" />{t("common.save")}</PrimaryButton>
              {addKb.isError ? <Err message={(addKb.error as Error).message} /> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "rag" ? (
        <Card title={t("page.intelligence.tabRag")}>
          <input className={`${inputClass} w-full`} placeholder={t("page.intelligence.ragPh")} value={qRag} onChange={(e) => setQRag(e.target.value)} />
          {ragSearch.isError ? <Err message={(ragSearch.error as Error).message} /> : null}
          <ul className="mt-4 space-y-2 text-sm">
            {(ragSearch.data?.items ?? []).map((row: any) => (
              <li key={`${row.collection}-${row.id}`} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                <span className="text-xs text-slate-500">{row.collection} · {typeof row.score === "number" ? row.score.toFixed(3) : ""}</span>
                <p className="mt-1 font-medium">{row.title}</p>
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{row.snippet}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {tab === "mem" ? (
        <div className="grid gap-4 xl:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[30rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card><p className="text-xs text-slate-500">memory / health: {memHealth.isSuccess ? JSON.stringify(memHealth.data) : "-"}</p></Card>
            <Card title={t("page.intelligence.memAdd")}>
              <textarea className={`${inputClass} min-h-[8rem] w-full`} value={newMem} onChange={(e) => setNewMem(e.target.value)} placeholder={t("page.intelligence.memAddPh")} />
              <div className="mt-2"><PrimaryButton disabled={!newMem.trim() || addMem.isPending} onClick={() => addMem.mutate()}>{t("common.save")}</PrimaryButton></div>
              {addMem.isError ? <Err message={(addMem.error as Error).message} /> : null}
            </Card>
          </div>
          <div className="space-y-4">
            <Card title={t("page.intelligence.memSearch")}>
              <input className={`${inputClass} w-full`} value={qMem} onChange={(e) => setQMem(e.target.value)} placeholder={t("page.intelligence.memSearchPh")} />
              {memSearch.isError ? <Err message={(memSearch.error as Error).message} /> : null}
              <MemoryList rows={memSearch.data?.items ?? []} />
            </Card>
            <Card title={t("page.intelligence.memRecent")}>
              {memRecent.isError ? <Err message={(memRecent.error as Error).message} /> : null}
              <MemoryList rows={memRecent.data?.items ?? []} />
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "rules" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]">
          <Card title={t("page.intelligence.rulesList")} actions={<MiniButton onClick={() => void rules.refetch()}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}>
            {rules.isError ? <Err message={(rules.error as Error).message} /> : null}
            <ul className="space-y-2 text-sm">
              {(rules.data ?? []).map((row: any, i: number) => (
                <li key={String(row.id ?? i)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                  <span className="text-xs text-slate-500">{row.category ?? "coding"} · {row.confidence ?? "-"}</span>
                  <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{row.rule ?? row.content}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t("page.intelligence.ruleCreate")}>
            <div className="space-y-2">
              <textarea className={`${inputClass} min-h-[8rem] w-full`} value={ruleDraft.rule} onChange={(e) => setRuleDraft((v) => ({ ...v, rule: e.target.value }))} placeholder={t("page.intelligence.rulePh")} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} value={ruleDraft.category} onChange={(e) => setRuleDraft((v) => ({ ...v, category: e.target.value }))} />
                <input className={inputClass} value={ruleDraft.confidence} onChange={(e) => setRuleDraft((v) => ({ ...v, confidence: e.target.value }))} />
              </div>
              <PrimaryButton disabled={!ruleDraft.rule.trim() || addRule.isPending} onClick={() => addRule.mutate()}><Plus className="h-4 w-4" />{t("common.save")}</PrimaryButton>
              {addRule.isError ? <Err message={(addRule.error as Error).message} /> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "distill" ? (
        <div className="grid gap-4 xl:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[30rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card title={t("page.intelligence.distillRun")}>
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1 text-xs text-slate-500">
                    {t("page.intelligence.days")}
                    <input className={`${inputClass} w-full`} value={distillDraft.days} onChange={(e) => setDistillDraft((v) => ({ ...v, days: e.target.value }))} />
                  </label>
                  <label className="space-y-1 text-xs text-slate-500">
                    {t("page.intelligence.limit")}
                    <input className={`${inputClass} w-full`} value={distillDraft.limit} onChange={(e) => setDistillDraft((v) => ({ ...v, limit: e.target.value }))} />
                  </label>
                  <label className="space-y-1 text-xs text-slate-500">
                    {t("page.intelligence.category")}
                    <input className={`${inputClass} w-full`} value={distillDraft.category} onChange={(e) => setDistillDraft((v) => ({ ...v, category: e.target.value }))} placeholder="all" />
                  </label>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={distillDraft.dryRun} onChange={(e) => setDistillDraft((v) => ({ ...v, dryRun: e.target.checked }))} />
                  {t("page.intelligence.dryRun")}
                </label>
                <PrimaryButton disabled={runDistill.isPending} onClick={() => runDistill.mutate()}>
                  <Sparkles className="h-4 w-4" />
                  {t("page.intelligence.runDistill")}
                </PrimaryButton>
                {runDistill.isError ? <Err message={(runDistill.error as Error).message} /> : null}
                {runDistill.data ? (
                  <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(runDistill.data, null, 2)}</pre>
                ) : null}
              </div>
            </Card>
            <Card title={t("page.intelligence.distillHow")}>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t("page.intelligence.distillDesc")}</p>
            </Card>
          </div>
          <Card
            title={t("page.intelligence.proposals")}
            actions={<MiniButton onClick={() => void proposals.refetch()}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}
          >
            {proposals.isError ? <Err message={(proposals.error as Error).message} /> : null}
            <ul className="space-y-3 text-sm">
              {(proposals.data ?? []).map((row: any) => {
                const status = row.status ?? "pending";
                return (
                  <li key={String(row.id)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="rounded-md bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-200">{row.category ?? "other"}</span>
                        <span className="ml-2 text-xs text-slate-500">{t("page.intelligence.confidence")}: {row.confidence ?? "-"} · {t("page.intelligence.evidence")}: {row.evidence_count ?? 0}</span>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status === "approved" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : status === "rejected" ? "bg-rose-500/10 text-rose-700 dark:text-rose-200" : "bg-amber-500/10 text-amber-700 dark:text-amber-200"}`}>
                        {t(`page.intelligence.proposalStatus.${status}`)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-slate-900 dark:text-slate-100">{row.rule}</p>
                    {Array.isArray(row.examples) && row.examples.length ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                        {row.examples.slice(0, 3).map((example: string, i: number) => <li key={`${row.id}-${i}`}>{example}</li>)}
                      </ul>
                    ) : null}
                    {status === "pending" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <PrimaryButton disabled={reviewProposal.isPending} onClick={() => reviewProposal.mutate({ id: String(row.id), status: "approved" })}>
                          <CheckCircle2 className="h-4 w-4" />
                          {t("page.intelligence.approveRule")}
                        </PrimaryButton>
                        <MiniButton disabled={reviewProposal.isPending} onClick={() => reviewProposal.mutate({ id: String(row.id), status: "rejected" })}>
                          <XCircle className="h-4 w-4" />
                          {t("page.intelligence.rejectRule")}
                        </MiniButton>
                      </div>
                    ) : row.reviewed_at ? (
                      <p className="mt-2 text-xs text-slate-500">{row.reviewed_at}</p>
                    ) : null}
                  </li>
                );
              })}
              {proposals.isSuccess && (proposals.data ?? []).length === 0 ? <li className="text-sm text-slate-500">{t("page.intelligence.noProposals")}</li> : null}
            </ul>
            {reviewProposal.isError ? <Err message={(reviewProposal.error as Error).message} /> : null}
          </Card>
        </div>
      ) : null}

      {tab === "worker" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <WorkerMetric label={t("page.intelligence.workerTotal")} value={String(workerHealth.data?.summary?.total ?? workerJobs.data?.summary?.total ?? 0)} />
            <WorkerMetric label={t("page.intelligence.workerActive")} value={String(workerHealth.data?.summary?.active ?? workerJobs.data?.summary?.active ?? 0)} />
            <WorkerMetric label="Redis" value={workerHealth.data?.redis ? "on" : "file"} />
            <WorkerMetric label={t("page.intelligence.workerStream")} value={String(workerHealth.data?.stream ?? "-")} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[26rem_minmax(0,1fr)] 2xl:grid-cols-[30rem_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card title={t("page.intelligence.workerEnqueue")}>
                <div className="space-y-3">
                  <select className={`${inputClass} w-full`} value={workerDraft.type} onChange={(e) => setWorkerDraft((v) => ({ ...v, type: e.target.value }))}>
                    {(workerTypes.data?.items ?? []).map((row: any) => <option key={row.id} value={row.id}>{row.id}</option>)}
                    {!workerTypes.data?.items?.length ? <option value="kb.index">kb.index</option> : null}
                  </select>
                  <textarea className={`${inputClass} min-h-[9rem] w-full font-mono text-xs`} value={workerDraft.payload} onChange={(e) => setWorkerDraft((v) => ({ ...v, payload: e.target.value }))} placeholder='{"paths":["docs/"],"force":false}' />
                  <PrimaryButton disabled={enqueueWorker.isPending || !workerDraft.type} onClick={() => enqueueWorker.mutate()}>
                    <PlayCircle className="h-4 w-4" />
                    {t("page.intelligence.workerSubmit")}
                  </PrimaryButton>
                  {enqueueWorker.isError ? <Err message={(enqueueWorker.error as Error).message} /> : null}
                  {enqueueWorker.data ? <pre className="max-h-36 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(enqueueWorker.data, null, 2)}</pre> : null}
                </div>
              </Card>
              <Card title={t("page.intelligence.workerTypes")}>
                <ul className="space-y-2 text-sm">
                  {(workerTypes.data?.items ?? []).map((row: any) => (
                    <li key={row.id} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{row.id}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.description}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <Card
              title={t("page.intelligence.workerJobs")}
              actions={<MiniButton onClick={() => { void workerJobs.refetch(); void workerHealth.refetch(); }}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}
            >
              <div className="mb-3 grid gap-2 md:grid-cols-3">
                <select className={inputClass} value={workerFilter.status} onChange={(e) => setWorkerFilter((v) => ({ ...v, status: e.target.value }))}>
                  <option value="">{t("page.intelligence.allStatus")}</option>
                  {["queued", "pending_local", "running", "completed", "failed", "canceled"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className={inputClass} value={workerFilter.type} onChange={(e) => setWorkerFilter((v) => ({ ...v, type: e.target.value }))}>
                  <option value="">{t("page.intelligence.allTypes")}</option>
                  {(workerTypes.data?.items ?? []).map((row: any) => <option key={row.id} value={row.id}>{row.id}</option>)}
                </select>
                <MiniButton onClick={() => setWorkerFilter({ status: "", type: "" })}>{t("common.reset")}</MiniButton>
              </div>
              {workerJobs.isError ? <Err message={(workerJobs.error as Error).message} /> : null}
              <ul className="space-y-3 text-sm">
                {(workerJobs.data?.items ?? []).map((job: any) => (
                  <li key={String(job.id)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{job.id}</p>
                        <p className="mt-1 text-xs text-slate-500">{job.type} · {job.updated_at || job.created_at} · attempt {job.attempt ?? 1}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${job.status === "completed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : job.status === "failed" || job.status === "canceled" ? "bg-rose-500/10 text-rose-700 dark:text-rose-200" : "bg-amber-500/10 text-amber-700 dark:text-amber-200"}`}>{job.status}</span>
                    </div>
                    {job.note ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">{job.note}</p> : null}
                    {job.error ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-200">{job.error}</p> : null}
                    <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-slate-950 p-2 text-[11px] text-slate-100">{JSON.stringify({ payload: job.payload, result: job.result }, null, 2)}</pre>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!["completed", "failed", "canceled"].includes(String(job.status)) ? (
                        <MiniButton disabled={cancelWorker.isPending} onClick={() => cancelWorker.mutate(String(job.id))}>
                          <Ban className="h-4 w-4" />
                          {t("page.intelligence.workerCancel")}
                        </MiniButton>
                      ) : null}
                      <MiniButton disabled={retryWorker.isPending} onClick={() => retryWorker.mutate(String(job.id))}>
                        <RotateCw className="h-4 w-4" />
                        {t("page.intelligence.workerRetry")}
                      </MiniButton>
                    </div>
                  </li>
                ))}
                {workerJobs.isSuccess && !workerJobs.data?.items?.length ? <li className="text-sm text-slate-500">{t("page.intelligence.workerEmpty")}</li> : null}
              </ul>
              {cancelWorker.isError ? <Err message={(cancelWorker.error as Error).message} /> : null}
              {retryWorker.isError ? <Err message={(retryWorker.error as Error).message} /> : null}
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "sync" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <WorkerMetric label={t("page.intelligence.syncModules")} value={String(syncHealth.data?.modules?.length ?? syncModules.data?.items?.length ?? 0)} />
            <WorkerMetric label={t("page.intelligence.syncJournal")} value={String(syncSummary.data?.journal?.total ?? syncJournal.data?.total ?? 0)} />
            <WorkerMetric label={t("page.intelligence.syncProject")} value={String(syncSummary.data?.project_id ?? "-")} />
            <WorkerMetric label="WSS" value={syncSummary.data?.wss?.event_prefix || "sop.sync."} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem] 2xl:grid-cols-[minmax(0,1fr)_32rem]">
            <div className="space-y-4">
              <Card
                title={t("page.intelligence.syncOverview")}
                actions={<MiniButton onClick={() => { void syncSummary.refetch(); void syncJournal.refetch(); }}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}
              >
                {syncSummary.isError ? <Err message={(syncSummary.error as Error).message} /> : null}
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(syncSummary.data?.modules ?? syncModules.data?.items ?? []).map((row: any) => (
                    <div key={row.id} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{row.id}</p>
                        <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] text-brand-700 dark:text-brand-200">{row.kind}</span>
                      </div>
                      <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">{row.count ?? 0}</p>
                      <p className="mt-1 min-h-8 text-xs leading-4 text-slate-500">{row.description}</p>
                      {row.newest ? <p className="mt-2 truncate text-[11px] text-slate-400">{row.newest}</p> : null}
                    </div>
                  ))}
                </div>
              </Card>
              <Card title={t("page.intelligence.syncPull")}>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_14rem_7rem]">
                  <input className={inputClass} value={syncDraft.modules} onChange={(e) => setSyncDraft((v) => ({ ...v, modules: e.target.value }))} placeholder="tasks,rules,specs" />
                  <input className={inputClass} value={syncDraft.cursor} onChange={(e) => setSyncDraft((v) => ({ ...v, cursor: e.target.value }))} placeholder="cursor" />
                  <input className={inputClass} value={syncDraft.limit} onChange={(e) => setSyncDraft((v) => ({ ...v, limit: e.target.value }))} />
                </div>
                <div className="mt-3">
                  <PrimaryButton disabled={pullSync.isPending} onClick={() => pullSync.mutate()}>
                    <RotateCw className="h-4 w-4" />
                    {t("page.intelligence.syncPullRun")}
                  </PrimaryButton>
                </div>
                {pullSync.isError ? <Err message={(pullSync.error as Error).message} /> : null}
                {pullSync.data ? <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(pullSync.data, null, 2)}</pre> : null}
              </Card>
            </div>
            <div className="space-y-4">
              <Card title={t("page.intelligence.syncAssetPush")}>
                <div className="space-y-2">
                  <select className={`${inputClass} w-full`} value={syncAssetDraft.module} onChange={(e) => setSyncAssetDraft((v) => ({ ...v, module: e.target.value }))}>
                    {["rules", "specs", "templates"].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input className={`${inputClass} w-full`} value={syncAssetDraft.path} onChange={(e) => setSyncAssetDraft((v) => ({ ...v, path: e.target.value }))} placeholder="RULES.md" />
                  <textarea className={`${inputClass} min-h-[10rem] w-full font-mono text-xs`} value={syncAssetDraft.content} onChange={(e) => setSyncAssetDraft((v) => ({ ...v, content: e.target.value }))} placeholder={t("page.intelligence.syncAssetContent")} />
                  <PrimaryButton disabled={pushSyncAsset.isPending || !syncAssetDraft.path.trim() || !syncAssetDraft.content.trim()} onClick={() => pushSyncAsset.mutate()}>
                    <UploadCloud className="h-4 w-4" />
                    {t("page.intelligence.syncPushRun")}
                  </PrimaryButton>
                  {pushSyncAsset.isError ? <Err message={(pushSyncAsset.error as Error).message} /> : null}
                  {pushSyncAsset.data ? <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(pushSyncAsset.data, null, 2)}</pre> : null}
                </div>
              </Card>
              <Card title={t("page.intelligence.syncJournalList")}>
                {syncJournal.isError ? <Err message={(syncJournal.error as Error).message} /> : null}
                <ul className="space-y-2 text-sm">
                  {(syncJournal.data?.items ?? syncSummary.data?.journal?.latest ?? []).map((row: any) => (
                    <li key={String(row.id)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{row.module}.{row.action}</span>
                        <span className="text-[11px] text-slate-500">{row.ts || row.time || row.created_at}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">{row.record_id || row.id}</p>
                    </li>
                  ))}
                  {syncJournal.isSuccess && !syncJournal.data?.items?.length ? <li className="text-sm text-slate-500">{t("page.intelligence.syncEmpty")}</li> : null}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "db" ? (
        <div className="space-y-4">
          <Card title={t("page.intelligence.dbDrivers")}><pre className="max-h-52 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(dbDrivers.data ?? {}, null, 2)}</pre></Card>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]">
            <Card title={t("page.intelligence.dbConnections")} actions={<MiniButton onClick={() => void dbConnections.refetch()}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}>
              {dbConnections.isError ? <Err message={(dbConnections.error as Error).message} /> : null}
              <ul className="space-y-2 text-sm">
                {(dbConnections.data?.items ?? []).map((row: any) => (
                  <li key={String(row.name)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><span className="font-medium">{row.name}</span><span className="ml-2 text-xs text-slate-500">{row.type} · {row.role} · {(row.capabilities ?? []).join(",")}</span></div>
                      <MiniButton onClick={() => testDb.mutate({ name: row.name, url: testUrls[row.name] ?? "" })}>{t("page.intelligence.test")}</MiniButton>
                    </div>
                    <input className={`${inputClass} mt-2 w-full`} placeholder="temporary url for test" value={testUrls[row.name] ?? ""} onChange={(e) => setTestUrls((v) => ({ ...v, [row.name]: e.target.value }))} />
                    <p className="mt-1 text-xs text-slate-500">{row.host}:{row.port} / {row.database} / {row.secret_ref || row.url_env}</p>
                  </li>
                ))}
              </ul>
              {testDb.data ? <pre className="mt-3 rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(testDb.data, null, 2)}</pre> : null}
              {testDb.isError ? <Err message={(testDb.error as Error).message} /> : null}
            </Card>
            <Card title={t("page.intelligence.dbCreate")}>
              <div className="space-y-2">
                {(["name", "type", "role", "capability", "host", "port", "database", "username", "secret_ref"] as const).map((key) => (
                  <input key={key} className={`${inputClass} w-full`} placeholder={key} value={dbDraft[key]} onChange={(e) => setDbDraft((v) => ({ ...v, [key]: e.target.value }))} />
                ))}
                <PrimaryButton disabled={!dbDraft.name.trim() || saveDb.isPending} onClick={() => saveDb.mutate()}>{t("common.save")}</PrimaryButton>
                {saveDb.isError ? <Err message={(saveDb.error as Error).message} /> : null}
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "events" ? (
        <Card title={t("page.intelligence.eventsList")} actions={<MiniButton onClick={() => void events.refetch()}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}>
          {events.isError ? <Err message={(events.error as Error).message} /> : null}
          <ul className="space-y-2 text-sm">
            {(events.data?.items ?? []).map((row: any) => {
              const payload = row.payload ?? row;
              return <li key={String(row.id ?? payload.id)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"><span className="text-xs text-slate-500">{row.ts ?? payload.time}</span><p className="font-medium">{payload.type ?? row.action}</p><pre className="mt-1 max-h-32 overflow-auto text-xs">{JSON.stringify(payload.data ?? payload, null, 2)}</pre></li>;
            })}
          </ul>
        </Card>
      ) : null}

      {tab === "usage" ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {Object.keys(pieToRecord(usageCharts.data?.by_metric)).length ? (
              <WorkbenchPanel title={t("page.intelligence.usageByMetric")}>
                <Suspense fallback={<LoadingBlock />}>
                  <EChartsDonutLazy data={pieToRecord(usageCharts.data?.by_metric)} height={220} />
                </Suspense>
              </WorkbenchPanel>
            ) : null}
            {Object.keys(pieToRecord(usageCharts.data?.by_source)).length ? (
              <WorkbenchPanel title={t("page.intelligence.usageBySource")}>
                <Suspense fallback={<LoadingBlock />}>
                  <EChartsDonutLazy data={pieToRecord(usageCharts.data?.by_source)} height={220} />
                </Suspense>
              </WorkbenchPanel>
            ) : null}
            {usageTrend ? (
              <WorkbenchPanel title={t("page.intelligence.usageTrend")} className="lg:col-span-2">
                <Suspense fallback={<LoadingBlock />}>
                  <EChartsBarLazy categories={usageTrend.categories} series={usageTrend.series} asLine height={240} />
                </Suspense>
              </WorkbenchPanel>
            ) : null}
          </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]">
          <Card title={t("page.intelligence.usageSummary")} actions={<MiniButton onClick={() => { void usage.refetch(); void usageCharts.refetch(); void quota.refetch(); void usageAlerts.refetch(); }}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}>
            {usage.isError ? <Err message={(usage.error as Error).message} /> : null}
            {usageAlertTasks.data && !usageAlertTasks.data.dry_run ? <Alert className="mb-3" type="success" showIcon message={t("page.intelligence.usageTasksCreated", { count: usageAlertTasks.data.created ?? 0 })} /> : null}
            {usageAlertTasks.error ? <Alert className="mb-3" type="error" showIcon message={(usageAlertTasks.error as Error).message} /> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(usage.data?.totals ?? {}).map(([metric, used]) => {
                const limit = Number(quota.data?.limits?.[metric] ?? 0);
                const ratio = limit > 0 ? Math.round((Number(used) / limit) * 100) : 0;
                return (
                  <div key={metric} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-xs text-slate-500">{metric}</div>
                    <div className="mt-1 text-lg font-semibold">{String(used)}</div>
                    {limit > 0 ? <Progress className="mt-2" percent={Math.min(100, ratio)} size="small" status={ratio >= 100 ? "exception" : ratio >= 80 ? "active" : "normal"} /> : null}
                    {limit > 0 ? <div className="mt-1 text-xs text-slate-500">{t("page.intelligence.quotaLimit")}: {limit}</div> : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{t("page.intelligence.usageAlerts")}</p>
                  <p className="text-xs text-slate-500">{t("page.intelligence.usageAlertsHint")}</p>
                </div>
                <Space wrap>
                  <Button size="small" disabled={!usageAlerts.data?.items?.length} loading={usageAlertTasks.isPending} onClick={() => usageAlertTasks.mutate(true)}>{t("page.intelligence.previewUsageTasks")}</Button>
                  <Button size="small" type="primary" disabled={!usageAlerts.data?.items?.length} loading={usageAlertTasks.isPending} onClick={() => usageAlertTasks.mutate(false)}>{t("page.intelligence.createUsageTasks")}</Button>
                </Space>
              </div>
              <Table
                size="small"
                rowKey={(row: any) => String(row.id)}
                loading={usageAlerts.isLoading}
                dataSource={usageAlerts.data?.items ?? []}
                pagination={{ pageSize: 5, showSizeChanger: true }}
                scroll={{ x: 760 }}
                locale={{ emptyText: t("page.intelligence.noUsageAlerts") }}
                columns={[
                  { title: t("page.intelligence.metric"), dataIndex: "metric", width: 160 },
                  { title: t("page.intelligence.level"), dataIndex: "level", width: 110, render: (value: string) => <Tag color={value === "critical" ? "red" : value === "high" ? "orange" : "gold"}>{value}</Tag> },
                  { title: t("page.intelligence.usageRatio"), dataIndex: "ratio", width: 120, render: (value: number) => `${value}%` },
                  { title: t("page.intelligence.remaining"), dataIndex: "remaining", width: 140 },
                  { title: t("page.intelligence.recommendation"), dataIndex: "recommendation" },
                ]}
              />
            </div>
            <div className="mt-4">
              <Table
                size="small"
                rowKey={(row: any) => row.source}
                dataSource={Object.entries(usage.data?.by_source ?? {}).map(([source, metrics]) => ({ source, ...(metrics as Record<string, number>) }))}
                pagination={{ pageSize: 5, showSizeChanger: true }}
                scroll={{ x: 720 }}
                columns={[
                  { title: t("page.intelligence.source"), dataIndex: "source", width: 180 },
                  ...Object.keys(usage.data?.totals ?? {}).map((metric) => ({ title: metric, dataIndex: metric, render: (value: number) => value ?? 0 })),
                ]}
              />
            </div>
          </Card>
          <Card title={t("page.intelligence.quotaEdit")}>
            <textarea className={`${inputClass} min-h-[10rem] w-full font-mono`} value={quotaDraft} onChange={(e) => setQuotaDraft(e.target.value)} />
            <div className="mt-2"><PrimaryButton disabled={setQuota.isPending} onClick={() => setQuota.mutate()}>{t("common.save")}</PrimaryButton></div>
            {setQuota.isError ? <Err message={(setQuota.error as Error).message} /> : null}
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ quota: quota.data, remaining: usage.data?.remaining }, null, 2)}</pre>
          </Card>
          <Modal
            open={usageTaskPreview.length > 0}
            title={t("page.intelligence.usageTaskPreview")}
            onCancel={() => setUsageTaskPreview([])}
            footer={<Button type="primary" onClick={() => setUsageTaskPreview([])}>{t("common.close")}</Button>}
            width={820}
          >
            <Table
              size="small"
              rowKey={(row: any) => `${row.source_report_id}-${row.title}`}
              dataSource={usageTaskPreview}
              pagination={false}
              scroll={{ x: 760, y: 420 }}
              columns={[
                { title: t("tasks.task"), dataIndex: "title" },
                { title: t("tasks.priority"), dataIndex: "priority", width: 100 },
                { title: t("tasks.assignee"), dataIndex: "assigned_to", width: 140 },
                { title: t("tasks.source"), dataIndex: "source", width: 160 },
              ]}
            />
          </Modal>
        </div>
        </div>
      ) : null}
    </div>
  );
}

function MemoryList({ rows }: { rows: any[] }) {
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {rows.map((row: any) => (
        <li key={String(row.id)} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-xs text-slate-500">{row.kind} · {row.createdAt ?? ""}</span>
          <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{row.content}</p>
        </li>
      ))}
    </ul>
  );
}

function WorkerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}
