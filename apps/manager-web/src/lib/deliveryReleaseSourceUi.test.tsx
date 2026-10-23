import { isValidElement, type ReactNode } from "react";
import { Button, Drawer, Input, Radio } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryReleaseSourceEditor } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseSourceEditor";
import { prepareReleaseSourcePacket, readReleaseCiReceipt } from "./deliveryRelease";
import { releaseQuality, releaseIndex, releaseSourcePacket } from "./deliveryReleaseFixtures";

const hooks = vi.hoisted(() => ({ state: [] as any[], next: 0, scope: "original", retained: new Map<string, string>(), quota: false,
  cleanups: [] as Array<() => void>, exitGuard: null as (() => boolean) | null }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: (make: () => void | (() => void)) => {
    const i = hooks.next++;
    if (!(i in hooks.state)) { hooks.state[i] = true; const cleanup = make(); if (cleanup) hooks.cleanups.push(cleanup); }
  },
  useRef: (value: unknown) => { const i = hooks.next++; return hooks.state[i] ??= { current: value }; },
  useState: (value: unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state)) hooks.state[i] = typeof value === "function" ? value() : value;
    return [hooks.state[i], (next: any) => { hooks.state[i] = typeof next === "function" ? next(hooks.state[i]) : next; }];
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => hooks.scope }));
vi.mock("./eventReceipts", () => ({ eventRetryDraftKey: (project: string, identity: string) => `sop.event-retry.v1:${hooks.scope}:${project}:${identity}` }));
vi.mock("./deliveryRelease", async () => ({ ...(await vi.importActual<typeof import("./deliveryRelease")>("./deliveryRelease")),
  prepareReleaseSourcePacket: vi.fn(),
}));
function all(node: ReactNode, type: unknown): any[] {
  if (Array.isArray(node)) return node.flatMap((value) => all(value, type));
  if (!isValidElement<any>(node)) return [];
  return [...(node.type === type ? [node.props] : []), ...all(node.props.children, type), ...all(node.props.footer, type), ...all(node.props.action, type)];
}
const close = vi.fn();
function render(readOnly = false) {
  hooks.next = 0;
  return DeliveryReleaseSourceEditor({ projectId: "P", quality: { ...releaseQuality, tasks: releaseQuality.independent_tasks },
    policy: releaseIndex.policy!, readOnly, onClose: close, onExitGuard: (guard) => { hooks.exitGuard = guard; } });
}
const button = (key: string, readOnly = false) => all(render(readOnly), Button).find((row) => row.children === `deliveryRelease.${key}`)!;
function nonCode() {
  all(render(), Radio.Group)[0].onChange({ target: { value: "no_code_change" } });
  all(render(), Input.TextArea)[0].onChange({ target: { value: "Explicit documentation task" } });
}
beforeEach(() => {
  hooks.state = []; hooks.next = 0; hooks.scope = "original"; close.mockReset();
  hooks.retained.clear(); hooks.quota = false; hooks.cleanups = []; hooks.exitGuard = null;
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => hooks.retained.get(key) ?? null,
    setItem: (key: string, raw: string) => { if (hooks.quota) throw new Error("quota"); hooks.retained.set(key, raw); },
    removeItem: (key: string) => hooks.retained.delete(key) });
  const location = new URL("https://app.example/#/dev-flow?project_id=P&view=quality");
  const history = { state: null, replaceState: (_state: unknown, _title: string, href: string) => { location.href = new URL(href, location).href; } };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location, history, document: new EventTarget() }));
  vi.stubGlobal("location", location);
  vi.mocked(prepareReleaseSourcePacket).mockReset().mockResolvedValue({ project_id: "P", version: 7,
    query_generation: 7, packet: structuredClone(releaseSourcePacket) });
});
afterEach(() => { hooks.cleanups.forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); });
function remount() {
  hooks.cleanups.forEach((cleanup) => cleanup()); hooks.cleanups = []; hooks.state = []; hooks.next = 0;
}
describe("explicit source preparation uses the actual editor", () => {
  it("never defaults a task to non-code and invalidates a prepared packet after editing", async () => {
    expect(all(render(), Radio.Group)[0].value).toBe(null);
    expect(button("sourceGenerate").disabled).toBe(true);
    nonCode();
    await button("sourceGenerate").onClick();
    expect(prepareReleaseSourcePacket).toHaveBeenCalledWith("P", expect.objectContaining({
      scope_basis: releaseQuality.scope_basis, policy_generation: 1,
      mappings: [{ task_id: "T-one", kind: "no_code_change", base_commit: null, accepted_commit: null, comment: "Explicit documentation task" }],
    }), expect.any(AbortSignal));
    expect(button("sourceDownload").disabled).toBe(false);
    all(render(), Input.TextArea)[0].onChange({ target: { value: "Changed rationale" } });
    expect(button("sourceDownload").disabled).toBe(true);
  });
  it("retains input on read failure and prevents generation for readers", async () => {
    nonCode();
    vi.mocked(prepareReleaseSourcePacket).mockRejectedValueOnce(new Error("offline"));
    await button("sourceGenerate").onClick();
    expect(all(render(), Input.TextArea)[0].value).toBe("Explicit documentation task");
    expect(button("sourceGenerate", true).disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });
  it("preserves multiline rationale in the actual preparation callback and blocks invalid text", async () => {
    nonCode(); const comment = "Documentation reviewed\r\n\tNo code changes 😀";
    all(render(), Input.TextArea)[0].onChange({ target: { value: comment } });
    await button("sourceGenerate").onClick();
    expect(prepareReleaseSourcePacket).toHaveBeenLastCalledWith("P", expect.objectContaining({ mappings: [expect.objectContaining({ comment })] }), expect.any(AbortSignal));
    all(render(), Input.TextArea)[0].onChange({ target: { value: "Bad\u0000text" } });
    expect(button("sourceGenerate").disabled).toBe(true); await button("sourceGenerate").onClick();
    expect(prepareReleaseSourcePacket).toHaveBeenCalledTimes(1);
  });
  it("drops a late result from another session without offering its packet", async () => {
    nonCode();
    let finish!: (value: any) => void;
    vi.mocked(prepareReleaseSourcePacket).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = button("sourceGenerate").onClick();
    hooks.scope = "other";
    window.dispatchEvent(new Event("sop-session"));
    finish({ project_id: "P", version: 7, query_generation: 7, packet: releaseSourcePacket });
    await pending;
    expect(button("sourceDownload")).toBeUndefined();
    expect(all(render(), Input.TextArea)).toHaveLength(0);
  });
  it("preserves signed envelope text and rejects files for another current scope", () => {
    const rawEnvelope = '{"payload":"one","payload":"two"}';
    const raw = JSON.stringify({ envelope: rawEnvelope, source_packet: releaseSourcePacket, ...releaseQuality.selected });
    expect(readReleaseCiReceipt(raw, releaseQuality.selected, "P", releaseQuality.scope_basis!).envelope).toBe(rawEnvelope);
    expect(() => readReleaseCiReceipt(raw, releaseQuality.selected, "P", "d".repeat(64))).toThrow();
    expect(() => readReleaseCiReceipt(raw, { requirement_ids: [], task_ids: [] }, "P", releaseQuality.scope_basis!)).toThrow();
  });
  it("restores filled input after closing and reopening but requires fresh generation", async () => {
    nonCode(); await button("sourceGenerate").onClick(); expect(button("sourceDownload").disabled).toBe(false);
    button("close").onClick(); expect(close).toHaveBeenCalledOnce(); remount();
    expect(all(render(), Input.TextArea)[0].value).toBe("Explicit documentation task");
    expect(button("sourceDownload").disabled).toBe(true); expect(button("sourceGenerate").disabled).toBe(false);
    expect(prepareReleaseSourcePacket).toHaveBeenCalledTimes(1);
  });
  it("warns before losing input when storage is unavailable, including real route and unload guards", () => {
    hooks.quota = true; nonCode(); render();
    all(render(), Drawer)[0].onClose(); expect(close).not.toHaveBeenCalled();
    expect(button("sourceDraftDiscardClose")).toBeDefined(); button("sourceDraftContinue").onClick();
    const before = location.href; location.hash = "#/dev-flow?view=tasks"; window.dispatchEvent(new Event("hashchange"));
    expect(location.href).toBe(before); expect(close).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    button("sourceDraftDiscardClose").onClick(); expect(close).toHaveBeenCalledOnce();
  });
  it("registers a host guard without locking editing and releases it after input is retained", () => {
    hooks.quota = true; nonCode(); render(); expect(hooks.exitGuard!()).toBe(false);
    expect(button("sourceDraftContinue")).toBeDefined(); hooks.quota = false;
    all(render(), Input.TextArea)[0].onChange({ target: { value: "Now retained" } });
    expect(hooks.exitGuard!()).toBe(true); remount();
    expect(hooks.exitGuard).toBeNull();
  });
  it("clears only after confirmation and prevents readonly or late-session edits", () => {
    nonCode(); const original = [...hooks.retained.values()];
    all(render(true), Input.TextArea)[0].onChange({ target: { value: "Must not replace" } });
    expect([...hooks.retained.values()]).toEqual(original);
    button("sourceDraftClear").onClick(); expect(all(render(), Input.TextArea)[0].value).toBe("Explicit documentation task");
    const readonlyClear = all(render(true), Button).find((row) => row.danger && row.children === "deliveryRelease.sourceDraftClear")!;
    expect(readonlyClear.disabled).toBe(true); readonlyClear.onClick(); expect([...hooks.retained.values()]).toEqual(original);
    button("sourceDraftContinue").onClick(); expect([...hooks.retained.values()]).toEqual(original);
    button("sourceDraftClear").onClick();
    all(render(), Button).find((row) => row.danger && row.children === "deliveryRelease.sourceDraftClear")!.onClick();
    expect(all(render(), Radio.Group)[0].value).toBeNull(); expect(hooks.retained.size).toBe(0);
    const lateEdit = all(render(), Radio.Group)[0].onChange;
    hooks.scope = "other"; lateEdit({ target: { value: "no_code_change" } });
    expect(hooks.retained.size).toBe(0);
  });
});
