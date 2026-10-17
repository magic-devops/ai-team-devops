import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExecutionExitGuard } from "./executionExitGuard";
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  refs: [] as any[],
  index: 0,
  refIndex: 0,
  scope: "one",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current: initial });
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [
      hooks.state[index],
      (next: unknown) => {
        hooks.state[index] = next;
      },
    ];
  },
}));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => hooks.scope }));
const render = () => {
  hooks.index = 0;
  hooks.refIndex = 0;
  return useExecutionExitGuard();
};
beforeEach(() => {
  hooks.state = [];
  hooks.refs = [];
  hooks.scope = "one";
});
describe("pending execution identities are aggregated independently", () => {
  it("does not unlock the parent when a different task reports false", () => {
    render().setPending("task-one", true);
    render().setPending("task-two", true);
    render().setPending("task-one", false);
    expect(render().pending).toBe(true);
    expect(render().canNavigate()).toBe(false);
    render().setPending("task-two", false);
    expect(render().pending).toBe(false);
    expect(render().canNavigate()).toBe(true);
  });
  it("does not prevent leaving after the operator identity changes", () => {
    render().setPending("execution", true);
    hooks.scope = "two";
    expect(render().canNavigate()).toBe(true);
  });
});
