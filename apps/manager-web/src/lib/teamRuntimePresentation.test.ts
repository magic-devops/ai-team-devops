import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExecutionExecutorFacts, RuntimeBindingFacts } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionExecutorFacts";
import { teamRuntimeTranslations } from "../i18n/delivery-team-runtime";
import type { ExecutorSnapshot } from "./deliveryTeamRuntime";
let language: keyof typeof teamRuntimeTranslations = "zh-CN";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key.split(".").slice(1).reduce<unknown>((value, field) => value && typeof value === "object" ? (value as Record<string, unknown>)[field] : undefined, teamRuntimeTranslations[language]) || key }) }));
const snapshot: ExecutorSnapshot = { member_id: "agent:recorded", member_name: "Original executor name", binding_basis: "binding-original", binding_generation: 2, workspace_id: "runtime-original", workspace_name: "Original runtime", agent_id: "profile-original", agent_version: 4, agent_title: "Original profile", profile_digest: "original-digest", provider: "codex", recorded_at: "2026-10-17T00:00:00Z", recorded_by: "user:lead" };
describe("immutable execution member presentation", () => {
  it.each(["zh-CN", "en-US", "ja-JP"] as const)("distinguishes unassociated dispatches from unrecorded history (%s)", (locale) => {
    language = locale;
    expect(renderToStaticMarkup(createElement(ExecutionExecutorFacts, { snapshot: null }))).toContain(teamRuntimeTranslations[locale].noAssociation);
    expect(renderToStaticMarkup(createElement(ExecutionExecutorFacts, { snapshot: undefined }))).toContain(teamRuntimeTranslations[locale].unrecorded);
  });
  it("renders the original member, configuration version and generation without a live roster lookup", () => {
    const html = renderToStaticMarkup(createElement(ExecutionExecutorFacts, { snapshot }));
    for (const value of [snapshot.member_name, snapshot.member_id, snapshot.workspace_id, snapshot.agent_id, "v4", snapshot.recorded_at]) expect(html).toContain(value);
    expect(html).not.toContain("deliveryTeamRuntime.");
  });
  it("shows stored binding source while current runtime access is unavailable", () => {
    const html = renderToStaticMarkup(createElement(RuntimeBindingFacts, { binding: { workspace_id: snapshot.workspace_id, agent_id: snapshot.agent_id, agent_version: snapshot.agent_version, profile_digest: snapshot.profile_digest, source: { workspace_name: snapshot.workspace_name, agent_title: snapshot.agent_title, provider: snapshot.provider }, bound_at: snapshot.recorded_at, bound_by: snapshot.recorded_by } }));
    expect(html).toContain("Original runtime");
    expect(html).toContain("Original profile");
  });
  it("provides the same interface and reason keys in each language", () => {
    for (const resource of Object.values(teamRuntimeTranslations)) {
      expect(Object.keys(resource).sort()).toEqual(Object.keys(teamRuntimeTranslations["zh-CN"]).sort());
      expect(Object.keys(resource.reasons).sort()).toEqual(Object.keys(teamRuntimeTranslations["zh-CN"].reasons).sort());
    }
  });
});
