import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../components/Card";
import { api } from "../lib/api";
export function Marketplace() {
    const [q, setQ] = useState("");
    const list = useQuery({
        queryKey: ["mp", q],
        queryFn: () => api.marketplaceList(q),
    });
    return (_jsx(Card, { title: "Marketplace", actions: _jsx("input", { className: "rounded border border-zinc-300 px-2 py-1 text-sm dark:bg-zinc-800 dark:border-zinc-700", placeholder: "search\u2026", value: q, onChange: (e) => setQ(e.target.value) }), children: _jsx("div", { className: "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3", children: (list.data?.items ?? []).map((p) => (_jsxs("div", { className: "rounded border border-zinc-200 p-3 dark:border-zinc-800", children: [_jsxs("div", { className: "font-semibold", children: [p.name, " ", _jsxs("span", { className: "ml-1 text-xs text-zinc-500", children: ["v", p.version] })] }), _jsx("div", { className: "mt-1 text-xs text-zinc-500", children: p.type }), _jsx("p", { className: "mt-1 text-sm text-zinc-700 dark:text-zinc-300", children: p.description }), _jsxs("div", { className: "mt-2 text-xs text-zinc-500", children: ["\u2B50 ", p.rating?.avg ?? 0, " \u00B7 ", p.rating?.count ?? 0] })] }, p.name))) }) }));
}
