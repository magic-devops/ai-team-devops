import { isValidElement, type ReactNode } from "react";
import { Empty } from "antd";
import { describe, expect, it, vi } from "vitest";
import { DeliveryDeploymentWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryDeploymentWorkbench";
import { deploymentIndex } from "./deliveryDeploymentFixtures";

vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: () => [null, vi.fn()],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({
    data: deploymentIndex,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
function find(node: ReactNode, type: unknown): Record<string, any> | undefined {
  if (Array.isArray(node))
    return node.map((child) => find(child, type)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return undefined;
  return node.type === type ? node.props : find(node.props.children, type);
}
describe("deployment list follows the selected release", () => {
  it("shows an explicit empty state when other releases have deployments but this one has none", () => {
    const tree = DeliveryDeploymentWorkbench({
      projectId: "P",
      sessionId: "session",
      releaseId: "REL-without-deployment",
      deploymentId: "",
      preparation: null,
      background: "#/dev-flow?view=releases&project_id=P",
      readOnly: false,
      onSaved: vi.fn(),
      onClosePreparation: vi.fn(),
      onRollback: vi.fn(),
      onOpenDeployment: vi.fn(),
      onCloseDeployment: vi.fn(),
    });
    expect(find(tree, Empty)?.description).toBe(
      "deliveryDeployment.noDeployments",
    );
    expect(JSON.stringify(tree)).not.toContain("DEP-one");
  });
});
