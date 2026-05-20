import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../../../src/lib/api";
import { getToken } from "../../../../../src/lib/authStorage";
import en from "../../../../../src/i18n/en-US.json";
import ja from "../../../../../src/i18n/ja-JP.json";
import zh from "../../../../../src/i18n/zh-CN.json";
import { translateAccessFinding, translateAccessKind, translateAccessRecommendation, translateAccessSeverity } from "./accessReviewI18n";

const t = (key: string, options?: Record<string, unknown>) => `${key}:${JSON.stringify(options ?? {})}`;

function jwtWithPayload(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("access review i18n helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("localizes the focused access review navigation item", () => {
    expect(zh.nav.orgAccessReview).toBe("权限体检");
    expect(en.nav.orgAccessReview).toBe("Access review");
    expect(ja.nav.orgAccessReview).toBe("アクセスレビュー");
  });

  it("translates finding content from stable kind and params", () => {
    const finding = {
      id: "project_without_admin-1",
      kind: "project_without_admin",
      severity: "high" as const,
      title: "项目缺少项目管理员：Alpha",
      description: "活跃项目没有 project_admin",
      project_id: "p1",
      project_name: "Alpha",
      params: { projectName: "Alpha" },
    };

    expect(translateAccessFinding(t, finding, "title")).toContain("page.organization.accessFinding.project_without_admin.title");
    expect(translateAccessFinding(t, finding, "description")).toContain("\"projectName\":\"Alpha\"");
    expect(translateAccessSeverity(t, "high")).toContain("page.organization.accessSeverityMap.high");
    expect(translateAccessKind(t, "project_without_admin")).toContain("page.organization.accessKindMap.project_without_admin");
  });

  it("translates recommendation rows by index", () => {
    expect(translateAccessRecommendation(t, "优先处理 high 风险", 0)).toContain("page.organization.accessRecommendation.0");
  });

  it("binds the first project and retries once when a scoped API reports missing X-Project-Id", async () => {
    const store = new Map<string, string>([["sop-token", "token-1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/v1/sync/summary") && !store.get("sop-current-project-id")) {
        return new Response(JSON.stringify({ detail: "需要登录且携带 X-Project-Id 以绑定同步分区" }), { status: 400 });
      }
      if (path.endsWith("/api/v1/projects")) {
        return Response.json([{ id: "p1", tenant_code: "tenant-a", business_id: "biz-a", project_code: "proj-a" }]);
      }
      return Response.json({
        ok: true,
        project_id: (init?.headers as Record<string, string>)?.["X-Project-Id"],
        modules: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.syncSummary()).resolves.toMatchObject({ ok: true, project_id: "p1" });
    expect(store.get("sop-current-project-id")).toBe("p1");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/auth/me",
      "/api/v1/sync/summary",
      "/api/v1/projects",
      "/api/v1/sync/summary",
    ]);
  });

  it("clears the stale browser session when the API reports an expired token", async () => {
    const store = new Map<string, string>([
      ["sop-token", "expired-token"],
      ["sop-current-project-id", "p1"],
      ["sop-current-tenant-code", "tenant-a"],
    ]);
    const dispatched: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
      location: {
        pathname: "/",
        search: "",
        hash: "#/organization/access-review",
        replace: vi.fn(),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Token 已过期" }), { status: 401 })));

    await expect(api.authMe()).rejects.toThrow("HTTP 401");
    expect(store.get("sop-token")).toBeUndefined();
    expect(store.get("sop-current-project-id")).toBeUndefined();
    expect(store.get("sop-current-tenant-code")).toBeUndefined();
    expect(dispatched).toContain("sop-session");
    expect(window.location.replace).toHaveBeenCalledWith("/login.html?redirect=%2F%23%2Forganization%2Faccess-review");
  });

  it("does not force logout for a non-session 401 response", async () => {
    const store = new Map<string, string>([
      ["sop-token", "active-token"],
      ["sop-current-project-id", "p1"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      location: {
        pathname: "/",
        search: "",
        hash: "#/settings",
        replace: vi.fn(),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "管理员账号或密码错误" }), { status: 401 })));

    await expect(api.authMe()).rejects.toThrow("HTTP 401");
    expect(store.get("sop-token")).toBe("active-token");
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("treats an already expired JWT in localStorage as signed out before page queries run", () => {
    const store = new Map<string, string>([
      ["sop-token", jwtWithPayload({ sub: "u1", exp: Math.floor(Date.now() / 1000) - 60 })],
      ["sop-current-project-id", "p1"],
    ]);
    const dispatched: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
    });

    expect(getToken()).toBeNull();
    expect(store.get("sop-token")).toBeUndefined();
    expect(store.get("sop-current-project-id")).toBeUndefined();
    expect(dispatched).toContain("sop-session");
  });
});
