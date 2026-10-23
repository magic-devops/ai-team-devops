/** Actual preview surface definitions, deliberately not executed in this source-only phase. */
import { isValidElement, type ReactNode } from "react";
import { Button, Modal } from "antd";
import { describe, expect, it, vi } from "vitest";
import { TaskSubmissionReworkPreview } from "../../subapps/ai-rd-center/src/pages/delivery/TaskSubmissionReworkPreview";
import { taskSubmissionCopy } from "../i18n/task-submission";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "zh-CN" } }) }));
const copy = taskSubmissionCopy("zh-CN"), hash = "a".repeat(64);
function nodes(value: ReactNode): any[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!isValidElement<any>(value)) return []; return [value, ...["children", "footer", "description", "action"].flatMap((key) => nodes(value.props[key]))]; }
const preview: any = { project_id: "P", task_id: "T", version: 3, rework_reference: { submission_id: "Selected", submission_digest: hash, decision_id: "D" }, rework_basis: hash, allowed: true, reasons: [],
  current: { definition: { title: "Current task" }, criteria: [{ source: "task", index: 0, text: "Current acceptance criterion", text_digest: hash }] },
  draft: { source: null, summary: "Earlier delivery summary", artifacts: [{ id: "A", title: "Historical artifact", content: "Full historic evidence", url: "https://example.com/artifact", sha256: hash }], criteria: [], tests: [{ id: "Test", title: "Historical test", status: "not_run", evidence_ids: [] }] },
  feedback_context: { decision: { comment: "Fix the failed case", reviewer: { name: "Reviewer" }, created_at: "2026-10-23T03:00:00Z", issue_id: null }, submission: { payload: { summary: "Earlier delivery summary" } } }, feedback_context_sha256: hash };
describe("selected report reuse preview", () => {
  it("shows historical materials and current reset scope before an explicit adopt action", () => {
    const adopt = vi.fn(), close = vi.fn(), tree = TaskSubmissionReworkPreview({ preview, busy: false, canAdopt: true, onAdopt: adopt, onClose: close });
    const all = nodes(tree), body = JSON.stringify(tree); expect(body).toContain(copy.reworkHistorical); expect(body).toContain(copy.reworkReset);
    expect(body).toContain("Full historic evidence"); expect(body).toContain("Current acceptance criterion"); expect(body).toContain("Fix the failed case");
    const button = all.find((node) => node.type === Button && node.props.children === copy.reworkAdopt)!; button.props.onClick(); expect(adopt).toHaveBeenCalledOnce();
    expect(all.find((node) => node.type === Modal).props.maskClosable).toBe(false);
  });
  it("keeps closing available when fresh permission disappears but denies adoption", () => {
    const close = vi.fn(), tree = TaskSubmissionReworkPreview({ preview, busy: false, canAdopt: false, onAdopt: vi.fn(), onClose: close });
    const all = nodes(tree); expect(all.find((node) => node.type === Button && node.props.children === copy.reworkAdopt).props.disabled).toBe(true);
    const modal = all.find((node) => node.type === Modal); expect(modal.props.closable).toBe(true); modal.props.onCancel(); expect(close).toHaveBeenCalledOnce();
  });
  it("preserves denied reasons and exposes no action that manufactures a report", () => {
    const denied = { ...preview, allowed: false, reasons: [{ code: "submission_write_required", message: "Write access unavailable" }] };
    const tree = TaskSubmissionReworkPreview({ preview: denied, busy: false, canAdopt: true, onAdopt: vi.fn(), onClose: vi.fn() });
    expect(JSON.stringify(tree)).toContain("Write access unavailable"); expect(nodes(tree).find((node) => node.type === Button && node.props.children === copy.reworkAdopt).props.disabled).toBe(true);
  });
});
