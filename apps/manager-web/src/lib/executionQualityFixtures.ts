/** Structured server-response fixtures for consumer definitions; no runtime claim. */
import type { ExecutionQuality } from "./executionQuality";
export function qualityFixture(identity: { execution_id: string; run_id: string; run_version: number; attempt: number },
  status: ExecutionQuality["status"] = "not_configured"): ExecutionQuality {
  const configured = status !== "not_configured";
  return { schema: "manager.execution-quality.v1", ...identity, status, reason_codes: [],
    test_node_ids: configured ? ["tests"] : [], test_plan_sha256: "a".repeat(64), results_sha256: configured ? "b".repeat(64) : null,
    reused_node_ids: [], tests: configured ? [{ node_id: "tests", status: status === "passed" ? "passed" : "pending", result_attempt: 1, reused: false }] : [] };
}
