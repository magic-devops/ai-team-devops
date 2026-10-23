import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import { adoptRuntimeBindingDraft, changeBindingWorkspace, fetchTeamRuntimeBindings, openRuntimeBindingDraft, prepareRuntimeBinding, selectExecutionMember, useDirectExecution, type MemberRuntimeState, type TeamRuntimeBindings } from "./deliveryTeamRuntime";
import { adoptExecutionDraft, openExecutionDraft, executionPayload, type DeliveryTargets, type ExecutionTarget } from "./deliveryExecution";
import { commandDraft } from "./executionCommands";
import type { DeliveryTaskData } from "./delivery";
vi.mock("./http", () => ({ request: vi.fn() }));
const member: MemberRuntimeState = { member_id: "agent:member", member_name: "Executor", member_kind: "agent", binding_basis: "binding-2", generation: 2, status: "current", permissions: { can_bind: true, can_unbind: true }, reasons: [], binding: { workspace_id: "runtime", agent_id: "profile", agent_version: 2, profile_digest: "digest", source: { workspace_name: "Runtime", agent_title: "Profile", provider: "codex" }, bound_by: "user:lead", bound_at: "2026-10-17T00:00:00Z" } };
const catalogue: TeamRuntimeBindings = { project_id: "project", version: 7, as_of: "", runtime_configured: true, members: [member], workspaces: [{ id: "runtime", name: "Runtime", agents: [{ id: "profile", version: 2, title: "Profile", provider: "codex" }] }] };
const workspace = { project: { id: "project" }, version: 7, task: { id: "T-one", basis: "task", owner_id: "user:owner", execution_gate: { eligible: true } } } as unknown as DeliveryTaskData;
beforeEach(() => vi.mocked(request).mockClear());
describe("explicit runtime association editing", () => {
  it("reads only the explicit project catalogue without writing defaults", async () => {
    const signal = new AbortController().signal;
    await fetchTeamRuntimeBindings("project", signal);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/v1/delivery/team-runtime-bindings", { headers: { "X-Project-Id": "project" }, signal });
    expect(() => fetchTeamRuntimeBindings("")).toThrow();
  });
  it("clears profile identity and version when the selected workspace changes", () => {
    const initial = openRuntimeBindingDraft(catalogue, member.member_id, "bind", "intent");
    const changed = changeBindingWorkspace(initial, "other-runtime");
    expect(changed).toMatchObject({ workspaceId: "other-runtime", agentId: "", agentVersion: 0 });
    expect(() => prepareRuntimeBinding(changed, catalogue)).toThrow("chooseCurrentProfile");
    expect(prepareRuntimeBinding(initial, catalogue)).toMatchObject({ action: "member.runtime.bind", version: 7, payload: { member_id: "agent:member", workspace_id: "runtime", agent_id: "profile", agent_version: 2 } });
  });
  it("keeps the exact stale version and draft until explicit adoption and selection of the current version", () => {
    const initial = openRuntimeBindingDraft(catalogue, member.member_id, "bind", "original");
    const latest = { ...catalogue, version: 9, workspaces: [{ ...catalogue.workspaces[0], agents: [{ ...catalogue.workspaces[0].agents[0], version: 3 }] }] };
    expect(() => prepareRuntimeBinding(initial, latest)).toThrow("chooseCurrentProfile");
    const adopted = adoptRuntimeBindingDraft(initial, latest, "adopted");
    expect(adopted).toMatchObject({ agentId: "profile", agentVersion: 2, intent: { version: 9, key: "adopted" } });
    expect(initial.intent.version).toBe(7);
    expect(prepareRuntimeBinding({ ...adopted, agentVersion: 3 }, latest).payload).toMatchObject({ agent_version: 3 });
  });
  it("uses can_unbind independently from can_bind or runtime availability", () => {
    const inaccessible = { ...catalogue, runtime_configured: false, workspaces: [], members: [{ ...member, status: "unavailable" as const, permissions: { can_bind: false, can_unbind: true } }] };
    const draft = openRuntimeBindingDraft(inaccessible, member.member_id, "unbind", "unlink");
    expect(prepareRuntimeBinding(draft, inaccessible)).toMatchObject({ action: "member.runtime.unbind", payload: { member_id: member.member_id } });
    expect(() => openRuntimeBindingDraft(inaccessible, member.member_id, "bind", "wrong")).toThrow("bindingPermission");
  });
});
describe("member association is independent from responsible ownership and target placement", () => {
  it("fixes the selected profile and clears the old target, preserving tests and owner", () => {
    const initial = { ...openExecutionDraft(workspace, "T-one", "intent"), commands: [commandDraft("tests", "python")], preview: {} as never, target: {} as never };
    const selected = selectExecutionMember(initial, member);
    expect(selected).toMatchObject({ executorMemberId: member.member_id, executorBindingBasis: "binding-2", workspaceId: "runtime", agentId: "profile", agentVersion: 2, target: null, preview: null, commands: initial.commands });
    expect(workspace.task.owner_id).toBe("user:owner");
    expect(() => selectExecutionMember(selected, { ...member, status: "stale" })).toThrow("executorUnavailable");
    const direct = useDirectExecution(selected);
    expect(direct).toMatchObject({ executorMemberId: "", executorBindingBasis: "", workspaceId: "runtime", agentId: "profile", commands: initial.commands });
  });
  it("does not require a member catalogue for direct dispatch and never adopts an invalid member silently", () => {
    const target: ExecutionTarget = { id: "local", name: "Local", version: 1, kind: "local", can_execute: true, basis: "target", paired: null, online: null, last_seen_at: null, expires_at: null, worker_id: null, capability_digest: "digest", reason_codes: [], runtime_capabilities: ["agent", "command"], policy: { allowed_runtimes: ["agent", "command"], allowed_providers: ["codex"] }, providers: [{ id: "codex", executable_present: true, auth: "unknown", version: null }] };
    const initial = { ...openExecutionDraft(workspace, "T-one", "intent"), workspaceId: "runtime", agentId: "profile", agentVersion: 2, target };
    expect(executionPayload(initial).executor_member_id).toBe("");
    const targets = { project_id: "project", workspaces: [{ id: "runtime", agents: [{ id: "profile", version: 3, provider: "codex" }], local: target, devices: [] }] } as unknown as DeliveryTargets;
    const selected = { ...selectExecutionMember(initial, member), target };
    expect(() => adoptExecutionDraft(selected, workspace, targets, "next")).toThrow("executorCatalogueRequired");
    expect(() => adoptExecutionDraft(selected, workspace, targets, "next", { ...catalogue, members: [{ ...member, status: "unavailable" }] })).toThrow("executorUnavailable");
    const current = { ...catalogue, members: [{ ...member, binding_basis: "binding-3", generation: 3, binding: { ...member.binding!, agent_version: 3 } }] };
    const adopted = adoptExecutionDraft(selected, workspace, targets, "adopt", current);
    expect(adopted).toMatchObject({ executorMemberId: member.member_id, executorBindingBasis: "binding-3", agentVersion: 3, target: null, preview: null });
    expect(selected.executorBindingBasis).toBe("binding-2");
  });
});
