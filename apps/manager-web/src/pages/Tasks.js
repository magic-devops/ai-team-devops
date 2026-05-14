import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../components/Card";
import { api } from "../lib/api";
export function Tasks() {
    const q = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
    return (_jsxs(Card, { title: "Tasks", children: [q.error ? _jsx("div", { className: "text-red-600", children: q.error.message }) : null, _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left text-zinc-500", children: [_jsx("th", { className: "py-1", children: "ID" }), _jsx("th", { className: "py-1", children: "Title" }), _jsx("th", { className: "py-1", children: "Status" }), _jsx("th", { className: "py-1", children: "Assignee" })] }) }), _jsx("tbody", { children: (q.data ?? []).map((t) => (_jsxs("tr", { className: "border-t border-zinc-200 dark:border-zinc-800", children: [_jsx("td", { className: "py-1 font-mono text-xs", children: t.id }), _jsx("td", { className: "py-1", children: t.title }), _jsx("td", { className: "py-1", children: t.status }), _jsx("td", { className: "py-1", children: t.assignee ?? "-" })] }, t.id))) })] })] }));
}
