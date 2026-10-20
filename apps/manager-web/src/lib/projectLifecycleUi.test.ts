/** Migrated consumer definitions; current runtime verification is deferred. */
import { isValidElement, type ReactNode } from "react";
import { Button, Input, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectLifecycleEditor } from "../../subapps/main-admin/src/pages/projects/ProjectLifecycleEditor";
import { ProjectCommandFeedback } from "../../subapps/main-admin/src/pages/projects/ProjectCommandFeedback";
import { previewProjectLifecycle, submitProjectCommand } from "./projectPortfolio";
import { lifecyclePreview, portfolioDetail } from "./projectPortfolioFixtures";
import type { ProjectEditorOriginal } from "./projectEditorCommand";

const hooks = vi.hoisted(() => ({
  state: [] as any[], refs: [] as any[], next: 0, refNext: 0, scope: "original",
  controllers: {} as Record<string, any>, stored: new Map<string, string>(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useRef: (value: any) => hooks.refs[hooks.refNext++] ||= { current: value },
  useState: (initial: any) => {
    const index = hooks.next++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.state[index], (change: any) => {
      hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change;
    }];
  },
  useEffect: () => {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")),
  projectSessionKey: () => hooks.scope,
  previewProjectLifecycle: vi.fn(), submitProjectCommand: vi.fn(),
}));
vi.mock("./projectEditorCommand", async () => {
  const actual = await vi.importActual<typeof import("./projectEditorCommand")>("./projectEditorCommand");
  return {
    ...actual,
    useProjectEditorCommand: (projectId: string, action: "project.lifecycle" | "project.update", onPending?: (value: boolean) => void) => {
      const scope = hooks.scope;
      const controller = hooks.controllers[action] ||= actual.createProjectEditorController({
        projectId, action, scope, currentScope: () => hooks.scope,
        load: () => hooks.stored.get(action) || null,
        save: (raw) => hooks.stored.set(action, raw), onPending,
        send: (original) => submitProjectCommand(projectId, original.action, original.payload, original.intent),
      });
      const state = controller.snapshot();
      return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) };
    },
  };
});

function acknowledgement(original: ProjectEditorOriginal) {
  return {
    project_id: "P", action: original.action, resource: { kind: "project", id: "P" },
    applied_version: original.intent.version + 1, version: original.intent.version + 1,
    query_generation: null, replayed: false, affected_refs: [{ kind: "project", id: "P" }],
    result: {
      from_status: "active", target_status: original.payload.target_status, reason: original.payload.reason,
      archive: original.payload.target_status === "archived" ? {
        id: "archive-P", at: "2026-10-20T10:00:00Z", actor_id: "user:lead", actor_name: "Lead",
        reason: original.payload.reason, preview_basis: original.payload.preview_basis, facts: lifecyclePreview.facts,
      } : null,
    },
  };
}
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, any>) => boolean): Record<string, any> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  if (node.type === ProjectCommandFeedback) return find(ProjectCommandFeedback(node.props as any), type, predicate);
  return find(node.props.children, type, predicate) || find(node.props.footer, type, predicate) || find(node.props.action, type, predicate);
}
const onClose = vi.fn(), onSaved = vi.fn();
const render = () => {
  hooks.next = 0; hooks.refNext = 0;
  return ProjectLifecycleEditor({ initial: portfolioDetail, background: "#/projects/portfolio?project_id=P", onClose, onSaved });
};
const button = (label: string) => find(render(), Button, (props) => props.children === `projectPortfolio.${label}`)!;
const reason = () => find(render(), Input.TextArea, (props) => props["aria-label"] === "projectPortfolio.reason")!;
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
async function preview() {
  reason().onChange({ target: { value: "Project finished" } });
  button("preview").onClick(); await settle();
}
beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.next = 0; hooks.refNext = 0; hooks.scope = "original";
  hooks.controllers = {}; hooks.stored.clear(); onClose.mockReset(); onSaved.mockReset();
  vi.mocked(previewProjectLifecycle).mockReset().mockResolvedValue(lifecyclePreview);
  vi.mocked(submitProjectCommand).mockReset().mockImplementation(async (_project, action, payload, intent) => acknowledgement({ action, payload, intent }));
});

describe("lifecycle fixed preview interaction", () => {
  it("invalidates the old fixed preview when an explicit reread fails", async () => {
    await preview(); expect(button("confirm").disabled).toBe(false);
    vi.mocked(previewProjectLifecycle).mockRejectedValueOnce(new Error("offline"));
    button("preview").onClick(); await settle();
    expect(button("confirm").disabled).toBe(true);
  });

  it("replays the same immutable request after unknown and closes only after a valid acknowledgement", async () => {
    await preview();
    vi.mocked(submitProjectCommand).mockRejectedValueOnce(new Error("network failure"));
    button("confirm").onClick(); await settle(); expect(onClose).not.toHaveBeenCalled();
    const original = vi.mocked(submitProjectCommand).mock.calls[0];
    button("retryOriginal").onClick(); await settle();
    expect(vi.mocked(submitProjectCommand).mock.calls[1]).toEqual(original);
    expect(original.slice(0, 3)).toEqual(["P", "project.lifecycle", { target_status: "archived", reason: "Project finished", preview_basis: "a".repeat(64) }]);
    expect(onSaved).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires explicit reread and confirmation after a 409 while preserving the reason", async () => {
    await preview(); vi.mocked(submitProjectCommand).mockRejectedValueOnce(new Error("HTTP 409: project changed"));
    button("confirm").onClick(); await settle();
    expect(button("confirm").disabled).toBe(true); expect(reason().value).toBe("Project finished");
    expect(submitProjectCommand).toHaveBeenCalledOnce();
    vi.mocked(previewProjectLifecycle).mockResolvedValueOnce({ ...lifecyclePreview, version: 9, preview_basis: "b".repeat(64) });
    button("readLatest").onClick(); await settle(); expect(submitProjectCommand).toHaveBeenCalledOnce();
    button("confirm").onClick(); await settle();
    expect(vi.mocked(submitProjectCommand).mock.calls[1][3]).toMatchObject({ version: 9 });
    expect(vi.mocked(submitProjectCommand).mock.calls[1][3].key).not.toBe(vi.mocked(submitProjectCommand).mock.calls[0][3].key);
  });

  it("requires a new preview after target or reason edits", async () => {
    await preview(); find(render(), Select, () => true)!.onChange("paused");
    expect(button("confirm").disabled).toBe(true); expect(reason().value).toBe("Project finished");
  });

  it("does not dispatch a fixed proposal after the account or workspace changes", async () => {
    await preview(); const confirm = button("confirm"); hooks.scope = "other";
    confirm.onClick(); await settle();
    expect(submitProjectCommand).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
});
