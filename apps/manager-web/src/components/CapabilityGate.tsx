import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type CapabilityAction, useCapabilities } from "../lib/capabilities";

export function CapabilityGate({
  capability,
  action = "read",
  children,
  fallback,
}: {
  capability: string;
  action?: CapabilityAction;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { t } = useTranslation();
  const caps = useCapabilities();
  if (caps.isLoading) return null;
  if (caps.can(capability, action)) return <>{children}</>;
  return (
    fallback ?? (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
        {t("capability.denied")}
      </div>
    )
  );
}
