export type ExecutionTestPlan = {
  schema: "manager.execution-test-plan.v1";
  node_ids: string[];
  command_sha256: Record<string, string>;
};
export type ExecutionQuality = {
  schema: "manager.execution-quality.v1";
  status: "not_configured" | "pending" | "failed" | "invalid" | "passed";
  reason_codes: string[];
  execution_id: string;
  run_id: string;
  run_version: number;
  attempt: number;
  test_node_ids: string[];
  test_plan_sha256: string | null;
  results_sha256: string | null;
  reused_node_ids: string[];
  tests: { node_id: string; status: "pending" | "failed" | "skipped" | "invalid" | "passed";
    result_attempt: number | null; reused: boolean }[];
};
export function canAcceptExecution(value?: {
  execution_id: string; run_id: string; run_version: number; attempt: number;
  status: string; stale: boolean; quality?: ExecutionQuality; permissions: { can_accept: boolean };
}) {
  const quality = value?.quality;
  return Boolean(value && !value.stale && value.status === "awaiting_review" && value.permissions.can_accept === true &&
    quality?.schema === "manager.execution-quality.v1" && quality.status === "passed" &&
    quality.execution_id === value.execution_id && quality.run_id === value.run_id &&
    quality.run_version === value.run_version && quality.attempt === value.attempt);
}
