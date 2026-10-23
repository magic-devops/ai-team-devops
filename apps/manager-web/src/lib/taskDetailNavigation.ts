import type { DeliveryTask } from "./delivery";

export const taskDetailSections = ["overview", "execution", "work-order", "design", "delivery", "planning", "discussion"] as const;
export type TaskDetailSection = (typeof taskDetailSections)[number];

/** A reading suggestion only. Each destination retains its own live authority. */
export function taskDetailNextSection(task: DeliveryTask): TaskDetailSection | null {
  if (task.verified && task.delivery_status === "verified_completed") return null;
  if (task.dependency_blocked?.length || task.planning?.blocked_reason) return "planning";
  if (task.execution_id) return "execution";
  if (["awaiting_review", "recorded_completed", "verified_completed"].includes(task.delivery_status) ||
      (task.recorded_status || task.status) === "completed") return "delivery";
  // Missing a native execution says nothing about external work or human work.
  return null;
}

/** Scope the lookup to this mounted detail; never navigate the route or mutate. */
export function focusTaskSection(root: HTMLElement | null, section: TaskDetailSection, isActive: () => boolean) {
  if (!root || !isActive()) return false;
  const target = root.querySelector<HTMLElement>(`[data-task-section="${section}"]`);
  if (!target || !isActive()) return false;
  const reduced = typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  return true;
}
