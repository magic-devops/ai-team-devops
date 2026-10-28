import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReflectionWorkbench } from "../../subapps/ai-foundation/src/pages/intelligence/reflections/ReflectionWorkbench";
import { reflectionDigest } from "./reflectionFixtures";
const h = vi.hoisted(() => ({ options: [] as any[], unknown: false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-query", async () => ({ ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")), useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: (options: any) => { h.options.push(options); return { data: undefined, error: null, isPending: true, refetch: vi.fn() }; }, useQueries: (options: any) => { h.options.push(...options.queries); return options.queries.map(() => ({ data: undefined, error: null, isPending: true, refetch: vi.fn() })); } }));
vi.mock("./projectPortfolio", async () => ({ ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")), projectSessionKey: () => "S" }));
vi.mock("./executionExitGuard", () => ({ useExecutionExitGuard: () => ({ pending: h.unknown, blocked: false, canNavigate: () => !h.unknown, setPending: () => {} }) }));
vi.mock("./reflectionCommand", async () => {
  const actual = await vi.importActual<typeof import("./reflectionCommand")>("./reflectionCommand");
  return { ...actual, useReflectionInputCommand: () => {
    const original = actual.prepareReflectionInputOriginal(7, { title: "Retained original", rationale: "Retained rationale", sources: [{ reflection_id: "R", source_digest: reflectionDigest, attempt_id: "A" }] }, () => "original-key");
    const controller = actual.createReflectionInputController({ projectId: "P", scope: "S", currentScope: () => "S", load: () => h.unknown ? JSON.stringify({ phase: "unknown", original }) : null, save: () => {}, send: async () => { throw new Error("not invoked by a read"); } });
    return { ...controller, state: controller.snapshot(), locked: h.unknown, unresolved: h.unknown };
  } };
});
beforeEach(() => { h.options = []; h.unknown = false; });
describe("actual reflection route read gates", () => {
  it.each([
    "project_id=P&project_id=Q",
    "project_id=P&reflection_receipt=R&reflection_receipt=other",
    "project_id=P&reflection_category=unrecognized",
    "project_id=P&reflection_receipt=R%2Fpath",
    "project_id=P&reflection_page=-1",
    "project_id=P&arbitrary=1",
  ])("issues no current queries for ambiguous or malformed route %s", (query) => {
    vi.stubGlobal("location", { hash: "#/intelligence/reflections?" + query });
    const html = renderToStaticMarkup(createElement(ReflectionWorkbench, { projectId: "P" }));
    expect(h.options.every((options) => options.enabled === false)).toBe(true);
    expect(html).toContain("reflections.invalidRoute");
  });
  it("keeps a canonical current-project unknown recovery host while malformed route queries remain disabled", () => {
    h.unknown = true;
    vi.stubGlobal("location", { hash: "#/intelligence/reflections?project_id=P&project_id=Q" });
    const html = renderToStaticMarkup(createElement(ReflectionWorkbench, { projectId: "P" }));
    expect(h.options.every((options) => options.enabled === false)).toBe(true);
    expect(html).toContain("reflections.invalidRoute");
    expect(html).toContain("reflections.recoveryProject");
  });
});
