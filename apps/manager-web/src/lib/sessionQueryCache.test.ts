import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, getWorkspaceScope, setSession, setUserSession, setWorkspaceScope } from "./authStorage";
import { watchSessionQueryCache } from "./sessionQueryCache";

let stop: (() => void) | undefined;
let client: QueryClient;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  setSession("account-a", "project-a", "tenant-a");
  client = new QueryClient();
});

afterEach(() => { stop?.(); client.clear(); vi.unstubAllGlobals(); });

it("discards cached identities, permissions and business data on login changes", () => {
  stop = watchSessionQueryCache(client);
  client.setQueryData(["authMe"], { user_id: "account-a", role: "project_admin" });
  client.setQueryData(["tasks"], [{ id: "old-private-task" }]);
  setSession("account-b", "project-b", "tenant-b");
  expect(client.getQueryData(["authMe"])).toBeUndefined();
  expect(client.getQueryData(["tasks"])).toBeUndefined();
});

it("discards the previous project's results while keeping the new project selection", () => {
  stop = watchSessionQueryCache(client);
  client.setQueryData(["tasks"], [{ id: "old-private-task" }]);
  setWorkspaceScope({ projectId: "project-b", projectCode: "project-b" });
  expect(client.getQueryData(["tasks"])).toBeUndefined();
  expect(getWorkspaceScope().projectId).toBe("project-b");
});

it("retains current data when a session notification does not change identity or scope", () => {
  stop = watchSessionQueryCache(client);
  client.setQueryData(["tasks"], ["current"]);
  window.dispatchEvent(new Event("sop-session"));
  expect(client.getQueryData(["tasks"])).toEqual(["current"]);
});

it("handles cross-tab login changes and logout", () => {
  stop = watchSessionQueryCache(client);
  client.setQueryData(["tasks"], ["private"]);
  localStorage.setItem("sop-token", "different-tab-login");
  window.dispatchEvent(new Event("storage"));
  expect(client.getQueryData(["tasks"])).toBeUndefined();
  client.setQueryData(["tasks"], ["new-private"]);
  clearSession();
  expect(client.getQueryData(["tasks"])).toBeUndefined();
});

it("refreshes the profile without resetting an explicitly selected project", () => {
  setUserSession({ user_id: "account-a", default_project_id: "default-project" }, { preserveWorkspace: true });
  expect(getWorkspaceScope().projectId).toBe("project-a");
  expect(JSON.parse(localStorage.getItem("sop-user")!)).toMatchObject({ id: "account-a" });
});

it("notifies subscribers on a fresh login even when workspace fields stay the same", () => {
  stop = watchSessionQueryCache(client);
  client.setQueryData(["tasks"], ["previous-login"]);
  setSession("account-a", "project-a", "tenant-a");
  expect(client.getQueryData(["tasks"])).toBeUndefined();
});

it("replaces mounted query observers after clearing the previous workspace", async () => {
  const options = {
    queryKey: ["tasks"],
    staleTime: Infinity,
    queryFn: async () => getWorkspaceScope().projectId,
  };
  client.setQueryData(options.queryKey, "project-a");
  const createObserver = () => new QueryObserver(client, options);
  const old = createObserver();
  const unsubscribe = old.subscribe(() => {});
  let fresh: ReturnType<typeof createObserver> | undefined;
  let stopFresh: (() => void) | undefined;
  const remount = vi.fn(() => {
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    unsubscribe();
    const next = createObserver();
    fresh = next;
    stopFresh = next.subscribe(() => {});
  });
  stop = watchSessionQueryCache(client, remount);
  setWorkspaceScope({ projectId: "project-b", projectCode: "project-b" });
  expect(remount).toHaveBeenCalledOnce();
  await fresh!.refetch();
  expect(fresh!.getCurrentResult().data).toBe("project-b");
  stopFresh?.();
});
