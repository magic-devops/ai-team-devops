import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowHumanReview } from "../../subapps/ai-rd-center/src/pages/delivery/WorkflowHumanReview";
import { GenerationMetadata } from "../../subapps/ai-rd-center/src/pages/product/AssistanceControls";
import { assistanceTranslations } from "../i18n/assistance";
import zhCN from "../i18n/zh-CN.json";
import enUS from "../i18n/en-US.json";
import jaJP from "../i18n/ja-JP.json";
import type { WorkflowReviewDetail } from "./requirementsAssistance";
import { formatAssistanceDate } from "./requirementsAssistance";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const render = (detail: WorkflowReviewDetail) =>
  renderToStaticMarkup(
    createElement(WorkflowHumanReview, {
      workflowId: "workflow",
      detail,
      onSaved: () => {},
    }),
  );
describe("workflow review presentation", () => {
  it("uses a labelled comment form for code review, with no raw JSON input", () => {
    const markup = render({
      type: "code_review",
      status: "awaiting_human",
      permissions: { write: true, approve: true },
      review: { source: "ai", status: "failed", error: "Provider unavailable" },
    });
    expect(markup).toContain("assistance.comment");
    expect(markup).toContain("assistance.approve</button>");
    expect(markup).toContain("Provider unavailable");
    expect(markup).not.toContain("font-mono");
  });
  it("renders type-specific sprint and triage actions instead of code review buttons", () => {
    const permissions = { write: true, approve: true };
    const sprint = render({
      type: "sprint_lifecycle",
      status: "awaiting_human",
      phase: "in_progress",
      permissions,
      result: { tasks: ["T-1"], completed: [] },
    });
    expect(sprint).toContain("assistance.complete_task</button>");
    expect(sprint).toContain('value="T-1"');
    expect(sprint).not.toContain("assistance.approve</button>");
    const triage = render({
      type: "bug_triage",
      status: "awaiting_human",
      phase: "assigned",
      permissions,
    });
    expect(triage).toContain("assistance.reassign</button>");
    expect(triage).toContain("assistance.resolve</button>");
    expect(triage).not.toContain("assistance.reject</button>");
  });
  it("shows terminal decisions and comments with no approval controls", () => {
    const markup = render({
      type: "code_review",
      status: "completed",
      permissions: { write: true, approve: true },
      decision_record: {
        decision: "request_changes",
        comment: "Tests are missing",
        actor_id: "reviewer",
      },
    });
    expect(markup).toContain("Tests are missing");
    expect(markup).toContain("assistance.terminal");
    expect(markup).not.toContain("assistance.approve</button>");
  });
  it("labels local rules without inventing model usage", () => {
    const markup = renderToStaticMarkup(
      createElement(GenerationMetadata, {
        generation: { id: "receipt", source: "rules", usage: {} },
      }),
    );
    expect(markup).toContain("assistance.rules");
    expect(markup).toContain("assistance.noUsage");
    expect(markup).not.toContain("assistance.model");
  });
  it("renders persisted review timestamps as local dates and names the project model source", () => {
    const at = 1792196476.0201635;
    const markup = render({
      type: "code_review",
      status: "completed",
      review: { source: "llm_gateway", status: "succeeded" },
      decision_record: { decision: "request_changes", comment: "Add recovery checks", at },
    });
    expect(markup).not.toContain(`>${at}<`);
    expect(markup).toContain(formatAssistanceDate(new Date(at * 1000).toISOString(), "zh-CN"));
    for (const resource of Object.values(assistanceTranslations)) {
      expect(resource.llm_gateway).toBeTruthy();
      expect(resource.llm_gateway).not.toContain("llm_gateway");
    }
  });
  it("keeps complete provenance in titles while displaying short identifiers and a localized date", () => {
    const id = "a".repeat(64);
    const basis = "b".repeat(64);
    const created_at = "2026-10-16T15:30:12.123456Z";
    const markup = renderToStaticMarkup(
      createElement(GenerationMetadata, {
        generation: {
          id,
          basis,
          created_at,
          source: "ai",
          model: "Configured model",
          provider: "Configured provider",
          usage: { input_tokens: 12, output_tokens: 8 },
        },
      }),
    );
    expect(markup).toContain(`title="${id}"`);
    expect(markup).toContain(`title="${basis}"`);
    expect(markup).not.toContain(`>${id}<`);
    expect(markup).not.toContain(`>${basis}<`);
    expect(markup).not.toContain(`>${created_at}<`);
    expect(markup).toContain("assistance.tokens: 20");
    for (const locale of ["zh-CN", "en-US", "ja-JP"])
      expect(formatAssistanceDate(created_at, locale)).not.toContain("T15:30");
    expect(formatAssistanceDate("invalid", "en-US")).toBe("—");
  });
});

it("provides the same assistance text keys in Chinese, English and Japanese", () => {
  const keys = (value: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(value)
      .flatMap(([key, item]) =>
        typeof item === "object" && item
          ? keys(item as Record<string, unknown>, `${prefix}${key}.`)
          : `${prefix}${key}`,
      )
      .sort();
  expect(keys(assistanceTranslations["en-US"])).toEqual(
    keys(assistanceTranslations["zh-CN"]),
  );
  expect(keys(assistanceTranslations["ja-JP"])).toEqual(
    keys(assistanceTranslations["zh-CN"]),
  );
});
it("provides headings and descriptions for every focused requirement mode in all languages", () => {
  for (const resource of [zhCN, enUS, jaJP]) {
    for (const mode of ["pool", "review", "generation", "batch"] as const) {
      const text = resource.page.requirements.mode[mode];
      expect(text.title.trim().length).toBeGreaterThan(0);
      expect(text.hint.trim().length).toBeGreaterThan(0);
      expect(text.hint).not.toContain("page.requirements.mode.");
    }
  }
});
