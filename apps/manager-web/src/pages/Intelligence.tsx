import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Brain, Database, Gauge, Library, Plus, RotateCw, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { NeedLogin } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

type Tab = "kb" | "rag" | "mem" | "rules" | "db" | "events" | "usage";

const tabs: Array<{ key: Tab; icon: typeof Library; labelKey: string }> = [
  { key: "kb", icon: Library, labelKey: "page.intelligence.tabKb" },
  { key: "rag", icon: Search, labelKey: "page.intelligence.tabRag" },
  { key: "mem", icon: Brain, labelKey: "page.intelligence.tabMem" },
  { key: "rules", icon: ShieldCheck, labelKey: "page.intelligence.tabRules" },
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

export function Intelligence() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("kb");
  const [qKb, setQKb] = useState("");
  const [qRag, setQRag] = useState("");
  const [qMem, setQMem] = useState("");
  const [newMem, setNewMem] = useState("");
  const [kbDraft, setKbDraft] = useState({ title: "", content: "", category: "general", tags: "" });
  const [ruleDraft, setRuleDraft] = useState({ rule: "", category: "coding", confidence: "0.75" });
  const [dbDraft, setDbDraft] = useState({ name: "", type: "postgres", role: "business", capability: "sql", host: "", port: "", database: "", username: "", secret_ref: "" });
  const [quotaDraft, setQuotaDraft] = useState("{}");
  const [testUrls, setTestUrls] = useState<Record<string, string>>({});
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());

  const memHealth = useQuery({ queryKey: ["memHealth"], queryFn: api.memoryHealth, enabled: authed });
  const memRecent = useQuery({ queryKey: ["memRecent"], queryFn: () => api.memoryRecent(40), enabled: authed && tab === "mem" });
  const memSearch = useQuery({ queryKey: ["memSearch", qMem], queryFn: () => api.memorySearch(qMem, 25), enabled: authed && tab === "mem" && qMem.trim().length >= 1 });
  const kbSearch = useQuery({ queryKey: ["kbSearch", qKb], queryFn: () => api.knowledgeSearch(qKb), enabled: authed && tab === "kb" && qKb.trim().length >= 1 });
  const ragSearch = useQuery({ queryKey: ["ragSearch", qRag], queryFn: () => api.ragSearch(qRag), enabled: authed && tab === "rag" && qRag.trim().length >= 1 });
  const rules = useQuery({ queryKey: ["rules"], queryFn: api.rules, enabled: authed && tab === "rules" });
  const dbDrivers = useQuery({ queryKey: ["dbDrivers"], queryFn: api.dbDrivers, enabled: authed && tab === "db" });
  const dbConnections = useQuery({ queryKey: ["dbConnections"], queryFn: api.dbConnections, enabled: authed && tab === "db" });
  const events = useQuery({ queryKey: ["events"], queryFn: () => api.eventsList(100), enabled: authed && tab === "events" });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api.usageSummary(5000), enabled: authed && tab === "usage" });
  const quota = useQuery({ queryKey: ["quota"], queryFn: api.usageQuota, enabled: authed && tab === "usage" });

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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_30rem]">
          <Card title={t("page.intelligence.usageSummary")} actions={<MiniButton onClick={() => { void usage.refetch(); void quota.refetch(); }}><RotateCw className="h-4 w-4" />{t("common.refresh")}</MiniButton>}>
            {usage.isError ? <Err message={(usage.error as Error).message} /> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(usage.data?.totals ?? {}).map(([k, v]) => <div key={k} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{String(v)}</div></div>)}
            </div>
            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ quota: quota.data, remaining: usage.data?.remaining, by_source: usage.data?.by_source }, null, 2)}</pre>
          </Card>
          <Card title={t("page.intelligence.quotaEdit")}>
            <textarea className={`${inputClass} min-h-[10rem] w-full font-mono`} value={quotaDraft} onChange={(e) => setQuotaDraft(e.target.value)} />
            <div className="mt-2"><PrimaryButton disabled={setQuota.isPending} onClick={() => setQuota.mutate()}>{t("common.save")}</PrimaryButton></div>
            {setQuota.isError ? <Err message={(setQuota.error as Error).message} /> : null}
          </Card>
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
