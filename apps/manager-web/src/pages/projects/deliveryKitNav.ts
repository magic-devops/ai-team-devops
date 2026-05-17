import type { TFunction } from "i18next";
import type { GovernancePanelKey } from "./GovernanceModule";
import type { OnboardingPanelKey } from "./OnboardingModule";
import type { DeliveryPhase } from "./ProjectDeliveryKitShell";
import type { TemplatePanelKey } from "./TemplatesModule";
import type { TabKey } from "./types";

export type ProjectsRouteState = {
  tab: TabKey;
  onboardingPanel: OnboardingPanelKey;
  templatePanel: TemplatePanelKey;
  governancePanel: GovernancePanelKey;
  focused: boolean;
};

const ONBOARDING_PANELS: OnboardingPanelKey[] = ["overview", "commands", "env", "agent", "profiles", "context"];
const TEMPLATE_PANELS: TemplatePanelKey[] = ["overview", "catalog", "clone", "capabilities"];
const GOVERNANCE_PANELS: GovernancePanelKey[] = ["review", "ops", "actions", "prompt"];

function pickPanel<T extends string>(segment: string | undefined, allowed: readonly T[], fallback: T): T {
  if (segment && allowed.includes(segment as T)) return segment as T;
  return fallback;
}

/** 从 hash 解析项目管理页（含 AI 交付套件三阶段子路径）。 */
export function parseProjectsDeliveryHash(hash: string): ProjectsRouteState {
  const h = (hash || "#/projects").split("?")[0];

  if (h === "#/projects/delivery-kit" || h === "#/projects/delivery-kit/") {
    return {
      tab: "templates",
      templatePanel: "overview",
      onboardingPanel: "overview",
      governancePanel: "review",
      focused: true,
    };
  }

  const templates = h.match(/^#\/projects\/templates(?:\/([\w-]+))?$/);
  if (templates) {
    return {
      tab: "templates",
      templatePanel: pickPanel(templates[1], TEMPLATE_PANELS, "overview"),
      onboardingPanel: "overview",
      governancePanel: "review",
      focused: true,
    };
  }

  const onboarding = h.match(/^#\/projects\/onboarding(?:\/([\w-]+))?$/);
  if (onboarding) {
    const seg = onboarding[1] === "agent" ? "agent" : onboarding[1];
    return {
      tab: "onboarding",
      onboardingPanel: pickPanel(seg, ONBOARDING_PANELS, "overview"),
      templatePanel: "overview",
      governancePanel: "review",
      focused: true,
    };
  }

  const governance = h.match(/^#\/projects\/governance(?:\/([\w-]+))?$/);
  if (governance) {
    return {
      tab: "governance",
      governancePanel: pickPanel(governance[1], GOVERNANCE_PANELS, "review"),
      templatePanel: "overview",
      onboardingPanel: "overview",
      focused: true,
    };
  }

  const portfolio = h.match(/^#\/projects\/([\w-]+)$/);
  if (portfolio) {
    const seg = portfolio[1];
    const tabKeys: TabKey[] = ["portfolio", "business", "tenants", "users", "members"];
    if (tabKeys.includes(seg as TabKey)) {
      return {
        tab: seg as TabKey,
        templatePanel: "overview",
        onboardingPanel: "overview",
        governancePanel: "review",
        focused: true,
      };
    }
  }

  if (h === "#/projects") {
    return {
      tab: "portfolio",
      templatePanel: "overview",
      onboardingPanel: "overview",
      governancePanel: "review",
      focused: false,
    };
  }

  return {
    tab: "portfolio",
    templatePanel: "overview",
    onboardingPanel: "overview",
    governancePanel: "review",
    focused: false,
  };
}

export function onboardingSubNav(panel: OnboardingPanelKey, t: TFunction) {
  const items: { key: OnboardingPanelKey; label: string; path: string }[] = [
    { key: "overview", label: t("page.projects.panelOverview"), path: "overview" },
    { key: "commands", label: t("page.projects.panelCommands"), path: "commands" },
    { key: "env", label: t("page.projects.panelEnv"), path: "env" },
    { key: "agent", label: t("page.projects.panelAgent"), path: "agent" },
    { key: "profiles", label: t("page.projects.panelProfiles"), path: "profiles" },
    { key: "context", label: t("page.projects.panelContext"), path: "context" },
  ];
  return items.map((item) => ({
    key: item.key,
    label: item.label,
    href: `#/projects/onboarding/${item.path}`,
    active: panel === item.key,
  }));
}

export function templateSubNav(panel: TemplatePanelKey, t: TFunction) {
  const items: { key: TemplatePanelKey; label: string; path: string }[] = [
    { key: "overview", label: t("page.projects.templateOverview"), path: "overview" },
    { key: "catalog", label: t("page.projects.templateCatalog"), path: "catalog" },
    { key: "clone", label: t("page.projects.templateCloneWizard"), path: "clone" },
    { key: "capabilities", label: t("page.projects.templateCapabilities"), path: "capabilities" },
  ];
  return items.map((item) => ({
    key: item.key,
    label: item.label,
    href: `#/projects/templates/${item.path}`,
    active: panel === item.key,
  }));
}

export function governanceSubNav(panel: GovernancePanelKey, t: TFunction) {
  const items: { key: GovernancePanelKey; label: string; path: string }[] = [
    { key: "review", label: t("page.projects.governanceReview"), path: "review" },
    { key: "ops", label: t("page.projects.opsPlan"), path: "ops" },
    { key: "actions", label: t("page.projects.nextActions"), path: "actions" },
    { key: "prompt", label: t("page.projects.agentPrompt"), path: "prompt" },
  ];
  return items.map((item) => ({
    key: item.key,
    label: item.label,
    href: `#/projects/governance/${item.path}`,
    active: panel === item.key,
  }));
}

export function isDeliveryTab(tab: string): tab is DeliveryPhase {
  return tab === "templates" || tab === "onboarding" || tab === "governance";
}

export const DELIVERY_KIT_PATH = "#/projects/delivery-kit";
