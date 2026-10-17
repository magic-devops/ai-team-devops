import { isValidElement, type ReactNode } from "react";
import { Button, Input } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryDeploymentEnvironment } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDeploymentEnvironment";
import {
  fetchDeliveryDeployments,
  submitDeploymentCommand,
} from "./deliveryDeployment";
import { deploymentIndex } from "./deliveryDeploymentFixtures";
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  next: 0,
  scope: "original",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useRef: (value: unknown) => ({ current: value }),
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
vi.mock("./deliveryDeployment", async () => ({
  ...(await vi.importActual<typeof import("./deliveryDeployment")>(
    "./deliveryDeployment",
  )),
  fetchDeliveryDeployments: vi.fn(),
  submitDeploymentCommand: vi.fn(),
}));
function find(
  node: ReactNode,
  type: unknown,
  test: (props: Record<string, any>) => boolean,
): Record<string, any> | undefined {
  if (Array.isArray(node))
    return node.map((n) => find(n, type, test)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return undefined;
  if (node.type === type && test(node.props)) return node.props;
  return (
    find(node.props.children, type, test) || find(node.props.footer, type, test)
  );
}
const onSaved = vi.fn(),
  onClose = vi.fn();
const render = (locked = false) => {
  hooks.next = 0;
  return DeliveryDeploymentEnvironment({
    projectId: "P",
    initial: deploymentIndex,
    environment: {
      ...deploymentIndex.environments[0],
      can_edit: !locked,
      locked_by: locked ? ["DEP-one"] : [],
    },
    readOnly: false,
    onSaved,
    onClose,
  });
};
const button = (key: string) =>
  find(render(), Button, (p) => p.children === key)!;
beforeEach(() => {
  hooks.state = [];
  hooks.next = 0;
  hooks.scope = "original";
  onSaved.mockClear();
  onClose.mockClear();
  vi.mocked(submitDeploymentCommand)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(fetchDeliveryDeployments)
    .mockReset()
    .mockResolvedValue({ ...deploymentIndex, version: 9 });
});
describe("controlled environment editing", () => {
  it("retains the draft on conflict and requires reviewing then explicitly adopting the fresh basis", async () => {
    const field = find(
      render(),
      Input,
      (p) => p["aria-label"] === "deliveryDeployment.workspace",
    )!;
    field.onChange({ target: { value: "W-new" } });
    vi.mocked(submitDeploymentCommand).mockRejectedValueOnce(
      new Error("HTTP 409: changed"),
    );
    await button("deliveryDeployment.save").onClick();
    expect(button("deliveryDeployment.save").disabled).toBe(true);
    await button("deliveryRelease.readLatest").onClick();
    expect(button("deliveryDeployment.save").disabled).toBe(true);
    expect(
      find(
        render(),
        Input,
        (p) => p["aria-label"] === "deliveryDeployment.workspace",
      )!.value,
    ).toBe("W-new");
    button("deliveryRelease.adopt").onClick();
    await button("deliveryDeployment.save").onClick();
    expect(vi.mocked(submitDeploymentCommand).mock.calls[1][3].version).toBe(9);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("honors environment locks and retries only the original request after an unknown response", async () => {
    expect(
      find(
        render(true),
        Button,
        (p) => p.children === "deliveryDeployment.save",
      )!.disabled,
    ).toBe(true);
    vi.mocked(submitDeploymentCommand).mockRejectedValueOnce(
      new Error("network interrupted"),
    );
    await button("deliveryDeployment.save").onClick();
    const first = vi.mocked(submitDeploymentCommand).mock.calls[0];
    expect(onClose).not.toHaveBeenCalled();
    expect(button("deliveryDeployment.save").disabled).toBe(true);
    await button("deliveryDeployment.queryOriginal").onClick();
    expect(vi.mocked(submitDeploymentCommand).mock.calls[1]).toEqual(first);
  });
});
