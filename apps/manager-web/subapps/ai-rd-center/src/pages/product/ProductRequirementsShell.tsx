import { CheckCircle2, ChevronRight, Library, Rows3, SearchCheck, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RequirementMode } from "../Requirements";
import { requirementsPhaseHref } from "./requirementsNav";

const PHASE_META: Record<
  RequirementMode,
  { icon: LucideIcon; step: number; navKey: string }
> = {
  pool: { icon: Library, step: 1, navKey: "requirementPool" },
  review: { icon: SearchCheck, step: 2, navKey: "requirementReview" },
  generation: { icon: Sparkles, step: 3, navKey: "requirementGeneration" },
  batch: { icon: Rows3, step: 4, navKey: "requirementBatch" },
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

export function ProductRequirementsShell(props: {
  phase: RequirementMode;
  total: number;
  ready: number;
  completed: number;
  completionRate: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const readyPct = props.total > 0 ? Math.round((props.ready / props.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--brand-soft)]/40 via-[var(--surface)] to-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
              {t("page.requirements.kit.badge")}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text)] sm:text-xl">
              {t("page.requirements.kit.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
              {t("page.requirements.kit.desc")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Metric label={t("page.requirements.hubTotal")} value={props.total} />
            <Metric label={t("page.requirements.hubReady")} value={`${readyPct}%`} />
            <Metric label={t("page.requirements.hubCompletion")} value={`${props.completionRate}%`} />
          </div>
        </div>

        <ol className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(PHASE_META) as RequirementMode[]).map((key) => {
            const meta = PHASE_META[key];
            const Icon = meta.icon;
            const active = props.phase === key;
            const done =
              key === "pool"
                ? props.total > 0
                : key === "review"
                  ? props.ready > 0
                  : key === "generation"
                    ? props.completed > 0
                    : props.total > 0 && props.completionRate >= 30;
            return (
              <li key={key}>
                <a
                  href={requirementsPhaseHref(key)}
                  className={`flex h-full items-start gap-3 rounded-lg border px-3 py-3 transition ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-sm"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand)]/50 hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      active ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-muted)] text-[var(--muted-strong)]"
                    }`}
                  >
                    {done && !active ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : meta.step}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">
                      <Icon className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                      {t(`nav.${meta.navKey}`)}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                      {t(`page.requirements.kit.step.${key}`)}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--muted)]" />
                </a>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        {props.children}
      </div>
    </div>
  );
}
