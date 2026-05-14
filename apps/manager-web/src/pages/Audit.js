import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../components/Card";
import { api } from "../lib/api";
export function Audit() {
    const state = useQuery({ queryKey: ["audit-state"], queryFn: api.auditState });
    const verify = useQuery({
        queryKey: ["audit-verify"],
        queryFn: api.auditVerify,
    });
    return (_jsxs("div", { className: "space-y-4", children: [_jsx(Card, { title: "Chain Head", children: _jsx("pre", { className: "overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800", children: JSON.stringify(state.data, null, 2) }) }), _jsx(Card, { title: "Verify", children: _jsxs("div", { children: [_jsxs("div", { className: "text-sm", children: ["ok:", " ", _jsx("span", { className: verify.data?.ok ? "text-emerald-600" : "text-red-600 font-semibold", children: String(verify.data?.ok ?? "—") }), " ", "\u00B7 total: ", verify.data?.total ?? "—"] }), verify.data?.errors?.length ? (_jsx("pre", { className: "mt-2 overflow-auto rounded bg-red-50 p-2 text-xs text-red-700", children: JSON.stringify(verify.data.errors, null, 2) })) : null] }) })] }));
}
