import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectOwnerSelect } from "../components/DeliveryMemberIdentity";
import { TaskDetailContent } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail";
import type { DeliveryTaskData } from "./delivery";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
function findOwner(node: ReactNode): { onChange: (id: string) => void } | undefined {
  if (Array.isArray(node)) return node.map(findOwner).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; items?: { children: ReactNode }[]; onChange: (id: string) => void }>(node)) return undefined;
  return node.type === ProjectOwnerSelect ? node.props : findOwner(node.props.children) || findOwner(node.props.items?.map((item) => item.children));
}
describe("task owner commands use the definition currently displayed", () => {
  it.each(["", "REQ-linked"])("pins the visible task basis for reassignment and clearing (%s)", async (requirementId) => {
    const workspace = {
      project: { id: "project" },
      permissions: { write: true },
      members: [{ id: "user:old", name: "Original", kind: "human", active: true }],
      task: { id: "T-one", req_id: requirementId, basis: "visible-task-basis", owner_id: "user:old", title: "Task", status: "pending" },
      requirement: requirementId ? { id: requirementId, flow: { stage: "development" } } : null,
    } as unknown as DeliveryTaskData;
    const command = vi.fn().mockResolvedValue(undefined);
    const tree = TaskDetailContent({ detail: workspace, taskId: "T-one", canEdit: true, onSaved: vi.fn(), onEditingChange: vi.fn(), onCommand: command });
    const owner = findOwner(tree);
    expect(owner).toBeDefined();
    workspace.task = { ...workspace.task, basis: "unseen-newer-basis" };
    owner!.onChange("agent:next");
    expect(command).toHaveBeenLastCalledWith("task.update", { id: "T-one", owner_id: "agent:next", task_basis: "visible-task-basis" });
    owner!.onChange("");
    expect(command).toHaveBeenLastCalledWith("task.update", { id: "T-one", owner_id: "", task_basis: "visible-task-basis" });
  });
});
