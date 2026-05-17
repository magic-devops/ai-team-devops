import type { RequirementMode } from "../Requirements";

const MODES: RequirementMode[] = ["pool", "review", "generation", "batch"];

const LEGACY_MODE: Record<string, RequirementMode> = {
  requirement_pool: "pool",
  smart_review: "review",
  task_generation: "generation",
  batch_governance: "batch",
};

function pickMode(segment: string | undefined): RequirementMode {
  if (!segment) return "pool";
  if (MODES.includes(segment as RequirementMode)) return segment as RequirementMode;
  return LEGACY_MODE[segment] ?? "pool";
}

export type RequirementsRouteState = {
  mode: RequirementMode;
  focused: boolean;
};

/** 从 hash 解析需求工作台阶段（pool / review / generation / batch）。 */
export function parseRequirementsHash(hash: string): RequirementsRouteState {
  const h = (hash || "#/requirements").split("?")[0];

  if (h === "#/requirements/workbench" || h === "#/requirements/workbench/") {
    return { mode: "pool", focused: true };
  }

  const m = h.match(/^#\/requirements\/([\w-]+)$/);
  if (m) {
    const seg = m[1];
    if (seg === "workbench") return { mode: "pool", focused: true };
    if (MODES.includes(seg as RequirementMode) || seg in LEGACY_MODE) {
      return { mode: pickMode(seg), focused: true };
    }
  }

  if (h === "#/requirements" || h === "#/requirements/") {
    return { mode: "pool", focused: false };
  }

  return { mode: "pool", focused: false };
}

export function requirementsPhaseHref(mode: RequirementMode): string {
  return `#/requirements/${mode}`;
}

export const REQUIREMENTS_WORKBENCH_PATH = "#/requirements/pool";
