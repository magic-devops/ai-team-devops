import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Clipboard, FolderKanban, Terminal } from "lucide-react";
import { Card } from "../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton, SearchInput } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken, setProjectId } from "../lib/authStorage";

export function Projects() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const currentPid = getProjectId();
  const [keyword, setKeyword] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(currentPid ?? "");
  const [copied, setCopied] = useState("");

  const q = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
    enabled: authed,
  });

  const filtered = useMemo(() => {
    const list = q.data ?? [];
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter(
      (p: { id?: string; name?: string }) =>
        String(p.name ?? "").toLowerCase().includes(k) || String(p.id ?? "").toLowerCase().includes(k),
    );
  }, [q.data, keyword]);

  const onboarding = useQuery({
    queryKey: ["projectOnboarding", selectedProjectId],
    queryFn: () => api.projectOnboarding(selectedProjectId),
    enabled: authed && Boolean(selectedProjectId),
  });

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  };

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
        <Card
          title={t("page.projects.list")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput value={keyword} onChange={setKeyword} placeholder={t("page.projects.searchPh")} />
              <RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />
            </div>
          }
        >
          <p className="mb-4 text-xs text-[var(--muted)]">{t("page.projects.hint")}</p>
          {q.isLoading ? <LoadingBlock /> : null}
          {q.error ? <ErrorBlock message={(q.error as Error).message} /> : null}
          {!q.isLoading && !q.error && filtered.length === 0 ? (
            <EmptyState message={t("page.projects.empty")} />
          ) : null}
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((p: { id: string; name: string; status?: string }) => {
              const active = currentPid === p.id;
              const selected = selectedProjectId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`flex min-h-[7rem] w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                      active || selected
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-sm ring-1 ring-[var(--brand)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]"
                    }`}
                    onClick={() => {
                      setSelectedProjectId(p.id);
                      setProjectId(p.id);
                    }}
                  >
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-softer)] text-[var(--brand)]">
                        <FolderKanban className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--text)]">{p.name}</p>
                        <p className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{p.id}</p>
                        {p.status ? (
                          <p className="mt-2 inline-flex rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted-strong)]">
                            {p.status}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {active ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand)] px-2 py-0.5 text-xs font-medium text-white">
                        <Check className="h-3 w-3" />
                        {t("page.projects.current")}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs font-medium text-[var(--brand)]">
                        {t("page.projects.select")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title={t("page.projects.onboarding")}>
          {!selectedProjectId ? <EmptyState message={t("page.projects.pickProject")} /> : null}
          {onboarding.isLoading ? <LoadingBlock /> : null}
          {onboarding.error ? <ErrorBlock message={(onboarding.error as Error).message} /> : null}
          {onboarding.data ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[var(--muted)]">{t("page.projects.scope")}</div>
                <div className="mt-1 grid gap-1 font-mono text-[11px] text-[var(--muted-strong)]">
                  <span>tenant_code={onboarding.data.isolation?.tenant_code || "-"}</span>
                  <span>business_code={onboarding.data.isolation?.business_code || "-"}</span>
                  <span>project_code={onboarding.data.isolation?.project_code || "-"}</span>
                </div>
              </div>
              <Snippet
                title={t("page.projects.quickStart")}
                value={onboarding.data.commands?.new_project ?? ""}
                copied={copied === "quick"}
                onCopy={() => copyText("quick", onboarding.data.commands?.new_project ?? "")}
              />
              <Snippet
                title={t("page.projects.prepare")}
                value={[onboarding.data.commands?.prepare_context, onboarding.data.commands?.doctor].filter(Boolean).join("\n")}
                copied={copied === "prepare"}
                onCopy={() => copyText("prepare", [onboarding.data.commands?.prepare_context, onboarding.data.commands?.doctor].filter(Boolean).join("\n"))}
              />
              <Snippet
                title={t("page.projects.env")}
                value={Object.entries(onboarding.data.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
                copied={copied === "env"}
                onCopy={() => copyText("env", Object.entries(onboarding.data.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"))}
              />
              <Snippet
                title="agent.toml"
                value={onboarding.data.agent_toml ?? ""}
                copied={copied === "agent"}
                onCopy={() => copyText("agent", onboarding.data.agent_toml ?? "")}
              />
              <Snippet
                title={t("page.projects.agentContext")}
                value={JSON.stringify(onboarding.data.agent_context ?? {}, null, 2)}
                copied={copied === "agentContext"}
                onCopy={() => copyText("agentContext", JSON.stringify(onboarding.data.agent_context ?? {}, null, 2))}
              />
              <div>
                <div className="mb-2 text-sm font-semibold text-[var(--text)]">{t("page.projects.toolProfiles")}</div>
                <div className="space-y-2">
                  {(onboarding.data.tool_profiles ?? []).map((profile: any) => {
                    const value = [
                      `# ${profile.name}`,
                      `target: ${profile.target}`,
                      "",
                      profile.content,
                      "",
                      ...(profile.commands ?? []).map((cmd: string) => `$ ${cmd}`),
                    ].join("\n");
                    return (
                      <Snippet
                        key={String(profile.id)}
                        title={`${profile.name} · ${profile.target}`}
                        value={value}
                        copied={copied === `profile:${profile.id}`}
                        onCopy={() => copyText(`profile:${profile.id}`, value)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function Snippet({
  title,
  value,
  copied,
  onCopy,
}: {
  title: string;
  value: string;
  copied?: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Terminal className="h-4 w-4 shrink-0 text-[var(--brand)]" />
          <span className="truncate">{title}</span>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
          onClick={onCopy}
        >
          <Clipboard className="h-3.5 w-3.5" />
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted-strong)]">
        {value}
      </pre>
    </div>
  );
}
