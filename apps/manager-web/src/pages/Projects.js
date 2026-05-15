import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Card } from "../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton, SearchInput } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken, setProjectId } from "../lib/authStorage";
export function Projects() {
    const { t } = useTranslation();
    const authed = Boolean(getToken());
    const currentPid = getProjectId();
    const [keyword, setKeyword] = useState("");
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
    if (!authed)
        return _jsx(NeedLogin, {});
    return (_jsx("div", { className: "mx-auto max-w-5xl space-y-4", children: _jsxs(Card, { title: t("page.projects.list"), actions: _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(SearchInput, { value: keyword, onChange: setKeyword, placeholder: t("page.projects.searchPh") }), _jsx(RefreshButton, { onClick: () => void q.refetch(), pending: q.isFetching })] }), children: [_jsx("p", { className: "mb-3 text-xs text-slate-500 dark:text-slate-400", children: t("page.projects.hint") }), q.isLoading ? _jsx(LoadingBlock, {}) : null, q.error ? _jsx(ErrorBlock, { message: q.error.message }) : null, !q.isLoading && !q.error && filtered.length === 0 ? (_jsx(EmptyState, { message: t("page.projects.empty") })) : null, _jsx("ul", { className: "divide-y divide-slate-200 dark:divide-slate-700", children: filtered.map((p) => {
                        const active = currentPid === p.id;
                        return (_jsx("li", { children: _jsxs("button", { type: "button", className: `flex w-full items-center justify-between gap-2 py-3 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${active ? "bg-brand-50/80 dark:bg-brand-950/20" : ""}`, onClick: () => setProjectId(p.id), children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "font-medium text-slate-900 dark:text-slate-100", children: p.name }), _jsx("p", { className: "font-mono text-[10px] text-slate-400", children: p.id }), p.status ? _jsx("p", { className: "mt-0.5 text-xs text-slate-500", children: p.status }) : null] }), active ? (_jsxs("span", { className: "inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200", children: [_jsx(Check, { className: "h-3 w-3" }), t("page.projects.current")] })) : (_jsx("span", { className: "shrink-0 text-xs text-brand-600 dark:text-brand-400", children: t("page.projects.select") }))] }) }, p.id));
                    }) })] }) }));
}
