/** Actual metadata modal consumer definitions; runtime verification is deferred. */
import { isValidElement, type ReactNode } from "react";
import { Button, Input } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectInspector } from "../../subapps/main-admin/src/pages/projects/ProjectInspector";
import { ProjectSettingsEditor } from "../../subapps/main-admin/src/pages/projects/ProjectSettingsEditor";
import { ProjectLifecycleEditor } from "../../subapps/main-admin/src/pages/projects/ProjectLifecycleEditor";
import { fetchProjectPortfolioDetail, submitProjectCommand } from "./projectPortfolio";
import { portfolioDetail } from "./projectPortfolioFixtures";

const hooks = vi.hoisted(() => ({
  frames: {} as Record<string, any[]>, frame: "", next: 0, data: null as any,
  controller: null as any, stored: new Map<string, string>(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useRef: (initial: any) => {
    const slots = hooks.frames[hooks.frame] ||= [], index = hooks.next++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useState: (initial: any) => {
    const slots = hooks.frames[hooks.frame] ||= [], index = hooks.next++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (change: any) => { slots[index] = typeof change === "function" ? change(slots[index]) : change; }];
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./authStorage", async () => ({
  ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")),
  getSessionRevision: () => "metadata-session",
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")),
  projectSessionKey: () => "session", submitProjectCommand: vi.fn(), fetchProjectPortfolioDetail: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: hooks.data, isError: false, error: null, isLoading: false, refetch: vi.fn(async () => ({ data: hooks.data })) }),
}));
vi.mock("./projectEditorCommand", async () => {
  const actual = await vi.importActual<typeof import("./projectEditorCommand")>("./projectEditorCommand");
  return {
    ...actual,
    useProjectEditorCommand: (projectId: string, action: "project.lifecycle" | "project.update", onPending?: (pending: boolean) => void) => {
      const key = actual.projectEditorStorageKey(projectId, action)!;
      hooks.controller ||= actual.createProjectEditorController({
        projectId, action, scope: "session", currentScope: () => "session",
        load: () => hooks.stored.get(key) || null, save: (raw) => { hooks.stored.set(key, raw); }, onPending,
        send: (original) => submitProjectCommand(projectId, original.action, original.payload, original.intent),
      });
      const controller = hooks.controller, state = controller.snapshot();
      return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: ["sending", "unknown"].includes(state.phase) };
    },
  };
});

function frame<T>(name: string, callback: () => T): T { hooks.frame = name; hooks.next = 0; return callback(); }
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.footer), ...nodes(node.props.action)];
}
function find(tree: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true): any {
  return nodes(tree).find((node) => node.type === type && predicate(node.props))?.props;
}
const saved = vi.fn();
function inspector() {
  const host = frame("host", () => ProjectInspector({ projectId: "P", background: "#/projects/portfolio?project_id=P", businesses: [], sessionKey: "session", onClose: vi.fn(), onSaved: saved }));
  const body = nodes(host).find((node) => typeof node.type === "function" && node.type.name === "InspectorBody")!;
  return frame("body", () => body.type(body.props));
}
function settings() {
  const editor = nodes(inspector()).find((node) => node.type === ProjectSettingsEditor)!;
  expect(editor, "the real settings modal is mounted").toBeDefined();
  return frame("settings", () => ProjectSettingsEditor(editor.props));
}
function button(tree: ReactNode, key: string): any {
  return find(tree, Button, (props) => (Array.isArray(props.children) ? props.children[0] : props.children) === `projectPortfolio.${key}`);
}
function name(tree: ReactNode): any { return find(tree, Input, (props) => props["aria-label"] === "projectPortfolio.name"); }

beforeEach(() => {
  hooks.frames = {}; hooks.frame = ""; hooks.next = 0; hooks.controller = null; hooks.stored.clear();
  hooks.data = structuredClone(portfolioDetail); saved.mockReset();
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "sop-user" ? JSON.stringify({ id: "metadata-editor", tenant_id: "tenant" }) : null });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => hooks.stored.get(key) || null });
  vi.mocked(fetchProjectPortfolioDetail).mockReset().mockImplementation(async () => hooks.data);
  vi.mocked(submitProjectCommand).mockReset().mockImplementation(async (_project, action, _payload, intent) => ({
    project_id: "P", action, resource: { kind: "project", id: "P" },
    applied_version: intent.version + 1, version: intent.version + 1,
    query_generation: null, replayed: false, affected_refs: [{ kind: "project", id: "P" }], result: null,
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("project metadata remains a fixed user draft", () => {
  it("preserves the draft across background refresh and requires explicit read, adoption and confirmation after conflict", async () => {
    button(inspector(), "configure").onClick();
    name(settings()).onChange({ target: { value: "My retained title" } });
    hooks.data = { ...portfolioDetail, project: { ...portfolioDetail.project, version: 9, name: "Other editor title" } };
    expect(name(settings()).value).toBe("My retained title");
    vi.mocked(submitProjectCommand).mockRejectedValueOnce(new Error("HTTP 409: project changed"));
    await button(settings(), "save").onClick();
    expect(vi.mocked(submitProjectCommand).mock.calls[0]).toEqual(["P", "project.update", expect.objectContaining({ name: "My retained title" }), expect.objectContaining({ version: 7 })]);
    expect(button(settings(), "save").disabled).toBe(true); expect(saved).not.toHaveBeenCalled();
    expect(fetchProjectPortfolioDetail).not.toHaveBeenCalled();
    await button(settings(), "readLatest").onClick();
    expect(submitProjectCommand).toHaveBeenCalledTimes(1); expect(name(settings()).value).toBe("My retained title");
    button(settings(), "adopt").onClick();
    expect(submitProjectCommand).toHaveBeenCalledTimes(1);
    await button(settings(), "save").onClick();
    const calls = vi.mocked(submitProjectCommand).mock.calls;
    expect(calls[1][3]).toMatchObject({ version: 9 }); expect(calls[1][3].key).not.toBe(calls[0][3].key);
    expect(calls[1][2]).toMatchObject({ name: "My retained title" });
    expect(calls[1][2]).not.toHaveProperty("status"); expect(calls[1][2]).not.toHaveProperty("vector_db_config");
    expect(saved).toHaveBeenCalledTimes(1);
    expect(nodes(inspector()).filter((node) => node.type === ProjectSettingsEditor)).toHaveLength(0);
  });

  it("keeps archived metadata read only while the independent lifecycle restore action remains available", () => {
    hooks.data = { ...portfolioDetail, project: { ...portfolioDetail.project, status: "archived", permissions: { ...portfolioDetail.project.permissions, can_configure: false, can_write: false, can_restore: true, can_transition: true } } };
    const first = inspector();
    expect(button(first, "configure").disabled).toBe(true); expect(button(first, "restore").disabled).toBe(false);
    button(first, "configure").onClick();
    expect(nodes(inspector()).filter((node) => node.type === ProjectSettingsEditor)).toHaveLength(0);
    button(first, "restore").onClick();
    expect(nodes(inspector()).filter((node) => node.type === ProjectLifecycleEditor)).toHaveLength(1);
  });
});
