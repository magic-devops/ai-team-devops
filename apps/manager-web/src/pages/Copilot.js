import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";
import { Card } from "../components/Card";
import { NeedLogin } from "../components/PageStates";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";
export function Copilot() {
    const { t } = useTranslation();
    const authed = Boolean(getToken());
    const [q, setQ] = useState("");
    const ask = useMutation({ mutationFn: (s) => api.copilotAsk(s) });
    if (!authed)
        return _jsx(NeedLogin, {});
    return (_jsx("div", { className: "mx-auto max-w-3xl", children: _jsxs(Card, { title: t("page.copilot.title"), className: "border-zinc-200/80 bg-gradient-to-b from-white to-zinc-50/90 dark:from-zinc-900 dark:to-zinc-950/90", actions: _jsxs("span", { className: "inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800 dark:bg-brand-950/50 dark:text-brand-200", children: [_jsx(Sparkles, { className: "h-3.5 w-3.5", "aria-hidden": true }), "Copilot"] }), children: [_jsx("p", { className: "mb-3 text-sm text-zinc-600 dark:text-zinc-400", children: t("copilot.intro") }), _jsxs("div", { className: "space-y-3", children: [_jsx("textarea", { className: "min-h-[120px] w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-zinc-900 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-brand-400", rows: 4, placeholder: t("copilot.placeholder"), value: q, onChange: (e) => setQ(e.target.value) }), _jsx("div", { className: "flex flex-wrap items-center gap-2", children: _jsxs("button", { type: "button", className: "inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50", disabled: !q.trim() || ask.isPending, onClick: () => ask.mutate(q), children: [ask.isPending ? (_jsx(Loader2, { className: "h-4 w-4 animate-spin", "aria-hidden": true })) : (_jsx(Sparkles, { className: "h-4 w-4", "aria-hidden": true })), t("copilot.ask")] }) }), ask.data ? (_jsx("pre", { className: "max-h-[min(60vh,480px)] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200", children: JSON.stringify(ask.data, null, 2) })) : null, ask.error ? (_jsx("div", { className: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200", children: ask.error.message })) : null] })] }) }));
}
