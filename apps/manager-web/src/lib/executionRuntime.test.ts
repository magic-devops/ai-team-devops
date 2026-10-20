import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchExecutionNodeOutput,
  mergeExecutionOutput,
  prepareExecutionControl,
  submitExecutionControl,
  type ExecutionControlPreview,
} from "./executionRuntime";
import { request } from "./http";
const context = vi.hoisted(() => ({ scope: "session-one" }));
vi.mock("./http", () => ({ request: vi.fn() }));
vi.mock("./projectPortfolio", () => ({
  projectSessionKey: () => context.scope,
  projectHeaders: (id: string) => ({ "X-Project-Id": id }),
}));
const preview = (): ExecutionControlPreview => ({
  project_id: "P",
  execution_id: "E",
  version: 7,
  action: "execution.cancel",
  allowed: true,
  reasons: [],
  payload: {
    id: "E",
    run_id: "R",
    run_version: 9,
    attempt: 2,
    control_basis: "a".repeat(64),
    reason: "Stop the original run",
  },
});
beforeEach(() => {
  context.scope = "session-one";
  vi.mocked(request).mockReset();
});
describe("fixed execution controls and exact output", () => {
  it("retries the exact captured version, body and key after a lost response", async () => {
    const captured = preview();
    const intent = prepareExecutionControl("P", "E", captured, "original-key");
    captured.version = 99;
    captured.payload.reason = "different operation";
    vi.mocked(request)
      .mockRejectedValueOnce(new Error("network lost"))
      .mockResolvedValue({ project_id: "P", action: "execution.cancel", resource: { kind: "execution", id: "E" }, result: { run_id: "R", run_version: 10, replayed_runtime: false }, affected_refs: [{ kind: "execution", id: "E" }], applied_version: 8, version: 8, query_generation: 2, replayed: false });
    await expect(submitExecutionControl(intent)).rejects.toThrow(
      "network lost",
    );
    await submitExecutionControl(intent);
    expect(vi.mocked(request).mock.calls[1]).toEqual(
      vi.mocked(request).mock.calls[0],
    );
    expect(
      JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body)),
    ).toEqual({
      action: "execution.cancel",
      expected_version: 7,
      idempotency_key: "original-key",
      payload: {
        id: "E",
        run_id: "R",
        run_version: 9,
        attempt: 2,
        control_basis: "a".repeat(64),
        reason: "Stop the original run",
      },
    });
  });
  it("blocks a stale operator before sending and rejects a response after identity changes", async () => {
    const intent = prepareExecutionControl("P", "E", preview(), "key");
    context.scope = "session-two";
    await expect(submitExecutionControl(intent)).rejects.toThrow(
      "scopeChanged",
    );
    expect(request).not.toHaveBeenCalled();
    context.scope = "session-one";
    vi.mocked(request).mockImplementationOnce(async () => {
      context.scope = "session-two";
      return { project_id: "P", action: "execution.cancel", resource: { kind: "execution", id: "E" }, result: { run_id: "R", run_version: 10, replayed_runtime: false }, affected_refs: [{ kind: "execution", id: "E" }], applied_version: 8, version: 8, query_generation: 2, replayed: false };
    });
    await expect(submitExecutionControl(intent)).rejects.toThrow(
      "scopeChanged",
    );
  });
  it("rejects denied, cross-execution and cross-project previews", () => {
    expect(() =>
      prepareExecutionControl("P", "E", { ...preview(), allowed: false }, "k"),
    ).toThrow();
    expect(() =>
      prepareExecutionControl(
        "P",
        "E",
        { ...preview(), execution_id: "another" },
        "k",
      ),
    ).toThrow();
    expect(() =>
      prepareExecutionControl(
        "P",
        "E",
        { ...preview(), project_id: "another" },
        "k",
      ),
    ).toThrow();
  });
  it("requests exactly the selected old attempt and stream, without falling back", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      execution_id: "E",
      node_id: "node-two",
      attempt: 2,
      stream: "stderr",
    });
    await fetchExecutionNodeOutput(
      "P",
      "E",
      "node-two",
      2,
      "stderr",
      "bound/cursor",
    );
    expect(request).toHaveBeenCalledWith(
      "/api/v1/delivery/executions/E/nodes/node-two/output?attempt=2&stream=stderr&limit=50&cursor=bound%2Fcursor",
      expect.objectContaining({ headers: { "X-Project-Id": "P" } }),
    );
    await expect(
      fetchExecutionNodeOutput("P", "E", "node-two", 0, "stderr"),
    ).rejects.toThrow();
  });
  it("merges reconnect duplicates in order and refuses changed content at the same sequence", () => {
    const chunk = {
      seq: 2,
      source_seq: 2,
      node_id: "n",
      attempt: 2,
      stream: "stdout" as const,
      text: "safe output",
      observed_at: "",
      truncated: false,
    };
    expect(
      mergeExecutionOutput(
        [chunk],
        [{ ...chunk }, { ...chunk, seq: 1, source_seq: 1, text: "first" }],
      ).chunks.map((item) => item.text),
    ).toEqual(["first", "safe output"]);
    expect(() =>
      mergeExecutionOutput([chunk], [{ ...chunk, text: "changed" }]),
    ).toThrow("outputSequenceChanged");
  });
});
