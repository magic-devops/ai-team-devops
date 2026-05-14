import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../components/Card";
import { api } from "../lib/api";
export function Projects() {
    const q = useQuery({ queryKey: ["projects"], queryFn: api.projects });
    return (_jsxs(Card, { title: "Projects", children: [q.isLoading ? _jsx("div", { children: "\u2026" }) : null, q.error ? _jsx("div", { className: "text-red-600", children: q.error.message }) : null, _jsx("ul", { className: "divide-y divide-zinc-200 dark:divide-zinc-800", children: (q.data ?? []).map((p) => (_jsxs("li", { className: "py-2", children: [_jsx("div", { className: "font-medium", children: p.name }), _jsx("div", { className: "text-xs text-zinc-500", children: p.id })] }, p.id ?? p.name))) })] }));
}
