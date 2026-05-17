import { jsx as _jsx } from "react/jsx-runtime";
import { Card as AntCard } from "antd";
export function Card({ title, children, actions, className = "", }) {
    return (_jsx(AntCard, { title: title ? _jsx("span", { className: "block min-w-0 whitespace-normal text-sm font-semibold leading-6 tracking-tight text-[var(--text)]", children: title }) : undefined, extra: actions, className: [
            "sop-card min-w-0 text-[var(--text)] shadow-sm shadow-slate-950/[0.04] dark:shadow-black/20",
            className,
        ].filter(Boolean).join(" "), styles: { body: { padding: 16 }, header: { padding: "0 16px", minHeight: 48 } }, children: children }));
}
