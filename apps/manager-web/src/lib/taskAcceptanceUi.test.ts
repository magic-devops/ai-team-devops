import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaskAcceptanceFacts } from "../../subapps/ai-rd-center/src/pages/delivery/TaskAcceptanceFacts";
import { TaskCriteriaEditor } from "../../subapps/ai-rd-center/src/pages/delivery/TaskCriteriaEditor";
import { ExecutionAcceptanceSnapshot } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionAcceptanceSnapshot";
import { taskAcceptanceTranslations } from "../i18n/task-acceptance";
import { normalizeTaskCriteria } from "./taskAcceptance";
import type { ExecutionPreview } from "./deliveryExecution";
let language: keyof typeof taskAcceptanceTranslations = "en-US";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(
        key
          .split(".")
          .slice(1)
          .reduce<unknown>(
            (value, part) =>
              value && typeof value === "object"
                ? (value as Record<string, unknown>)[part]
                : undefined,
            taskAcceptanceTranslations[language],
          ) ??
          options?.defaultValue ??
          key,
      ).replace(/\{\{(\w+)\}\}/g, (_all, name) =>
        String(options?.[name] ?? ""),
      ),
  }),
}));
describe("task-owned and explicitly linked acceptance presentation", () => {
  it("labels task and selected requirement conditions separately without importing unselected text", () => {
    const html = renderToStaticMarkup(
      createElement(TaskAcceptanceFacts, {
        acceptance: {
          criteria: ["Own check", "Selected requirement check"],
          sources: [
            { source: "task", index: 0, text: "Own check" },
            {
              source: "requirement",
              index: 1,
              text: "Selected requirement check",
            },
          ],
          available: true,
          requirement_id: "REQ",
          requirement_revision: 2,
        },
      }),
    );
    expect(html).toContain("Own check");
    expect(html).toContain("Selected requirement check");
    expect(html).toContain("Requirement");
  });
  it("renders only captured snapshot criteria and clearly marks uncollected original sources", () => {
    const snapshot = {
      task_id: "T",
      title: "Original",
      description: "",
      assigned_to: "",
      task_acceptance_criteria: ["Original task check"],
      acceptance_criteria: ["Original task check", "Selected"],
      owner: null,
      dependency_basis: {},
      requirement: {
        id: "REQ",
        title: "Original requirement",
        description: "",
        revision: 2,
        acceptance_criteria: ["Unselected", "Selected"],
        criteria_indices: [1],
      },
    } satisfies ExecutionPreview["snapshot"];
    const html = renderToStaticMarkup(
      createElement(ExecutionAcceptanceSnapshot, { snapshot }),
    );
    expect(html).toContain("Original task check");
    expect(html).toContain("Selected");
    expect(html).not.toContain("Unselected");
    const historical = renderToStaticMarkup(
      createElement(ExecutionAcceptanceSnapshot, {
        snapshot: {
          title: "Old",
          acceptance_criteria: ["Original recorded condition"],
        },
      }),
    );
    expect(historical).toContain("not captured");
    expect(historical).toContain("Original recorded condition");
    expect(historical).not.toContain("Requirement revision");
  });
  it("keeps controls explicitly labelled and disables row changes while saving", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCriteriaEditor, {
        value: ["First", "Second"],
        disabled: true,
        onChange: () => {},
      }),
    );
    expect(html).toContain("Acceptance criterion 1");
    expect(html).toContain("Move up 2");
    expect(html).toContain("Remove criterion 1");
    expect(html).toContain("disabled");
  });
  it("enforces text boundaries while preserving order and an explicit empty draft", () => {
    expect(normalizeTaskCriteria([])).toEqual([]);
    expect(normalizeTaskCriteria([" B ", " A "])).toEqual(["B", "A"]);
    for (const value of [
      [" "],
      [false],
      ["x".repeat(2001)],
      Array(81).fill("x"),
    ])
      expect(() => normalizeTaskCriteria(value)).toThrow();
    expect(
      normalizeTaskCriteria(Array(80).fill("x".repeat(2000))),
    ).toHaveLength(80);
  });
  it("provides equivalent source, missing-history and gate labels in all three languages", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value)
            .flatMap(([key, item]) => keys(item, `${prefix}.${key}`))
            .sort()
        : [prefix];
    expect(keys(taskAcceptanceTranslations["en-US"])).toEqual(
      keys(taskAcceptanceTranslations["zh-CN"]),
    );
    expect(keys(taskAcceptanceTranslations["ja-JP"])).toEqual(
      keys(taskAcceptanceTranslations["zh-CN"]),
    );
    for (const lang of ["zh-CN", "en-US", "ja-JP"] as const) {
      language = lang;
      expect(
        renderToStaticMarkup(
          createElement(TaskAcceptanceFacts, { acceptance: null }),
        ),
      ).not.toContain("deliveryTaskAcceptance.");
    }
  });
});
