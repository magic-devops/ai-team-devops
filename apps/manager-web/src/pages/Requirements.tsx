import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  NeedLogin,
  RefreshButton,
  SearchInput,
} from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

const STATUS_ALL = "__all__";

export function Requirements() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState(STATUS_ALL);

  const q = useQuery({
    queryKey: ["requirements"],
    queryFn: api.requirements,
    enabled: authed && hasProject,
  });

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const r of q.data ?? []) {
      if (r.status) set.add(String(r.status));
    }
    return Array.from(set).sort();
  }, [q.data]);

  const filtered = useMemo(() => {
    let list = q.data ?? [];
    if (status !== STATUS_ALL) list = list.filter((r: { status?: string }) => r.status === status);
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter(
      (r: { title?: string; id?: string; description?: string }) =>
        String(r.title ?? "").toLowerCase().includes(k) ||
        String(r.id ?? "").toLowerCase().includes(k) ||
        String(r.description ?? "").toLowerCase().includes(k),
    );
  }, [q.data, keyword, status]);

  if (!authed) return <NeedLogin />;
  if (!hasProject) {
    return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card
        title={t("page.requirements.list")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={keyword} onChange={setKeyword} />
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value={STATUS_ALL}>{t("page.requirements.allStatus")}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />
          </div>
        }
      >
        {q.isLoading ? <LoadingBlock /> : null}
        {q.error ? <ErrorBlock message={(q.error as Error).message} /> : null}
        {!q.isLoading && !q.error && filtered.length === 0 ? (
          <EmptyState message={t("page.requirements.empty")} />
        ) : null}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {filtered.map((r: { id: string; title?: string; status?: string; priority?: string; description?: string }) => (
            <li key={r.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium dark:bg-slate-800">
                  {r.priority ?? "P?"}
                </span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{r.title}</span>
                <span className="rounded px-1.5 py-0.5 text-xs bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                  {r.status}
                </span>
              </div>
              {r.description ? (
                <p className="mt-1 line-clamp-2 text-slate-600 dark:text-slate-400">{r.description}</p>
              ) : null}
              <p className="mt-1 font-mono text-[10px] text-slate-400">{r.id}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
