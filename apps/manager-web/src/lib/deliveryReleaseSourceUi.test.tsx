import { isValidElement, type ReactNode } from "react";
import { Button, Input, Radio } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryReleaseSourceEditor } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseSourceEditor";
import { prepareReleaseSourcePacket, readReleaseCiReceipt } from "./deliveryRelease";
import { releaseQuality, releaseIndex, releaseSourcePacket } from "./deliveryReleaseFixtures";

const hooks = vi.hoisted(() => ({ state: [] as any[], next: 0, scope: "original" }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useRef: (value: unknown) => { const i = hooks.next++; return hooks.state[i] ??= { current: value }; },
  useState: (value: unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state)) hooks.state[i] = typeof value === "function" ? value() : value;
    return [hooks.state[i], (next: any) => { hooks.state[i] = typeof next === "function" ? next(hooks.state[i]) : next; }];
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => hooks.scope }));
vi.mock("./deliveryRelease", async () => ({ ...(await vi.importActual<typeof import("./deliveryRelease")>("./deliveryRelease")),
  prepareReleaseSourcePacket: vi.fn(),
}));
function all(node: ReactNode, type: unknown): any[] {
  if (Array.isArray(node)) return node.flatMap((value) => all(value, type));
  if (!isValidElement<any>(node)) return [];
  return [...(node.type === type ? [node.props] : []), ...all(node.props.children, type), ...all(node.props.footer, type)];
}
const close = vi.fn();
function render(readOnly = false) {
  hooks.next = 0;
  return DeliveryReleaseSourceEditor({ projectId: "P", quality: { ...releaseQuality, tasks: releaseQuality.independent_tasks },
    policy: releaseIndex.policy!, readOnly, onClose: close });
}
const button = (key: string, readOnly = false) => all(render(readOnly), Button).find((row) => row.children === `deliveryRelease.${key}`)!;
function nonCode() {
  all(render(), Radio.Group)[0].onChange({ target: { value: "no_code_change" } });
  all(render(), Input)[0].onChange({ target: { value: "Explicit documentation task" } });
}
beforeEach(() => {
  hooks.state = []; hooks.next = 0; hooks.scope = "original"; close.mockReset();
  vi.mocked(prepareReleaseSourcePacket).mockReset().mockResolvedValue({ project_id: "P", version: 7,
    query_generation: 7, packet: structuredClone(releaseSourcePacket) });
});
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
    all(render(), Input)[0].onChange({ target: { value: "Changed rationale" } });
    expect(button("sourceDownload").disabled).toBe(true);
  });
  it("retains input on read failure and prevents generation for readers", async () => {
    nonCode();
    vi.mocked(prepareReleaseSourcePacket).mockRejectedValueOnce(new Error("offline"));
    await button("sourceGenerate").onClick();
    expect(all(render(), Input)[0].value).toBe("Explicit documentation task");
    expect(button("sourceGenerate", true).disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });
  it("drops a late result from another session without offering its packet", async () => {
    nonCode();
    let finish!: (value: any) => void;
    vi.mocked(prepareReleaseSourcePacket).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = button("sourceGenerate").onClick();
    hooks.scope = "other";
    finish({ project_id: "P", version: 7, query_generation: 7, packet: releaseSourcePacket });
    await pending;
    expect(button("sourceDownload").disabled).toBe(true);
  });
  it("preserves signed envelope text and rejects files for another current scope", () => {
    const rawEnvelope = '{"payload":"one","payload":"two"}';
    const raw = JSON.stringify({ envelope: rawEnvelope, source_packet: releaseSourcePacket, ...releaseQuality.selected });
    expect(readReleaseCiReceipt(raw, releaseQuality.selected, "P", releaseQuality.scope_basis!).envelope).toBe(rawEnvelope);
    expect(() => readReleaseCiReceipt(raw, releaseQuality.selected, "P", "d".repeat(64))).toThrow();
    expect(() => readReleaseCiReceipt(raw, { requirement_ids: [], task_ids: [] }, "P", releaseQuality.scope_basis!)).toThrow();
  });
});
