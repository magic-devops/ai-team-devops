import { request } from "./http";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryCommandAck,
} from "./delivery";
import type { ExecutionTarget } from "./deliveryExecution";
import { projectHeaders } from "./projectPortfolio";
import {
  releaseProblem,
  type ReleaseActor,
  type ReleaseSnapshot,
} from "./deliveryRelease";

export type DeploymentReason = { code: string; message: string };
export type DeploymentPermissions = {
  can_configure: boolean;
  can_prepare: boolean;
  can_operate: boolean;
  can_sync: boolean;
};
export type DeploymentEnvironmentDefinition = {
  workspace_id: string;
  target_device_id: string;
  runner_argv: string[];
  apply_argv: string[];
  probe_argv: string[];
  artifact_origins: string[];
  max_artifact_bytes: number;
  timeout_seconds: number;
  observation_seconds: number;
  min_samples: number;
  traffic_steps: number[];
};
export type DeploymentEnvironmentSave = DeploymentEnvironmentDefinition & {
  id: string;
  name: string;
  active: boolean;
};
export type DeploymentEnvironmentForm = {
  id: string;
  name: string;
  active: boolean;
  workspace_id: string;
  target_device_id: string;
  runner_argv: string;
  apply_argv: string;
  probe_argv: string;
  artifact_origins: string;
  max_artifact_bytes: string;
  timeout_seconds: string;
  observation_seconds: string;
  min_samples: string;
  traffic_steps: string;
};
export type DeploymentEnvironment = {
  id: string;
  name: string;
  generation: number;
  active: boolean;
  definition: DeploymentEnvironmentDefinition;
  created_at: string;
  updated_at: string;
  locked_by: string[];
  can_edit: boolean;
  reasons: DeploymentReason[];
};
export type DeploymentBaseline = {
  deployment_id: string;
  candidate_id: string;
  candidate_snapshot: ReleaseSnapshot;
  environment_id: string;
  environment_generation: number;
  target_snapshot: ExecutionTarget;
  verified_at: string;
};
export type DeploymentSnapshot = {
  kind: "deploy" | "rollback";
  candidate_id: string;
  candidate_snapshot: ReleaseSnapshot;
  environment_id: string;
  environment_name: string;
  environment_generation: number;
  definition: DeploymentEnvironmentDefinition;
  target_snapshot: ExecutionTarget;
  baseline: DeploymentBaseline | null;
  rollback_of: string;
  traffic_steps: number[];
  reason: string;
};
export type DeploymentOperation = {
  id: string;
  index: number;
  observe: boolean;
  status: string;
  plan: Record<string, unknown>;
  plan_digest: string;
  requested_by: ReleaseActor;
  runtime_scope: Record<string, string>;
  run_id: string | null;
  run_version: number | null;
  run_status: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};
export type DeploymentStatus =
  | "pending_dispatch"
  | "planned"
  | "queued"
  | "running"
  | "awaiting_promotion"
  | "verified"
  | "failed"
  | "unknown"
  | "cancelled"
  | "rolled_back";
export type DeploymentActions = {
  can_dispatch: boolean;
  can_start: boolean;
  can_advance: boolean;
  can_observe: boolean;
  can_cancel: boolean;
  can_sync: boolean;
  can_rollback: boolean;
  reasons: DeploymentReason[];
};
export type DeploymentView = {
  id: string;
  candidate_id: string;
  environment_id: string;
  kind: "deploy" | "rollback";
  status: DeploymentStatus;
  requested_by: ReleaseActor;
  snapshot: DeploymentSnapshot;
  operations: DeploymentOperation[];
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  actual_traffic: number | null;
  issue_id: string | null;
  current: boolean;
  business_valid: boolean;
  reasons: DeploymentReason[];
  basis: string;
  actions: DeploymentActions;
};
export type DeploymentIndex = {
  project_id: string;
  version: number;
  as_of: string;
  environments: DeploymentEnvironment[];
  deployments: DeploymentView[];
  permissions: DeploymentPermissions;
};
export type DeploymentDetail = Omit<DeploymentIndex, "deployments"> & {
  deployment: DeploymentView;
};
export type DeploymentPreviewInput = {
  candidate_id: string;
  environment_id: string;
  rollback_of: string;
  reason: string;
};
export type DeploymentPreview = {
  project_id: string;
  version: number;
  as_of: string;
  allowed: boolean;
  reasons: DeploymentReason[];
  preview_basis: string;
  snapshot: DeploymentSnapshot | null;
  permissions: DeploymentPermissions;
};
export type DeploymentCommand =
  | "deployment.environment.save"
  | "deployment.create"
  | "deployment.dispatch"
  | "deployment.start"
  | "deployment.advance"
  | "deployment.observe"
  | "deployment.cancel"
  | "deployment.sync";
export type DeploymentDraft = {
  projectId: string;
  form: DeploymentPreviewInput;
  preview: DeploymentPreview | null;
  intent: DeliveryIntent;
};
const scoped = (projectId: string) => {
  if (!projectId.trim() || projectId !== projectId.trim())
    throw new Error("scopeChanged");
  return projectHeaders(projectId);
};
export function fetchDeliveryDeployments(
  projectId: string,
  signal?: AbortSignal,
) {
  return request<DeploymentIndex>("/api/v1/delivery/deployments", {
    signal,
    headers: scoped(projectId),
  });
}
export function fetchDeliveryDeployment(
  projectId: string,
  id: string,
  signal?: AbortSignal,
) {
  if (!id) throw new Error("deploymentMissing");
  return request<DeploymentDetail>(
    `/api/v1/delivery/deployments/${encodeURIComponent(id)}`,
    { signal, headers: scoped(projectId) },
  );
}
export function deploymentPreviewInput(
  form: DeploymentPreviewInput,
): DeploymentPreviewInput {
  const input = {
    candidate_id: form.candidate_id,
    environment_id: form.environment_id,
    rollback_of: form.rollback_of,
    reason: form.reason.trim(),
  };
  if (
    !input.reason ||
    input.reason.length > 2000 ||
    !(
      (input.candidate_id && input.environment_id && !input.rollback_of) ||
      (input.rollback_of && !input.candidate_id && !input.environment_id)
    )
  )
    throw new Error("sourceRequired");
  return input;
}
export function previewDeliveryDeployment(
  projectId: string,
  form: DeploymentPreviewInput,
) {
  return request<DeploymentPreview>("/api/v1/delivery/deployment-preview", {
    method: "POST",
    headers: scoped(projectId),
    body: JSON.stringify(deploymentPreviewInput(form)),
  });
}
export function prepareDeployment(draft: DeploymentDraft) {
  const input = deploymentPreviewInput(draft.form),
    preview = draft.preview,
    snapshot = preview?.snapshot;
  if (
    !preview?.allowed ||
    !preview.permissions.can_prepare ||
    !snapshot ||
    preview.project_id !== draft.projectId ||
    preview.version !== draft.intent.version
  )
    throw new Error("previewRequired");
  const captured = {
    candidate_id: snapshot.kind === "rollback" ? "" : snapshot.candidate_id,
    environment_id: snapshot.kind === "rollback" ? "" : snapshot.environment_id,
    rollback_of: snapshot.rollback_of,
    reason: snapshot.reason,
  };
  if (
    JSON.stringify(input) !== JSON.stringify(deploymentPreviewInput(captured))
  )
    throw new Error("previewRequired");
  const payload = { ...input, preview_basis: preview.preview_basis };
  const intent = prepareDeliveryIntent(
    draft.intent,
    "deployment.create",
    payload,
  );
  return { payload, intent, draft: { ...draft, intent } };
}
export function submitDeploymentCommand(
  projectId: string,
  action: DeploymentCommand,
  payload: Record<string, unknown>,
  intent: DeliveryIntent,
) {
  return request<DeliveryCommandAck>("/api/v1/delivery/commands", {
    method: "POST",
    headers: scoped(projectId),
    body: JSON.stringify({
      action,
      payload,
      expected_version: intent.version,
      idempotency_key: intent.key,
    }),
  });
}
export function deploymentProblem(problem: unknown) {
  const info = releaseProblem(problem);
  return {
    ...info,
    unknown: !/HTTP (400|401|403|404|409|422)(?:\D|$)/.test(String(problem)),
  };
}
export function deploymentRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function deploymentEnvironmentForm(
  environment?: DeploymentEnvironment,
): DeploymentEnvironmentForm {
  const definition = environment?.definition;
  return {
    id: environment?.id || "",
    name: environment?.name || "",
    active: environment?.active ?? true,
    workspace_id: definition?.workspace_id || "",
    target_device_id: definition?.target_device_id || "",
    runner_argv: JSON.stringify(definition?.runner_argv || []),
    apply_argv: JSON.stringify(definition?.apply_argv || []),
    probe_argv: JSON.stringify(definition?.probe_argv || []),
    artifact_origins: JSON.stringify(definition?.artifact_origins || []),
    max_artifact_bytes: String(definition?.max_artifact_bytes ?? 268435456),
    timeout_seconds: String(definition?.timeout_seconds ?? 120),
    observation_seconds: String(definition?.observation_seconds ?? 10),
    min_samples: String(definition?.min_samples ?? 2),
    traffic_steps: JSON.stringify(definition?.traffic_steps || [5, 25, 100]),
  };
}
export function deploymentEnvironmentInput(
  form: DeploymentEnvironmentForm,
): DeploymentEnvironmentSave {
  const strings = (raw: string, max: number) => {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("jsonArray");
    }
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > max ||
      value.some(
        (x) => typeof x !== "string" || !x || /[\u0000-\u001f\u007f]/.test(x),
      )
    )
      throw new Error("jsonArray");
    return value as string[];
  };
  const integer = (raw: string, min: number, max: number) => {
    const value = Number(raw);
    if (!raw.trim() || !Number.isInteger(value) || value < min || value > max)
      throw new Error("invalidEnvironment");
    return value;
  };
  let steps: unknown;
  try {
    steps = JSON.parse(form.traffic_steps);
  } catch {
    throw new Error("jsonArray");
  }
  if (
    !Array.isArray(steps) ||
    !steps.length ||
    steps.length > 10 ||
    steps.some(
      (n, i) =>
        typeof n !== "number" ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > 100 ||
        (i && n <= steps[i - 1]),
    ) ||
    steps.at(-1) !== 100
  )
    throw new Error("invalidEnvironment");
  if (
    !form.name.trim() ||
    form.name.trim().length > 80 ||
    !form.workspace_id.trim()
  )
    throw new Error("invalidEnvironment");
  const input: DeploymentEnvironmentSave = {
    id: form.id,
    name: form.name.trim(),
    active: form.active,
    workspace_id: form.workspace_id.trim(),
    target_device_id: form.target_device_id.trim(),
    runner_argv: strings(form.runner_argv, 64),
    apply_argv: strings(form.apply_argv, 128),
    probe_argv: strings(form.probe_argv, 128),
    artifact_origins: strings(form.artifact_origins, 8),
    max_artifact_bytes: integer(form.max_artifact_bytes, 1, 268435456),
    timeout_seconds: integer(form.timeout_seconds, 3, 3540),
    observation_seconds: integer(form.observation_seconds, 1, 600),
    min_samples: integer(form.min_samples, 1, 100),
    traffic_steps: steps as number[],
  };
  if (input.timeout_seconds <= input.observation_seconds + 1)
    throw new Error("invalidEnvironment");
  return input;
}
