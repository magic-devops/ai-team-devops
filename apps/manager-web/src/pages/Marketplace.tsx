import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock, SearchInput } from "../components/PageStates";
import { api } from "../lib/api";

export function Marketplace() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["mp", q],
    queryFn: () => api.marketplaceList(q),
  });

  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card
        title={t("page.marketplace.title")}
        actions={<SearchInput value={q} onChange={setQ} placeholder={t("page.marketplace.searchPh")} />}
      >
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t("page.marketplace.hint")}</p>
        {list.isLoading ? <LoadingBlock /> : null}
        {list.error ? <ErrorBlock message={(list.error as Error).message} /> : null}
        {items.length === 0 && !list.isLoading && !list.error ? (
          <EmptyState message={t("page.marketplace.empty")} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((p: { name: string; version?: string; type?: string; description?: string; rating?: { avg?: number; count?: number } }) => (
              <article
                key={`${p.name}-${p.version}`}
                className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900/80 dark:to-slate-900/40"
              >
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {p.name}{" "}
                  <span className="text-xs font-normal text-slate-500">v{p.version ?? "?"}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{p.type}</div>
                <p className="mt-2 line-clamp-3 text-sm text-slate-700 dark:text-slate-300">{p.description}</p>
                <div className="mt-3 text-xs text-slate-500">
                  ⭐ {p.rating?.avg ?? 0} · {p.rating?.count ?? 0} {t("page.marketplace.ratings")}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
