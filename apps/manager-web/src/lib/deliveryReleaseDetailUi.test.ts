import { isValidElement, type ReactNode } from "react";
import { Button, Input } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryReleaseDetail,
  ReleaseDetailContent,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseDetail";
import { submitReleaseCommand } from "./deliveryRelease";
import { releaseAck, releaseDetail } from "./deliveryReleaseFixtures";
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  next: 0,
  scope: "original",
  data: null as unknown,
  error: null as unknown,
  effects: [] as (() => void)[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: (effect: () => void) => {
    hooks.effects.push(effect);
  },
  useRef: (value: unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state)) hooks.state[i] = { current: value };
    return hooks.state[i];
  },
  useMemo: (factory: () => unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state)) hooks.state[i] = factory();
    return hooks.state[i];
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
  useState: (initial: unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state))
      hooks.state[i] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.state[i],
      (change: unknown) => {
        hooks.state[i] =
          typeof change === "function" ? change(hooks.state[i]) : change;
      },
    ];
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>(
    "./projectPortfolio",
  )),
  projectSessionKey: () => hooks.scope,
}));
vi.mock("./deliveryRelease", async () => ({
  ...(await vi.importActual<typeof import("./deliveryRelease")>(
    "./deliveryRelease",
  )),
  submitReleaseCommand: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: () => ({
    data: hooks.data,
    error: hooks.error,
    isError: Boolean(hooks.error),
    isPending: false,
    isFetching: false,
    refetch: async () => ({ data: hooks.data }),
  }),
}));
function find(
  node: ReactNode,
  type: unknown,
  key: string,
): Record<string, any> | undefined {
  if (Array.isArray(node))
    return node.map((n) => find(n, type, key)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return undefined;
  if (
    node.type === type &&
    (node.props.children === `deliveryRelease.${key}` ||
      node.props["aria-label"] === `deliveryRelease.${key}`)
  )
    return node.props;
  return (
    find(node.props.children, type, key) || find(node.props.footer, type, key)
  );
}
const render = (id = "REL-one") => {
  hooks.next = 0;
  return ReleaseDetailContent({
    projectId: "P",
    releaseId: id,
    sessionId: "test",
    background: "#/dev-flow?view=releases&project_id=P",
    onSaved: vi.fn(),
  });
};
const button = (key: string) => find(render(), Button, key)!;
beforeEach(() => {
  hooks.state = [];
  hooks.next = 0;
  hooks.scope = "original";
  hooks.data = structuredClone(releaseDetail);
  hooks.error = null;
  vi.mocked(submitReleaseCommand)
    .mockReset()
    .mockImplementation(async (projectId, action, payload, intent) =>
      releaseAck(projectId, action, payload, intent),
    );
});
describe("candidate review remains tied to the visible receipt", () => {
  it("locks the captured review comment and cancellation after an unknown result", async () => {
    button("reject").onClick();
    find(render(), Input.TextArea, "comment")!.onChange({
      target: { value: "original review" },
    });
    vi.mocked(submitReleaseCommand).mockRejectedValueOnce(
      new Error("reply lost"),
    );
    await button("confirm").onClick();
    expect(find(render(), Input.TextArea, "comment")!.disabled).toBe(true);
    expect(button("cancel").disabled).toBe(true);
  });
  it("submits the captured review basis rather than a background refetch", async () => {
    button("approve").onClick();
    find(render(), Input.TextArea, "comment")!.onChange({
      target: { value: "Reviewed immutable CI and scope" },
    });
    hooks.data = {
      ...releaseDetail,
      version: 9,
      candidate: { ...releaseDetail.candidate, review_basis: "f".repeat(64) },
    };
    await button("confirm").onClick();
    expect(vi.mocked(submitReleaseCommand).mock.calls[0]).toEqual([
      "P",
      "release.candidate.review",
      {
        id: "REL-one",
        decision: "approve",
        comment: "Reviewed immutable CI and scope",
        review_basis: "e".repeat(64),
      },
      expect.objectContaining({ version: 7 }),
    ]);
  });
  it("never substitutes another candidate for an unknown exact ID", () => {
    const tree = render("REL-unknown");
    expect(JSON.stringify(tree)).toContain("deliveryRelease.releaseMissing");
    expect(find(tree, Button, "approve")).toBeUndefined();
  });
  it("does not use cached success as current permission when reading fails", () => {
    hooks.error = new Error("offline");
    expect(button("approve").disabled).toBe(true);
  });
  it("keeps the outgoing receipt only through close animation without replacing unknown IDs or leaking scope", () => {
    function drawer(id: string, projectId = "P") {
      hooks.next = 0;
      hooks.effects = [];
      const result = DeliveryReleaseDetail({
        releaseId: id,
        projectId,
        sessionId: "test",
        background: "#/dev-flow?view=releases",
        onClose: vi.fn(),
        onSaved: vi.fn(),
      });
      hooks.effects.forEach((effect) => effect());
      return result.props;
    }
    expect(drawer("REL-one").open).toBe(true);
    const closing = drawer("");
    expect(closing.open).toBe(false);
    expect(closing.children.props.releaseId).toBe("REL-one");
    closing.afterOpenChange(false);
    expect(drawer("").children).toBe("");
    drawer("REL-one");
    expect(drawer("REL-unknown").children.props.releaseId).toBe("REL-unknown");
    expect(drawer("", "other-project").children).toBe("");
  });
  it("retains review comment and original key after a network failure", async () => {
    button("reject").onClick();
    find(render(), Input.TextArea, "comment")!.onChange({
      target: { value: "Needs additional evidence" },
    });
    vi.mocked(submitReleaseCommand).mockRejectedValueOnce(
      new Error("network result unknown"),
    );
    await button("confirm").onClick();
    expect(find(render(), Input.TextArea, "comment")!.value).toBe(
      "Needs additional evidence",
    );
    const original = vi.mocked(submitReleaseCommand).mock.calls[0];
    await button("replayOriginal").onClick();
    expect(vi.mocked(submitReleaseCommand).mock.calls[1]).toEqual(original);
  });
});
