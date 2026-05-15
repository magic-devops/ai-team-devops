import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Card } from "../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton, SearchInput } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken, setProjectId } from "../lib/authStorage";

export function Projects() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const currentPid = getProjectId();
  const [keyword, setKeyword] = useState("");

  const q = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
    enabled: authed,
  });

  const filtered = useMemo(() => {
    const list = q.data ?? [];
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter(
      (p: { id?: string; name?: string }) =>
        String(p.name ?? "").toLowerCase().includes(k) || String(p.id ?? "").toLowerCase().includes(k),
    );
  }, [q.data, keyword]);

  if (!authed) return <NeedLogin />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card
        title={t("page.projects.list")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={keyword} onChange={setKeyword} placeholder={t("page.projects.searchPh")} />
            <RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />
          </div>
        }
      >
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t("page.projects.hint")}</p>
        {q.isLoading ? <LoadingBlock /> : null}
        {q.error ? <ErrorBlock message={(q.error as Error).message} /> : null}
        {!q.isLoading && !q.error && filtered.length === 0 ? (
          <EmptyState message={t("page.projects.empty")} />
        ) : null}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {filtered.map((p: { id: string; name: string; status?: string }) => {
            const active = currentPid === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 py-3 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                    active ? "bg-brand-50/80 dark:bg-brand-950/20" : ""
                  }`}
                  onClick={() => setProjectId(p.id)}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
                    <p className="font-mono text-[10px] text-slate-400">{p.id}</p>
                    {p.status ? <p className="mt-0.5 text-xs text-slate-500">{p.status}</p> : null}
                  </div>
                  {active ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                      <Check className="h-3 w-3" />
                      {t("page.projects.current")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-brand-600 dark:text-brand-400">
                      {t("page.projects.select")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
