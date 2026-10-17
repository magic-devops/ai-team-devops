import { request } from "./http";
import type { ScheduleAllocation } from "./deliveryScheduling";
import { normalizeTaskCriteria } from "./taskAcceptance";

export type TaskPlanItem = {
  key: string;
  title: string;
  description: string;
  owner_id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  estimate: "XS" | "S" | "M" | "L" | "XL";
  acceptance_criteria: string[];
  requirement_criteria_indices: number[];
  depends_on: string[];
  starts_on: string | null;
  ends_on: string | null;
  blocked_reason: string;
};
export type TaskPlanRow = TaskPlanItem & { selected: boolean };
export type PlanUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
};
export type TaskPlanning = Partial<Omit<TaskPlanItem, "acceptance_criteria">> &
  Partial<{
    requirement_revision: number;
    requirement_basis: string;
    preview_id: string;
    source: "manual" | "template" | "ai";
    model: string;
    provider: string;
    usage: Partial<PlanUsage>;
    allocations: ScheduleAllocation[];
    requirement_snapshot?: {
      id: string;
      title: string;
      description: string;
      acceptance_criteria: string[];
    };
  }>;
export type PlanPreviewRequest = {
  requirement_id: string;
  expected_version: number;
  idempotency_key: string;
  generator: "template" | "ai";
  mode: "frontend" | "backend" | "fullstack" | "testing";
  max_items: number;
};
export type TaskPlanPreview = {
  id: string;
  version: number;
  requirement_revision: number;
  requirement_basis: string;
  requirement_snapshot: {
    id: string;
    title: string;
    description: string;
    acceptance_criteria: string[];
  };
  items: TaskPlanItem[];
  source: "template" | "ai";
  model: string;
  provider: string;
  usage: PlanUsage;
  warnings: string[];
};
export const selectedPlanItems = (rows: TaskPlanRow[]): TaskPlanItem[] =>
  rows.filter((row) => row.selected).map(({ selected: _, ...item }) => item);

export function taskPlanProblems(
  rows: TaskPlanRow[],
  criteriaCount: number,
  existingIds: string[],
) {
  const selected = selectedPlanItems(rows);
  const problems: {
    code:
      | "empty"
      | "limit"
      | "title"
      | "dates"
      | "criteria"
      | "missingDependency"
      | "cycle";
    key?: string;
  }[] = [];
  if (!selected.length) problems.push({ code: "empty" });
  if (selected.length > 40) problems.push({ code: "limit" });
  const byKey = new Map(selected.map((row) => [row.key, row]));
  const allowed = new Set([...byKey.keys(), ...existingIds]);
  for (const row of selected) {
    try {
      normalizeTaskCriteria(row.acceptance_criteria);
    } catch {
      problems.push({ code: "criteria", key: row.key });
    }
    if (!row.title.trim()) problems.push({ code: "title", key: row.key });
    if (row.starts_on && row.ends_on && row.starts_on > row.ends_on)
      problems.push({ code: "dates", key: row.key });
    if (
      row.requirement_criteria_indices.some((i) => i < 0 || i >= criteriaCount)
    )
      problems.push({ code: "criteria", key: row.key });
    if (row.depends_on.some((id) => !allowed.has(id)))
      problems.push({ code: "missingDependency", key: row.key });
  }
  const visited = new Set<string>();
  const pending = new Set<string>();
  const cycle = (key: string): boolean => {
    if (pending.has(key)) return true;
    if (visited.has(key) || !byKey.has(key)) return false;
    pending.add(key);
    if (byKey.get(key)!.depends_on.some(cycle)) return true;
    pending.delete(key);
    visited.add(key);
    return false;
  };
  if (selected.some((row) => cycle(row.key))) problems.push({ code: "cycle" });
  return problems;
}

export function remapPlanCriteria(
  rows: TaskPlanRow[],
  previous: string[],
  next: string[],
): TaskPlanRow[] {
  return rows.map((row) => ({
    ...row,
    requirement_criteria_indices: remapCriterionIndexes(
      row.requirement_criteria_indices,
      previous,
      next,
    ),
  }));
}

export function remapCriterionIndexes(
  indexes: number[],
  previous: string[],
  next: string[],
): number[] {
  const available = new Map<string, number[]>();
  next.forEach((text, index) =>
    available.set(text, [...(available.get(text) || []), index]),
  );
  const mapping = previous.map((text) => available.get(text)?.shift());
  return indexes.flatMap((index) =>
    mapping[index] === undefined ? [] : [mapping[index]!],
  );
}

export function previewTaskPlan(
  projectId: string,
  body: PlanPreviewRequest,
  signal?: AbortSignal,
) {
  return request<TaskPlanPreview>("/api/v1/delivery/task-plan-preview", {
    method: "POST",
    headers: { "X-Project-Id": projectId },
    body: JSON.stringify(body),
    signal,
  });
}

export function planError(error: unknown): {
  message: string;
  code: string;
  conflict: boolean;
} {
  const raw = (error as Error).message || String(error);
  const plainConflict =
    raw.startsWith("HTTP 409") &&
    /Project changed|Progress scope changed|Concurrent edit|Concurrent command|Concurrent update|Concurrent.*Reload/i.test(
      raw,
    );
  try {
    const detail = JSON.parse(raw.slice(raw.indexOf(":") + 1)).detail;
    if (typeof detail === "string")
      return { message: detail, code: "", conflict: plainConflict };
    if (detail && typeof detail === "object" && detail.message) {
      const code = String(detail.code || "");
      return {
        message: String(detail.message),
        code,
        conflict:
          raw.startsWith("HTTP 409") &&
          [
            "project_version_conflict",
            "plan_basis_changed",
            "task_basis_changed",
            "planning_basis_changed",
          ].includes(code),
      };
    }
  } catch {
    /* Keep transport failures readable and retryable. */
  }
  return {
    message: raw,
    code: "",
    conflict: plainConflict,
  };
}
