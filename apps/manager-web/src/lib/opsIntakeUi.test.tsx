/** Actual editor and controller callbacks, source definitions only, unrun. */
import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Input, Modal } from "antd";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OpsIntakeEditor } from "../../subapps/ai-ops-center/src/pages/system/ops-center/OpsRemediationIntake";
import { createOpsIntakeController } from "./opsIntakeCommand";
const h = vi.hoisted(() => ({ slots: [] as any[], next: 0, effects: [] as Array<() => void>, query: {} as any, read: vi.fn(), send: vi.fn(), raw: null as string | null, active: true }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = (initial: any) => { const index = h.next++; if (!(index in h.slots)) h.slots[index] = initial; return index; };
  return { ...actual, useState: (initial: any) => { const index = slot(typeof initial === "function" ? initial() : initial); return [h.slots[index], (value: any) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }]; },
    useRef: (initial: any) => h.slots[slot({ current: initial })],
    useEffect: (effect: () => any, deps: any[]) => { const index = slot(undefined), old = h.slots[index]; if (!old || deps.some((v, i) => v !== old.deps[i])) { const entry = { deps, cleanup: undefined as any }; h.slots[index] = entry; h.effects.push(() => { old?.cleanup?.(); entry.cleanup = effect(); }); } },
  };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "zh-CN" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => h.query }));
vi.mock("./opsRemediation", async () => ({ ...await vi.importActual<typeof import("./opsRemediation")>("./opsRemediation"), readOpsIntake: (...args: any[]) => h.read(...args) }));
const view = { project_id: "P", version: 7, source_type: "self_heal", source_id: "ops-one", source_digest: "a".repeat(64), source_kind: "reported_only", snapshot: { id: "ops-one", trigger_condition: "Investigate API" }, can_intake: true, existing_issue_id: null, existing_issue_available: false, as_of: "2026-10-23T00:00:00Z" };
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); return isValidElement<any>(node) ? [node, ...["children", "action", "description"].flatMap((key) => nodes(node.props[key]))] : []; }
function button(tree: ReactNode, label: string) { return nodes(tree).find((n) => n.type === Button && n.props.children === label)!; }
function owner() {
  const c = createOpsIntakeController({ projectId: "P", scope: "scope", currentScope: () => h.active ? "scope" : "changed", load: () => h.raw, save: (raw) => { h.raw = raw; }, send: h.send });
  return Object.defineProperties(c, { scope: { value: "scope" }, state: { get: () => c.snapshot() }, locked: { get: () => !["idle", "refused"].includes(c.snapshot().phase) } });
}
let command: any;
function frame(patch: Record<string, any> = {}) { h.next = 0; h.effects = []; const tree = OpsIntakeEditor({ projectId: "P", sourceId: "ops-one", open: true, onClose: vi.fn(), command, ...patch }); h.effects.forEach((effect) => effect()); return tree; }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.effects = []; h.next = 0; h.active = true; h.raw = null; h.read.mockReset(); h.send.mockReset(); h.read.mockResolvedValue(structuredClone(view)); h.query = { data: structuredClone(view), error: null, isPending: false, refetch: vi.fn() }; command = owner(); vi.stubGlobal("crypto", { randomUUID: () => "ops-ui-original-key" }); });
afterEach(() => { for (const slot of h.slots) slot?.cleanup?.(); vi.unstubAllGlobals(); });

describe("one operational intake workflow", () => {
  it("uses the RCA action and read boundary for an RCA source, preserving the unknown original", async () => {
    const rca = { ...view, source_type: "rca" };
    h.query.data = rca; h.read.mockResolvedValue(rca); h.send.mockRejectedValue(new Error("response lost"));
    frame({ sourceType: "rca" }); const tree = frame({ sourceType: "rca" });
    button(tree, "纳入问题").props.onClick(); await flush();
    expect(h.read).toHaveBeenCalledWith("P", "ops-one", undefined, "rca");
    expect(h.send).toHaveBeenCalledOnce();
    expect(command.snapshot().original.action).toBe("issue.rca.intake");
    expect(command.snapshot().phase).toBe("unknown");
  });
  it("keeps an editable draft when a known refusal is cleared and the reread shares its cached value", async () => {
    frame(); const tree = frame();
    nodes(tree).find((n) => n.type === Input)!.props.onChange({ target: { value: "Keep this investigation" } });
    h.send.mockRejectedValue(new Error('HTTP 409: {"detail":{"code":"ops_source_changed"}}'));
    button(frame(), "纳入问题").props.onClick(); await flush();
    expect(command.snapshot().phase).toBe("refused");
    button(frame(), "重新读取来源").props.onClick();
    const editable = frame();
    expect(command.snapshot().phase).toBe("idle");
    expect(nodes(editable).find((n) => n.type === Input)!.props.value).toBe("Keep this investigation");
    expect(button(editable, "纳入问题")).toBeDefined();
    expect(h.query.refetch).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledOnce();
  });
  it("takes fresh facts once, prevents double submits and retains an unknown original after a source read fails", async () => {
    frame(); const tree = frame();
    let release!: (value: unknown) => void; h.read.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    h.send.mockRejectedValue(new Error("response lost"));
    button(tree, "纳入问题").props.onClick(); button(tree, "纳入问题").props.onClick(); expect(h.read).toHaveBeenCalledTimes(1);
    release(view); await flush(); expect(h.send).toHaveBeenCalledOnce(); expect(command.snapshot().phase).toBe("unknown");
    h.query.error = new Error("source missing");
    const recovery = frame(); expect(nodes(recovery).find((n) => n.type === Modal).props.closable).toBe(false);
    expect(button(recovery, "恢复原请求")).toBeDefined(); expect(JSON.stringify(recovery)).toContain("ops-ui-original-key");
    expect(nodes(recovery).filter((n) => n.type === Input)).toHaveLength(0);
    const retained = h.raw; button(recovery, "保留操作，稍后恢复").props.onClick();
    expect(nodes(frame({ open: false })).find((n) => n.type === Modal).props.open).toBe(false);
    expect(h.raw).toBe(retained); expect(h.send).toHaveBeenCalledOnce();
  });
  it("does not write from a late preview after a different source was selected", async () => {
    frame(); const tree = frame(); let release!: (value: unknown) => void;
    h.read.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    button(tree, "纳入问题").props.onClick(); frame({ sourceId: "other-source" }); release(view); await flush();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects a late preview when the source type changed with the same external ID", async () => {
    frame(); const tree = frame(); let release!: (value: unknown) => void;
    h.read.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    button(tree, "纳入问题").props.onClick(); frame({ sourceType: "rca" }); release(view); await flush();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("requires explicit adoption of new facts and keeps the human's draft", async () => {
    frame(); const tree = frame(); const input = nodes(tree).find((n) => n.type === Input)!;
    input.props.onChange({ target: { value: "Human investigation title" } });
    h.read.mockResolvedValue({ ...view, version: 8 }); button(frame(), "纳入问题").props.onClick(); await flush();
    expect(h.send).not.toHaveBeenCalled(); const blocked = frame(); expect(button(blocked, "采用当前来源")).toBeDefined();
    button(blocked, "采用当前来源").props.onClick(); const adopted = frame();
    expect(nodes(adopted).find((n) => n.type === Input).props.value).toBe("Human investigation title");
    expect(command.snapshot().phase).toBe("idle");
  });
});
