import { describe, expect, it } from "vitest";
import i18next from "i18next";
import { deploymentTranslations } from "../i18n/delivery-deployment";
import appI18n from "../i18n";
describe("deployment recovery language coverage", () => {
  it.each(["zh-CN", "en-US", "ja-JP"] as const)(
    "localizes the project state operation guard in %s",
    (language) => {
      const key = "deliveryDeploymentReasons.project_not_active";
      expect(appI18n.getFixedT(language)(key)).not.toBe(key);
    },
  );
  it.each(["zh-CN", "en-US", "ja-JP"] as const)(
    "registers retirement guidance and preserves existing settings in %s",
    (language) => {
      const t = appI18n.getFixedT(language);
      for (const key of [
        "page.settings.configurationOnlyNotice",
        "page.settings.controlledReleases",
        "page.opsCenter.pipelineHistoryOnly",
        "page.opsCenter.pipelineHistoryEmpty",
        "page.settings.title",
        "page.opsCenter.workbenchTitle",
      ])
        expect(t(key)).not.toBe(key);
    },
  );
  it.each(["zh-CN", "en-US", "ja-JP"] as const)(
    "provides actionable states and actual evidence labels in %s",
    async (language) => {
      const instance = i18next.createInstance();
      await instance.init({
        lng: language,
        resources: {
          [language]: {
            translation: {
              deliveryDeployment: deploymentTranslations[language],
            },
          },
        },
        interpolation: { escapeValue: false },
      });
      for (const key of [
        "unknownHint",
        "queryOriginal",
        "noBaseline",
        "confirmRollback",
        "configuredOnly",
        "status.awaiting_promotion",
        "status.rolled_back",
        "status.unknown",
      ])
        expect(instance.t(`deliveryDeployment.${key}`)).not.toBe(
          `deliveryDeployment.${key}`,
        );
      const rule = instance.t("deliveryDeployment.observationRule", {
        samples: 3,
        seconds: 12,
      });
      expect(rule).toContain("3");
      expect(rule).toContain("12");
    },
  );
});
