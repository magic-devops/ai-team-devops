import { ReactNode } from "react";

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:bg-zinc-900 dark:border-zinc-800">
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</h3>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
