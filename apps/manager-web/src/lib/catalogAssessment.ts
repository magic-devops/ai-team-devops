/** Unknown catalog scores never become zero through coercion or a fallback. */
export function isAssessedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function assessmentText(value: unknown, unassessed: string, percent = false): string {
  return isAssessedNumber(value) ? `${value}${percent ? "%" : ""}` : unassessed;
}
