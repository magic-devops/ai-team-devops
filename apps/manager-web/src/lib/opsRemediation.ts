import { bindSessionRequest } from "./http";
import { getSessionRevision } from "./authStorage";
import type { OpsIntakeOriginal } from "./opsIntakeCommand";
export type OpsIntakeView = {
  project_id: string; version: number; as_of: string; source_id: string; source_digest: string;
  source_kind: "reported_only"; snapshot: Record<string, unknown>; existing_issue_id: string | null;
  existing_issue_available: boolean; can_intake: boolean;
};
export async function readOpsIntake(projectId: string, sourceId: string, signal?: AbortSignal): Promise<OpsIntakeView> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sourceId)) throw new Error("ops_source_invalid");
  const send = bindSessionRequest({ projectId, revision: getSessionRevision() || "" });
  const value = await send<OpsIntakeView>(`/api/v1/delivery/ops-actions/${encodeURIComponent(sourceId)}/intake`, { signal, headers: { "X-Project-Id": projectId } });
  if (!value || value.project_id !== projectId || value.source_id !== sourceId || !/^[a-f0-9]{64}$/.test(value.source_digest) ||
      !Number.isSafeInteger(value.version) || value.version < 0 || value.source_kind !== "reported_only" ||
      !value.snapshot || typeof value.snapshot !== "object" || Array.isArray(value.snapshot) ||
      value.snapshot.id !== sourceId ||
      typeof value.can_intake !== "boolean" || typeof value.existing_issue_available !== "boolean" ||
      value.existing_issue_id !== null && (typeof value.existing_issue_id !== "string" || !value.existing_issue_id.trim())) throw new Error("ops_source_invalid");
  return value;
}
export function opsIntakeOriginal(view: OpsIntakeView, fields: { title: string; description: string; severity: "P0" | "P1" | "P2" | "P3" }, key: string): OpsIntakeOriginal {
  return { action: "issue.ops.intake", payload: { source_id: view.source_id, source_digest: view.source_digest, ...fields }, intent: { version: view.version, key } };
}
