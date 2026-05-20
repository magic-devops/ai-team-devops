import { CheckCircle2, ChevronRight, Copy, Sparkles, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "./types";
import { Badge, Metric } from "./ui";

export type DeliveryPhase = "templates" | "onboarding" | "governance";

const PHASE_META: Record<
  DeliveryPhase,
  { href: string; icon: LucideIcon; step: number; navKey: string }
> = {
  templates: { href: "#/projects/templates/overview", icon: Copy, step: 1, navKey: "templates" },
  onboarding: { href: "#/projects/onboarding/overview", icon: Terminal, step: 2, navKey: "onboarding" },
  governance: { href: "#/projects/governance/review", icon: Sparkles, step: 3, navKey: "governance" },
};

export function ProjectDeliveryKitShell(props: {
  phase: DeliveryPhase;
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  templateCount: number;
  onboardingReady: number;
  onboardingTotal: number;
  governanceScore?: number;
  governanceGrade?: string;
  children: ReactNode;
  subNav?: { key: string; label: string; href: string; active: boolean }[];
}) {
  const { t } = useTranslation();
  const selected = props.projects.find((p) => p.id === props.selectedProjectId);
  const readyPct =
    props.onboardingTotal > 0 ? Math.round((props.onboardingReady / props.onboardingTotal) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--brand-soft)]/40 via-[var(--surface)] to-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
              {t("page.projects.deliveryKit.badge")}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text)] sm:text-xl">
              {t("page.projects.deliveryKit.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
              {t("page.projects.deliveryKit.desc")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Metric label={t("page.projects.deliveryKit.metricTemplates")} value={props.templateCount} />
            <Metric
              label={t("page.projects.deliveryKit.metricOnboarding")}
              value={props.selectedProjectId ? `${readyPct}%` : "—"}
            />
            <Metric
              label={t("page.projects.deliveryKit.metricGovernance")}
              value={props.governanceScore != null ? String(props.governanceScore) : "—"}
            />
          </div>
        </div>

        <ol className="mt-5 grid gap-2 sm:grid-cols-3">
          {(Object.keys(PHASE_META) as DeliveryPhase[]).map((key) => {
            const meta = PHASE_META[key];
            const Icon = meta.icon;
            const active = props.phase === key;
            const done =
              key === "templates"
                ? props.templateCount > 0
                : key === "onboarding"
                  ? props.selectedProjectId && readyPct >= 80
                  : props.selectedProjectId && (props.governanceScore ?? 0) >= 70;
            return (
              <li key={key}>
                <a
                  href={meta.href}
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
                      {t(`page.projects.module.${meta.navKey}`)}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                      {t(`page.projects.deliveryKit.step.${key}`)}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--muted)]" />
                </a>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
              {t("page.projects.deliveryKit.projectLabel")}
            </label>
            <select
              className="h-10 w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 text-sm text-[var(--text)]"
              value={props.selectedProjectId}
              onChange={(e) => props.onSelectProject(e.target.value)}
            >
              <option value="">{t("page.projects.selectOnboardingProject")}</option>
              {props.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name || project.id}
                  {project.is_template ? ` · ${t("page.projects.deliveryKit.templateTag")}` : ""}
                </option>
              ))}
            </select>
            {selected ? (
              <p className="mt-2 break-all font-mono text-[11px] text-[var(--muted)]">{selected.id}</p>
            ) : (
              <p className="mt-2 text-xs text-[var(--muted)]">{t("page.projects.deliveryKit.projectHint")}</p>
            )}
          </div>
          {props.phase !== "templates" && props.governanceGrade && props.selectedProjectId ? (
            <Badge
              tone={(props.governanceScore ?? 0) >= 70 ? "brand" : "neutral"}
              label={t(`page.projects.grade.${props.governanceGrade}`, {
                defaultValue: props.governanceGrade,
              })}
            />
          ) : null}
        </div>

        {props.subNav?.length ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
            {props.subNav.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium ${
                  item.active
                    ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                {item.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {props.children}
    </div>
  );
}
