import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { FlashMessage } from "../components/FlashMessage";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";
export function Workflows() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const authed = Boolean(getToken());
    const hasProject = Boolean(getProjectId());
    const [type, setType] = useState("");
    const [args, setArgs] = useState("{}");
    const [flash, setFlash] = useState(null);
    const types = useQuery({
        queryKey: ["wf-types"],
        queryFn: api.workflowTypes,
        enabled: authed && hasProject,
    });
    const start = useMutation({
        mutationFn: () => {
            let parsed = {};
            try {
                parsed = JSON.parse(args || "{}");
            }
            catch {
                throw new Error(t("page.workflows.invalidJson"));
            }
            return api.startWorkflow({ type, args: parsed });
        },
        onSuccess: (data) => {
            setFlash({ kind: "ok", message: t("page.workflows.started", { id: data?.workflow_id ?? data?.id ?? "—" }) });
            void qc.invalidateQueries({ queryKey: ["wf-types"] });
        },
        onError: (err) => setFlash({ kind: "err", message: err.message }),
    });
    useEffect(() => {
        if (!flash)
            return;
        const tmr = window.setTimeout(() => setFlash(null), 6000);
        return () => window.clearTimeout(tmr);
    }, [flash]);
    if (!authed)
        return _jsx(NeedLogin, {});
    if (!hasProject)
        return _jsx("p", { className: "text-sm text-amber-700", children: t("projectSelector.hint") });
    return (_jsxs("div", { className: "mx-auto max-w-5xl space-y-4", children: [flash ? _jsx(FlashMessage, { kind: flash.kind, message: flash.message, onDismiss: () => setFlash(null) }) : null, _jsxs(Card, { title: t("page.workflows.available"), actions: _jsx(RefreshButton, { onClick: () => void types.refetch(), pending: types.isFetching }), children: [types.isLoading ? _jsx(LoadingBlock, {}) : null, types.error ? _jsx(ErrorBlock, { message: types.error.message }) : null, (types.data ?? []).length === 0 && !types.isLoading && !types.error ? (_jsx(EmptyState, { message: t("page.workflows.empty") })) : (_jsx("ul", { className: "divide-y divide-slate-200 dark:divide-slate-700", children: (types.data ?? []).map((wf) => (_jsxs("li", { className: "py-3 text-sm", children: [_jsx("div", { className: "font-mono font-medium text-slate-900 dark:text-slate-100", children: wf.type }), _jsx("div", { className: "mt-0.5 text-xs text-slate-500", children: wf.description }), _jsxs("div", { className: "mt-1 text-xs text-slate-400", children: [t("page.workflows.signals"), ": ", (wf.signals ?? []).join(", ") || "—"] })] }, wf.type))) }))] }), _jsx(Card, { title: t("page.workflows.start"), children: _jsxs("div", { className: "space-y-3", children: [_jsxs("select", { className: "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900", value: type, onChange: (e) => setType(e.target.value), children: [_jsx("option", { value: "", children: t("page.workflows.choose") }), (types.data ?? []).map((wf) => (_jsx("option", { value: wf.type, children: wf.type }, wf.type)))] }), _jsx("textarea", { className: "w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900", rows: 6, value: args, onChange: (e) => setArgs(e.target.value), placeholder: '{"key": "value"}' }), _jsx("button", { type: "button", className: "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50", disabled: !type || start.isPending, onClick: () => start.mutate(), children: start.isPending ? t("common.loading") : t("page.workflows.startBtn") }), start.data ? (_jsx("pre", { className: "overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900", children: JSON.stringify(start.data, null, 2) })) : null] }) })] }));
}
