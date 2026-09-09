import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import zhCN from "./i18n/zh-CN.json";
import enUS from "./i18n/en-US.json";
import jaJP from "./i18n/ja-JP.json";
import { collaborationTranslations } from "./i18n/collaboration";

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
      "zh-CN": { translation: { ...zhCN, collaboration: collaborationTranslations["zh-CN"] } },
      "en-US": { translation: { ...enUS, collaboration: collaborationTranslations["en-US"] } },
      "ja-JP": { translation: { ...jaJP, collaboration: collaborationTranslations["ja-JP"] } },
    },
    detection: { order: ["localStorage"], caches: ["localStorage"] },
  });

export default i18n;
