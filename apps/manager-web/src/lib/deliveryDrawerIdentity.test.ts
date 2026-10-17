import { isValidElement, type ReactNode } from "react";
import { Drawer } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryTeamMembers } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTeamMembers";
import { parseSchedulingRoute } from "./deliveryScheduling";
import type { DeliveryWorkspace } from "./delivery";
import { useDrawerIdentity } from "./useDrawerIdentity";
const hooks = vi.hoisted(() => ({ state: [] as unknown[], next: 0, effects: [] as (() => void)[] }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => {
    const index = hooks.next++;
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.state[index], (change: unknown) => { hooks.state[index] = typeof change === "function" ? change(hooks.state[index]) : change; }];
  },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
type DrawerProps = { open: boolean; children: ReactNode; afterOpenChange: (open: boolean) => void };
function findDrawer(node: ReactNode): DrawerProps | undefined {
  if (Array.isArray(node)) return node.map(findDrawer).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  return node.type === Drawer ? node.props as DrawerProps : findDrawer(node.props.children);
}
function memberDrawer(id: string, projectId = "project-a") {
  hooks.next = 0;
  hooks.effects = [];
  vi.stubGlobal("location", { hash: "#/dev-flow?view=team" });
  const workspace = { project: { id: projectId }, members: projectId === "project-a" ? [{ id: "agent:one", name: "Visible agent", kind: "agent", active: true }] : [], tasks: [], permissions: { configure: false } } as unknown as DeliveryWorkspace;
  const tree = DeliveryTeamMembers({ workspace, sessionId: "test", onSaved: vi.fn(), calendarFailed: false, route: { ...parseSchedulingRoute("#/dev-flow?view=team"), teamMemberId: id }, onRoute: vi.fn(), onEdit: vi.fn(), onCalendar: vi.fn(), onRetryCalendar: vi.fn(), onTask: vi.fn() });
  const drawer = findDrawer(tree)!;
  hooks.effects.forEach((effect) => effect());
  return drawer;
}
beforeEach(() => { hooks.state = []; hooks.next = 0; hooks.effects = []; });
function taskIdentity(scope: string, id: string) {
  hooks.next = 0;
  hooks.effects = [];
  const result = useDrawerIdentity(scope, id);
  hooks.effects.forEach((effect) => effect());
  return result;
}
describe("controlled drawer closing identity", () => {
  it("keeps only the outgoing member content until the close animation completes", () => {
    expect(memberDrawer("agent:one").open).toBe(true);
    const closing = memberDrawer("");
    expect(closing.open).toBe(false);
    expect(JSON.stringify(closing.children)).toContain("Visible agent");
    expect(JSON.stringify(closing.children)).not.toContain("deliveryTeam.missing");
    closing.afterOpenChange(false);
    expect(JSON.stringify(memberDrawer("").children)).not.toContain("Visible agent");
  });
  it("never substitutes outgoing content for a new unknown identity or another project", () => {
    memberDrawer("agent:one");
    expect(JSON.stringify(memberDrawer("agent:unknown").children)).toContain("deliveryTeam.missing");
    expect(JSON.stringify(memberDrawer("agent:unknown").children)).not.toContain("Visible agent");
    memberDrawer("agent:one");
    expect(JSON.stringify(memberDrawer("", "project-b").children)).not.toContain("Visible agent");
  });
  it("retains the outgoing task ID through close and clears it only after the transition", () => {
    expect(taskIdentity("project-a:session", "T-one").displayId).toBe("T-one");
    const closing = taskIdentity("project-a:session", "");
    expect(closing.displayId).toBe("T-one");
    closing.afterOpenChange(false);
    expect(taskIdentity("project-a:session", "").displayId).toBe("");
  });
  it("uses exact new task IDs and prevents stale close callbacks from clearing a reopened drawer", () => {
    taskIdentity("project-a:session", "T-one");
    const closing = taskIdentity("project-a:session", "");
    expect(taskIdentity("project-a:session", "T-unknown").displayId).toBe("T-unknown");
    closing.afterOpenChange(false);
    expect(taskIdentity("project-a:session", "").displayId).toBe("T-unknown");
    expect(taskIdentity("project-b:session", "").displayId).toBe("");
    expect(taskIdentity("project-a:other-session", "").displayId).toBe("");
  });
});
