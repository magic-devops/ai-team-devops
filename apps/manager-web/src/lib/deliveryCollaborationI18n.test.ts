import { describe, expect, it } from "vitest";
import appI18n from "../i18n";
import { deliveryCollaborationTranslations } from "../i18n/deliveryCollaboration";
describe("collaboration language registration", () => {
  it.each(["zh-CN", "en-US", "ja-JP"] as const)(
    "registers readable recovery and exact historical states in %s",
    (language) => {
      const t = appI18n.getFixedT(language);
      for (const key of [
        "eventUnavailable",
        "unknownAssociationHint",
        "unknownWriteHint",
        "adoptLatest",
        "earlierUnknown",
        "currentImpactHint",
        "restrictedLinks",
        "fields.acceptance_criteria",
        "kinds.execution",
        "actions.execution.review",
        "actions.release.candidate.create",
        "actions.deployment.start",
      ]) {
        expect(t(`deliveryCollaboration.${key}`)).not.toBe(
          `deliveryCollaboration.${key}`,
        );
      }
      expect(
        Object.keys(deliveryCollaborationTranslations[language]).sort(),
      ).toEqual(Object.keys(deliveryCollaborationTranslations["zh-CN"]).sort());
    },
  );
});
