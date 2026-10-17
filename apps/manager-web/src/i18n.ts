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

function getStoredLanguage() {
  try {
    return localStorage.getItem("i18nextLng") || undefined;
  } catch {
    return undefined;
  }
}

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
        },
      },
      "en-US": {
        translation: {
          ...enUS,
          collaboration: collaborationTranslations["en-US"],
          delivery: deliveryTranslations["en-US"],
          assistance: assistanceTranslations["en-US"],
          deliveryProject: projectInboxTranslations["en-US"],
        },
      },
      "ja-JP": {
        translation: {
          ...jaJP,
          collaboration: collaborationTranslations["ja-JP"],
          delivery: deliveryTranslations["ja-JP"],
          assistance: assistanceTranslations["ja-JP"],
          deliveryProject: projectInboxTranslations["ja-JP"],
        },
      },
    },
    detection: { order: ["localStorage"], caches: ["localStorage"] },
  });

export default i18n;
