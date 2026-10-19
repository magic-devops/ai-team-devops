import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { deliveryTranslations } from "../i18n/delivery";
import { deliveryCollaborationTranslations } from "../i18n/deliveryCollaboration";
import { runtimeTranslations } from "../i18n/delivery-runtime";
import {
  RequirementRecordOriginal,
  DeliveryRequirementImpact,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementReads";
import { RequirementImpactFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementChangeEditor";
vi.mock("antd", () => {
  const block = ({
    children,
    title,
    description,
  }: {
    children?: ReactNode;
    title?: ReactNode;
    description?: ReactNode;
  }) => createElement("div", {}, title, description, children);
  return {
    Alert: block,
    Button: block,
    Tag: block,
    Empty: Object.assign(block, { PRESENTED_IMAGE_SIMPLE: "empty" }),
    Skeleton: block,
    Select: block,
  };
});
const basis = "a".repeat(64);
describe("actual translated requirement record and proof presentation", () => {
  for (const language of ["zh-CN", "en-US", "ja-JP"] as const) {
    async function render(node: ReactNode) {
      const i18n = createInstance();
      await i18n.init({
        lng: language,
        fallbackLng: language,
        resources: {
          [language]: {
            translation: {
              delivery: deliveryTranslations[language],
              deliveryCollaboration:
                deliveryCollaborationTranslations[language],
              deliveryRuntime: runtimeTranslations[language],
            },
          },
        },
        interpolation: { escapeValue: false },
      });
      return renderToStaticMarkup(
        createElement(I18nextProvider, { i18n }, node),
      );
    }
    it(`${language} shows business review fields and keeps technical originals collapsed`, async () => {
      const value = await render(
        createElement(RequirementRecordOriginal, {
          collection: "reviews",
          position: 0,
          record: {
            stage: "development",
            decision: "reopen",
            comment: "User review text",
            actor: "Lin",
            revision: 2,
            at: "2026-10-19T00:00:00Z",
            internal_debug: { snapshot: "TECHNICAL_SNAPSHOT" },
          },
        }),
      );
      const main = value.split("<details>")[0];
      expect(main).toContain(deliveryTranslations[language].reopen);
      expect(main).toContain(deliveryTranslations[language].stages.development);
      expect(main).toContain("User review text");
      expect(main).not.toContain("TECHNICAL_SNAPSHOT");
      expect(value).toContain("TECHNICAL_SNAPSHOT");
      expect(value).not.toContain("<details open");
    });
    it(`${language} translates artifact kinds and results`, async () => {
      const value = await render(
        createElement(RequirementRecordOriginal, {
          collection: "artifacts",
          position: 0,
          record: {
            kind: "test",
            result: "passed",
            title: "Test evidence",
            content: "Actual result",
            source: "manual",
            at: "2026-10-19T00:00:00Z",
          },
        }),
      );
      const main = value.split("<details>")[0];
      expect(main).toContain(deliveryTranslations[language].kinds.test);
      expect(main).toContain(deliveryTranslations[language].statuses.passed);
      expect(main).not.toContain(">passed<");
    });
    it(`${language} translates incomplete proof reasons without exposing server messages`, async () => {
      const value = await render(
        createElement(RequirementImpactFacts, {
          preview: {
            impact: { counts: null, invalidates_current_acceptance: null },
            reasons: [
              {
                code: "requirement_proof_bytes_budget",
                message: "UNTRANSLATED_SERVER_MESSAGE",
              },
            ],
          } as any,
        }),
      );
      expect(value).toContain(
        deliveryCollaborationTranslations[language].completeReadBudget,
      );
      expect(value).not.toContain("UNTRANSLATED_SERVER_MESSAGE");
      expect(value).not.toContain("requirement_proof_bytes_budget");
    });
    it(`${language} translates current item status instead of showing the internal state token`, async () => {
      vi.stubGlobal("location", {
        hash: "#/dev-flow?project_id=P&requirement=R",
      });
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: 30000, retry: false } },
      });
      const base = {
        project_id: "P",
        requirement_id: "R",
        version: 7,
        query_generation: 3,
        as_of: "now",
        requirement_basis: basis,
      };
      client.setQueryData(["delivery-requirement-impact", "P", "S", "R"], {
        ...base,
        available: true,
        complete: true,
        counts: {
          direct_task: 1,
          dependent_task: 0,
          execution: 0,
          release_candidate: 0,
          deployment: 0,
          restricted_execution: 0,
          restricted_deployment: 0,
        },
        reasons: [],
      });
      client.setQueryData(
        [
          "delivery-requirement-impact-page",
          "P",
          "S",
          "R",
          3,
          basis,
          "direct_task",
          "",
        ],
        {
          ...base,
          kind: "direct_task",
          items: [
            {
              id: "T",
              kind: "direct_task",
              title: "Actual current task",
              status: "in_progress",
              target: { id: "T", kind: "task", available: true },
            },
          ],
          total: 1,
          limit: 20,
          next_cursor: null,
        },
      );
      const value = await render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(DeliveryRequirementImpact, {
            projectId: "P",
            sessionId: "S",
            requirementId: "R",
            onNavigate: () => {},
          }),
        ),
      );
      expect(value).toContain(
        deliveryTranslations[language].statuses.in_progress,
      );
      expect(value).not.toContain(">in_progress<");
      client.clear();
    });
  }
});
