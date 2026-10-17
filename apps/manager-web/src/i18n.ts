import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import zhCN from "./i18n/zh-CN.json";
import enUS from "./i18n/en-US.json";
import jaJP from "./i18n/ja-JP.json";
import { collaborationTranslations } from "./i18n/collaboration";
import { deliveryTranslations } from "./i18n/delivery";
import { assistanceTranslations } from "./i18n/assistance";
import { projectInboxTranslations } from "./i18n/delivery-project-inbox";
import { progressTranslations } from "./i18n/delivery-progress";
import { manualReviewTranslations } from "./i18n/delivery-manual-review";
import { taskAcceptanceTranslations } from "./i18n/task-acceptance";
import { runtimeTranslations } from "./i18n/delivery-runtime";
import { schedulingTranslations } from "./i18n/delivery-scheduling";
import { teamIdentityTranslations } from "./i18n/delivery-team";
import { teamRuntimeTranslations } from "./i18n/delivery-team-runtime";
import { projectPortfolioTranslations } from "./i18n/project-portfolio";
import {
  releaseTranslations,
  releaseReasonTranslations,
} from "./i18n/delivery-release";

function getStoredLanguage() {
  try {
    return localStorage.getItem("i18nextLng") || undefined;
  } catch {
    return undefined;
  }
}

i18n.on("languageChanged", (language) => {
  if (typeof document !== "undefined" && document.documentElement)
    document.documentElement.lang = i18n.resolvedLanguage || language;
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: getStoredLanguage() || "zh-CN",
    fallbackLng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: {
      "zh-CN": {
        translation: {
          ...zhCN,
          collaboration: collaborationTranslations["zh-CN"],
          delivery: deliveryTranslations["zh-CN"],
          assistance: assistanceTranslations["zh-CN"],
          deliveryProject: projectInboxTranslations["zh-CN"],
          deliveryProgress: progressTranslations["zh-CN"],
          deliveryManualReview: manualReviewTranslations["zh-CN"],
          deliverySchedule: schedulingTranslations["zh-CN"],
          deliveryRuntime: runtimeTranslations["zh-CN"],
          deliveryTaskAcceptance: taskAcceptanceTranslations["zh-CN"],
          deliveryTeam: teamIdentityTranslations["zh-CN"],
          deliveryTeamRuntime: teamRuntimeTranslations["zh-CN"],
          projectPortfolio: projectPortfolioTranslations["zh-CN"],
          deliveryRelease: releaseTranslations["zh-CN"],
          deliveryReleaseReasons: releaseReasonTranslations["zh-CN"],
        },
      },
      "en-US": {
        translation: {
          ...enUS,
          collaboration: collaborationTranslations["en-US"],
          delivery: deliveryTranslations["en-US"],
          assistance: assistanceTranslations["en-US"],
          deliveryProject: projectInboxTranslations["en-US"],
          deliveryProgress: progressTranslations["en-US"],
          deliveryManualReview: manualReviewTranslations["en-US"],
          deliverySchedule: schedulingTranslations["en-US"],
          deliveryRuntime: runtimeTranslations["en-US"],
          deliveryTaskAcceptance: taskAcceptanceTranslations["en-US"],
          deliveryTeam: teamIdentityTranslations["en-US"],
          deliveryTeamRuntime: teamRuntimeTranslations["en-US"],
          projectPortfolio: projectPortfolioTranslations["en-US"],
          deliveryRelease: releaseTranslations["en-US"],
          deliveryReleaseReasons: releaseReasonTranslations["en-US"],
        },
      },
      "ja-JP": {
        translation: {
          ...jaJP,
          collaboration: collaborationTranslations["ja-JP"],
          delivery: deliveryTranslations["ja-JP"],
          assistance: assistanceTranslations["ja-JP"],
          deliveryProject: projectInboxTranslations["ja-JP"],
          deliveryProgress: progressTranslations["ja-JP"],
          deliveryManualReview: manualReviewTranslations["ja-JP"],
          deliverySchedule: schedulingTranslations["ja-JP"],
          deliveryRuntime: runtimeTranslations["ja-JP"],
          deliveryTaskAcceptance: taskAcceptanceTranslations["ja-JP"],
          deliveryTeam: teamIdentityTranslations["ja-JP"],
          deliveryTeamRuntime: teamRuntimeTranslations["ja-JP"],
          projectPortfolio: projectPortfolioTranslations["ja-JP"],
          deliveryRelease: releaseTranslations["ja-JP"],
          deliveryReleaseReasons: releaseReasonTranslations["ja-JP"],
        },
      },
    },
    detection: { order: ["localStorage"], caches: ["localStorage"] },
  });

export default i18n;
