import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import zhCN from "./i18n/zh-CN.json";
import enUS from "./i18n/en-US.json";
import jaJP from "./i18n/ja-JP.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
      "ja-JP": { translation: jaJP },
    },
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
  });

export default i18n;
