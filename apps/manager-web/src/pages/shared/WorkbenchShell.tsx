import type { ReactNode } from "react";

export function WorkbenchShell({
  title,
  description,
  actions,
  metrics,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  metrics?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {metrics ? <div className="min-w-0 w-full">{metrics}</div> : null}
      {children ?? null}
    </div>
  );
}
