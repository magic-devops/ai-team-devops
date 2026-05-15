import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock, SearchInput } from "../components/PageStates";
import { api } from "../lib/api";
export function Marketplace() {
    const { t } = useTranslation();
    const [q, setQ] = useState("");
    const list = useQuery({
        queryKey: ["mp", q],
        queryFn: () => api.marketplaceList(q),
    });
    const items = list.data?.items ?? [];
    return (_jsx("div", { className: "w-full space-y-4", children: _jsxs(Card, { title: t("page.marketplace.title"), actions: _jsx(SearchInput, { value: q, onChange: setQ, placeholder: t("page.marketplace.searchPh") }), children: [_jsx("p", { className: "mb-3 text-sm text-slate-600 dark:text-slate-400", children: t("page.marketplace.hint") }), list.isLoading ? _jsx(LoadingBlock, {}) : null, list.error ? _jsx(ErrorBlock, { message: list.error.message }) : null, items.length === 0 && !list.isLoading && !list.error ? (_jsx(EmptyState, { message: t("page.marketplace.empty") })) : (_jsx("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3", children: items.map((p) => (_jsxs("article", { className: "rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900/80 dark:to-slate-900/40", children: [_jsxs("div", { className: "font-semibold text-slate-900 dark:text-slate-100", children: [p.name, " ", _jsxs("span", { className: "text-xs font-normal text-slate-500", children: ["v", p.version ?? "?"] })] }), _jsx("div", { className: "mt-1 text-xs text-slate-500", children: p.type }), _jsx("p", { className: "mt-2 line-clamp-3 text-sm text-slate-700 dark:text-slate-300", children: p.description }), _jsxs("div", { className: "mt-3 text-xs text-slate-500", children: ["\u2B50 ", p.rating?.avg ?? 0, " \u00B7 ", p.rating?.count ?? 0, " ", t("page.marketplace.ratings")] })] }, `${p.name}-${p.version}`))) }))] }) }));
}
