import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CiEvidenceFacts,
  ReleaseSnapshotFacts,
  QualityTaskFacts,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseFacts";
import {
  ciEvidence,
  releaseSnapshot,
  releaseQuality,
} from "./deliveryReleaseFixtures";
import {
  releaseTranslations,
  releaseReasonTranslations,
} from "../i18n/delivery-release";
let language: keyof typeof releaseTranslations = "en-US";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(
        (releaseTranslations[language] as Record<string, string>)[
          key.split(".").slice(1).join(".")
        ] ??
          options?.defaultValue ??
          key,
      ).replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? "")),
    i18n: { language },
  }),
}));
describe("release evidence and fixed provenance", () => {
  it("shows actual signed CI commit, artifact digest and failed or zero checks distinctly", () => {
    const html = renderToStaticMarkup(
      createElement(CiEvidenceFacts, { evidence: ciEvidence }),
    );
    expect(html).toContain(ciEvidence.statement.predicate.commit_sha);
    expect(html).toContain(ciEvidence.statement.subject[0].digest.sha256);
    expect(html).toContain("Tests 12");
    const empty = {
      ...ciEvidence,
      passed: false,
      statement: {
        ...ciEvidence.statement,
        predicate: {
          ...ciEvidence.statement.predicate,
          tests: { total: 0, failed: 0, errors: 0, skipped: 0 },
        },
      },
    };
    expect(
      renderToStaticMarkup(createElement(CiEvidenceFacts, { evidence: empty })),
    ).toContain("Zero tests");
  });
  it("keeps captured acceptance and deployment boundaries visible in all three languages", () => {
    for (const lang of ["zh-CN", "en-US", "ja-JP"] as const) {
      language = lang;
      const html = renderToStaticMarkup(
        createElement(ReleaseSnapshotFacts, { snapshot: releaseSnapshot }),
      );
      expect(html).toContain(releaseSnapshot.quality.requirements[0].title);
      expect(html).toContain(releaseSnapshot.ci.commit_sha);
      expect(html).not.toContain("deliveryRelease.");
      expect(Object.keys(releaseTranslations[lang]).sort()).toEqual(
        Object.keys(releaseTranslations["zh-CN"]).sort(),
      );
      expect(Object.keys(releaseReasonTranslations[lang]).sort()).toEqual(
        Object.keys(releaseReasonTranslations["zh-CN"]).sort(),
      );
    }
  });
  it("labels manual acceptance as manual and missing proof as unverified", () => {
    language = "en-US";
    const task = releaseQuality.independent_tasks[0];
    expect(
      renderToStaticMarkup(createElement(QualityTaskFacts, { task })),
    ).toContain("Human acceptance");
    expect(
      renderToStaticMarkup(
        createElement(QualityTaskFacts, {
          task: {
            ...task,
            verified: false,
            proof: { ...task.proof, source: "none" },
          },
        }),
      ),
    ).toContain("No valid acceptance");
  });
});
