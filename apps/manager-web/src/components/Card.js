import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Card({ title, children, actions, className = "", }) {
    const base = "rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.04] dark:border-slate-700/70 dark:bg-slate-900/75 dark:ring-white/[0.06]";
    return (_jsxs("section", { className: [base, className].filter(Boolean).join(" "), children: [(title || actions) && (_jsxs("header", { className: "mb-3 flex items-center justify-between gap-2", children: [title && (_jsx("h3", { className: "text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100", children: title })), actions] })), children] }));
}
