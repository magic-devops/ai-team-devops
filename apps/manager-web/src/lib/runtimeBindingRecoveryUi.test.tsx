/** SOURCE ONLY. Recovery must not depend on a current directory or configuration. */
import { isValidElement, type ReactNode } from "react";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeBindingRecovery } from "../../subapps/ai-rd-center/src/pages/delivery/RuntimeBindingRecovery";
import { createRuntimeBindingController, type RuntimeBindingCommand } from "./runtimeBindingCommand";
const h = vi.hoisted(() => ({ state: [] as any[], next: 0, effects: [] as Array<() => void> }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useRef: (initial: any) => { const at = h.next++; return h.state[at] ||= { current: initial }; },
  useState: (initial: any) => { const at = h.next++; if (!(at in h.state)) h.state[at] = initial; return [h.state[at], (value: any) => { h.state[at] = value; }]; },
  useEffect: (effect: () => (() => void)) => { h.effects.push(effect()); },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-US" } }) }));
const original = { action: "member.runtime.unbind" as const, payload: { member_id: "M" }, intent: { version: 4, key: "fixed-original-key" } };
const ack = { project_id: "P", action: original.action, resource: { kind: "member", id: "M" }, result: null, affected_refs: [{ kind: "member", id: "M" }], applied_version: 5, version: 5, query_generation: 3, replayed: true };
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<any>(node)) return []; return [node, ...nodes(node.props.children)]; }
function fixture(phase: "unknown" | "succeeded" | "refused" = "unknown") {
  const send = vi.fn(async () => ack), saved = vi.fn(), resolved = vi.fn(), deferred = vi.fn(); let active = true;
  const controller = createRuntimeBindingController({ projectId: "P", memberId: "M", scope: "scope", currentScope: () => "scope", load: () => JSON.stringify({ phase, original, ...(phase === "succeeded" ? { ack } : {}) }), save: vi.fn(), send });
  const render = () => { h.next = 0; return RuntimeBindingRecovery({ projectId: "P", memberId: "M", command: { ...controller, state: controller.snapshot(), locked: true } as RuntimeBindingCommand, onSaved: saved, onResolved: resolved, onDeferred: deferred, isActive: () => active }); };
  const button = (action: string) => nodes(render()).find((node) => node.type === Button && node.props["data-action"] === action)?.props;
  return { send, saved, resolved, deferred, controller, render, button, leave: () => { active = false; } };
}
beforeEach(() => { h.state = []; h.next = 0; h.effects = []; });
describe("binding operation recovery surface", () => {
  it("replays only the saved original and keeps the confirmed receipt for explicit application", async () => {
    const f = fixture(); await f.button("recover-runtime-binding").onClick(); expect(f.send).toHaveBeenCalledWith(original);
    expect(f.saved).not.toHaveBeenCalled(); await f.button("finish-runtime-binding").onClick();
    expect(f.saved).toHaveBeenCalledWith(ack); expect(f.resolved).toHaveBeenCalledOnce(); expect(f.controller.snapshot().phase).toBe("idle");
  });
  it("retains known success if applying the receipt fails", async () => {
    const f = fixture("succeeded"); f.saved.mockImplementation(() => { throw new Error("Refresh failed"); });
    await f.button("finish-runtime-binding").onClick(); expect(f.controller.snapshot().phase).toBe("succeeded"); expect(f.resolved).not.toHaveBeenCalled();
  });
  it("awaits asynchronous refresh and retains the receipt on rejection", async () => {
    const f = fixture("succeeded"); let reject!: (error: Error) => void;
    f.saved.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const button = f.button("finish-runtime-binding"), pending = button.onClick();
    button.onClick(); expect(f.saved).toHaveBeenCalledTimes(1); expect(f.controller.snapshot().phase).toBe("succeeded");
    reject(new Error("Directory refresh failed")); await pending;
    expect(f.controller.snapshot().phase).toBe("succeeded"); expect(f.resolved).not.toHaveBeenCalled();
  });
  it("rejects double recovery and stale callbacks after the active member changes", async () => {
    const f = fixture(), button = f.button("recover-runtime-binding"); f.leave(); await button.onClick();
    expect(f.send).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
  });
  it("permits explicit discard only for a known refusal", () => {
    const f = fixture("refused"); f.button("discard-runtime-binding").onClick(); expect(f.controller.snapshot().phase).toBe("idle"); expect(f.send).not.toHaveBeenCalled();
  });
  it("can leave an unresolved editor without resetting, discarding or resending its original", () => {
    const f = fixture(); f.button("defer-runtime-binding").onClick();
    expect(f.deferred).toHaveBeenCalledOnce(); expect(f.controller.snapshot()).toMatchObject({ phase: "unknown", original });
    expect(f.send).not.toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled(); expect(f.resolved).not.toHaveBeenCalled();
  });
});
