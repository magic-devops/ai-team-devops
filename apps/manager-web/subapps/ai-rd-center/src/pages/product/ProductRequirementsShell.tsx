import { ChevronRight, Library, Rows3, SearchCheck, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RequirementMode } from "../Requirements";
import { requirementsPhaseHref } from "./requirementsNav";

const PHASE_META: Record<RequirementMode, { icon: LucideIcon }> = {
  pool: { icon: Library },
  review: { icon: SearchCheck },
  generation: { icon: Sparkles },
  batch: { icon: Rows3 },
};

const SHELL_LABELS = {
  "zh-CN": {
    title: "需求治理工作台",
    hubTotal: "需求总数",
    hubReady: "含验收标准",
    hubCompleted: "登记完成",
    hubCompletion: "登记完成率",
  },
  "en-US": {
    title: "Requirements workbench",
    hubTotal: "Total requirements",
    hubReady: "With acceptance criteria",
    hubCompleted: "Marked completed",
    hubCompletion: "Marked completion rate",
  },
  "ja-JP": {
    title: "要件ワークベンチ",
    hubTotal: "要件数",
    hubReady: "受け入れ条件あり",
    hubCompleted: "完了に設定",
    hubCompletion: "完了設定率",
  },
} as const;

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums text-[var(--text)]">{value}</dd>
    </div>
  );
}

export function ProductRequirementsShell(props: {
  phase: RequirementMode;
  total: number;
  ready: number;
  completed: number;
  completionRate: number;
  factsReady?: boolean;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n?.resolvedLanguage || i18n?.language || "zh-CN";
  const locale = language.startsWith("ja") ? "ja-JP" : language.startsWith("en") ? "en-US" : "zh-CN";
  const labels = SHELL_LABELS[locale];
  const label = (key: keyof typeof labels) => t(
    `page.requirements.${
      key === "title" ? "kit.title"
        : key === "hubCompleted" ? "kit.recordedCompleted"
          : key === "hubCompletion" ? "kit.recordedCompletionRate" : key
    }`,
    { lng: locale, fallbackLng: false, defaultValue: labels[key] },
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
        <nav aria-label={label("title")}>
          <ol className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {(Object.keys(PHASE_META) as RequirementMode[]).map((key) => {
              const meta = PHASE_META[key];
              const Icon = meta.icon;
              const active = props.phase === key;
              return (
                <li key={key}>
                  <a
                    href={requirementsPhaseHref(key)}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-full min-h-11 items-center gap-2 rounded-lg border px-3 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                      active
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-sm"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand)]/50 hover:bg-[var(--surface-muted)]"
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                    <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--text)]">
                      {t(`page.requirements.mode.${key}.title`)}
                    </span>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
        <p className="text-sm leading-6 text-[var(--muted-strong)]">
          {t(`page.requirements.mode.${props.phase}.hint`)}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--border)] pt-3 sm:grid-cols-4">
          <Metric label={label("hubTotal")} value={props.factsReady === false ? "—" : props.total} />
          <Metric label={label("hubReady")} value={props.factsReady === false ? "—" : `${props.ready} / ${props.total}`} />
          <Metric label={label("hubCompleted")} value={props.factsReady === false ? "—" : props.completed} />
          <Metric label={label("hubCompletion")} value={props.factsReady === false ? "—" : `${props.completionRate}%`} />
        </dl>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        {props.children}
      </div>
    </div>
  );
}
