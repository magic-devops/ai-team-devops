import { ReactNode } from "react";

export function Card({
  title,
  children,
  actions,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** 追加在 section 上的 Tailwind 类 */
  className?: string;
}) {
  const base =
    "rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.04] dark:border-slate-700/70 dark:bg-slate-900/75 dark:ring-white/[0.06]";
  return (
    <section className={[base, className].filter(Boolean).join(" ")}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h3 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">{title}</h3>
          )}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
