import { Check, Clipboard, ListChecks, ShieldCheck, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../components/PageStates";
import type { TabKey } from "./types";
import { Badge, secondaryBtn, Snippet } from "./ui";

export type GovernancePanelKey = "review" | "ops" | "actions" | "prompt";

export function GovernanceModule(props: {
  selectedProjectId: string;
  data: any;
  loading: boolean;
  error: Error | null;
  opsPlan?: any;
  opsLoading?: boolean;
  opsError?: Error | null;
  copied: string;
  initialPanel?: GovernancePanelKey;
  embedded?: boolean;
  copyText: (label: string, text: string) => void;
  onSelectTab: (tab: TabKey) => void;
  bootstrapResult?: any;
  bootstrapPending?: boolean;
  onBootstrapPreview: () => void;
  onBootstrapCreate: () => void;
  onOpsPreview: () => void;
  onOpsCreate: () => void;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<GovernancePanelKey>(props.initialPanel ?? "review");
  const prompt = props.data?.agent_prompt ?? "";

  useEffect(() => {
    setPanel(props.initialPanel ?? "review");
  }, [props.initialPanel]);

  if (!props.selectedProjectId) {
    return (
      <Card title={t("page.projects.module.governance")}>
        <EmptyState message={t("page.projects.deliveryKit.needProject")} />
        <p className="mt-3 text-sm text-[var(--muted)]">{t("page.projects.deliveryKit.governanceHint")}</p>
      </Card>
    );
  }
  if (props.loading) return <Card><LoadingBlock /></Card>;
  if (props.error) return <Card><ErrorBlock message={props.error.message} /></Card>;
  if (!props.data) return null;

  const showActions = panel === "actions" || panel === "review" || panel === "ops";

  return (
    <div className="space-y-4">
      {!props.embedded ? (
        <Card title={t("page.projects.projectGovernanceWorkbench")}>
          <PanelTabs panel={panel} onPanel={setPanel} data={props.data} opsPlan={props.opsPlan} prompt={prompt} t={t} />
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {panel === "review" ? (
            <Card title={t("page.projects.governanceReview")}>
              <ScoreBanner score={props.data.score ?? 0} grade={props.data.grade} t={t} />
              <div className="mt-4 grid gap-2">
                {(props.data.checks ?? []).map((check: any) => (
                  <div key={check.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex min-w-0 items-center gap-2">
                        {check.ok ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />}
                        <span className="truncate text-sm font-medium text-[var(--text)]">{check.label}</span>
                      </div>
                      <span className="text-xs text-[var(--muted)]">{check.weight}</span>
                    </div>
                    {!check.ok ? <p className="mt-1 text-xs text-[var(--muted)]">{check.recommendation}</p> : null}
                  </div>
                ))}
              </div>
              {(props.data.checks ?? []).some((c: any) => !c.ok) ? (
                <p className="mt-4 text-sm text-[var(--muted)]">
                  {t("page.projects.deliveryKit.fixViaOnboarding")}{" "}
                  <a href="#/projects/onboarding" className="font-medium text-[var(--brand)] hover:underline">
                    {t("page.projects.onboarding")}
                  </a>
                </p>
              ) : null}
            </Card>
          ) : null}

          {panel === "ops" ? (
            <Card title={t("page.projects.opsPlan")}>
              {props.opsLoading ? <LoadingBlock /> : null}
              {props.opsError ? <ErrorBlock message={props.opsError.message} /> : null}
              {props.opsPlan ? (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Stat label={t("page.projects.opsHealth")} value={String(props.opsPlan.health?.score ?? 0)} />
                    <Stat label={t("page.projects.opsTasks")} value={String(props.opsPlan.task_candidates?.length ?? 0)} />
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 sm:col-span-2">
                      <p className="text-xs text-[var(--muted)]">{t("page.projects.opsScope")}</p>
                      <p className="mt-1 break-all font-mono text-xs text-[var(--text)]">
                        {props.opsPlan.scope?.tenant_code || "-"} / {props.opsPlan.scope?.business_code || "*"} / {props.opsPlan.scope?.project_id || "-"}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {(props.opsPlan.commands ?? []).map((cmd: any) => (
                      <button
                        key={cmd.id}
                        type="button"
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-sm hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                        onClick={() => props.copyText(`ops:${cmd.id}`, cmd.command)}
                      >
                        <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                          <Terminal className="h-4 w-4 text-[var(--brand)]" />
                          {cmd.title}
                        </div>
                        <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">{cmd.command}</p>
                        <p className="mt-1 text-xs text-[var(--brand)]">{props.copied === `ops:${cmd.id}` ? t("common.copied") : t("page.projects.copyCommand")}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>
          ) : null}

          {panel === "prompt" ? (
            <Snippet
              title={t("page.projects.agentPrompt")}
              value={prompt}
              copied={props.copied === "agentPrompt"}
              onCopy={() => props.copyText("agentPrompt", prompt)}
            />
          ) : null}

          {panel === "actions" ? (
            <Card title={t("page.projects.nextActions")}>
              <ActionList
                actions={props.data.actions ?? []}
                copied={props.copied}
                copyText={props.copyText}
                onSelectTab={props.onSelectTab}
                t={t}
              />
            </Card>
          ) : null}
        </div>

        {showActions ? (
          <aside className="space-y-4">
            <Card title={t("page.projects.deliveryKit.taskifyTitle")}>
              <p className="mb-3 text-xs leading-5 text-[var(--muted)]">{t("page.projects.deliveryKit.taskifyDesc")}</p>
              <div className="grid grid-cols-1 gap-2">
                <button type="button" className={secondaryBtn} disabled={props.bootstrapPending} onClick={props.onBootstrapPreview}>
                  <ListChecks className="h-4 w-4" />
                  {t("page.projects.previewBootstrap")}
                </button>
                <button type="button" className={secondaryBtn} disabled={props.bootstrapPending} onClick={props.onBootstrapCreate}>
                  <ListChecks className="h-4 w-4" />
                  {t("page.projects.createBootstrap")}
                </button>
                <button type="button" className={secondaryBtn} disabled={props.bootstrapPending} onClick={props.onOpsPreview}>
                  <ListChecks className="h-4 w-4" />
                  {t("page.projects.previewOpsTasks")}
                </button>
                <button type="button" className={secondaryBtn} disabled={props.bootstrapPending} onClick={props.onOpsCreate}>
                  <ListChecks className="h-4 w-4" />
                  {t("page.projects.createOpsTasks")}
                </button>
              </div>
              {props.bootstrapResult ? (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]">
                  {t("page.projects.bootstrapResult", {
                    planned: props.bootstrapResult.summary?.planned ?? 0,
                    created: props.bootstrapResult.summary?.created ?? 0,
                    skipped: props.bootstrapResult.summary?.skipped ?? 0,
                  })}
                </div>
              ) : null}
            </Card>
            {panel === "review" || panel === "ops" ? (
              <Snippet
                title={t("page.projects.agentPrompt")}
                value={prompt}
                copied={props.copied === "agentPrompt"}
                onCopy={() => props.copyText("agentPrompt", prompt)}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function PanelTabs({
  panel,
  onPanel,
  data,
  opsPlan,
  prompt,
  t,
}: {
  panel: GovernancePanelKey;
  onPanel: (p: GovernancePanelKey) => void;
  data: any;
  opsPlan?: any;
  prompt: string;
  t: (key: string) => string;
}) {
  const panels: { key: GovernancePanelKey; label: string; count: number }[] = [
    { key: "review", label: t("page.projects.governanceReview"), count: data?.checks?.length ?? 0 },
    { key: "ops", label: t("page.projects.opsPlan"), count: opsPlan?.task_candidates?.length ?? 0 },
    { key: "actions", label: t("page.projects.nextActions"), count: data?.actions?.length ?? 0 },
    { key: "prompt", label: t("page.projects.agentPrompt"), count: prompt ? 1 : 0 },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {panels.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onPanel(item.key)}
          className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${
            panel === item.key
              ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
              : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          }`}
        >
          {item.label}
          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{item.count}</span>
        </button>
      ))}
    </div>
  );
}

function ScoreBanner({ score, grade, t }: { score: number; grade?: string; t: (key: string) => string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div>
        <p className="text-xs text-[var(--muted)]">{t("page.projects.readinessScore")}</p>
        <p className="mt-1 text-3xl font-semibold text-[var(--text)]">{score}</p>
      </div>
      <Badge tone={score >= 70 ? "brand" : "neutral"} label={t(`page.projects.grade.${grade || "needs_attention"}`)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function ActionList({
  actions,
  copied,
  copyText,
  onSelectTab,
  t,
}: {
  actions: any[];
  copied: string;
  copyText: (label: string, text: string) => void;
  onSelectTab: (tab: TabKey) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-2">
      {actions.map((action: any) => (
        <div key={action.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-[var(--text)]">{action.title}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{action.impact}</p>
            </div>
            <Badge label={action.kind} />
          </div>
          {action.command ? (
            <button type="button" className={`${secondaryBtn} mt-2 w-full`} onClick={() => copyText(`action:${action.id}`, action.command)}>
              <Clipboard className="h-3.5 w-3.5" />
              {copied === `action:${action.id}` ? t("common.copied") : t("page.projects.copyCommand")}
            </button>
          ) : action.id === "add_members" ? (
            <button type="button" className={`${secondaryBtn} mt-2 w-full`} onClick={() => onSelectTab("members")}>
              {t("page.projects.members")}
            </button>
          ) : action.id === "onboarding" ? (
            <a href="#/projects/onboarding" className={`${secondaryBtn} mt-2 w-full`}>
              {t("page.projects.onboarding")}
            </a>
          ) : (
            <button type="button" className={`${secondaryBtn} mt-2 w-full`} onClick={() => onSelectTab("portfolio")}>
              {t("page.projects.inspector")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
