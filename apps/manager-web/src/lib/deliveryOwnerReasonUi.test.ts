import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { taskAcceptanceTranslations } from "../i18n/task-acceptance";
import { DeliveryExecutionPanel } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryExecutionPanel";
import { ManualReviewFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryManualReviewPanel";
import type { DeliveryTask, DeliveryWorkspace } from "./delivery";
import type { ManualReviewCurrent } from "./deliveryTaskReview";
let language: keyof typeof taskAcceptanceTranslations = "zh-CN";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => {
  const reasons = taskAcceptanceTranslations[language].reasons as Record<string, string>;
  return key.startsWith("deliveryTaskAcceptance.reasons.") ? reasons[key.split(".").at(-1)!] || options?.defaultValue || key : options?.defaultValue || key;
} }) }));
const codes = ["task_owner_missing", "task_owner_unavailable", "task_owner_invalid", "task_owner_is_tool", "task_owner_outside_project", "task_owner_inactive", "task_owner_missing_identity", "task_owner_id_required", "task_owner_invalid_scope"];
describe("responsible identity gate messages", () => {
  it.each(["zh-CN", "en-US", "ja-JP"] as const)("localizes execution and manual gates through the same reason codes (%s)", (locale) => {
    language = locale;
    const messages = taskAcceptanceTranslations[locale].reasons as Record<string, string>;
    for (const code of codes) expect(messages[code], code).toEqual(expect.any(String));
    const reasons = codes.map((code) => ({ code, message: `UNTRANSLATED SERVER MESSAGE ${code}` }));
    const task = { id: "T-one", req_id: "", status: "pending", acceptance: { available: true }, execution_gate: { eligible: false, reasons } } as DeliveryTask;
    const workspace = { project: { id: "project" }, permissions: { write: false }, executions: [] } as unknown as DeliveryWorkspace;
    const cache = new QueryClient();
    const execution = renderToStaticMarkup(createElement(QueryClientProvider, { client: cache }, createElement(DeliveryExecutionPanel, { data: workspace, task, sessionId: "test", onCommand: vi.fn(), onSaved: vi.fn() })));
    const manual = renderToStaticMarkup(createElement(ManualReviewFacts, { current: { task: { status: "pending" }, reasons, verified: false } as ManualReviewCurrent, compact: true }));
    for (const html of [execution, manual]) {
      expect(html).not.toContain("UNTRANSLATED SERVER MESSAGE");
      for (const code of codes) expect(html).toContain(messages[code]);
    }
  });
});
