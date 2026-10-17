import { RefreshCw, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Metric } from "./ui";
import { portfolioHash } from "@/lib/projectPortfolioRoute";

export function ProjectHero({ summary, onRefresh, busy }: { summary: any; onRefresh: () => void; busy?: boolean }) {
  const { t } = useTranslation();
  const totals = summary?.entity_totals ?? {};
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">{t("page.projects.workbench")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("page.projects.workbenchHint")}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("page.projects.metricProjects")} value={summary?.total ?? 0} />
        <Metric label={t("page.projects.metricActive")} value={summary?.active ?? 0} />
        <Metric label={t("page.projects.metricTemplates")} value={summary?.templates ?? 0} />
        <Metric label={t("page.projects.metricDelivery")} value={`${totals.requirements ?? 0}/${totals.tasks ?? 0}`} />
      </div>
      {summary?.risks_total > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          <div className="inline-flex items-center gap-2 font-medium">
            <Sparkles className="h-4 w-4" />
            {t("projectPortfolio.risks")} · {summary.risks_total}
          </div>
          <ul className="mt-2 grid gap-1 text-xs">
            {summary.risks.slice(0, 3).map((risk: any, idx: number) => (
              <li key={`${risk.project_id}-${idx}`}><a className="underline" href={portfolioHash({ projectId: risk.project_id })}>{risk.project_id}: {risk.title}</a></li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
