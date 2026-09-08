import { afterEach, describe, expect, it, vi } from "vitest";
import { createHermesClient } from "./hermes";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HermesClient", () => {
  it("reads scoped repository and stored changes, and pins dispatch to a commit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockJsonResponse({ ok: true, items: [] }));
    const client = createHermesClient({ baseUrl: "https://hermes.example", token: "test", workspaceId: "ws" });
    await client.repository();
    expect(fetchMock).toHaveBeenLastCalledWith("https://hermes.example/api/hermes/v1/workspaces/ws/repository", expect.objectContaining({ headers: expect.objectContaining({ "X-Workspace-Id": "ws" }) }));
    await client.runChanges("run 1");
    expect(fetchMock).toHaveBeenLastCalledWith("https://hermes.example/api/hermes/v1/runs/run%201/changes", expect.anything());
    const plan = { nodes: [], isolation: "git_worktree" as const, base_commit: "a".repeat(40), expected_version: 1, idempotency_key: "pinned", dry_run: true };
    await client.taskDispatch("task", plan);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/dispatch"), expect.objectContaining({ body: JSON.stringify(plan) }));
  });
  it("binds task delivery requests to scope, versions, decisions and dry-run", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockJsonResponse({ ok: true, items: [] }));
    const client = createHermesClient({ baseUrl: "https://hermes.example", token: "test", workspaceId: "ws" });
    await client.taskDelivery("task 1");
    expect(fetchMock).toHaveBeenLastCalledWith("https://hermes.example/api/hermes/v1/tasks/task%201/delivery", expect.objectContaining({ headers: expect.objectContaining({ "X-Workspace-Id": "ws" }) }));
    const plan = { expected_version: 2, nodes: [], idempotency_key: "same-key", dry_run: true };
    await client.taskDispatch("task 1", plan);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/dispatch"), expect.objectContaining({ method: "POST", body: JSON.stringify(plan) }));
    const review = { expected_version: 3, run_id: "run", run_version: 9, decision: "accept" as const, comment: "Reviewed", idempotency_key: "review", dry_run: false };
    await client.taskReview("task 1", review);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/review"), expect.objectContaining({ body: JSON.stringify(review) }));
  });
  it.each([{ error: "bad" }, { ok: false }, { ok: "false", items: [] }, "<html>proxy error</html>"])("rejects malformed runtime probe payload %j", async (payload) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockJsonResponse(payload));
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787", token: "secret" });
    await expect(client.diagnostics()).rejects.toThrow("Invalid Hermes runtime diagnostics response");
    await expect(client.readiness()).rejects.toThrow("Invalid Hermes runtime diagnostics response");
  });

  it("retains degraded runtime checks while still rejecting unauthorized probes", async () => {
    const payload = { ok: false, items: [{ id: "executor", status: "failed", detail: "Install runtime" }], permissions: ["read"] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockJsonResponse(payload));
    const client = createHermesClient({ baseUrl: "https://hermes.example", token: "secret" });
    expect(await client.diagnostics()).toMatchObject(payload);
    expect(await client.readiness()).toMatchObject(payload);
    fetchMock.mockResolvedValue(mockJsonResponse({ ok: false, error: { message: "Forbidden" } }, { status: 403 }));
    await expect(client.diagnostics()).rejects.toThrow("Forbidden");
    fetchMock.mockResolvedValue(mockJsonResponse({ ok: false, error: { message: "Action rejected" } }));
    await expect(client.actions()).rejects.toThrow("Action rejected");
  });
  it("preserves audit and agent context and refuses unsafe remote endpoints", async () => {
    const payload = { ok: true, items: [], audit: { actor: "owner", trace_id: "trace" }, agent_consumption: { workspace_id: "ws" }, cli: { command: "sop run list" } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse(payload));
    const client = createHermesClient({ baseUrl: "https://hermes.example/api/hermes/v1", token: "secret" });
    expect(await client.actions()).toMatchObject(payload);
    expect(fetchMock).toHaveBeenCalledWith("https://hermes.example/api/hermes/v1/actions", expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
    fetchMock.mockClear();
    for (const baseUrl of ["http://hermes.example", "https://user:pass@hermes.example", "https://hermes.example?token=secret"]) {
      await expect(createHermesClient({ baseUrl, token: "secret" }).actions()).rejects.toThrow("HTTPS");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("calls Hermes resources with canonical api v1 base, bearer token, workspace scope, and query filters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        ok: true,
        items: [{ id: "run-1", kind: "run", version: 3, status: "ready", data: {}, created_at: "c", updated_at: "u" }],
        trace_id: "trace-1",
      }),
    );
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787/", token: "secret", workspaceId: "ws-1" });

    const response = await client.list("runs", { q: "build", status: "ready", kind: "command", limit: 10, cursor: "next" });

    expect(response.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/hermes/v1/runs?q=build&status=ready&kind=command&limit=10&cursor=next",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
          "X-Workspace-Id": "ws-1",
        }),
      }),
    );
  });

  it("normalizes missing items to an empty array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse({ ok: true, trace_id: "trace-2" }));
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787", token: "secret" });

    const response = await client.actions();

    expect(response.items).toEqual([]);
  });

  it("sends idempotent run actions with expected version and dry-run flag", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse({ ok: true, items: [] }));
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787", token: "secret", workspaceId: "ws-2" });

    await client.runAction("run/unsafe id", "replay", {
      idempotency_key: "idem-1",
      expected_version: 7,
      dry_run: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/hermes/v1/runs/run%2Funsafe%20id/replay",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ idempotency_key: "idem-1", expected_version: 7, dry_run: true }),
      }),
    );
  });

  it("calls the real run export API with workspace scope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse({ ok: true, items: [{ kind: "hermes.audit-package" }] }));
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787", token: "secret", workspaceId: "ws-2" });

    await client.runAction("run-1", "export", {
      idempotency_key: "export-1",
      expected_version: 11,
      dry_run: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/hermes/v1/runs/run-1/export",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
          "X-Workspace-Id": "ws-2",
        }),
        body: JSON.stringify({ idempotency_key: "export-1", expected_version: 11, dry_run: false }),
      }),
    );
  });

  it("allows run creation without client-owned workspace root or session alias", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse({ ok: true, items: [] }));
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787", token: "secret", workspaceId: "ws-2" });

    await client.create("runs", {
      data: {
        title: "Quality evidence run",
        nodes: [{ id: "typecheck", title: "Typecheck", kind: "command", argv: ["pnpm", "typecheck"], expected_exit_code: 0, timeout_seconds: 60 }],
      },
      idempotency_key: "run-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/hermes/v1/runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          data: {
            title: "Quality evidence run",
            nodes: [{ id: "typecheck", title: "Typecheck", kind: "command", argv: ["pnpm", "typecheck"], expected_exit_code: 0, timeout_seconds: 60 }],
          },
          idempotency_key: "run-1",
        }),
      }),
    );
  });

  it("sends CAS patch payloads without dropping empty strings", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse({ ok: true, items: [] }));
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787", token: "secret", workspaceId: "ws-2" });

    await client.patch("tasks", "task-1", {
      data: { title: "Bounded task", description: "", kind: "", status: "blocked" },
      expected_version: 4,
      idempotency_key: "task-edit-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/hermes/v1/tasks/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          data: { title: "Bounded task", description: "", kind: "", status: "blocked" },
          expected_version: 4,
          idempotency_key: "task-edit-1",
        }),
      }),
    );
  });

  it("raises explicit unavailable errors when core rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({ ok: false, items: [], error: { message: "bad token" }, trace_id: "trace-auth" }, { status: 401 }),
    );
    const client = createHermesClient({ baseUrl: "http://127.0.0.1:8787", token: "secret" });

    await expect(client.workspaces()).rejects.toMatchObject({
      name: "HermesUnavailableError",
      message: "bad token",
      status: 401,
      traceId: "trace-auth",
    });
  });
});
