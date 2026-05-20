import { ReactNode } from "react";
import { Card } from "../../../../../src/components/Card";

export function ModuleFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      title={title}
      actions={actions}
      className="overflow-hidden"
    >
      {description ? <p className="mb-4 max-w-4xl text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
      {children}
    </Card>
  );
}
