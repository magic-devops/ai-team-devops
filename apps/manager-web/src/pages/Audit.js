import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Card } from "../components/Card";
import { ErrorBlock, LoadingBlock, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
export function Audit() {
    const { t } = useTranslation();
    const state = useQuery({ queryKey: ["audit-state"], queryFn: api.auditState });
    const verify = useQuery({
        queryKey: ["audit-verify"],
        queryFn: api.auditVerify,
    });
    const refresh = () => {
        void state.refetch();
        void verify.refetch();
    };
    return (_jsxs("div", { className: "mx-auto max-w-5xl space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("p", { className: "text-sm text-slate-600 dark:text-slate-400", children: t("page.audit.subtitle") }), _jsx(RefreshButton, { onClick: refresh, pending: state.isFetching || verify.isFetching })] }), _jsxs(Card, { title: t("page.audit.chainHead"), children: [state.isLoading ? _jsx(LoadingBlock, {}) : null, state.error ? _jsx(ErrorBlock, { message: state.error.message }) : null, state.data ? (_jsxs("dl", { className: "grid gap-2 text-sm sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("dt", { className: "text-slate-500", children: t("page.audit.count") }), _jsx("dd", { className: "text-2xl font-bold tabular-nums", children: state.data.count ?? 0 })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("dt", { className: "text-slate-500", children: t("page.audit.prevHash") }), _jsx("dd", { className: "mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-300", children: String(state.data.prev_hash ?? "—") })] })] })) : null] }), _jsxs(Card, { title: t("page.audit.verify"), children: [verify.isLoading ? _jsx(LoadingBlock, {}) : null, verify.error ? _jsx(ErrorBlock, { message: verify.error.message }) : null, verify.data ? (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ShieldCheck, { className: `h-5 w-5 ${verify.data.ok ? "text-emerald-600" : "text-rose-600"}` }), _jsx("span", { className: "text-sm font-medium", children: verify.data.ok ? t("page.audit.verifyOk") : t("page.audit.verifyFail") }), _jsxs("span", { className: "text-xs text-slate-500", children: [t("page.audit.total"), ": ", verify.data.total ?? "—"] })] }), verify.data.errors?.length ? (_jsx("pre", { className: "overflow-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200", children: JSON.stringify(verify.data.errors, null, 2) })) : null] })) : null] })] }));
}
