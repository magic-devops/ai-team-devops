import { describe, expect, it } from "vitest";
import { executionPayload, openExecutionDraft, type ExecutionDraftSession, type ExecutionTarget } from "./deliveryExecution";
import type { DeliveryWorkspace } from "./delivery";
const target = { id: "device", kind: "device", basis: "target-basis", can_execute: true } as ExecutionTarget;
function draft() {
  const data = { project: { id: "project" }, version: 7, tasks: [{ id: "T-one", basis: "task-basis" }] } as unknown as DeliveryWorkspace;
  return { ...openExecutionDraft(data, "T-one", "intent"), workspaceId: "runtime", agentId: "profile", agentVersion: 2, target };
}
describe("optional team executor dispatch contract", () => {
  it("starts with an explicit unassociated executor without deriving it from the task owner", () => {
    const session = draft() as ExecutionDraftSession & { executorMemberId: string; executorBindingBasis: string };
    expect(session.executorMemberId).toBe("");
    expect(session.executorBindingBasis).toBe("");
  });
  it("pins both member identity and binding basis in the actual preview and queue payload", () => {
    const session = { ...draft(), executorMemberId: "agent:builder", executorBindingBasis: "binding-2" };
    expect(executionPayload(session)).toMatchObject({ executor_member_id: "agent:builder", executor_binding_basis: "binding-2", workspace_id: "runtime", agent_id: "profile", agent_version: 2, target_device_id: "device" });
  });
  it("rejects partial or command-mode member associations without silently switching to direct configuration", () => {
    expect(() => executionPayload({ ...draft(), executorMemberId: "agent:builder", executorBindingBasis: "" })).toThrow();
    expect(() => executionPayload({ ...draft(), mode: "command", commands: [{ id: "test", title: "Test", argv: ["python", "-V"], expectedExitCode: 0, timeoutSeconds: 30, test: true }], executorMemberId: "agent:builder", executorBindingBasis: "binding" } as unknown as ExecutionDraftSession)).toThrow();
  });
});
