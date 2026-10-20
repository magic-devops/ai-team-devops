/** Real consumer callback definitions. Runtime, type and browser verification are deferred. */
import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Drawer, Form, Input, Modal } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectLifecycleEditor } from "../../subapps/main-admin/src/pages/projects/ProjectLifecycleEditor";
import { ProjectSettingsEditor } from "../../subapps/main-admin/src/pages/projects/ProjectSettingsEditor";
import { ProjectInspector } from "../../subapps/main-admin/src/pages/projects/ProjectInspector";
import { ProjectCommandFeedback } from "../../subapps/main-admin/src/pages/projects/ProjectCommandFeedback";
import { ProjectCommandRecovery } from "../../subapps/main-admin/src/pages/projects/ProjectCommandRecovery";
import { PortfolioModule } from "../../subapps/main-admin/src/pages/projects/PortfolioModule";
import { lifecyclePreview, portfolioDetail, portfolioResponse } from "./projectPortfolioFixtures";
import { enterPortfolioProject, fetchProjectPortfolioDetail, previewProjectLifecycle, projectSessionKey } from "./projectPortfolio";
import type { DeliveryCommandAck } from "./deliveryQuery";

const h = vi.hoisted(() => ({
  frames: {} as Record<string, any[]>, frame: "", next: 0,
  controllers: {} as Record<string, any>, stored: new Map<string, string>(),
  sends: [] as any[], pending: {} as Record<string, boolean>,
  token: "original-token", revision: "login-one", project: "P",
  mode: "unknown" as "unknown" | "success" | "pending" | "refused" | "badAck",
  resolves: [] as Array<(ack: unknown) => void>,
  detailError: null as Error | null,
  failConfirmedStorage: false,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: any) => {
    const frame = h.frame, index = h.next++;
    const slots = h.frames[frame] ||= [];
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value: any) => {
      slots[index] = typeof value === "function" ? value(slots[index]) : value;
    }];
  },
  useRef: (initial: any) => {
    const slots = h.frames[h.frame] ||= [], index = h.next++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./authStorage", async () => ({
  ...(await vi.importActual<typeof import("./authStorage")>("./authStorage")),
  getToken: () => h.token,
  getSessionRevision: () => h.revision,
  getProjectId: () => h.project,
  getWorkspaceScope: () => ({ tenantCode: "tenant-A", businessCode: "business-A", projectId: h.project, projectCode: h.project }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>("./projectPortfolio")),
  previewProjectLifecycle: vi.fn(),
  fetchProjectPortfolioDetail: vi.fn(),
  enterPortfolioProject: vi.fn(() => "#/dev-flow?project_id=P"),
}));
vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const detail = queryKey[0] === "projectPortfolioDetail";
    const data = detail ? portfolioDetail : queryKey[0] === "projectPortfolio" ? portfolioResponse : [];
    const error = detail ? h.detailError : null;
    return { data, isLoading: false, isFetching: false, isError: Boolean(error), error, refetch: vi.fn(async () => ({ data, error })) };
  },
}));
vi.mock("./projectEditorCommand", async () => {
  const actual = await vi.importActual<typeof import("./projectEditorCommand")>("./projectEditorCommand");
  const { projectSessionKey: scope } = await import("./projectPortfolio");
  return {
    ...actual,
    useProjectEditorCommand: (projectId: string, action: "project.lifecycle" | "project.update", onPending?: (pending: boolean) => void) => {
      const identity = `${scope()}:${projectId}:${action}`;
      const storageKey = actual.projectEditorStorageKey(projectId, action);
      const controller = h.controllers[identity] ||= actual.createProjectEditorController({
        projectId, action, scope: scope(), currentScope: scope,
        load: () => storageKey ? h.stored.get(storageKey) || null : null,
        save: (raw) => {
          if (!storageKey || h.failConfirmedStorage && (!raw || JSON.parse(raw).phase === "succeeded")) throw new Error("retainedOriginalUnavailable");
          h.stored.set(storageKey, raw);
        },
        onPending: (pending) => { h.pending[action] = pending; onPending?.(pending); },
        send: async (original) => {
          h.sends.push(structuredClone(original));
          if (h.mode === "unknown") throw new Error("Network reply lost after a possible commit");
          if (h.mode === "refused") throw new Error("HTTP 409: Project changed. Reload and retry.");
          if (h.mode === "pending") return new Promise((resolve) => h.resolves.push(resolve));
          const ack = commandAck(original);
          return h.mode === "badAck" ? { ...ack, resource: { kind: "project", id: "foreign" } } : ack;
        },
      });
      const state = controller.snapshot();
      h.pending[action] = ["sending", "unknown"].includes(state.phase);
      onPending?.(h.pending[action]);
      return { ...controller, state, locked: !["idle", "refused"].includes(state.phase), unresolved: h.pending[action] };
    },
  };
});

function commandAck(original: any): DeliveryCommandAck {
  const lifecycle = original.action === "project.lifecycle";
  return {
    project_id: "P", action: original.action, resource: { kind: "project", id: "P" },
    applied_version: original.intent.version + 1, version: original.intent.version + 1,
    affected_refs: [{ kind: "project", id: "P" }], query_generation: null, replayed: true,
    result: lifecycle ? {
      from_status: "active", target_status: original.payload.target_status, reason: original.payload.reason,
      archive: original.payload.target_status === "archived" ? {
        id: "archive-P", at: "2026-10-20T10:00:00Z", actor_id: "user:lead", actor_name: "Lead",
        reason: original.payload.reason, preview_basis: original.payload.preview_basis, facts: lifecyclePreview.facts,
      } : null,
    } : null,
  };
}
function frame<T>(identity: string, callback: () => T): T {
  h.frame = identity; h.next = 0;
  return callback();
}
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<any>(node)) return [];
  if (node.type === ProjectCommandFeedback) return [node, ...nodes(ProjectCommandFeedback(node.props))];
  return [node, ...nodes(node.props.children), ...nodes(node.props.footer), ...nodes(node.props.action)];
}
function find(tree: ReactNode, type: unknown, predicate: (props: any) => boolean = () => true): any {
  return nodes(tree).find((node) => node.type === type && predicate(node.props))?.props;
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<any>(node)) return text(node.props.children);
  return node == null || typeof node === "boolean" ? "" : String(node);
}
function button(tree: ReactNode, label: string): any {
  return find(tree, Button, (props) => text(props.children).startsWith(`projectPortfolio.${label}`));
}
function action(tree: ReactNode, value: string): any {
  return find(tree, Button, (props) => props["data-action"] === value);
}
function labeled(tree: ReactNode, label: string): any {
  return nodes(tree).find((node) => node.props["aria-label"] === `projectPortfolio.${label}`)?.props;
}
function settingsName(tree: ReactNode): any {
  const direct = labeled(tree, "name");
  if (direct) return direct;
  const item = find(tree, Form.Item, (props) => props.label === "projectPortfolio.name");
  return find(item?.children, Input);
}
const onClose = vi.fn(), onSaved = vi.fn();
const pending = (value: boolean) => { h.pending.lifecycleHost = value; };
function lifecycle() {
  return frame("lifecycle", () => ProjectLifecycleEditor({ initial: portfolioDetail, background: "#/projects/portfolio?project_id=P", onClose, onSaved, onUnresolvedChange: pending }));
}
function settings() {
  return frame("settings", () => ProjectSettingsEditor({ initial: portfolioDetail, businesses: [{ id: "business", name: "Product" }], onClose, onSaved, onUnresolvedChange: (value) => { h.pending.settingsHost = value; } }));
}
function inspector(projectId = "P") {
  const host = frame("inspector-host", () => ProjectInspector({ projectId, background: "#/projects/portfolio?project_id=P", businesses: [], onClose, onSaved, sessionKey: projectSessionKey() }));
  const child = nodes(host).find((node) => typeof node.type === "function" && node.type.name === "InspectorBody");
  expect(child, "the real inspector body is mounted").toBeDefined();
  const body = frame("inspector-body", () => child.type(child.props));
  return { host, body };
}
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
async function readyLifecycle() {
  labeled(lifecycle(), "reason").onChange({ target: { value: "Project finished" } });
  button(lifecycle(), "preview").onClick();
  await settle();
  return lifecycle();
}
function recreate() {
  for (const controller of Object.values(h.controllers)) controller.invalidate();
  h.controllers = {}; h.frames = {};
}

beforeEach(() => {
  h.frames = {}; h.frame = ""; h.next = 0; h.controllers = {}; h.stored.clear();
  h.sends = []; h.pending = {}; h.mode = "unknown"; h.resolves = [];
  h.token = "original-token"; h.revision = "login-one"; h.project = "P";
  h.detailError = null; h.failConfirmedStorage = false;
  onClose.mockReset(); onSaved.mockReset();
  vi.mocked(previewProjectLifecycle).mockReset().mockResolvedValue(lifecyclePreview);
  vi.mocked(fetchProjectPortfolioDetail).mockReset().mockResolvedValue(portfolioDetail);
  vi.mocked(enterPortfolioProject).mockClear();
  const values = new Map<string, string>([["sop-user", JSON.stringify({ id: "user:lead", tenant_id: "tenant-A" })]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => h.stored.get(key) || null, setItem: (key: string, value: string) => h.stored.set(key, value) });
  const location = { hash: "#/projects/portfolio?project_id=P", href: "http://localhost/#/projects/portfolio?project_id=P", pathname: "/", search: "" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real project editors and retained command recovery", () => {
  it("previews lifecycle facts without dispatching a project command or closing", async () => {
    const tree = await readyLifecycle();
    expect(previewProjectLifecycle).toHaveBeenCalledTimes(1);
    expect(h.sends).toHaveLength(0);
    expect(button(tree, "confirm").disabled).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("invalidates a successful preview if an explicit reread fails", async () => {
    await readyLifecycle();
    vi.mocked(previewProjectLifecycle).mockRejectedValueOnce(new Error("Offline while reading a new preview"));
    button(lifecycle(), "preview").onClick();
    await settle();
    expect(button(lifecycle(), "confirm").disabled).toBe(true);
    expect(h.sends).toHaveLength(0);
  });

  it("rejects retained edits and duplicate reads while a lifecycle preview is in flight", async () => {
    labeled(lifecycle(), "reason").onChange({ target: { value: "Project finished" } });
    let resolve!: (value: typeof lifecyclePreview) => void;
    vi.mocked(previewProjectLifecycle).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const tree = lifecycle();
    const read = button(tree, "preview"), reason = labeled(tree, "reason");
    read.onClick(); read.onClick();
    reason.onChange({ target: { value: "Changed while previewing" } });
    button(tree, "cancel").onClick(); find(tree, Modal).onCancel();
    expect(previewProjectLifecycle).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    resolve(lifecyclePreview); await settle();
    expect(labeled(lifecycle(), "reason").value).toBe("Project finished");
    expect(button(lifecycle(), "confirm").disabled).toBe(false);
    expect(h.sends).toHaveLength(0);
  });

  it("blocks old reason, target, preview, confirm and cancel callbacks after an unknown lifecycle submit", async () => {
    const tree = await readyLifecycle();
    const reason = labeled(tree, "reason"), target = labeled(tree, "targetStatus");
    const preview = button(tree, "preview"), confirm = button(tree, "confirm"), cancel = button(tree, "cancel");
    confirm.onClick();
    await settle();
    const original = structuredClone(h.sends[0]);
    reason.onChange({ target: { value: "Replacement reason" } }); target.onChange("paused");
    preview.onClick(); confirm.onClick(); cancel.onClick(); find(tree, Modal).onCancel();
    await settle();
    expect(h.sends).toEqual([original]);
    expect(previewProjectLifecycle).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect(h.pending.lifecycleHost).toBe(true);
    expect(find(lifecycle(), Modal)).toMatchObject({ closable: false, keyboard: false, maskClosable: false });
    expect(button(lifecycle(), "retryOriginal")).toBeDefined();
  });

  it("recreates the lifecycle editor from the original store and only replays its fixed body, version and key", async () => {
    button(await readyLifecycle(), "confirm").onClick();
    await settle();
    const original = structuredClone(h.sends[0]);
    recreate(); h.mode = "success";
    button(lifecycle(), "retryOriginal").onClick();
    await settle();
    expect(h.sends).toEqual([original, original]);
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.pending.lifecycleHost).toBe(false);
  });

  it("does not notify or close before a lifecycle acknowledgement arrives", async () => {
    h.mode = "pending";
    const tree = await readyLifecycle();
    const confirm = button(tree, "confirm");
    confirm.onClick(); confirm.onClick(); find(tree, Modal).onCancel();
    await settle();
    expect(h.sends).toHaveLength(1); expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    h.resolves[0](commandAck(h.sends[0])); await settle();
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a mismatched lifecycle acknowledgement unknown instead of closing", async () => {
    h.mode = "badAck";
    button(await readyLifecycle(), "confirm").onClick(); await settle();
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect(button(lifecycle(), "retryOriginal")).toBeDefined();
  });

  it("finishes a confirmed lifecycle result after storage recovery without another project command", async () => {
    const first = await readyLifecycle();
    h.mode = "success"; h.failConfirmedStorage = true;
    button(first, "confirm").onClick(); await settle();
    expect(h.sends).toHaveLength(1); expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    const retained = lifecycle();
    expect(action(retained, "retry-original")).toBeUndefined();
    expect(action(retained, "finish-confirmed")).toBeDefined();
    button(first, "cancel").onClick(); find(first, Modal).onCancel();
    button(first, "confirm").onClick(); button(first, "preview").onClick();
    labeled(first, "reason").onChange({ target: { value: "Must not replace acknowledged original" } });
    await settle(); expect(h.sends).toHaveLength(1); expect(previewProjectLifecycle).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    h.failConfirmedStorage = false;
    action(retained, "finish-confirmed").onClick(); await settle();
    expect(h.sends).toHaveLength(1); expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
    expect([...h.stored.values()].every((raw) => raw === "")).toBe(true);
  });

  it("requires an explicit new preview after a refused lifecycle submission", async () => {
    h.mode = "refused";
    button(await readyLifecycle(), "confirm").onClick(); await settle();
    expect(button(lifecycle(), "confirm").disabled).toBe(true);
    expect(labeled(lifecycle(), "reason").value).toBe("Project finished");
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    vi.mocked(previewProjectLifecycle).mockResolvedValueOnce({ ...lifecyclePreview, version: 9, preview_basis: "b".repeat(64) });
    button(lifecycle(), "readLatest").onClick(); await settle();
    expect(h.sends).toHaveLength(1);
    h.mode = "success";
    button(lifecycle(), "confirm").onClick(); await settle();
    expect(h.sends).toHaveLength(2);
    expect(h.sends[1].intent.version).toBe(9);
    expect(h.sends[1].intent.key).not.toBe(h.sends[0].intent.key);
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks metadata editing, cancellation and old save callbacks while its request is unknown", async () => {
    const tree = settings(), input = settingsName(tree), save = button(tree, "save"), cancel = button(tree, "cancel");
    input.onChange({ target: { value: "Reviewed project name" } });
    button(settings(), "save").onClick(); await settle();
    const original = structuredClone(h.sends[0]);
    input.onChange({ target: { value: "Must not replace the original" } });
    save.onClick(); cancel.onClick(); find(tree, Modal).onCancel(); await settle();
    expect(h.sends).toEqual([original]);
    expect(settingsName(settings()).value).toBe("Reviewed project name");
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    expect(h.pending.settingsHost).toBe(true);
  });

  it("restores and replays the exact unknown metadata command after recreation", async () => {
    settingsName(settings()).onChange({ target: { value: "Reviewed project name" } });
    button(settings(), "save").onClick(); await settle();
    const original = structuredClone(h.sends[0]);
    recreate(); h.mode = "success";
    button(settings(), "retryOriginal").onClick(); await settle();
    expect(h.sends).toEqual([original, original]);
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("waits for a real metadata acknowledgement before notifying or closing", async () => {
    h.mode = "pending";
    const tree = settings(), save = button(tree, "save");
    save.onClick(); save.onClick(); find(tree, Modal).onCancel(); await settle();
    expect(h.sends).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    h.resolves[0](commandAck(h.sends[0])); await settle();
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("finishes acknowledged metadata using storage cleanup without replaying its write", async () => {
    const first = settings();
    h.mode = "success"; h.failConfirmedStorage = true;
    button(first, "save").onClick(); await settle();
    expect(h.sends).toHaveLength(1); expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    const retained = settings();
    expect(action(retained, "retry-original")).toBeUndefined();
    expect(action(retained, "finish-confirmed")).toBeDefined();
    button(first, "cancel").onClick(); find(first, Modal).onCancel();
    button(first, "save").onClick(); settingsName(first).onChange({ target: { value: "Another command" } });
    await settle(); expect(h.sends).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    h.failConfirmedStorage = false;
    action(retained, "finish-confirmed").onClick(); await settle();
    expect(h.sends).toHaveLength(1); expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
    expect([...h.stored.values()].every((raw) => raw === "")).toBe(true);
  });

  it("reads new metadata without writing and adopts its version only after explicit review", async () => {
    h.mode = "refused";
    settingsName(settings()).onChange({ target: { value: "My reviewed draft" } });
    button(settings(), "save").onClick(); await settle();
    const original = structuredClone(h.sends[0]);
    expect(fetchProjectPortfolioDetail).not.toHaveBeenCalled();
    vi.mocked(fetchProjectPortfolioDetail).mockResolvedValueOnce({ ...portfolioDetail, project: { ...portfolioDetail.project, name: "Another editor title", version: 9 } });
    action(settings(), "read-settings").onClick(); await settle();
    expect(h.sends).toEqual([original]);
    expect(settingsName(settings()).value).toBe("My reviewed draft");
    expect(button(settings(), "save").disabled).toBe(true);
    action(settings(), "adopt-settings").onClick();
    expect(h.sends).toEqual([original]);
    h.mode = "success"; button(settings(), "save").onClick(); await settle();
    expect(h.sends[1].payload).toEqual(original.payload);
    expect(h.sends[1].intent.version).toBe(9);
    expect(h.sends[1].intent.key).not.toBe(original.intent.key);
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks old metadata reread and adopt callbacks synchronously when the next save is sending", async () => {
    h.mode = "refused";
    button(settings(), "save").onClick(); await settle();
    action(settings(), "read-settings").onClick(); await settle();
    const reviewed = settings();
    const read = action(reviewed, "read-settings"), adopt = action(reviewed, "adopt-settings");
    adopt.onClick(); h.mode = "pending";
    const ready = settings();
    button(ready, "save").onClick();
    read.onClick(); adopt.onClick();
    settingsName(ready).onChange({ target: { value: "Must not change sending draft" } });
    button(ready, "cancel").onClick(); find(ready, Modal).onCancel();
    await settle();
    expect(h.sends).toHaveLength(2);
    expect(fetchProjectPortfolioDetail).toHaveBeenCalledTimes(1);
    expect(settingsName(settings()).value).toBe(portfolioDetail.project.name);
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    h.resolves[0](commandAck(h.sends[1])); await settle();
    expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects an old lifecycle confirm when only the login revision has changed", async () => {
    const tree = await readyLifecycle();
    h.revision = "login-two";
    button(tree, "confirm").onClick(); await settle();
    expect(h.sends).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });

  it("guards the inspector Drawer and internal navigation when a child reports an unresolved command", async () => {
    const first = inspector();
    const oldClose = find(first.host, Drawer).onClose;
    const oldEnter = button(first.body, "enter");
    const child = nodes(first.host).find((node) => typeof node.type === "function" && node.type.name === "InspectorBody");
    child.props.onPending("project.update", true);
    oldClose(); oldEnter.onClick();
    expect(onClose).not.toHaveBeenCalled(); expect(enterPortfolioProject).not.toHaveBeenCalled();
    const locked = inspector();
    expect(find(locked.host, Drawer)).toMatchObject({ closable: false, keyboard: false, maskClosable: false });
    child.props.onPending("project.update", false);
    find(inspector().host, Drawer).onClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the host guarded by a restored slot before its metadata modal is opened", async () => {
    button(settings(), "save").onClick(); await settle();
    expect(h.sends).toHaveLength(1);
    recreate();
    const recovered = inspector();
    find(recovered.host, Drawer).onClose();
    button(recovered.body, "enter").onClick();
    expect(onClose).not.toHaveBeenCalled(); expect(enterPortfolioProject).not.toHaveBeenCalled();
    expect(find(recovered.host, Drawer)).toMatchObject({ closable: false, keyboard: false, maskClosable: false });
  });

  it("opens only settings when both old editor buttons are clicked in the same render", () => {
    const first = inspector();
    action(first.body, "open-settings").onClick();
    action(first.body, "open-lifecycle").onClick();
    const body = inspector().body;
    expect(nodes(body).filter((node) => node.type === ProjectSettingsEditor)).toHaveLength(1);
    expect(nodes(body).filter((node) => node.type === ProjectLifecycleEditor)).toHaveLength(0);
  });

  it("opens only lifecycle when its old button wins the same-render race", () => {
    const first = inspector();
    action(first.body, "open-lifecycle").onClick();
    action(first.body, "open-settings").onClick();
    const body = inspector().body;
    expect(nodes(body).filter((node) => node.type === ProjectLifecycleEditor)).toHaveLength(1);
    expect(nodes(body).filter((node) => node.type === ProjectSettingsEditor)).toHaveLength(0);
  });

  it("rejects both old editor open callbacks while the closed Drawer retains its outgoing body", () => {
    const first = inspector();
    const openSettings = action(first.body, "open-settings");
    const openLifecycle = action(first.body, "open-lifecycle");
    const originalSession = projectSessionKey();
    window.location.hash = "#/projects/portfolio";
    const closing = inspector("");
    expect(find(closing.host, Drawer).open).toBe(false);
    expect(nodes(closing.host).some((node) => typeof node.type === "function" && node.type.name === "InspectorBody")).toBe(true);
    expect(projectSessionKey()).toBe(originalSession);
    openSettings.onClick(); openLifecycle.onClick();
    const outgoing = inspector("").body;
    expect(nodes(outgoing).filter((node) => node.type === ProjectSettingsEditor || node.type === ProjectLifecycleEditor)).toHaveLength(0);
    expect(h.sends).toHaveLength(0); expect(previewProjectLifecycle).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled(); expect(window.location.hash).toBe("#/projects/portfolio");
  });

  it("retains original metadata recovery when a fresh detail read fails and withholds cached facts", async () => {
    button(settings(), "save").onClick(); await settle();
    const original = structuredClone(h.sends[0]);
    recreate(); h.detailError = new Error("HTTP 403: detail permission changed");
    const first = inspector();
    expect(text(first.body)).not.toContain(portfolioDetail.project.name);
    expect(button(first.body, "enter")).toBeUndefined();
    expect(text(first.body)).not.toContain("projectPortfolio.liveFacts");
    action(first.body, "recover-project.update").onClick();
    const retained = nodes(inspector().body).find((node) => node.type === ProjectCommandRecovery)!;
    const recovery = frame("recovery-update", () => ProjectCommandRecovery(retained.props));
    h.mode = "success";
    action(recovery, "retry-original").onClick(); await settle();
    expect(h.sends).toEqual([original, original]);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(nodes(inspector().body).filter((node) => node.type === ProjectCommandRecovery)).toHaveLength(0);
    expect(button(inspector().body, "enter")).toBeUndefined();
  });

  it("does not let an old recovery selector replace a sending original with another slot", async () => {
    button(settings(), "save").onClick(); await settle();
    button(await readyLifecycle(), "confirm").onClick(); await settle();
    recreate();
    const first = inspector();
    const lifecycleRecovery = action(first.body, "recover-project.lifecycle");
    const metadataRecovery = action(first.body, "recover-project.update");
    lifecycleRecovery.onClick();
    const retained = nodes(inspector().body).find((node) => node.type === ProjectCommandRecovery)!;
    expect(retained.props.action).toBe("project.lifecycle");
    const recovery = frame("recovery-lifecycle", () => ProjectCommandRecovery(retained.props));
    h.mode = "pending";
    action(recovery, "retry-original").onClick(); metadataRecovery.onClick(); await settle();
    const current = nodes(inspector().body).filter((node) => node.type === ProjectCommandRecovery);
    expect(current).toHaveLength(1); expect(current[0].props.action).toBe("project.lifecycle");
    expect(h.sends).toHaveLength(3); expect(h.sends[2]).toEqual(h.sends[1]);
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    h.resolves[0](commandAck(h.sends[2])); await settle();
  });

  it("releases confirmed recovery even when refreshing its parent fails, leaving the other original recoverable", async () => {
    button(settings(), "save").onClick(); await settle();
    button(await readyLifecycle(), "confirm").onClick(); await settle();
    recreate();
    action(inspector().body, "recover-project.update").onClick();
    const retained = nodes(inspector().body).find((node) => node.type === ProjectCommandRecovery)!;
    const recovery = frame("recovery-update", () => ProjectCommandRecovery(retained.props));
    onSaved.mockImplementationOnce(() => { throw new Error("Parent refresh failed after acknowledgement"); });
    h.mode = "success"; action(recovery, "retry-original").onClick(); await settle();
    const current = inspector().body;
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(nodes(current).filter((node) => node.type === ProjectCommandRecovery)).toHaveLength(0);
    expect(find(current, Alert, (props) => props.description === "projectPortfolio.refreshAfterSaveFailed")).toBeDefined();
    action(current, "recover-project.lifecycle").onClick();
    const next = nodes(inspector().body).filter((node) => node.type === ProjectCommandRecovery);
    expect(next).toHaveLength(1); expect(next[0].props.action).toBe("project.lifecycle");
    expect(h.sends).toHaveLength(3); expect(h.sends[2]).toEqual(h.sends[0]);
  });

  it("checks the live inspector guard before external row entry, filters, inspection or creation", () => {
    const portfolio = frame("portfolio", PortfolioModule);
    const inspectorElement = nodes(portfolio).find((node) => node.type === ProjectInspector)!;
    const host = frame("portfolio-inspector", () => ProjectInspector(inspectorElement.props));
    const child = nodes(host).find((node) => typeof node.type === "function" && node.type.name === "InspectorBody")!;
    frame("portfolio-inspector-body", () => child.type(child.props));
    child.props.onPending("settings:P", true);
    const originalHash = window.location.hash;
    button(portfolio, "enter").onClick(); button(portfolio, "inspect").onClick();
    labeled(portfolio, "search").onChange({ target: { value: "Another project" } });
    button(portfolio, "create").onClick();
    expect(enterPortfolioProject).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(originalHash);
    expect(find(frame("portfolio", PortfolioModule), Modal).open).toBe(false);
    child.props.onPending("settings:P", false);
    button(portfolio, "enter").onClick();
    expect(enterPortfolioProject).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/dev-flow?project_id=P");
  });
});
