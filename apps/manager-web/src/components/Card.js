import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Card({ title, children, actions, className = "", }) {
    const base = "rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-[var(--text)] shadow-sm shadow-slate-950/[0.04] ring-1 ring-white/40 backdrop-blur dark:shadow-black/20 dark:ring-white/[0.04]";
    return (_jsxs("section", { className: [base, className].filter(Boolean).join(" "), children: [(title || actions) && (_jsxs("header", { className: "mb-3 flex items-center justify-between gap-2", children: [title && (_jsx("h3", { className: "text-sm font-semibold tracking-tight text-[var(--text)]", children: title })), actions] })), children] }));
}
