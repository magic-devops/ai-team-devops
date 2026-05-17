import { Card as AntCard } from "antd";
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
  return (
    <AntCard
      title={title ? <span className="block min-w-0 whitespace-normal text-sm font-semibold leading-6 tracking-tight text-[var(--text)]">{title}</span> : undefined}
      extra={actions}
      className={[
        "sop-card min-w-0 text-[var(--text)] shadow-sm shadow-slate-950/[0.04] dark:shadow-black/20",
        className,
      ].filter(Boolean).join(" ")}
      styles={{ body: { padding: 16 }, header: { padding: "0 16px", minHeight: 48 } }}
    >
      {children}
    </AntCard>
  );
}
