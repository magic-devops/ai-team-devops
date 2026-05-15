import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
        if (!k)
            return list;
        return list.filter((p) => String(p.name ?? "").toLowerCase().includes(k) || String(p.id ?? "").toLowerCase().includes(k));
    }, [q.data, keyword]);
    const onboarding = useQuery({
        queryKey: ["projectOnboarding", selectedProjectId],
        queryFn: () => api.projectOnboarding(selectedProjectId),
        enabled: authed && Boolean(selectedProjectId),
    });
    const copyText = async (label, text) => {
        await navigator.clipboard.writeText(text);
        setCopied(label);
        window.setTimeout(() => setCopied(""), 1800);
    };
    if (!authed)
        return _jsx(NeedLogin, {});
    return (_jsx("div", { className: "w-full space-y-4", children: _jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]", children: [_jsxs(Card, { title: t("page.projects.list"), actions: _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(SearchInput, { value: keyword, onChange: setKeyword, placeholder: t("page.projects.searchPh") }), _jsx(RefreshButton, { onClick: () => void q.refetch(), pending: q.isFetching })] }), children: [_jsx("p", { className: "mb-4 text-xs text-[var(--muted)]", children: t("page.projects.hint") }), q.isLoading ? _jsx(LoadingBlock, {}) : null, q.error ? _jsx(ErrorBlock, { message: q.error.message }) : null, !q.isLoading && !q.error && filtered.length === 0 ? (_jsx(EmptyState, { message: t("page.projects.empty") })) : null, _jsx("ul", { className: "grid gap-3 md:grid-cols-2 2xl:grid-cols-3", children: filtered.map((p) => {
                                const active = currentPid === p.id;
                                const selected = selectedProjectId === p.id;
                                return (_jsx("li", { children: _jsxs("button", { type: "button", className: `flex min-h-[7rem] w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition hover:-translate-y-0.5 hover:shadow-md ${active || selected
                                            ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-sm ring-1 ring-[var(--brand)]"
                                            : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)]"}`, onClick: () => {
                                            setSelectedProjectId(p.id);
                                            setProjectId(p.id);
                                        }, children: [_jsxs("div", { className: "flex min-w-0 gap-3", children: [_jsx("span", { className: "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-softer)] text-[var(--brand)]", children: _jsx(FolderKanban, { className: "h-4 w-4" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate font-semibold text-[var(--text)]", children: p.name }), _jsx("p", { className: "mt-1 truncate font-mono text-[11px] text-[var(--muted)]", children: p.id }), p.status ? (_jsx("p", { className: "mt-2 inline-flex rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted-strong)]", children: p.status })) : null] })] }), active ? (_jsxs("span", { className: "inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand)] px-2 py-0.5 text-xs font-medium text-white", children: [_jsx(Check, { className: "h-3 w-3" }), t("page.projects.current")] })) : (_jsx("span", { className: "shrink-0 text-xs font-medium text-[var(--brand)]", children: t("page.projects.select") }))] }) }, p.id));
                            }) })] }), _jsxs(Card, { title: t("page.projects.onboarding"), children: [!selectedProjectId ? _jsx(EmptyState, { message: t("page.projects.pickProject") }) : null, onboarding.isLoading ? _jsx(LoadingBlock, {}) : null, onboarding.error ? _jsx(ErrorBlock, { message: onboarding.error.message }) : null, onboarding.data ? (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2", children: [_jsx("div", { className: "text-xs text-[var(--muted)]", children: t("page.projects.scope") }), _jsxs("div", { className: "mt-1 grid gap-1 font-mono text-[11px] text-[var(--muted-strong)]", children: [_jsxs("span", { children: ["tenant_code=", onboarding.data.isolation?.tenant_code || "-"] }), _jsxs("span", { children: ["business_code=", onboarding.data.isolation?.business_code || "-"] }), _jsxs("span", { children: ["project_code=", onboarding.data.isolation?.project_code || "-"] })] })] }), _jsx(Snippet, { title: t("page.projects.quickStart"), value: onboarding.data.commands?.new_project ?? "", copied: copied === "quick", onCopy: () => copyText("quick", onboarding.data.commands?.new_project ?? "") }), _jsx(Snippet, { title: t("page.projects.prepare"), value: [onboarding.data.commands?.prepare_context, onboarding.data.commands?.doctor].filter(Boolean).join("\n"), copied: copied === "prepare", onCopy: () => copyText("prepare", [onboarding.data.commands?.prepare_context, onboarding.data.commands?.doctor].filter(Boolean).join("\n")) }), _jsx(Snippet, { title: t("page.projects.env"), value: Object.entries(onboarding.data.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"), copied: copied === "env", onCopy: () => copyText("env", Object.entries(onboarding.data.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")) }), _jsx(Snippet, { title: "agent.toml", value: onboarding.data.agent_toml ?? "", copied: copied === "agent", onCopy: () => copyText("agent", onboarding.data.agent_toml ?? "") }), _jsx(Snippet, { title: t("page.projects.agentContext"), value: JSON.stringify(onboarding.data.agent_context ?? {}, null, 2), copied: copied === "agentContext", onCopy: () => copyText("agentContext", JSON.stringify(onboarding.data.agent_context ?? {}, null, 2)) }), _jsxs("div", { children: [_jsx("div", { className: "mb-2 text-sm font-semibold text-[var(--text)]", children: t("page.projects.toolProfiles") }), _jsx("div", { className: "space-y-2", children: (onboarding.data.tool_profiles ?? []).map((profile) => {
                                                const value = [
                                                    `# ${profile.name}`,
                                                    `target: ${profile.target}`,
                                                    "",
                                                    profile.content,
                                                    "",
                                                    ...(profile.commands ?? []).map((cmd) => `$ ${cmd}`),
                                                ].join("\n");
                                                return (_jsx(Snippet, { title: `${profile.name} · ${profile.target}`, value: value, copied: copied === `profile:${profile.id}`, onCopy: () => copyText(`profile:${profile.id}`, value) }, String(profile.id)));
                                            }) })] })] })) : null] })] }) }));
}
function Snippet({ title, value, copied, onCopy, }) {
    const { t } = useTranslation();
    return (_jsxs("div", { className: "rounded-xl border border-[var(--border)] bg-[var(--surface)]", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2", children: [_jsxs("div", { className: "inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text)]", children: [_jsx(Terminal, { className: "h-4 w-4 shrink-0 text-[var(--brand)]" }), _jsx("span", { className: "truncate", children: title })] }), _jsxs("button", { type: "button", className: "inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]", onClick: onCopy, children: [_jsx(Clipboard, { className: "h-3.5 w-3.5" }), copied ? t("common.copied") : t("common.copy")] })] }), _jsx("pre", { className: "max-h-60 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted-strong)]", children: value })] }));
}
