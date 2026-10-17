import { isValidElement, type ReactNode } from "react";
import { Button } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionObservationCard } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionObservationCard";
import { ExecutionRuntimePanel } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimePanel";
import { fetchExecutionObservations, type ExecutionObservations } from "./deliveryExecution";
import { request } from "./http";
import type { DeliveryExecution } from "./delivery";
const hooks = vi.hoisted(() => ({ observation: undefined as unknown, index: 0 }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"),
  useState: (initial: unknown) => [hooks.index++ === 0 ? hooks.observation : typeof initial === "function" ? initial() : initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }), useCallback: (callback: unknown) => callback, useEffect: () => {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./deliveryExecution", async () => ({ ...await vi.importActual<typeof import("./deliveryExecution")>("./deliveryExecution"), fetchExecutionObservations: vi.fn() }));
function find(node: ReactNode, type: unknown, predicate: (props: Record<string, unknown>) => boolean): Record<string, any> | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  return node.type === type && predicate(node.props) ? node.props : find(node.props.children as ReactNode, type, predicate);
}
const observation = { project_id: "project", execution_id: "execution", run_id: "recovered-run", run_version: 11, status: "planned", stale: false, executor_binding_invalidated: false, executor_snapshot: null, nodes: [], events: [], tests: { total: 0, passed: 0, failed: 0, pending: 0, status: "not_configured" }, permissions: { can_start: true, can_cancel: true, can_review: false, can_sync: true }, next_cursor: null, more: false } as unknown as ExecutionObservations;
const entry = { id: "execution", task_id: "T-one", workspace_id: "original-workspace", run_id: "", run_version: 0, status: "pending", stale: false, executor_binding_invalidated: true, snapshot: { title: "Original task" }, test_node_ids: [], results: {} } as unknown as DeliveryExecution;
beforeEach(() => { hooks.index = 0; hooks.observation = observation; vi.mocked(request).mockReset().mockResolvedValue({}); vi.mocked(fetchExecutionObservations).mockReset().mockResolvedValue(observation); });
describe("readonly receipt recovery retains the exact managed execution", () => {
  it("displays the recovered identity and delegates controls to the fixed Manager preview flow", () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const saved = vi.fn();
    const tree = ExecutionObservationCard({ entry, projectId: "project", sessionId: "session", workspaceVersion: 7, onSaved: saved, active: true, onCommand: sync });
    const identity = find(tree, "code", (props) => props.className === "runtime-identity")!;
    expect(find(tree, Button, (props) => props.children === "deliveryRuntime.start")).toBeUndefined();
    const runtime = find(tree, ExecutionRuntimePanel, () => true)!;
    expect(runtime).toMatchObject({ projectId: "project", executionId: "execution", sessionId: "session", onSaved: saved });
    expect(JSON.stringify(identity.children)).toContain("recovered-run");
  });
});
