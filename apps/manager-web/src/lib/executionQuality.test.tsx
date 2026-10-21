/** Quality gate consumers. Definitions only; runtime execution is deferred. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { canAcceptExecution, type ExecutionQuality } from "./executionQuality";
import { executionQualityCopy } from "../i18n/execution-quality";
import { ExecutionQualityNotice } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionQualityNotice";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-US" } }) }));
const quality = (status: ExecutionQuality["status"] = "passed"): ExecutionQuality => ({
  schema: "manager.execution-quality.v1", status, reason_codes: [], execution_id: "E", run_id: "R", run_version: 7,
  attempt: 2, test_node_ids: ["tests"], test_plan_sha256: "a".repeat(64), results_sha256: "b".repeat(64),
  reused_node_ids: ["tests"], tests: [{ node_id: "tests", status: "passed", result_attempt: 1, reused: true }],
});
const observation = () => ({ execution_id: "E", run_id: "R", run_version: 7, attempt: 2, stale: false,
  status: "awaiting_review", permissions: { can_accept: true }, quality: quality() });

describe("native command test acceptance", () => {
  it("requires the fresh server capability and exact quality identity", () => {
    const value = observation();
    expect(canAcceptExecution(value)).toBe(true);
    expect(canAcceptExecution({ ...value, permissions: { can_accept: false } })).toBe(false);
    for (const status of ["not_configured", "pending", "failed", "invalid"] as const)
      expect(canAcceptExecution({ ...value, quality: quality(status) })).toBe(false);
    expect(canAcceptExecution({ ...value, quality: { ...quality(), run_id: "other" } })).toBe(false);
    expect(canAcceptExecution({ ...value, quality: { ...quality(), run_version: 6 } })).toBe(false);
    expect(canAcceptExecution({ ...value, stale: true })).toBe(false);
    expect(canAcceptExecution({ ...value, quality: undefined })).toBe(false);
  });
  it("explains missing tests and the existing rework path without claiming test success", () => {
    const html = renderToStaticMarkup(createElement(ExecutionQualityNotice, { quality: quality("not_configured") }));
    expect(html).toContain(executionQualityCopy("en-US").not_configured);
    expect(html).toContain(executionQualityCopy("en-US").next);
    expect(html).not.toContain(executionQualityCopy("en-US").passed);
  });
  it("makes same-run reused test evidence explicit", () => {
    const html = renderToStaticMarkup(createElement(ExecutionQualityNotice, { quality: quality() }));
    expect(html).toContain("tests");
    expect(html).toContain(executionQualityCopy("en-US").reused);
  });
  it.each(["zh-CN", "en-US", "ja-JP"])("provides an actionable quality explanation in %s", (language) => {
    const copy = executionQualityCopy(language);
    for (const key of ["title", "not_configured", "invalid", "pending", "failed", "passed", "next", "reused"] as const)
      expect(copy[key].trim()).not.toBe("");
  });
});
