import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { IntelligenceHub } from "../../subapps/ai-foundation/src/pages/intelligence/IntelligenceHub";
import { SystemProductionReadinessPanel } from "../../subapps/ai-ops-center/src/pages/system/SystemProductionReadinessPanel";
import { MicroAppGovernance } from "../../subapps/ai-ops-center/src/pages/governance/MicroAppGovernance";
import { SystemMapHub } from "../../subapps/ai-ops-center/src/pages/governance/SystemMapHub";
import { SystemMap } from "../../subapps/ai-ops-center/src/pages/SystemMap";
import { SystemExperiencePriorityPanel } from "../../subapps/ai-ops-center/src/pages/system/SystemExperiencePriorityPanel";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => vi.unstubAllGlobals());
it("renders the real catalog consumer's nullable assessment as unassessed instead of a fabricated percentage", () => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "sop-token" ? "token" : null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["intelligenceHub"], { summary: {}, domains: [], stack_layers: [{ id: "reflectionIntake", name: "Canonical intake", maturity: null, assessment_state: "unassessed" }] });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(IntelligenceHub)));
  expect(html).toContain("catalogAssessment.unassessed");
  expect(html).not.toContain("null%");
  expect(html).not.toContain("NaN");
  client.clear();
});
it("renders real microapp modules with an unknown assessment without inventing zero percent", () => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "sop-token" ? "token" : null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["systemPagesMicroApps"], { summary: {}, apps: [{ id: "ai", name: "AI", owner: "Team", route: "#/intelligence", runtime_url: "", entry: "", mode: "", status: "watch", avg_maturity: null, module_count: 1, domain_module_count: 1, capability_count: 1, modules: [{ id: "reflectionIntake", name: "Canonical intake", path: "#/intelligence/reflections", maturity: null, assessment_state: "unassessed" }] }] });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MicroAppGovernance)));
  expect(html).toContain("catalogAssessment.unassessed");
  expect(html).not.toContain("null%");
  client.clear();
});
it("renders the real production readiness consumer's unassessed row without a success or gap claim", () => {
  const html = renderToStaticMarkup(createElement(SystemProductionReadinessPanel, { rows: [{ id: "reflectionIntake", name: "Canonical intake", path: "#/intelligence/reflections", domain: "ai", assessment_state: "unassessed", stage: "unassessed", production_score: null, readiness_score: null, dimensions: {}, recommendations: [] }], data: { summary: { avg_production_score: null, assessed_count: 0, unassessed_count: 1 } }, stage: "all", loading: false, domainLabel: (id: string) => id, onStageChange: () => {} }));
  expect(html).toContain("catalogAssessment.unassessed");
  expect(html).not.toContain("page.systemMap.productionNoGap");
});
it("keeps the SystemMap hub's all-unknown average and stack layer unassessed with assessment counts", () => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "sop-token" ? "token" : null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["systemPagesHub"], { summary: { avg_maturity: null, assessed_count: 0, unassessed_count: 1 }, domains: [], stack_layers: [{ id: "unknown", name: "Unknown layer", avg_maturity: null }], micro_apps: [] });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(SystemMapHub)));
  expect(html).toContain("catalogAssessment.unassessed");
  expect(html).toContain("catalogAssessment.counts");
  expect(html).not.toContain("0%");
  client.clear();
});
it("uses actual finite maturity values in the real SystemMap registry, preserving a true zero", () => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "sop-token" ? "token" : null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["systemPages", "react", "all", "all", ""], { react: [{ id: "unknown", name: "Unknown module", path: "#/unknown", domain: "ai", maturity: null }, { id: "zero", name: "Assessed zero", path: "#/zero", domain: "ai", maturity: 0 }] });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(SystemMap, { focused: true, initialSection: "registry" })));
  expect(html).toContain("catalogAssessment.unassessed");
  expect(html).toContain("0%");
  expect(html).not.toContain("null%");
  client.clear();
});
it("does not turn an unknown experience assessment into a priority issue or no-gap conclusion", () => {
  const html = renderToStaticMarkup(createElement(SystemExperiencePriorityPanel, { rows: [{ id: "unknown", name: "Unknown module", experience_score: null, status: "unassessed", dimensions: {}, recommendations: [] }], summary: { assessed_count: 0, unassessed_count: 1 }, domainLabel: (value: string) => value, canWrite: true, taskPending: false, onFocusModule: () => {}, onPreviewModuleTask: () => {}, onCreateModuleTask: () => {} }));
  expect(html).toContain("catalogAssessment.unassessed");
  expect(html).not.toContain("page.systemMap.noReadinessGaps");
  expect(html).not.toContain("Unknown module");
});
