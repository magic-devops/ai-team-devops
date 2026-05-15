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
    "rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-[var(--text)] shadow-sm shadow-slate-950/[0.04] ring-1 ring-white/40 backdrop-blur dark:shadow-black/20 dark:ring-white/[0.04]";
  return (
    <section className={[base, className].filter(Boolean).join(" ")}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h3 className="text-sm font-semibold tracking-tight text-[var(--text)]">{title}</h3>
          )}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
