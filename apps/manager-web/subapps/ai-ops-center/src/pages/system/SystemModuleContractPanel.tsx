import { Button, Segmented, Tag } from "antd";
import { Bot, FileText, ShieldCheck, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

type ContractPanel = "manifest" | "capabilities" | "actions";

type Props = {
  activePanel: ContractPanel;
  manifestData?: any;
  actionsData?: any;
  actionRunsData?: any;
  capabilityRows: any[];
  capabilitySummary?: any;
  roleCount?: number;
  currentRole: string;
  visibleCapabilities?: number | string;
  actionPlan?: any;
  actionResult?: any;
  planPending: boolean;
  executePending: boolean;
  canRunModuleAction: (item: any) => boolean;
  onPanelChange: (panel: ContractPanel) => void;
  onPreviewAction: (moduleId: string, actionId: string) => void;
  onExecuteAction: (moduleId: string, actionId: string) => void;
  onRefreshActionRuns: () => void;
};

function CompactMetric({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-[var(--text)]">{String(value ?? "-")}</p>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: any }) {
  return (
    <div className="min-w-0 rounded-lg bg-[var(--control-bg)] px-3 py-2">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-mono text-xs text-[var(--text)]">{String(value ?? "-")}</p>
    </div>
  );
}

function PermissionBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>
      {label}
    </span>
  );
}

export function SystemModuleContractPanel({
  activePanel,
  manifestData,
  actionsData,
  actionRunsData,
  capabilityRows,
  capabilitySummary,
  roleCount,
  currentRole,
  visibleCapabilities,
  actionPlan,
  actionResult,
  planPending,
  executePending,
  canRunModuleAction,
  onPanelChange,
  onPreviewAction,
  onExecuteAction,
  onRefreshActionRuns,
}: Props) {
  const { t } = useTranslation();
  const actionItems = actionsData?.items ?? [];
  const panels: Array<{ id: ContractPanel; icon: any; title: string; description: string; count: any }> = [
    {
      id: "manifest",
      icon: FileText,
      title: t("page.systemMap.contractPanel.manifestTitle"),
      description: t("page.systemMap.contractPanel.manifestDescription"),
      count: manifestData?.quality?.visible_module_count ?? manifestData?.modules?.length ?? 0,
    },
    {
      id: "capabilities",
      icon: ShieldCheck,
      title: t("page.systemMap.contractPanel.capabilitiesTitle"),
      description: t("page.systemMap.contractPanel.capabilitiesDescription"),
      count: capabilitySummary?.total ?? capabilityRows.length,
    },
    {
      id: "actions",
      icon: Zap,
      title: t("page.systemMap.contractPanel.actionsTitle"),
      description: t("page.systemMap.contractPanel.actionsDescription"),
      count: actionsData?.summary?.actions ?? 0,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.contractPanel.title")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.systemMap.contractPanel.subtitle")}</p>
          </div>
          <Segmented
            value={activePanel}
            onChange={(value) => onPanelChange(value as ContractPanel)}
            options={panels.map((panel) => ({ label: panel.title, value: panel.id }))}
          />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {panels.map((panel) => {
            const Icon = panel.icon;
            const active = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                onClick={() => onPanelChange(panel.id)}
                className={`rounded-lg border px-3 py-3 text-left transition hover:border-[var(--brand)] ${active ? "border-[var(--brand)] bg-[var(--surface)]" : "border-[var(--border)] bg-[var(--control-bg)]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`rounded-lg p-2 ${active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--surface-muted)] text-[var(--muted-strong)]"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="font-mono text-sm font-semibold text-[var(--brand)]">{panel.count}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-[var(--text)]">{panel.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{panel.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {activePanel === "manifest" ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="grid gap-2 sm:grid-cols-2">
            <CompactMetric label={t("page.systemMap.manifestVersion")} value={manifestData?.version} />
            <CompactMetric label={t("page.systemMap.visibleModules")} value={manifestData?.quality?.visible_module_count ?? manifestData?.modules?.length ?? 0} />
            <CompactMetric label={t("page.systemMap.legacyModules")} value={manifestData?.legacy_modules?.length ?? 0} />
            <CompactMetric label={t("page.systemMap.codeSplitting")} value={manifestData?.frontend?.code_splitting ? "on" : "off"} />
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.moduleManifestHint")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(manifestData?.frontend?.chunk_strategy ?? []).map((chunk: string) => (
                <span key={chunk} className="rounded-full bg-[var(--control-bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--muted-strong)]">{chunk}</span>
              ))}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <InfoLine label={t("page.systemMap.registrySource")} value={manifestData?.frontend?.module_registry_source} />
              <InfoLine label={t("page.systemMap.securitySource")} value={manifestData?.security?.capability_check} />
            </div>
          </div>
          {manifestData?.ai?.agent_consumption ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className="mt-0.5 rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Bot className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.agentConsumption")}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{manifestData.ai.agent_consumption.purpose}</p>
                  </div>
                </div>
                <code className="max-w-full truncate rounded-lg bg-[var(--control-bg)] px-2.5 py-1 text-xs text-[var(--text)]">{manifestData.ai.agent_consumption.refresh_command}</code>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {Object.entries(manifestData.ai.agent_consumption.local_files ?? {}).map(([key, value]) => (
                  <InfoLine key={key} label={key} value={value} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activePanel === "capabilities" ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <CompactMetric label={t("page.systemMap.capabilityTotal")} value={capabilitySummary?.total ?? capabilityRows.length} />
            <CompactMetric label={t("page.systemMap.submoduleTotal")} value={capabilitySummary?.submodules} />
            <CompactMetric label={t("page.systemMap.actionPermissionTotal")} value={capabilitySummary?.actions} />
            <CompactMetric label={t("page.systemMap.aiEnabled")} value={capabilitySummary?.ai_enabled} />
            <CompactMetric label={t("page.systemMap.roleCount")} value={roleCount ?? 5} />
            <CompactMetric label={t("page.systemMap.visibleCapabilities")} value={visibleCapabilities} />
          </div>
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <div className="hidden grid-cols-[1fr_1fr_1.1fr_1.1fr_1.2fr] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)] lg:grid">
              <span>{t("page.systemMap.module")}</span>
              <span>{t("page.systemMap.capabilityCode")}</span>
              <span>{t("page.systemMap.submodules")}</span>
              <span>{t("page.systemMap.permissionRoles")}</span>
              <span>{t("page.systemMap.aiSurfaces")}</span>
            </div>
            {capabilityRows.slice(0, 12).map((item: any) => {
              const canRead = (item.permission?.read ?? []).includes(currentRole);
              const canWrite = (item.permission?.write ?? []).includes(currentRole);
              const canAdmin = (item.permission?.admin ?? []).includes(currentRole);
              return (
                <article key={item.id} className="grid gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0 lg:grid-cols-[1fr_1fr_1.1fr_1.1fr_1.2fr]">
                  <div className="min-w-0">
                    <a href={item.path} className="truncate text-sm font-semibold text-[var(--text)] hover:text-[var(--brand)]">{item.name}</a>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">{item.domain_name}</p>
                  </div>
                  <code className="min-w-0 truncate rounded-lg bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--brand)]">{item.capability}</code>
                  <div className="flex flex-wrap gap-1">
                    {(item.submodules ?? []).slice(0, 4).map((sub: any) => (
                      <span key={sub.id} className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] text-[var(--muted-strong)]">{sub.name}</span>
                    ))}
                    {(item.submodules ?? []).length > 4 ? <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]">+{(item.submodules ?? []).length - 4}</span> : null}
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex flex-wrap gap-1">
                      <PermissionBadge active={canRead} label={t("page.systemMap.read")} />
                      <PermissionBadge active={canWrite} label={t("page.systemMap.write")} />
                      <PermissionBadge active={canAdmin} label={t("page.systemMap.admin")} />
                    </div>
                    <p className="line-clamp-1 text-[var(--muted)]">{(item.permission?.read ?? []).join(", ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(item.ai?.surfaces ?? []).slice(0, 5).map((surface: string) => (
                      <span key={surface} className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]">{surface}</span>
                    ))}
                  </div>
                </article>
              );
            })}
            {!capabilityRows.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.systemMap.noCapabilities")}</div> : null}
          </div>
        </div>
      ) : null}

      {activePanel === "actions" ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <CompactMetric label={t("page.systemMap.actionTotal")} value={actionsData?.summary?.actions ?? 0} />
            <CompactMetric label={t("page.systemMap.actionAllowed")} value={actionsData?.summary?.allowed ?? 0} />
            <CompactMetric label={t("page.systemMap.actionBlocked")} value={actionsData?.summary?.blocked ?? 0} />
            <CompactMetric label={t("page.systemMap.actionModules")} value={actionsData?.summary?.modules ?? 0} />
          </div>
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <div className="hidden grid-cols-[1fr_1fr_8rem_11rem] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-xs font-semibold text-[var(--muted)] lg:grid">
              <span>{t("page.systemMap.action")}</span>
              <span>{t("page.systemMap.module")}</span>
              <span>{t("page.systemMap.actionType")}</span>
              <span>{t("page.systemMap.actionPlan")}</span>
            </div>
            {actionItems.slice(0, 12).map((item: any) => {
              const runnable = canRunModuleAction(item);
              return (
                <article key={`${item.module_id}-${item.id}`} className="grid gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0 lg:grid-cols-[1fr_1fr_8rem_11rem] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text)]">{item.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{item.description}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--text)]">{item.module_name}</p>
                    <code className="mt-1 block truncate text-xs text-[var(--muted)]">{item.capability}</code>
                  </div>
                  <Tag color={runnable ? "green" : "red"}>{item.type}</Tag>
                  <div className="flex flex-wrap gap-1">
                    <Button size="small" disabled={!runnable} loading={planPending} onClick={() => onPreviewAction(String(item.module_id), String(item.id))}>
                      {t("page.systemMap.previewPlan")}
                    </Button>
                    <Button size="small" type="primary" disabled={!runnable} loading={executePending} onClick={() => onExecuteAction(String(item.module_id), String(item.id))}>
                      {t("page.systemMap.executeAction")}
                    </Button>
                  </div>
                </article>
              );
            })}
            {!actionItems.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.systemMap.noActions")}</div> : null}
          </div>
          {actionPlan ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{actionPlan.action?.name}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{actionPlan.module?.name} · {actionPlan.action?.target}</p>
                </div>
                <Tag color="blue">{actionPlan.role}</Tag>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {(actionPlan.steps ?? []).map((step: any) => (
                  <div key={step.order} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                    <p className="text-xs font-semibold text-[var(--text)]">{step.order}. {step.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{step.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {actionResult ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.actionResult")}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{actionResult.executed ? t("page.systemMap.actionExecuted") : actionResult.reason || actionResult.result?.type || "-"}</p>
            </div>
          ) : null}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.systemMap.actionRuns")}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{t("page.systemMap.actionRunsHint", { total: actionRunsData?.total ?? 0 })}</p>
              </div>
              <Button size="small" onClick={onRefreshActionRuns}>{t("common.refresh")}</Button>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {(actionRunsData?.items ?? []).slice(0, 6).map((run: any) => (
                <article key={run.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[var(--text)]">{run.module_name || run.module_id}</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{run.id}</p>
                    </div>
                    <Tag color={run.executed ? "green" : "gold"}>{run.result_type || "-"}</Tag>
                  </div>
                  <p className="mt-2 truncate text-xs text-[var(--muted-strong)]">{run.action_name || run.action_id}</p>
                </article>
              ))}
              {!actionRunsData?.items?.length ? <div className="text-sm text-[var(--muted)]">{t("page.systemMap.noActionRuns")}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
