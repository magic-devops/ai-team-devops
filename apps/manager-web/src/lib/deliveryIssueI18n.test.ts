import { describe, expect, it } from "vitest";
import { issueTranslations } from "../i18n/delivery-issue";
function leaves(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === "object" && item
        ? leaves(item as Record<string, unknown>, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    )
    .sort();
}
describe("problem diagnosis language contract", () => {
  it("provides the same nonempty translation keys in Chinese, English and Japanese", () => {
    expect(leaves(issueTranslations["zh-CN"])).toEqual(
      leaves(issueTranslations["en-US"]),
    );
    expect(leaves(issueTranslations["ja-JP"])).toEqual(
      leaves(issueTranslations["en-US"]),
    );
  });
  for (const locale of ["en-US", "zh-CN", "ja-JP"] as const)
    it(`translates evidence validity, historical results and server diagnosis reasons in ${locale}`, () => {
      const text = issueTranslations[locale] as any;
      expect(text.facts.business_valid).toBeTruthy();
      expect(text.evidenceStates.historical).toBeTruthy();
      for (const suffix of [
        "access_changed",
        "scope_changed",
        "evidence_restricted",
        "basis_changed",
        "source_missing",
        "approval_required",
        "unavailable",
        "reviewed",
        "cursor_invalid",
        "write_required",
        "issue_required",
        "evidence_unavailable",
        "evidence_changed",
        "idempotency_conflict",
        "version_conflict",
        "concurrent",
        "missing",
        "dismiss_denied",
        "action_invalid",
        "invalid_output",
        "generation_failed",
      ])
        expect(text.reasons[`issue_diagnosis_${suffix}`]).toBeTruthy();
    });
});
