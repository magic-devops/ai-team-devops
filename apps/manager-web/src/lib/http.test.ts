import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, getToken, getWorkspaceScope, setSession, setWorkspaceScope } from "./authStorage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("HTTP session consistency", () => {
  let fetcher: ReturnType<typeof vi.fn>;
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    replace = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/", search: "", hash: "#/dev-flow", replace },
      dispatchEvent: vi.fn(),
    });
    fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    setSession("session-a", "project-a", "tenant-a");
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("keeps a new login when an old auth probe returns 401", async () => {
    const delayed = deferred<Response>();
    fetcher.mockReturnValueOnce(delayed.promise);
    const { request } = await import("./http");
    const result = request("/api/v1/auth/me").catch((error: Error) => error);
    setSession("session-b", "project-b", "tenant-b");
    delayed.resolve(reply({ detail: "Token 无效" }, 401));
    expect(await result).toBeInstanceOf(Error);
    expect(getToken()).toBe("session-b");
    expect(getWorkspaceScope().projectId).toBe("project-b");
    expect(replace).not.toHaveBeenCalled();
  });

  it("still clears and redirects the current invalid session", async () => {
    fetcher.mockResolvedValueOnce(reply({ detail: "Token 已过期" }, 401));
    const { request } = await import("./http");
    await expect(request("/api/v1/auth/me")).rejects.toThrow("HTTP 401");
    expect(getToken()).toBeNull();
    expect(replace).toHaveBeenCalledOnce();
  });

  it("does not hydrate an old identity or dispatch its mutation under a new login", async () => {
    setSession("session-a", null, "tenant-a");
    const delayed = deferred<Response>();
    fetcher.mockReturnValueOnce(delayed.promise).mockImplementation(() => Promise.resolve(reply({ ok: true })));
    const { request } = await import("./http");
    const result = request("/api/v1/delivery/commands", { method: "POST", body: "draft-a" }).catch((e: Error) => e);
    setSession("session-b", "project-b", "tenant-b");
    delayed.resolve(reply({ user_id: "user-a", default_project_id: "project-a" }));
    expect(await result).toBeInstanceOf(Error);
    expect(getToken()).toBe("session-b");
    expect(getWorkspaceScope().projectId).toBe("project-b");
    expect(localStorage.getItem("sop-user")).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("hydrates a new session independently while the previous one is pending", async () => {
    setSession("session-a", null, "tenant-a");
    const oldProbe = deferred<Response>();
    const newProbe = deferred<Response>();
    fetcher.mockReturnValueOnce(oldProbe.promise).mockReturnValueOnce(newProbe.promise)
      .mockImplementation(() => Promise.resolve(reply({ ok: true })));
    const { request } = await import("./http");
    const oldResult = request("/api/v1/tasks").catch((e: Error) => e);
    setSession("session-b", null, "tenant-b");
    const newResult = request("/api/v1/tasks");
    expect(fetcher).toHaveBeenCalledTimes(2);
    newProbe.resolve(reply({ user_id: "user-b", default_project_id: "project-b", tenant_code: "tenant-b" }));
    expect(await newResult).toEqual({ ok: true });
    oldProbe.resolve(reply({ user_id: "user-a", default_project_id: "project-a" }));
    expect(await oldResult).toBeInstanceOf(Error);
    expect(getWorkspaceScope().projectId).toBe("project-b");
    expect(JSON.parse(localStorage.getItem("sop-user")!)).toMatchObject({ id: "user-b" });
    const headers = fetcher.mock.calls[2][1].headers;
    expect(headers).toMatchObject({ Authorization: "Bearer session-b", "X-Project-Id": "project-b" });
  });

  it("shares hydration for concurrent requests from the same session", async () => {
    setSession("session-a", null, "tenant-a");
    const probe = deferred<Response>();
    fetcher.mockReturnValueOnce(probe.promise).mockImplementation(() => Promise.resolve(reply({ ok: true })));
    const { request } = await import("./http");
    const first = request("/api/v1/tasks");
    const second = request("/api/v1/requirements");
    expect(fetcher).toHaveBeenCalledOnce();
    probe.resolve(reply({ default_project_id: "project-a", tenant_code: "tenant-a" }));
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a result from the previous project after switching projects", async () => {
    const delayed = deferred<Response>();
    fetcher.mockReturnValueOnce(delayed.promise);
    const { request } = await import("./http");
    const result = request("/api/v1/tasks").catch((e: Error) => e);
    setSession("session-a", "project-other", "tenant-a");
    delayed.resolve(reply([{ id: "private-project-a-task" }]));
    expect(await result).toBeInstanceOf(Error);
  });

  it("does not choose the first project or retry an unbound mutation", async () => {
    setSession("session-a", null, "tenant-a");
    fetcher.mockResolvedValueOnce(reply({ tenant_code: "tenant-a" }))
      .mockResolvedValueOnce(reply({ detail: "X-Project-Id required" }, 400))
      .mockResolvedValueOnce(reply([{ id: "project-a", tenant_code: "tenant-a" }]))
      .mockImplementation(() => Promise.resolve(reply({ ok: true })));
    const { request } = await import("./http");
    const result = request("/api/v1/tasks", { method: "POST", body: "draft-a" }).catch((e: Error) => e);
    expect(await result).toBeInstanceOf(Error);
    expect(getWorkspaceScope().projectId).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves an explicitly cleared project while still hydrating identity and a refreshed token", async () => {
    setSession("session-a", null, "tenant-a");
    setWorkspaceScope({ projectId: null, projectCode: null, businessCode: "chosen-business" });
    fetcher.mockResolvedValueOnce(reply({ user_id: "account-a", token: "refreshed", default_project_id: "project-a", tenant_code: "tenant-a" }))
      .mockResolvedValueOnce(reply({ ok: true }));
    const { request } = await import("./http");
    const body = JSON.stringify({ idempotency_key: "stable", draft: "original" });
    expect(await request("/api/v1/tasks", { method: "POST", body })).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(getToken()).toBe("refreshed");
    expect(getWorkspaceScope()).toMatchObject({ projectId: null, businessCode: "chosen-business" });
    expect(new Headers(fetcher.mock.calls[1][1].headers).has("X-Project-Id")).toBe(false);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ body, headers: { Authorization: "Bearer refreshed" } });
  });

  it("does not restore a logged-out session from a late hydration response", async () => {
    setSession("session-a", null, "tenant-a");
    const probe = deferred<Response>();
    fetcher.mockReturnValueOnce(probe.promise).mockImplementation(() => Promise.resolve(reply({ ok: true })));
    const { request } = await import("./http");
    const result = request("/api/v1/tasks").catch((e: Error) => e);
    clearSession();
    probe.resolve(reply({ user_id: "user-a", default_project_id: "project-a" }));
    expect(await result).toBeInstanceOf(Error);
    expect(getToken()).toBeNull();
    expect(getWorkspaceScope().projectId).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("overrides a project header without sending two differently cased values", async () => {
    fetcher.mockResolvedValueOnce(reply({ ok: true }));
    const { request } = await import("./http");
    await request("/api/v1/tasks", { headers: new Headers({ "X-Project-Id": "explicit-project" }) });
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("X-Project-Id")).toBe("explicit-project");
  });

  it("does not clear stored credentials after probing with an explicitly different token", async () => {
    fetcher.mockResolvedValueOnce(reply({ detail: "Token 无效" }, 401));
    const { request } = await import("./http");
    await expect(request("/api/v1/auth/me", { headers: { Authorization: "Bearer unrelated" } })).rejects.toThrow("HTTP 401");
    expect(getToken()).toBe("session-a");
    expect(replace).not.toHaveBeenCalled();
  });

  it("checks the session again after reading a delayed response body", async () => {
    const body = deferred<unknown>();
    const reading = deferred<void>();
    fetcher.mockResolvedValueOnce({ ok: true, json: () => { reading.resolve(); return body.promise; } });
    const { request } = await import("./http");
    const result = request("/api/v1/tasks").catch((e: Error) => e);
    await reading.promise;
    setSession("session-b", "project-b", "tenant-b");
    body.resolve([{ id: "old-task" }]);
    expect(await result).toBeInstanceOf(Error);
  });

  it("does not reuse a pending response after logging back into the same account", async () => {
    const probe = deferred<Response>();
    fetcher.mockReturnValueOnce(probe.promise);
    const { request } = await import("./http");
    const result = request("/api/v1/auth/me").catch((e: Error) => e);
    clearSession();
    setSession("session-a", "project-a", "tenant-a");
    probe.resolve(reply({ detail: "用户不存在或已禁用" }, 401));
    expect(await result).toBeInstanceOf(Error);
    expect(getToken()).toBe("session-a");
    expect(replace).not.toHaveBeenCalled();
  });

  it("reports a current failed hydration without dispatching the business operation", async () => {
    setSession("session-a", null, "tenant-a");
    fetcher.mockResolvedValueOnce(reply({ detail: "Token 无效" }, 401));
    const { request } = await import("./http");
    await expect(request("/api/v1/tasks", { method: "POST", body: "draft-a" })).rejects.toThrow("HTTP 401");
    expect(getToken()).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
