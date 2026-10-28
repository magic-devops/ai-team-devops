import { describe, expect, it } from "vitest";
import { assessmentText, isAssessedNumber } from "./catalogAssessment";

describe("catalog assessment values", () => {
  it.each([null, undefined, NaN, Infinity, -Infinity, "0", "None"])("keeps %s unassessed without numeric coercion", (value) => {
    expect(isAssessedNumber(value)).toBe(false);
    expect(assessmentText(value, "Unassessed", true)).toBe("Unassessed");
  });
  it("preserves an actual assessed zero and actual finite scores", () => {
    expect(isAssessedNumber(0)).toBe(true);
    expect(assessmentText(0, "Unassessed", true)).toBe("0%");
    expect(assessmentText(76.5, "Unassessed", true)).toBe("76.5%");
  });
});
