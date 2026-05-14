import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../components/Card";
import { api } from "../lib/api";
export function Workflows() {
    const qc = useQueryClient();
    const types = useQuery({ queryKey: ["wf-types"], queryFn: api.workflowTypes });
    const [type, setType] = useState("");
    const [args, setArgs] = useState("{}");
    const start = useMutation({
        mutationFn: () => api.startWorkflow({ type, args: JSON.parse(args || "{}") }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-types"] }),
    });
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(Card, { title: "Available Workflows", children: _jsx("ul", { className: "divide-y divide-zinc-200 dark:divide-zinc-800", children: (types.data ?? []).map((t) => (_jsxs("li", { className: "py-2", children: [_jsx("div", { className: "font-mono text-sm", children: t.type }), _jsx("div", { className: "text-xs text-zinc-500", children: t.description }), _jsxs("div", { className: "text-xs text-zinc-500", children: ["signals: ", t.signals.join(", ") || "-"] })] }, t.type))) }) }), _jsx(Card, { title: "Start a workflow", children: _jsxs("div", { className: "space-y-2", children: [_jsxs("select", { className: "w-full rounded border border-zinc-300 px-2 py-1 dark:bg-zinc-800 dark:border-zinc-700", value: type, onChange: (e) => setType(e.target.value), children: [_jsx("option", { value: "", children: "-- choose --" }), (types.data ?? []).map((t) => (_jsx("option", { value: t.type, children: t.type }, t.type)))] }), _jsx("textarea", { className: "w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs dark:bg-zinc-800 dark:border-zinc-700", rows: 6, value: args, onChange: (e) => setArgs(e.target.value) }), _jsx("button", { className: "rounded bg-brand-600 px-3 py-1 text-white hover:bg-brand-700 disabled:opacity-50", disabled: !type || start.isPending, onClick: () => start.mutate(), children: "Start" }), start.data ? (_jsx("pre", { className: "overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800", children: JSON.stringify(start.data, null, 2) })) : null] }) })] }));
}
