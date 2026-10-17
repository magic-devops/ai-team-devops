import { isValidElement, type ReactNode } from "react";
import { Button, Drawer, Input, Tabs } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeploymentDetailContent,
  DeploymentHealthEvidence,
  DeliveryDeploymentDetail,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDeploymentDetail";
import { submitDeploymentCommand } from "./deliveryDeployment";
import { deploymentIndex, deploymentView } from "./deliveryDeploymentFixtures";
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  next: 0,
  scope: "original",
  data: null as any,
  error: false,
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
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: hooks.data,
    isPending: false,
    isError: hooks.error,
    refetch: async () => ({ data: hooks.data }),
  }),
}));
vi.mock("./useDrawerIdentity", () => ({
  useDrawerIdentity: (_scope: string, id: string) => ({
    displayId: id,
    afterOpenChange: () => undefined,
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
    find(node.props.children, type, test) ||
    (node.type === Tabs
      ? find(
          node.props.items.map((x: any) => x.children),
          type,
          test,
        )
      : undefined)
  );
}
const onRollback = vi.fn(),
  onSaved = vi.fn();
const render = () => {
  hooks.next = 0;
  return DeploymentDetailContent({
    projectId: "P",
    deploymentId: "DEP-one",
    sessionId: "session",
    background:
      "#/dev-flow?view=releases&project_id=P&release_id=REL-one&deployment_id=DEP-one",
    onRollback,
    onSaved,
  });
};
const button = (key: string) =>
  find(render(), Button, (p) => p.children === `deliveryDeployment.${key}`);
beforeEach(() => {
  hooks.state = [];
  hooks.next = 0;
  hooks.scope = "original";
  hooks.error = false;
  hooks.data = {
    project_id: "P",
    version: 7,
    as_of: deploymentIndex.as_of,
    environments: deploymentIndex.environments,
    permissions: deploymentIndex.permissions,
    deployment: structuredClone(deploymentView),
  };
  vi.mocked(submitDeploymentCommand)
    .mockReset()
    .mockResolvedValue({} as never);
  onRollback.mockReset();
});
describe("actual deployment recovery controls", () => {
  it("shows a failed probe's recorded diagnostic and duration without claiming healthy evidence", () => {
    const operation = structuredClone(deploymentView.operations[0]);
    operation.result = {
      observation_seconds: 0,
      probes: [
        {
          exit_code: 1,
          duration_ms: 123,
          error: "Probe returned duplicate JSON keys",
          stdout: "invalid probe payload",
          stderr: "",
          observed_at: "2026-10-17T10:00:00Z",
        },
      ],
    };
    const tree = DeploymentHealthEvidence({ operation });
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("Probe returned duplicate JSON keys");
    expect(serialized).toContain("123 ms");
    expect(
      find(tree, "strong", (p) => p.children === "deliveryDeployment.healthy"),
    ).toBeUndefined();
  });
  it("keeps the exact detail open while an operation response is unresolved", () => {
    const onClose = vi.fn();
    const detail = () => {
      hooks.next = 0;
      return DeliveryDeploymentDetail({
        projectId: "P",
        deploymentId: "DEP-one",
        sessionId: "session",
        background: "#/dev-flow?view=releases&deployment_id=DEP-one",
        onSaved,
        onRollback,
        onClose,
      });
    };
    const content = find(detail(), DeploymentDetailContent, () => true)!;
    content.onUnresolvedChange(true);
    find(detail(), Drawer, () => true)!.onClose();
    expect(onClose).not.toHaveBeenCalled();
    content.onUnresolvedChange(false);
    find(detail(), Drawer, () => true)!.onClose();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("unknown outcome only offers read-only recovery and preserves the linked issue context", () => {
    expect(button("start")).toBeUndefined();
    expect(button("advance")).toBeUndefined();
    expect(button("rollback")).toBeUndefined();
    expect(button("observe")).toBeDefined();
    expect(button("sync")).toBeDefined();
    const issue = button("openIssue")!;
    const params = new URLSearchParams(issue.href.split("?")[1]);
    expect(params.get("issue")).toBe("ISS-one");
    expect(params.get("return_to")).toContain("deployment_id=DEP-one");
  });
  it("keeps a fixed operation identity when its submission response is unknown", async () => {
    button("observe")!.onClick();
    find(
      render(),
      Input.TextArea,
      (p) => p["aria-label"] === "deliveryDeployment.comment",
    )!.onChange({ target: { value: "Inspect journal without apply" } });
    vi.mocked(submitDeploymentCommand).mockRejectedValueOnce(
      new Error("network interrupted"),
    );
    await button("confirmAction")!.onClick();
    const original = vi.mocked(submitDeploymentCommand).mock.calls[0];
    expect(button("confirmAction")!.disabled).toBe(true);
    await button("queryOriginal")!.onClick();
    expect(vi.mocked(submitDeploymentCommand).mock.calls[1]).toEqual(original);
    expect(original).toMatchObject([
      "P",
      "deployment.observe",
      {
        id: "DEP-one",
        basis: "e".repeat(64),
        comment: "Inspect journal without apply",
      },
      { version: 7 },
    ]);
  });
  it("does not replace an unknown ID with another deployment or enable actions on stale reads", () => {
    hooks.data.deployment.id = "DEP-other";
    expect(button("observe")).toBeUndefined();
    hooks.data.deployment.id = "DEP-one";
    hooks.error = true;
    expect(button("observe")!.disabled).toBe(true);
  });
  it("retains operation notes after conflict and adopts only an explicitly reviewed new basis", async () => {
    button("observe")!.onClick();
    find(
      render(),
      Input.TextArea,
      (p) => p["aria-label"] === "deliveryDeployment.comment",
    )!.onChange({ target: { value: "Inspect journal without apply" } });
    vi.mocked(submitDeploymentCommand).mockRejectedValueOnce(
      new Error("HTTP 409: changed"),
    );
    await button("confirmAction")!.onClick();
    hooks.data.version = 9;
    hooks.data.deployment.basis = "b".repeat(64);
    await find(
      render(),
      Button,
      (p) => p.children === "deliveryRelease.readLatest",
    )!.onClick();
    expect(button("confirmAction")!.disabled).toBe(true);
    expect(
      find(
        render(),
        Input.TextArea,
        (p) => p["aria-label"] === "deliveryDeployment.comment",
      )!.value,
    ).toBe("Inspect journal without apply");
    find(
      render(),
      Button,
      (p) => p.children === "deliveryRelease.adopt",
    )!.onClick();
    await button("confirmAction")!.onClick();
    expect(vi.mocked(submitDeploymentCommand).mock.calls[1]).toMatchObject([
      "P",
      "deployment.observe",
      {
        id: "DEP-one",
        basis: "b".repeat(64),
        comment: "Inspect journal without apply",
      },
      { version: 9 },
    ]);
  });
  it("only offers explicit rollback when the server authorizes it and a real frozen baseline exists", () => {
    hooks.data.deployment.status = "failed";
    hooks.data.deployment.actions.can_rollback = true;
    expect(button("rollback")).toBeUndefined();
    hooks.data.deployment.snapshot.baseline = {
      deployment_id: "DEP-stable",
      candidate_id: "REL-stable",
      candidate_snapshot: hooks.data.deployment.snapshot.candidate_snapshot,
      environment_id: "ENV-one",
      environment_generation: 2,
      target_snapshot: hooks.data.deployment.snapshot.target_snapshot,
      verified_at: "2026-10-17T09:00:00Z",
    };
    button("rollback")!.onClick();
    expect(onRollback).toHaveBeenCalledWith("DEP-one");
  });
});
