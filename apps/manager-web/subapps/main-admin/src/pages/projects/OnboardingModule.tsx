import { AlertTriangle, CheckCircle2, Clipboard, FileCode2, Gauge, KeyRound, Network, Server, Terminal, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Card } from "../../../../../src/components/Card";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../../../../src/components/PageStates";
import { secondaryBtn } from "./ui";

export type OnboardingPanelKey = "overview" | "commands" | "env" | "agent" | "profiles" | "context";

const panelIcons = {
  overview: Gauge,
  commands: Terminal,
  env: KeyRound,
  agent: FileCode2,
  profiles: Wrench,
  context: Network,
};

export function OnboardingModule(props: {
  selectedProjectId: string;
  data: any;
  loading: boolean;
  error: Error | null;
  copied: string;
  initialPanel?: OnboardingPanelKey;
  embedded?: boolean;
  copyText: (label: string, text: string) => void;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<OnboardingPanelKey>(props.initialPanel ?? "overview");
  const [profileId, setProfileId] = useState("");
  const data = props.data ?? {};
  const profiles = data.tool_profiles ?? [];
  const selectedProfile = profiles.find((profile: any) => profile.id === (profileId || profiles[0]?.id)) ?? profiles[0];
  const envText = Object.entries(data.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
  const commandRows = [
    ["new_project", t("page.projects.quickStart"), data.commands?.new_project],
    ["existing_project", t("page.projects.existingProject"), data.commands?.existing_project],
    ["prepare_context", t("page.projects.prepare"), data.commands?.prepare_context],
    ["doctor", t("page.projects.doctor"), data.commands?.doctor],
    ["sync", t("page.projects.syncCommand"), data.commands?.sync],
    ["watch", t("page.projects.watchCommand"), data.commands?.watch],
    ["copilot", t("page.projects.copilotCommand"), data.commands?.copilot],
  ].filter((row) => row[2]);
  const readiness = data.readiness ?? [];
  const readyCount = readiness.filter((item: any) => item.ok).length;
  const profileText = selectedProfile
    ? [`# ${selectedProfile.name}`, `target: ${selectedProfile.target}`, "", selectedProfile.content, "", ...(selectedProfile.commands ?? []).map((cmd: string) => `$ ${cmd}`)].join("\n")
    : "";

  useEffect(() => {
    setPanel(props.initialPanel ?? "overview");
  }, [props.initialPanel]);

  if (!props.selectedProjectId) {
    return (
      <Card title={t("page.projects.onboarding")}>
        <EmptyState message={t("page.projects.deliveryKit.needProject")} />
        {!props.embedded ? (
          <p className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">{t("page.projects.onboardingWhyDesc")}</p>
        ) : null}
      </Card>
    );
  }
  if (props.loading) return <Card><LoadingBlock /></Card>;
  if (props.error) return <Card><ErrorBlock message={props.error.message} /></Card>;
  if (!props.data) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickStat label={t("page.projects.commandsReady")} value={String(commandRows.length)} />
        <QuickStat label={t("page.projects.onboardingReadiness")} value={`${readyCount}/${readiness.length}`} />
        <QuickStat label={t("page.projects.envReady")} value={String(Object.keys(data.env ?? {}).length)} />
        <QuickStat label={t("page.projects.profileReady")} value={String(profiles.length)} />
      </div>

      {!props.embedded ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <InfoLine icon={Server} label="Manager" value={data.manager?.api_base || "-"} />
          <InfoLine icon={Network} label="Project" value={data.isolation?.project_code || "-"} />
          <InfoLine icon={KeyRound} label="Tenant" value={data.isolation?.tenant_code || "-"} />
        </div>
      ) : null}

      <Card
        title={t("page.projects.onboardingAssets")}
        actions={<span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted-strong)]">{data.schema || "sop.project-onboarding"}</span>}
      >
        {!props.embedded ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {(Object.keys(panelIcons) as OnboardingPanelKey[]).map((key) => {
              const Icon = panelIcons[key];
              const active = panel === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPanel(key)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                      : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t(
                    key === "overview"
                      ? "page.projects.panelOverview"
                      : key === "commands"
                        ? "page.projects.panelCommands"
                        : key === "env"
                          ? "page.projects.panelEnv"
                          : key === "agent"
                            ? "page.projects.panelAgent"
                            : key === "profiles"
                              ? "page.projects.panelProfiles"
                              : "page.projects.panelContext",
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        {panel === "overview" ? <OverviewPanel commandRows={commandRows} readiness={readiness} t={t} /> : null}
        {panel === "commands" ? (
          <div className="space-y-2">
            {commandRows.map(([id, label, command]) => (
              <CommandRow
                key={id}
                label={String(label)}
                command={String(command)}
                copied={props.copied === `cmd:${id}`}
                onCopy={() => props.copyText(`cmd:${id}`, String(command))}
              />
            ))}
          </div>
        ) : null}
        {panel === "env" ? (
          <AssetBlock title={t("page.projects.env")} value={envText} copied={props.copied === "env"} onCopy={() => props.copyText("env", envText)} />
        ) : null}
        {panel === "agent" ? (
          <AssetBlock title="agent.toml" value={data.agent_toml ?? ""} copied={props.copied === "agent"} onCopy={() => props.copyText("agent", data.agent_toml ?? "")} />
        ) : null}
        {panel === "context" ? (
          <AssetBlock
            title={t("page.projects.agentContext")}
            value={JSON.stringify(data.agent_context ?? {}, null, 2)}
            copied={props.copied === "ctx"}
            onCopy={() => props.copyText("ctx", JSON.stringify(data.agent_context ?? {}, null, 2))}
          />
        ) : null}
        {panel === "profiles" ? (
          <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="space-y-2">
              {profiles.map((profile: any) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setProfileId(profile.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    (profileId || profiles[0]?.id) === profile.id
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                      : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <span className="block font-semibold">{profile.name}</span>
                  <span className="mt-1 block break-all font-mono text-xs">{profile.target}</span>
                </button>
              ))}
            </div>
            <AssetBlock
              title={selectedProfile ? `${selectedProfile.name} · ${selectedProfile.target}` : t("page.projects.toolProfiles")}
              value={profileText}
              copied={props.copied === `profile:${selectedProfile?.id}`}
              onCopy={() => props.copyText(`profile:${selectedProfile?.id}`, profileText)}
            />
          </div>
        ) : null}
      </Card>

      {panel === "overview" ? (
        <Card title={t("page.projects.recommendedFlow")}>
          <ol className="grid gap-2 sm:grid-cols-2">
            {(data.recommended_flow ?? []).map((row: string, idx: number) => (
              <li key={row} className="flex gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted-strong)]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">{idx + 1}</span>
                <span className="leading-6">{row}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-[var(--muted)]">
            {t("page.projects.deliveryKit.onboardingNext")}{" "}
            <a href="#/projects/governance" className="font-medium text-[var(--brand)] hover:underline">
              {t("page.projects.module.governance")}
            </a>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function OverviewPanel({
  commandRows,
  readiness,
  t,
}: {
  commandRows: (string | undefined)[][];
  readiness: any[];
  t: TFunction;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-2">
        {readiness.map((item: any) => (
          <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
              {item.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              {item.label}
            </div>
            <p className="mt-1 break-all text-xs leading-5 text-[var(--muted)]">{item.detail}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.projects.onboardingCapabilityMap")}</div>
        <div className="flex flex-wrap gap-2">
          {["tenant_code", "business_code", "project_id", "CLI", "Agent", "MCP/A2A", "rules", "tasks", "quality"].map((item) => (
            <span key={item} className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-xs font-medium text-[var(--muted-strong)]">
              {item}
            </span>
          ))}
        </div>
      </div>
      {commandRows.length ? (
        <p className="text-xs text-[var(--muted)]">
          {t("page.projects.deliveryKit.commandsHint", { count: commandRows.length })}
        </p>
      ) : null}
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function InfoLine({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--muted)]">
        <Icon className="h-3.5 w-3.5 text-[var(--brand)]" />
        {label}
      </div>
      <p className="break-all font-mono text-xs leading-5 text-[var(--text)]">{value}</p>
    </div>
  );
}

function CommandRow({ label, command, copied, onCopy }: { label: string; command: string; copied: boolean; onCopy: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 xl:grid-cols-[12rem_minmax(0,1fr)_7rem]">
      <div className="text-sm font-semibold text-[var(--text)]">{label}</div>
      <code className="min-w-0 overflow-auto rounded-md bg-[var(--surface-muted)] px-3 py-2 font-mono text-xs leading-5 text-[var(--muted-strong)]">{command}</code>
      <button type="button" className={secondaryBtn} onClick={onCopy}>
        <Clipboard className="h-3.5 w-3.5" />
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}

function AssetBlock({ title, value, copied, onCopy }: { title: string; value: string; copied: boolean; onCopy: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <FileCode2 className="h-4 w-4 shrink-0 text-[var(--brand)]" />
          <span className="break-words">{title}</span>
        </div>
        <button type="button" className={secondaryBtn} onClick={onCopy}>
          <Clipboard className="h-3.5 w-3.5" />
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-6 text-[var(--muted-strong)]">{value}</pre>
    </div>
  );
}
