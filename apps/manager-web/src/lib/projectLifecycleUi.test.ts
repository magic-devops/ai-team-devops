import { isValidElement, type ReactNode } from "react";
import { Button, Input, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectLifecycleEditor } from "../../subapps/main-admin/src/pages/projects/ProjectLifecycleEditor";
import { previewProjectLifecycle, submitProjectCommand } from "./projectPortfolio";
import { lifecyclePreview, portfolioDetail } from "./projectPortfolioFixtures";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], next: 0, scope: "original" }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: (value: unknown) => ({ current: value }), useState: (initial: unknown) => { const index = hooks.next++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial; return [hooks.state[index], (change: unknown) => { hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change; }]; } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./projectPortfolio", async () => ({ ...await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio"), projectSessionKey: () => hooks.scope, previewProjectLifecycle: vi.fn(), submitProjectCommand: vi.fn() }));
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, any>) => boolean): Record<string, any> | undefined { if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean); if (!isValidElement<Record<string, any>>(node)) return undefined; if (node.type === type && predicate(node.props)) return node.props; return find(node.props.children, type, predicate) || find(node.props.footer, type, predicate); }
const onClose = vi.fn(), onSaved = vi.fn();
const render = () => { hooks.next = 0; return ProjectLifecycleEditor({ initial: portfolioDetail, background: "#/projects/portfolio?project_id=P", onClose, onSaved }); };
const button = (label: string) => find(render(), Button, (props) => props.children === `projectPortfolio.${label}`)!;
const reason = () => find(render(), Input.TextArea, (props) => props["aria-label"] === "projectPortfolio.reason")!;
async function preview() { reason().onChange({ target: { value: "Project finished" } }); await button("preview").onClick(); }
beforeEach(() => { hooks.state = []; hooks.next = 0; hooks.scope = "original"; onClose.mockClear(); onSaved.mockClear(); vi.mocked(previewProjectLifecycle).mockReset().mockResolvedValue(lifecyclePreview); vi.mocked(submitProjectCommand).mockReset(); });
describe("lifecycle fixed preview interaction", () => {
  it("invalidates the old fixed preview when an explicit reread fails", async () => {
    await preview(); expect(button("confirm").disabled).toBe(false);
    vi.mocked(previewProjectLifecycle).mockRejectedValueOnce(new Error("offline"));
    await button("preview").onClick();
    expect(button("confirm").disabled).toBe(true);
  });
  it("keeps the same request key after a network failure and closes only after success", async () => {
    await preview();
    vi.mocked(submitProjectCommand).mockRejectedValueOnce(new Error("network failure")).mockResolvedValueOnce({});
    await button("confirm").onClick(); expect(onClose).not.toHaveBeenCalled();
    const original = vi.mocked(submitProjectCommand).mock.calls[0];
    await button("confirm").onClick();
    expect(vi.mocked(submitProjectCommand).mock.calls[1]).toEqual(original);
    expect(original.slice(0, 3)).toEqual(["P", "project.lifecycle", { target_status: "archived", reason: "Project finished", preview_basis: "a".repeat(64) }]);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("requires explicit reread and confirmation after a 409 while preserving the reason", async () => {
    await preview(); vi.mocked(submitProjectCommand).mockRejectedValueOnce(new Error("HTTP 409"));
    await button("confirm").onClick(); expect(button("confirm").disabled).toBe(true); expect(reason().value).toBe("Project finished");
    expect(submitProjectCommand).toHaveBeenCalledOnce();
    vi.mocked(previewProjectLifecycle).mockResolvedValueOnce({ ...lifecyclePreview, version: 9, preview_basis: "b".repeat(64) });
    await button("readLatest").onClick(); expect(submitProjectCommand).toHaveBeenCalledOnce();
    vi.mocked(submitProjectCommand).mockResolvedValueOnce({}); await button("confirm").onClick();
    expect(vi.mocked(submitProjectCommand).mock.calls[1][3]).toMatchObject({ version: 9 });
    expect(vi.mocked(submitProjectCommand).mock.calls[1][3].key).not.toBe(vi.mocked(submitProjectCommand).mock.calls[0][3].key);
  });
  it("requires a new preview after target or reason edits", async () => {
    await preview(); find(render(), Select, () => true)!.onChange("paused"); expect(button("confirm").disabled).toBe(true);
    expect(reason().value).toBe("Project finished");
  });
  it("does not dispatch a fixed proposal after the account or workspace changes", async () => {
    await preview(); const confirm = button("confirm"); hooks.scope = "other"; await confirm.onClick();
    expect(submitProjectCommand).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
});
