import { useTranslation } from "react-i18next";
import { isAssessedNumber } from "@/lib/catalogAssessment";

export function CatalogAssessmentCounts({ value }: { value?: { assessed_count?: number; unassessed_count?: number } }) {
  const { t } = useTranslation();
  if (!value || !isAssessedNumber(value.assessed_count) || !isAssessedNumber(value.unassessed_count)) return null;
  return <span className="text-xs text-[var(--muted)]">{t("catalogAssessment.counts", { assessed: value.assessed_count, unassessed: value.unassessed_count })}</span>;
}
