import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ request: vi.fn(), scope: "actor:P:session" }));
vi.mock("./http", () => ({ request: io.request }));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => io.scope }));
import { canonicalWorkOrderJson, readWorkOrderCurrent, readWorkOrderDetail, readWorkOrders, readWorkOrderPacket, validWorkOrderSummary } from "./externalWorkOrders";

const hash = "a".repeat(64), now = "2026-10-21T04:00:00Z";
export const workOrderDefinition = { task_id: "T", title: "Real task", description: "Deliver the task", assigned_to: "M", task_acceptance_criteria: ["Evidence"], acceptance_criteria: ["Evidence"],
  owner: { id: "M", name: "Owner", kind: "human", active: true }, requirement: null, dependency_basis: {}, designs: [], design_basis: hash };
export const workOrderExecutor = { id: "Tool", name: "Codex tool", kind: "tool", tool: "codex", active: true, available: true, reasons: [] };
export const workOrderSummary = { id: "W", task_id: "T", task_title: "Real task", order_revision: 1, state: "queued", request_digest: hash, packet_digest: hash, definition_digest: hash, native_boundary_digest: hash,
  executor: workOrderExecutor, requested_by: { id: "Actor", name: "Requester" }, claimed_by: null, created_at: now, updated_at: now, claimed_at: null, invalidated: false, invalidated_reason: null,
  progress: null, submission: null, delivery_state: null, closure: null };
const envelope = { project_id: "P", version: 3, query_generation: null, as_of: now };
export const workOrderCurrent = { ...envelope, task_id: "T", task_basis: hash, definition_digest: hash, native_boundary_digest: hash, definition: workOrderDefinition,
  executors: [workOrderExecutor], active_work_order_id: null, can_dispatch: true, reasons: [] };
export const workOrderDetail = { ...envelope, work_order: workOrderSummary, definition: workOrderDefinition, instructions: "", permissions: { can_claim: true, can_progress: false, can_cancel: true, can_release: false, can_report: false, reasons: [] } };

describe("formal external work order actual read consumers", () => {
  beforeEach(() => { io.request.mockReset(); io.scope = "actor:P:session"; });
  it("reads the exact current Task and never invents a synthetic Task or native run", async () => {
    io.request.mockResolvedValue(workOrderCurrent);
    const result = await readWorkOrderCurrent("P", "T", io.scope);
    expect(io.request.mock.calls[0][0]).toBe("/api/v1/delivery/tasks/T/work-orders/current");
    expect(result.definition.task_id).toBe("T");
    expect(result).not.toHaveProperty("run_id");
    expect(result).not.toHaveProperty("confidence");
  });
  it("keeps unknown progress null and reported progress distinct from acceptance", () => {
    expect(validWorkOrderSummary(workOrderSummary)).toBe(true);
    const claimed = { ...workOrderSummary, state: "claimed", claimed_by: { id: "Actor", name: "Claimant" }, claimed_at: now,
      progress: { percent: null, status: "running", message: "Working on criteria", reported_at: now, source: "external_reported" } };
    expect(validWorkOrderSummary(claimed)).toBe(true);
    expect(validWorkOrderSummary({ ...claimed, progress: { ...claimed.progress, source: "verified" } })).toBe(false);
    expect(validWorkOrderSummary({ ...claimed, progress: { ...claimed.progress, percent: 101 } })).toBe(false);
  });
  it("uses one bounded list and an explicit exact selection, without detail reads per list row", async () => {
    io.request.mockResolvedValueOnce({ ...envelope, items: [workOrderSummary], total: 1, limit: 20, next_cursor: null }).mockResolvedValueOnce(workOrderDetail);
    await readWorkOrders("P", io.scope, { taskId: "T", state: "queued", cursor: "" });
    expect(io.request).toHaveBeenCalledTimes(1);
    expect(io.request.mock.calls[0][0]).toContain("work-orders?limit=20&task_id=T&state=queued");
    await readWorkOrderDetail("P", "W", io.scope, "T");
    expect(io.request.mock.calls[1][0]).toBe("/api/v1/delivery/work-orders/W");
  });
  it("rejects cross-task exact selection, missing design context and callbacks after session change", async () => {
    io.request.mockResolvedValueOnce({ ...workOrderDetail, work_order: { ...workOrderSummary, task_id: "Other" } });
    await expect(readWorkOrderDetail("P", "W", io.scope, "T")).rejects.toThrow("workOrderInvalid");
    io.request.mockResolvedValueOnce({ ...workOrderCurrent, definition: { ...workOrderDefinition, designs: undefined } });
    await expect(readWorkOrderCurrent("P", "T", io.scope)).rejects.toThrow("workOrderInvalid");
    io.request.mockImplementationOnce(async () => { io.scope = "Other"; return workOrderCurrent; });
    await expect(readWorkOrderCurrent("P", "T", "actor:P:session")).rejects.toThrow("workOrderScopeChanged");
  });
  it("reads the complete exact packet only on demand, rejecting a different original digest", async () => {
    io.request.mockResolvedValueOnce({ ...envelope, work_order_id: "W", request_digest: hash, packet_digest: "b".repeat(64), packet: {}, max_packet_bytes: 524288 });
    await expect(readWorkOrderPacket("P", workOrderSummary as never, io.scope)).rejects.toThrow("workOrderInvalid");
    expect(io.request.mock.calls[0][0]).toBe("/api/v1/delivery/work-orders/W/packet");
  });
  it("rejects an altered actual HTTP packet body even when its summary and response digest metadata agree", async () => {
    const packet = { project_id: "P", task_id: "T", instructions: "Original instructions", design_context: [] };
    const packetDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalWorkOrderJson(packet))))).map((value) => value.toString(16).padStart(2, "0")).join("");
    io.request.mockResolvedValueOnce({ ...envelope, work_order_id: "W", request_digest: hash, packet_digest: packetDigest, packet: { ...packet, instructions: "Replaced instructions" }, max_packet_bytes: 524288 });
    await expect(readWorkOrderPacket("P", { ...workOrderSummary, packet_digest: packetDigest } as never, io.scope)).rejects.toThrow("workOrderInvalid");
  });
  it("rejects non-finite numbers, unsafe integers and unpaired surrogate strings in the packet original", () => {
    for (const value of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "\ud800", { "\udfff": "value" }]) expect(() => canonicalWorkOrderJson(value)).toThrow("workOrderInvalid");
  });
  it("accepts the Python canonical SHA for actual dependency keys U+E000 and U+1F600, using codepoint order", async () => {
    const packet = { project_id: "P", task_id: "T", definition: { dependency_basis: { "\ue000": "bmp", "\u{1f600}": "non-bmp" } } };
    const packetDigest = "7eff166d7fd3991d7b54090650451bb77b267a9331ae5a9836e669daff177e34";
    io.request.mockResolvedValueOnce({ ...envelope, work_order_id: "W", request_digest: hash, packet_digest: packetDigest, packet, max_packet_bytes: 524288 });
    await expect(readWorkOrderPacket("P", { ...workOrderSummary, packet_digest: packetDigest } as never, io.scope)).resolves.toMatchObject({ packet_digest: packetDigest, packet });
  });
  it("accepts Python canonical lexicographic numeric-like keys without JS object re-enumeration", async () => {
    const packet = { project_id: "P", task_id: "T", definition: { dependency_basis: { "2": "two", "10": "ten" } } };
    const packetDigest = "df557e4a9eaf0bbc5e407056e7150d990d7c01911c587b2369c7513bff70e7ee";
    io.request.mockResolvedValueOnce({ ...envelope, work_order_id: "W", request_digest: hash, packet_digest: packetDigest, packet, max_packet_bytes: 524288 });
    await expect(readWorkOrderPacket("P", { ...workOrderSummary, packet_digest: packetDigest } as never, io.scope)).resolves.toMatchObject({ packet_digest: packetDigest });
  });
});
