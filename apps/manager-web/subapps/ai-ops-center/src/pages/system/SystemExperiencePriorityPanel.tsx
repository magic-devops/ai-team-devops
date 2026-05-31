import { Button, Tag } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2">
      <p className="text-[11px] font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-[var(--muted-strong)]">{value}</p>
    </div>
  );
}

function weakestExperienceDimension(item: any): [string, any] | null {
  const entries = Object.entries(item?.dimensions ?? {}) as Array<[string, any]>;
  if (!entries.length) return null;
  return entries.sort((a, b) => Number(a[1]?.score ?? 100) - Number(b[1]?.score ?? 100))[0] ?? null;
}

export function SystemExperiencePriorityPanel({
  rows,
  agentConsumption,
  summary,
  domainLabel,
  canWrite,
  taskPending,
  onFocusModule,
  onPreviewModuleTask,
  onCreateModuleTask,
}: {
  rows: any[];
  agentConsumption?: any;
  summary?: any;
  domainLabel: (id: string) => string;
  canWrite: boolean;
  taskPending: boolean;
  onFocusModule: (item: any) => void;
  onPreviewModuleTask: (item: any) => void;
  onCreateModuleTask: (item: any) => void;
}) {
  const { t } = useTranslation();
  const topExperienceIssues = useMemo(
    () => rows.filter((item: any) => item.status !== "simple").slice(0, 3),
    [rows],
  );

  return (
    <div className="systemExperiencePriorityPanel experiencePriorityQueue mb-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.experiencePriorityTitle")}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("page.systemMap.experiencePriorityHint")}</p>
          </div>
          <Tag color="blue">{topExperienceIssues.length} focus</Tag>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {topExperienceIssues.map((item: any) => {
            const weak = weakestExperienceDimension(item);
            return (
              <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <a href={item.path} className="line-clamp-1 text-sm font-semibold text-[var(--text)] hover:text-[var(--brand)]">{item.name}</a>
                    <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{item.id} · {domainLabel(String(item.domain))}</p>
                  </div>
                  <Tag color={item.status === "complex" ? "red" : "gold"}>{t(`page.systemMap.experienceStatusValue.${item.status}`)}</Tag>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Info label={t("page.systemMap.experienceScore")} value={String(item.experience_score ?? "-")} />
                  <Info
                    label={t("page.systemMap.experienceWeakestDimension")}
                    value={weak ? `${t(`page.systemMap.experienceDimension.${weak[0]}`)} ${weak[1]?.score ?? "-"}` : "-"}
                  />
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{item.recommendations?.[0] || t("page.systemMap.noReadinessGaps")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="small" onClick={() => onFocusModule(item)}>
                    {t("page.systemMap.focusExperienceModule")}
                  </Button>
                  <Button size="small" loading={taskPending} onClick={() => onPreviewModuleTask(item)}>
                    {t("page.systemMap.previewModuleExperienceTask")}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={taskPending}
                    disabled={!canWrite}
                    title={!canWrite ? t("capability.denied") : undefined}
                    onClick={() => onCreateModuleTask(item)}
                  >
                    {t("page.systemMap.createModuleExperienceTask")}
                  </Button>
                </div>
              </article>
            );
          })}
          {!topExperienceIssues.length ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)] md:col-span-3">
              {t("page.systemMap.noExperienceRows")}
            </div>
          ) : null}
        </div>
      </div>
      <div className="experienceAiChangePack rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.experienceAiChangePack")}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{agentConsumption?.purpose}</p>
        <div className="mt-3 space-y-2">
          <Info label="API" value={agentConsumption?.api ?? "/api/v1/system/pages/experience-review"} />
          <Info label={t("page.systemMap.taskApi")} value={agentConsumption?.task_api ?? "/api/v1/system/pages/experience-review/tasks"} />
          <Info label={t("page.systemMap.experienceMobileRisk")} value={String(summary?.mobile_risk ?? 0)} />
          <Info label={t("page.systemMap.experiencePermissionGap")} value={String(summary?.permission_gap ?? 0)} />
          <Info label={t("page.systemMap.experienceAiEditGap")} value={String(summary?.ai_edit_gap ?? 0)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(agentConsumption?.fields ?? []).slice(0, 5).map((field: string) => (
            <span key={field} className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted-strong)]">{field}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
