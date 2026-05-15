import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { NeedLogin } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

function Err({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </div>
  );
}

export function Intelligence() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"kb" | "rag" | "mem">("kb");
  const [qKb, setQKb] = useState("");
  const [qRag, setQRag] = useState("");
  const [qMem, setQMem] = useState("");
  const [newMem, setNewMem] = useState("");
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());

  const memHealth = useQuery({ queryKey: ["memHealth"], queryFn: api.memoryHealth, enabled: authed });
  const memRecent = useQuery({
    queryKey: ["memRecent"],
    queryFn: () => api.memoryRecent(40),
    enabled: authed && tab === "mem",
  });
  const kbSearch = useQuery({
    queryKey: ["kbSearch", qKb],
    queryFn: () => api.knowledgeSearch(qKb),
    enabled: authed && tab === "kb" && qKb.trim().length >= 1,
  });

  const ragSearch = useQuery({
    queryKey: ["ragSearch", qRag],
    queryFn: () => api.ragSearch(qRag),
    enabled: authed && tab === "rag" && qRag.trim().length >= 1,
  });

  const indexKb = useMutation({
    mutationFn: () => api.workerEnqueue("kb.index", {}),
  });

  const memSearch = useQuery({
    queryKey: ["memSearch", qMem],
    queryFn: () => api.memorySearch(qMem, 25),
    enabled: authed && tab === "mem" && qMem.trim().length >= 1,
  });

  const addMem = useMutation({
    mutationFn: () => api.memoryAdd({ content: newMem.trim(), kind: "long", metadata: { source: "manager-web" } }),
    onSuccess: () => {
      setNewMem("");
      void qc.invalidateQueries({ queryKey: ["memRecent"] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-700 dark:text-brand-300">
          <Brain className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t("page.intelligence.title")}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{t("page.intelligence.subtitle")}</p>
        </div>
      </div>

      {!authed ? <NeedLogin /> : null}
      {authed && !hasProject ? (
        <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>
      ) : null}

      <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            tab === "kb"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
          onClick={() => setTab("kb")}
        >
          {t("page.intelligence.tabKb")}
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            tab === "rag"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
          onClick={() => setTab("rag")}
        >
          {t("page.intelligence.tabRag")}
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            tab === "mem"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
          onClick={() => setTab("mem")}
        >
          {t("page.intelligence.tabMem")}
        </button>
      </div>

      {tab === "kb" ? (
        <Card>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t("page.intelligence.kbHint")}</p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
              disabled={indexKb.isPending}
              onClick={() => indexKb.mutate()}
            >
              {t("page.intelligence.indexKb")}
            </button>
            {indexKb.data?.job_id ? (
              <span className="text-xs text-slate-500">job: {indexKb.data.job_id}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              placeholder={t("page.intelligence.kbPh")}
              value={qKb}
              onChange={(e) => setQKb(e.target.value)}
            />
          </div>
          {kbSearch.isError ? <Err message={(kbSearch.error as Error).message} /> : null}
          <ul className="mt-4 space-y-2 text-sm">
            {(kbSearch.data ?? []).map((row: any) => (
              <li
                key={String(row.id ?? row.path)}
                className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100">{row.category ?? "—"}</span>
                <span className="ml-2 text-slate-500">{row.path}</span>
                <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">{row.content}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : tab === "rag" ? (
        <Card>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            placeholder={t("page.intelligence.ragPh")}
            value={qRag}
            onChange={(e) => setQRag(e.target.value)}
          />
          {ragSearch.isError ? <Err message={(ragSearch.error as Error).message} /> : null}
          <ul className="mt-4 space-y-2 text-sm">
            {(ragSearch.data?.items ?? []).map((row: any) => (
              <li
                key={`${row.collection}-${row.id}`}
                className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
              >
                <span className="text-xs text-slate-500">
                  {row.collection} · {typeof row.score === "number" ? row.score.toFixed(3) : ""}
                </span>
                <p className="mt-1 font-medium">{row.title}</p>
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{row.snippet}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <p className="text-xs text-slate-500">
              memory / health: {memHealth.isSuccess ? JSON.stringify(memHealth.data) : "—"}
            </p>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t("page.intelligence.memAdd")}
            </h2>
            <textarea
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              rows={3}
              value={newMem}
              onChange={(e) => setNewMem(e.target.value)}
              placeholder={t("page.intelligence.memAddPh")}
            />
            <button
              type="button"
              className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              disabled={!newMem.trim() || addMem.isPending}
              onClick={() => addMem.mutate()}
            >
              {t("common.save")}
            </button>
            {addMem.isError ? <Err message={(addMem.error as Error).message} /> : null}
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t("page.intelligence.memSearch")}
            </h2>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={qMem}
              onChange={(e) => setQMem(e.target.value)}
              placeholder={t("page.intelligence.memSearchPh")}
            />
            {memSearch.isError ? <Err message={(memSearch.error as Error).message} /> : null}
            <ul className="mt-3 space-y-2 text-sm">
              {(memSearch.data?.items ?? []).map((row: any) => (
                <li
                  key={String(row.id)}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <span className="text-xs text-slate-500">{row.kind}</span>
                  <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{row.content}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t("page.intelligence.memRecent")}
            </h2>
            {memRecent.isError ? <Err message={(memRecent.error as Error).message} /> : null}
            <ul className="space-y-2 text-sm">
              {(memRecent.data?.items ?? []).map((row: any) => (
                <li
                  key={String(row.id)}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <span className="text-xs text-slate-500">{row.createdAt ?? ""}</span>
                  <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{row.content}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
