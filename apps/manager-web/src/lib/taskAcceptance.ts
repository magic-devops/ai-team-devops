export type TaskAcceptance = {
  criteria: string[];
  sources: { source: "task" | "requirement"; index: number; text: string }[];
  available: boolean;
  requirement_id: string | null;
  requirement_revision: number | null;
};
export function normalizeTaskCriteria(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 80)
    throw new Error("criteriaLimit");
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 2000)
      throw new Error("invalidCriterion");
    return item.trim();
  });
}
