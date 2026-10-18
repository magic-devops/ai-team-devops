import { eventReceiptTranslations } from "./i18n/event-receipts";
import { assetSyncTranslations } from "./i18n/asset-sync";
import { deliveryDiscussionTranslations } from "./i18n/delivery-discussion";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import zhCN from "./i18n/zh-CN.json";
import enUS from "./i18n/en-US.json";
import jaJP from "./i18n/ja-JP.json";
import { collaborationTranslations } from "./i18n/collaboration";
import { deliveryTranslations } from "./i18n/delivery";
import { deliveryQueryTranslations } from "./i18n/delivery-query";
import { deliveryCollaborationTranslations } from "./i18n/deliveryCollaboration";
import { assistanceTranslations } from "./i18n/assistance";
import { projectInboxTranslations } from "./i18n/delivery-project-inbox";
import { progressTranslations } from "./i18n/delivery-progress";
import { deliveryAttentionTranslations } from "./i18n/delivery-attention";
import { manualReviewTranslations } from "./i18n/delivery-manual-review";
import { taskAcceptanceTranslations } from "./i18n/task-acceptance";
import { runtimeTranslations } from "./i18n/delivery-runtime";
import { executionRuntimeTranslations } from "./i18n/delivery-execution-runtime";
import { schedulingTranslations } from "./i18n/delivery-scheduling";
import { teamIdentityTranslations } from "./i18n/delivery-team";
import { teamRuntimeTranslations } from "./i18n/delivery-team-runtime";
import { projectPortfolioTranslations } from "./i18n/project-portfolio";
import { issueTranslations } from "./i18n/delivery-issue";
import { deploymentTranslations } from "./i18n/delivery-deployment";
import { deploymentReasonTranslations } from "./i18n/delivery-deployment-reasons";
import {
  legacyDeploymentRetirementZh,
  legacyDeploymentRetirementEn,
  legacyDeploymentRetirementJa,
} from "./i18n/legacy-deployment-retirement";
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
          page: {
            ...zhCN.page,
            settings: {
              ...zhCN.page.settings,
              ...legacyDeploymentRetirementZh.page.settings,
            },
            opsCenter: {
              ...zhCN.page.opsCenter,
              ...legacyDeploymentRetirementZh.page.opsCenter,
            },
          },
          collaboration: collaborationTranslations["zh-CN"],
          delivery: deliveryTranslations["zh-CN"],
          deliveryQuery: deliveryQueryTranslations["zh-CN"],
          deliveryCollaboration: deliveryCollaborationTranslations["zh-CN"],
          assistance: assistanceTranslations["zh-CN"],
          deliveryProject: projectInboxTranslations["zh-CN"],
          deliveryProgress: progressTranslations["zh-CN"],
          deliveryAttention: deliveryAttentionTranslations["zh-CN"],
          deliveryDiscussion: deliveryDiscussionTranslations["zh-CN"],
          eventReceipts: eventReceiptTranslations["zh-CN"],
          assetSync: assetSyncTranslations["zh-CN"],
          deliveryManualReview: manualReviewTranslations["zh-CN"],
          deliverySchedule: schedulingTranslations["zh-CN"],
          deliveryRuntime: runtimeTranslations["zh-CN"],
          deliveryExecutionRuntime: executionRuntimeTranslations["zh-CN"],
          deliveryTaskAcceptance: taskAcceptanceTranslations["zh-CN"],
          deliveryTeam: teamIdentityTranslations["zh-CN"],
          deliveryTeamRuntime: teamRuntimeTranslations["zh-CN"],
          projectPortfolio: projectPortfolioTranslations["zh-CN"],
          deliveryRelease: releaseTranslations["zh-CN"],
          deliveryIssue: issueTranslations["zh-CN"],
          deliveryDeployment: deploymentTranslations["zh-CN"],
          deliveryDeploymentReasons: deploymentReasonTranslations["zh-CN"],
          deliveryReleaseReasons: releaseReasonTranslations["zh-CN"],
        },
      },
      "en-US": {
        translation: {
          ...enUS,
          page: {
            ...enUS.page,
            settings: {
              ...enUS.page.settings,
              ...legacyDeploymentRetirementEn.page.settings,
            },
            opsCenter: {
              ...enUS.page.opsCenter,
              ...legacyDeploymentRetirementEn.page.opsCenter,
            },
          },
          collaboration: collaborationTranslations["en-US"],
          delivery: deliveryTranslations["en-US"],
          deliveryQuery: deliveryQueryTranslations["en-US"],
          deliveryCollaboration: deliveryCollaborationTranslations["en-US"],
          assistance: assistanceTranslations["en-US"],
          deliveryProject: projectInboxTranslations["en-US"],
          deliveryProgress: progressTranslations["en-US"],
          deliveryAttention: deliveryAttentionTranslations["en-US"],
          deliveryDiscussion: deliveryDiscussionTranslations["en-US"],
          eventReceipts: eventReceiptTranslations["en-US"],
          assetSync: assetSyncTranslations["en-US"],
          deliveryManualReview: manualReviewTranslations["en-US"],
          deliverySchedule: schedulingTranslations["en-US"],
          deliveryRuntime: runtimeTranslations["en-US"],
          deliveryExecutionRuntime: executionRuntimeTranslations["en-US"],
          deliveryTaskAcceptance: taskAcceptanceTranslations["en-US"],
          deliveryTeam: teamIdentityTranslations["en-US"],
          deliveryTeamRuntime: teamRuntimeTranslations["en-US"],
          projectPortfolio: projectPortfolioTranslations["en-US"],
          deliveryRelease: releaseTranslations["en-US"],
          deliveryIssue: issueTranslations["en-US"],
          deliveryDeployment: deploymentTranslations["en-US"],
          deliveryDeploymentReasons: deploymentReasonTranslations["en-US"],
          deliveryReleaseReasons: releaseReasonTranslations["en-US"],
        },
      },
      "ja-JP": {
        translation: {
          ...jaJP,
          page: {
            ...jaJP.page,
            settings: {
              ...jaJP.page.settings,
              ...legacyDeploymentRetirementJa.page.settings,
            },
            opsCenter: {
              ...jaJP.page.opsCenter,
              ...legacyDeploymentRetirementJa.page.opsCenter,
            },
          },
          collaboration: collaborationTranslations["ja-JP"],
          delivery: deliveryTranslations["ja-JP"],
          deliveryQuery: deliveryQueryTranslations["ja-JP"],
          deliveryCollaboration: deliveryCollaborationTranslations["ja-JP"],
          assistance: assistanceTranslations["ja-JP"],
          deliveryProject: projectInboxTranslations["ja-JP"],
          deliveryProgress: progressTranslations["ja-JP"],
          deliveryAttention: deliveryAttentionTranslations["ja-JP"],
          deliveryDiscussion: deliveryDiscussionTranslations["ja-JP"],
          eventReceipts: eventReceiptTranslations["ja-JP"],
          assetSync: assetSyncTranslations["ja-JP"],
          deliveryManualReview: manualReviewTranslations["ja-JP"],
          deliverySchedule: schedulingTranslations["ja-JP"],
          deliveryRuntime: runtimeTranslations["ja-JP"],
          deliveryExecutionRuntime: executionRuntimeTranslations["ja-JP"],
          deliveryTaskAcceptance: taskAcceptanceTranslations["ja-JP"],
          deliveryTeam: teamIdentityTranslations["ja-JP"],
          deliveryTeamRuntime: teamRuntimeTranslations["ja-JP"],
          projectPortfolio: projectPortfolioTranslations["ja-JP"],
          deliveryRelease: releaseTranslations["ja-JP"],
          deliveryIssue: issueTranslations["ja-JP"],
          deliveryDeployment: deploymentTranslations["ja-JP"],
          deliveryDeploymentReasons: deploymentReasonTranslations["ja-JP"],
          deliveryReleaseReasons: releaseReasonTranslations["ja-JP"],
        },
      },
    },
    detection: { order: ["localStorage"], caches: ["localStorage"] },
  });

export default i18n;
