import { isValidElement, type ReactNode } from "react";
import { Button, Input, Modal } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryProgressCommands } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgressCommands";
const h = vi.hoisted(() => ({
  state: [] as any[],
  refs: [] as any[],
  next: 0,
  refNext: 0,
  controllers: {} as Record<string, any>,
  stored: new Map<string, string>(),
  sends: [] as any[],
  pending: {} as Record<string, boolean>,
  session: "original",
  mode: "unknown",
  label: "Project",
  badProof: false,
  resolve: null as any,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.state))
      h.state[index] = typeof initial === "function" ? initial() : initial;
    return [
      h.state[index],
      (value: any) => {
        h.state[index] =
          typeof value === "function" ? value(h.state[index]) : value;
      },
    ];
  },
  useRef: (value: any) => (h.refs[h.refNext++] ||= { current: value }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>(
    "./projectPortfolio",
  )),
  projectSessionKey: () => h.session,
}));
vi.mock("./deliveryProgress", async () => {
  const actual =
    await vi.importActual<typeof import("./deliveryProgress")>(
      "./deliveryProgress",
    );
  return {
    ...actual,
    fetchProgressFreezeProof: async () => ({
      project_id: "P",
      version: 7,
      query_generation: 3,
      scope: { kind: "project", id: "", label: "Project" },
      available: true,
      complete: true,
      basis: "a".repeat(64),
      task_ids: ["T-whole"],
      metrics: { tasks_total: h.badProof ? 2 : 1 },
      budget: {},
      reasons: [],
    }),
    useProgressCommand: (_project: string, action: any, onPending: any) => {
      const controller = (h.controllers[action] ||=
        actual.createProgressCommandController({
          projectId: "P",
          action,
          scope: h.session,
          currentScope: () => h.session,
          load: () => h.stored.get(action) || null,
          save: (value) => h.stored.set(action, value),
          onPending,
          send: async (original) => {
            h.sends.push(structuredClone(original));
            if (h.mode === "pending")
              return new Promise((resolve) => {
                h.resolve = resolve;
              });
            if (h.mode === "unknown")
              throw new Error("network interrupted after possible commit");
            return {
              project_id: "P",
              action,
              resource: {
                kind: action === "baseline.create" ? "baseline" : "observation",
                id: "new-resource",
              },
              applied_version: 8,
              version: 8,
              query_generation: 4,
              affected_refs: [
                {
                  kind:
                    action === "baseline.create" ? "baseline" : "observation",
                  id: "new-resource",
                },
              ],
              result: null,
              replayed: true,
            };
          },
        }));
      const state = controller.snapshot();
      return {
        ...controller,
        state,
        locked: state.phase !== "idle" && state.phase !== "refused",
        unresolved: ["sending", "unknown"].includes(state.phase),
      };
    },
  };
});
function find(
  node: ReactNode,
  type: unknown,
  predicate: (props: any) => boolean = () => true,
): any {
  if (Array.isArray(node))
    return node.map((item) => find(item, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(node.props.action, type, predicate)
  );
}
const saved = vi.fn();
function render() {
  h.next = 0;
  h.refNext = 0;
  return DeliveryProgressCommands({
    projectId: "P",
    route: {
      startsOn: "2026-10-01",
      endsOn: "2026-10-19",
      scope: "project",
      scopeId: "",
      baselineId: "",
      observationId: "",
    },
    data: { version: 7, scope: { label: h.label } } as any,
    canWrite: true,
    canApprove: true,
    unavailable: false,
    onSaved: saved,
    onRefresh: vi.fn(),
    onPending: (key, pending) => {
      h.pending[key] = pending;
    },
  });
}
const button = (tree: ReactNode, key: string) =>
  find(tree, Button, (props) => props.children === key);
async function settle() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
async function ready() {
  button(render(), "deliveryProgress.freeze").onClick();
  button(render(), "deliveryProgress.bounded.readProof").onClick();
  await settle();
  return render();
}
beforeEach(() => {
  h.state = [];
  h.refs = [];
  h.controllers = {};
  h.stored.clear();
  h.sends = [];
  h.pending = {};
  h.session = "original";
  h.mode = "unknown";
  h.label = "Project";
  h.badProof = false;
  saved.mockReset();
});
describe("actual progress command callbacks and durable originals", () => {
  it("limits a generated title from a legal long scope label without replacing a later human draft", async () => {
    h.label = "S".repeat(256);
    const tree = await ready();
    const input = find(tree, Input, (props) => props.maxLength === 200);
    expect(input.value.length).toBeLessThanOrEqual(200);
    input.onChange({ target: { value: "Human reviewed title" } });
    find(render(), Modal).onCancel();
    button(render(), "deliveryProgress.freeze").onClick();
    expect(
      find(render(), Input, (props) => props.maxLength === 200).value,
    ).toBe("Human reviewed title");
  });
  it("rejects reversed baseline dates in the UI while allowing an otherwise valid multi-year plan", async () => {
    const date = (tree: ReactNode, label: string) =>
      find(
        tree,
        "label",
        (props) => props.children?.[0]?.props?.children === label,
      ).children[1].props;
    date(await ready(), "deliveryProgress.startsOn").onChange({
      target: { value: "2026-10-30" },
    });
    date(render(), "deliveryProgress.endsOn").onChange({
      target: { value: "2026-10-01" },
    });
    expect(
      button(render(), "deliveryProgress.bounded.confirmFreeze").disabled,
    ).toBe(true);
    date(render(), "deliveryProgress.startsOn").onChange({
      target: { value: "2020-01-01" },
    });
    date(render(), "deliveryProgress.endsOn").onChange({
      target: { value: "2030-01-01" },
    });
    expect(
      button(render(), "deliveryProgress.bounded.confirmFreeze").disabled,
    ).toBe(false);
  });
  it("reports an incomplete proof in readable UI language instead of exposing the internal error token", async () => {
    h.badProof = true;
    const tree = await ready();
    button(tree, "deliveryProgress.bounded.confirmFreeze").onClick();
    await settle();
    expect(h.sends).toHaveLength(0);
    expect(JSON.stringify(render())).not.toContain(
      '"description":"progressProofRequired"',
    );
    expect(JSON.stringify(render())).toContain(
      "deliveryProgress.bounded.proofRequired",
    );
  });
  it("does not start freeze from a stale same-render callback after record has synchronously started", async () => {
    const tree = await ready();
    h.mode = "pending";
    button(tree, "deliveryProgress.record").onClick();
    button(tree, "deliveryProgress.bounded.confirmFreeze").onClick();
    await settle();
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].action).toBe("progress.record");
  });
  it("keeps the frozen body and key after unknown, blocks cancel and old input callbacks, and restores exact replay after recreation", async () => {
    const tree = await ready(),
      oldEdit = find(tree, Input, (props) => props.maxLength === 200).onChange;
    const originalTitle = h.state[4].title;
    button(tree, "deliveryProgress.bounded.confirmFreeze").onClick();
    await settle();
    oldEdit({ target: { value: "Must not replace the reviewed draft" } });
    expect(h.state[4].title).toBe(originalTitle);
    expect(find(render(), Modal)).toMatchObject({
      open: true,
      closable: false,
      keyboard: false,
    });
    find(render(), Modal).onCancel();
    expect(find(render(), Modal).open).toBe(true);
    const first = structuredClone(h.sends[0]);
    h.controllers = {};
    h.state = [];
    h.refs = [];
    h.mode = "success";
    button(render(), "deliveryProgress.bounded.retryOriginal").onClick();
    await settle();
    expect(h.sends[1]).toEqual(first);
    expect(saved).toHaveBeenCalledOnce();
  });
  it("clears successful pending before notifying the parent to select the newly created baseline", async () => {
    const tree = await ready();
    h.mode = "success";
    saved.mockImplementation(() =>
      expect(Object.values(h.pending).some(Boolean)).toBe(false),
    );
    button(tree, "deliveryProgress.bounded.confirmFreeze").onClick();
    await settle();
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: { kind: "baseline", id: "new-resource" },
      }),
    );
  });
});
