import type { CatalogPanel } from "../../Analytics";

export type { CatalogPanel };

export type GovernanceStackLayer = {
  id: string;
  title: string;
  items: string[];
  engines: string[];
};

export type GovernanceDomainCard = {
  id: CatalogPanel;
  path: string;
  summary: Record<string, unknown>;
  capabilities: string[];
};

export const GOVERNANCE_DOMAIN_ORDER: CatalogPanel[] = ["assets", "metrics", "services", "quality", "development"];

export const GOVERNANCE_DOMAIN_I18N: Record<CatalogPanel, { title: string; desc: string; aiPrefill: string }> = {
  assets: {
    title: "page.dataGovernance.domains.assets.title",
    desc: "page.dataGovernance.domains.assets.desc",
    aiPrefill: "page.dataGovernance.domains.assets.aiPrefill",
  },
  metrics: {
    title: "page.dataGovernance.domains.metrics.title",
    desc: "page.dataGovernance.domains.metrics.desc",
    aiPrefill: "page.dataGovernance.domains.metrics.aiPrefill",
  },
  services: {
    title: "page.dataGovernance.domains.services.title",
    desc: "page.dataGovernance.domains.services.desc",
    aiPrefill: "page.dataGovernance.domains.services.aiPrefill",
  },
  quality: {
    title: "page.dataGovernance.domains.quality.title",
    desc: "page.dataGovernance.domains.quality.desc",
    aiPrefill: "page.dataGovernance.domains.quality.aiPrefill",
  },
  development: {
    title: "page.dataGovernance.domains.development.title",
    desc: "page.dataGovernance.domains.development.desc",
    aiPrefill: "page.dataGovernance.domains.development.aiPrefill",
  },
};
