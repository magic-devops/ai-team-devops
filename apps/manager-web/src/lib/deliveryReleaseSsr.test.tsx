import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryReleaseWorkbench,
  EvidenceDetail,
  QualityDetail,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseWorkbench";
import {
  releaseIndex,
  releaseQuality,
  ciEvidence,
} from "./deliveryReleaseFixtures";
import { releaseTranslations } from "../i18n/delivery-release";
import type { DeliveryContext } from "./delivery";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
afterEach(() => vi.unstubAllGlobals());
const project = {
  project: { id: "P", status: "active" },
  version: 7,
  query_generation: 7,
} as DeliveryContext;
function render(
  view: "quality" | "releases",
  hash = "",
  decorate?: (client: QueryClient) => void,
) {
  if (hash) vi.stubGlobal("location", { hash });
  const client = new QueryClient();
  client.setQueryData(["delivery-release-context", "P", "S", 7], releaseIndex);
  client.setQueryData(
    ["delivery-quality-catalogue", "P", "S", 7, "all", "all", "", ""],
    {
      ...releaseIndex,
      items: [
        {
          kind: "requirement",
          id: "R-1",
          title: "Catalogue summary only",
          ready: true,
          attention: false,
          reasons: [],
          issue_count: 0,
          revision: 2,
          task_count: 0,
        },
      ],
      total: 1000,
      totals: { requirements: 900, independent_tasks: 100 },
      limit: 20,
      next_cursor: "NEXT",
    },
  );
  client.setQueryData(
    ["delivery-release-page", "P", "S", 7, "candidate", "", ""],
    { ...releaseIndex, items: [], total: 0, limit: 20, next_cursor: null },
  );
  decorate?.(client);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(DeliveryReleaseWorkbench, {
        view,
        workspace: project,
        sessionId: "S",
        onSaved: () => {},
      }),
    ),
  );
}
describe("bounded quality and release SSR", () => {
  it("renders initial quality without browser globals or hidden full facts", () => {
    expect(typeof location).toBe("undefined");
    const html = render("quality");
    expect(html).toContain("Catalogue summary only");
    expect(html).toContain("900");
    expect(html).toContain("deliveryRelease.pageCoverage");
    expect(html).not.toContain("Search is accessible");
    expect(html).not.toContain("original envelope");
  });
  it("renders only explicit quality details with the original selected criteria", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["delivery-quality-detail", "P", "S", 7, "requirement", "R-1"],
      releaseQuality,
    );
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(QualityDetail, {
          projectId: "P",
          sessionId: "S",
          generation: 7,
          id: "R-1",
          kind: "requirement",
          background: "#/dev-flow?view=quality&project_id=P",
        }),
      ),
    );
    expect(html).toContain("Search is accessible");
  });
  it("opens exact off-page CI evidence independently of the current directory page", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["delivery-release-evidence", "P", "S", 7, "CI-off-page"],
      {
        ...releaseIndex,
        evidence: { ...ciEvidence, id: "CI-off-page" },
        envelope: "off-page fixed original",
      },
    );
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EvidenceDetail, {
          projectId: "P",
          sessionId: "S",
          generation: 7,
          id: "CI-off-page",
        }),
      ),
    );
    expect(html).toContain("CI-off-page");
    expect(html).toContain("off-page fixed original");
    expect(html).not.toContain("deliveryRelease.evidenceMissing");
  });
  it("labels directory validity and all new states in Chinese, English and Japanese", () => {
    const html = render("releases");
    expect(html).toContain("deliveryRelease.directoryValidityHint");
    for (const language of ["zh-CN", "en-US", "ja-JP"] as const) {
      const text = releaseTranslations[language];
      for (const key of [
        "directoryValidityHint",
        "recordedPassed",
        "projectTotals",
        "pageCoverage",
        "generationChanged",
        "unknownRequest",
        "replayOriginal",
        "forbiddenRead",
      ] as const)
        expect(text[key]).toBeTruthy();
    }
  });
});
