import { isValidElement, type ReactNode } from "react";
import { Button, Input, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryReleaseEditor } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseEditor";
import {
  previewDeliveryRelease,
  submitReleaseCommand,
} from "./deliveryRelease";
import {
  releaseForm,
  releaseIndex,
  releasePreview,
} from "./deliveryReleaseFixtures";
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
vi.mock("./deliveryRelease", async () => ({
  ...(await vi.importActual<typeof import("./deliveryRelease")>(
    "./deliveryRelease",
  )),
  previewDeliveryRelease: vi.fn(),
  submitReleaseCommand: vi.fn(),
}));
export function find(
  node: ReactNode,
  type: unknown,
  predicate: (props: Record<string, any>) => boolean,
): Record<string, any> | undefined {
  if (Array.isArray(node))
    return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(node.props.footer, type, predicate)
  );
}
const onClose = vi.fn(),
  onSaved = vi.fn();
const render = () => {
  hooks.next = 0;
  return DeliveryReleaseEditor({
    projectId: "P",
    initial: releaseIndex,
    selected: releaseIndex.evidence[0].selected,
    onClose,
    onSaved,
  });
};
const button = (key: string) =>
  find(
    render(),
    Button,
    (props) => props.children === `deliveryRelease.${key}`,
  )!;
function fill() {
  for (const key of [
    "version",
    "environment",
    "artifact_url",
    "release_notes",
    "rollback_plan",
  ] as const) {
    const label = {
      version: "version",
      environment: "environment",
      artifact_url: "artifactUrl",
      release_notes: "notes",
      rollback_plan: "rollback",
    }[key];
    find(
      render(),
      ["release_notes", "rollback_plan"].includes(key) ? Input.TextArea : Input,
      (props) => props["aria-label"] === `deliveryRelease.${label}`,
    )!.onChange({ target: { value: releaseForm[key] } });
  }
  find(
    render(),
    Select,
    (props) => props["aria-label"] === "deliveryRelease.chooseEvidence",
  )!.onChange("CI-one");
}
beforeEach(() => {
  vi.stubGlobal("location", { hash: "#/dev-flow?view=releases&project_id=P" });
  hooks.state = [];
  hooks.next = 0;
  hooks.scope = "original";
  onClose.mockClear();
  onSaved.mockClear();
  vi.mocked(previewDeliveryRelease)
    .mockReset()
    .mockResolvedValue(releasePreview);
  vi.mocked(submitReleaseCommand)
    .mockReset()
    .mockResolvedValue({} as never);
});
describe("candidate compilation uses a fixed preview", () => {
  it("starts with no evidence selected and only closes after a successful fixed submission", async () => {
    expect(
      find(
        render(),
        Select,
        (props) => props["aria-label"] === "deliveryRelease.chooseEvidence",
      )!.value,
    ).toBe("");
    fill();
    await button("preview").onClick();
    vi.mocked(submitReleaseCommand).mockRejectedValueOnce(
      new Error("network unavailable"),
    );
    await button("confirm").onClick();
    expect(onClose).not.toHaveBeenCalled();
    const original = vi.mocked(submitReleaseCommand).mock.calls[0];
    await button("confirm").onClick();
    expect(vi.mocked(submitReleaseCommand).mock.calls[1]).toEqual(original);
    expect(original).toMatchObject([
      "P",
      "release.candidate.create",
      expect.objectContaining({
        preview_basis: "a".repeat(64),
        ci_evidence_id: "CI-one",
      }),
      expect.objectContaining({ version: 7 }),
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("preserves the draft after 409 and requires explicit repreview before a new confirmation", async () => {
    fill();
    await button("preview").onClick();
    vi.mocked(submitReleaseCommand).mockRejectedValueOnce(
      new Error("HTTP 409"),
    );
    await button("confirm").onClick();
    expect(button("confirm").disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      find(
        render(),
        Input,
        (p) => p["aria-label"] === "deliveryRelease.version",
      )!.value,
    ).toBe("v1.2.0");
    vi.mocked(previewDeliveryRelease).mockResolvedValueOnce({
      ...releasePreview,
      version: 9,
    });
    await button("readLatest").onClick();
    expect(submitReleaseCommand).toHaveBeenCalledOnce();
    await button("confirm").onClick();
    expect(vi.mocked(submitReleaseCommand).mock.calls[1][3].version).toBe(9);
  });
  it("clears confirmation when a field changes or an explicit fresh preview fails", async () => {
    fill();
    await button("preview").onClick();
    find(
      render(),
      Input,
      (p) => p["aria-label"] === "deliveryRelease.environment",
    )!.onChange({ target: { value: "production" } });
    expect(button("confirm").disabled).toBe(true);
    fill();
    await button("preview").onClick();
    vi.mocked(previewDeliveryRelease).mockRejectedValueOnce(
      new Error("offline"),
    );
    await button("preview").onClick();
    expect(button("confirm").disabled).toBe(true);
  });
  it("rejects a captured click after account or project context changes", async () => {
    fill();
    await button("preview").onClick();
    const confirm = button("confirm");
    hooks.scope = "another-project";
    await confirm.onClick();
    expect(submitReleaseCommand).not.toHaveBeenCalled();
  });
  it("retains the prepared draft but disables confirmation after the parent scope becomes read only", async () => {
    fill();
    await button("preview").onClick();
    hooks.next = 0;
    const tree = DeliveryReleaseEditor({
      projectId: "P",
      initial: releaseIndex,
      selected: releaseIndex.evidence[0].selected,
      onClose,
      onSaved,
      readOnly: true,
    });
    expect(
      find(tree, Button, (p) => p.children === "deliveryRelease.confirm")!
        .disabled,
    ).toBe(true);
    expect(
      find(tree, Input, (p) => p["aria-label"] === "deliveryRelease.version")!
        .value,
    ).toBe("v1.2.0");
  });
});
