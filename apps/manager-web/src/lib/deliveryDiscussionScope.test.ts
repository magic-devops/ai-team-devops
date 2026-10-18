import { describe, expect, it } from "vitest";
import { createDiscussionGate } from "./deliveryDiscussionDraft";
describe("discussion request epochs", () => {
  it("never revives an old request after A to B to A without a replacement", () => {
    const gate = createDiscussionGate();
    gate.enter("A");
    const old = gate.start();
    gate.enter("B");
    gate.enter("A");
    expect(gate.current(old)).toBe(false);
  });
  it("keeps replacement work isolated from old completions and unmount", () => {
    const gate = createDiscussionGate();
    gate.enter("A");
    const old = gate.start();
    gate.enter("B");
    const replacement = gate.start();
    expect(gate.current(old)).toBe(false);
    expect(gate.current(replacement)).toBe(true);
    gate.leave();
    expect(gate.current(replacement)).toBe(false);
  });
});
