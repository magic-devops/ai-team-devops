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
import { runtimeTranslations } from "./i18n/delivery-runtime";
import { schedulingTranslations } from "./i18n/delivery-scheduling";

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
        },
      },
    },
    detection: { order: ["localStorage"], caches: ["localStorage"] },
  });

export default i18n;
