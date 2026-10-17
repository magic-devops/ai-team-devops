import { isValidElement, type ReactNode } from "react";
import { Button, Input, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryDeploymentEditor } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDeploymentEditor";
import {
  previewDeliveryDeployment,
  submitDeploymentCommand,
} from "./deliveryDeployment";
import {
  deploymentIndex,
  deploymentPreview,
} from "./deliveryDeploymentFixtures";
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
  previewDeliveryDeployment: vi.fn(),
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
const onClose = vi.fn(),
  onSaved = vi.fn();
const render = (readOnly = false) => {
  hooks.next = 0;
  return DeliveryDeploymentEditor({
    projectId: "P",
    initial: deploymentIndex,
    candidateId: "REL-one",
    rollbackOf: "",
    background: "#/dev-flow?view=releases&release_id=REL-one&project_id=P",
    readOnly,
    onClose,
    onSaved,
  });
};
const button = (key: string) =>
  find(render(), Button, (p) => p.children === `deliveryDeployment.${key}`)!;
function fill() {
  find(
    render(),
    Select,
    (p) => p["aria-label"] === "deliveryDeployment.environment",
  )!.onChange("ENV-one");
  find(
    render(),
    Input.TextArea,
    (p) => p["aria-label"] === "deliveryDeployment.reason",
  )!.onChange({ target: { value: "Ship approved change" } });
}
beforeEach(() => {
  hooks.state = [];
  hooks.next = 0;
  hooks.scope = "original";
  onClose.mockClear();
  onSaved.mockClear();
  vi.mocked(previewDeliveryDeployment)
    .mockReset()
    .mockResolvedValue(deploymentPreview);
  vi.mocked(submitDeploymentCommand)
    .mockReset()
    .mockResolvedValue({} as never);
});
describe("explicit deployment confirmation", () => {
  it("starts without an environment and invalidates a fixed preview when the draft changes", async () => {
    expect(
      find(
        render(),
        Select,
        (p) => p["aria-label"] === "deliveryDeployment.environment",
      )!.value,
    ).toBe("");
    expect(button("confirmDeploy").disabled).toBe(true);
    fill();
    await button("preview").onClick();
    expect(button("confirmDeploy").disabled).toBe(false);
    find(
      render(),
      Input.TextArea,
      (p) => p["aria-label"] === "deliveryDeployment.reason",
    )!.onChange({ target: { value: "Changed scope" } });
    expect(button("confirmDeploy").disabled).toBe(true);
  });
  it("queries the exact original request after an unknown response without closing or preparing a second intent", async () => {
    fill();
    await button("preview").onClick();
    vi.mocked(submitDeploymentCommand).mockRejectedValueOnce(
      new Error("network interrupted"),
    );
    await button("confirmDeploy").onClick();
    expect(onClose).not.toHaveBeenCalled();
    expect(button("confirmDeploy").disabled).toBe(true);
    expect(button("preview").disabled).toBe(true);
    const first = vi.mocked(submitDeploymentCommand).mock.calls[0];
    await button("queryOriginal").onClick();
    expect(vi.mocked(submitDeploymentCommand).mock.calls[1]).toEqual(first);
    expect(first).toMatchObject([
      "P",
      "deployment.create",
      {
        candidate_id: "REL-one",
        environment_id: "ENV-one",
        rollback_of: "",
        reason: "Ship approved change",
        preview_basis: "f".repeat(64),
      },
      { version: 7 },
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("retains input on conflict and requires a fresh preview before confirmation", async () => {
    fill();
    await button("preview").onClick();
    vi.mocked(submitDeploymentCommand).mockRejectedValueOnce(
      new Error("HTTP 409: changed"),
    );
    await button("confirmDeploy").onClick();
    expect(button("confirmDeploy").disabled).toBe(true);
    expect(
      find(
        render(),
        Input.TextArea,
        (p) => p["aria-label"] === "deliveryDeployment.reason",
      )!.value,
    ).toBe("Ship approved change");
    await button("preview").onClick();
    expect(button("confirmDeploy").disabled).toBe(false);
  });
  it("blocks read-only and captured actions after scope changes", async () => {
    fill();
    await button("preview").onClick();
    expect(
      find(
        render(true),
        Button,
        (p) => p.children === "deliveryDeployment.confirmDeploy",
      )!.disabled,
    ).toBe(true);
    const confirm = button("confirmDeploy");
    hooks.scope = "other";
    await confirm.onClick();
    expect(submitDeploymentCommand).not.toHaveBeenCalled();
  });
});
