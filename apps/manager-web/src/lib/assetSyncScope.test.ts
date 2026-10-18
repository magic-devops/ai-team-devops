import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { createAssetSyncController, emptyAssetDraft } from "./assetSync";
import { bindSessionRequest } from "./http";
import { projectSessionKey } from "./projectPortfolio";

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map([
    ["sop-token", "same-user-token"],
    ["sop-session-revision", "same-login"],
    ["sop-current-project-id", "A"],
    ["sop-current-project-code", "A"],
    ["sop-current-tenant-code", "tenant-code"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) || null,
  });
  return values;
}
const body = {
  module: "rules",
  action: "upsert",
  expected_version: 0,
  idempotency_key: "original-A",
  record: { path: "RULES.md", content: "Original A", expected_sha256: null },
} as const;

it("does not send after another context changes scope while the original is being saved", async () => {
  const values = storage();
  let saved: string | null = null;
  const controller = createAssetSyncController({
    identity: {
      tenantId: "tenant",
      userId: "actor",
      projectId: "A",
      revision: "same-login",
    },
    scope: projectSessionKey(),
    currentScope: projectSessionKey,
    load: () => saved,
    save: (value) => {
      saved = value;
      if (JSON.parse(value).phase === "sending")
        values.set("sop-current-project-id", "B");
    },
    send: (value) => api.syncPush(value),
    key: () => "original-A",
  });
  controller.patch({
    ...emptyAssetDraft(),
    version: "0",
    basis: "absent",
    content: "Original A",
  });
  await controller.review();
  const original = controller.snapshot().command;
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await controller.submit();
  expect(fetcher).not.toHaveBeenCalled();
  expect(controller.snapshot().phase).toBe("unknown");
  expect(JSON.parse(saved!).command).toEqual(original);
});

it.each(["project", "session"])(
  "binds the real request to the original %s before a later global capture",
  async (changed) => {
    const values = storage();
    const bound = bindSessionRequest({
      projectId: "A",
      revision: "same-login",
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    values.set(
      changed === "project" ? "sop-current-project-id" : "sop-session-revision",
      "B",
    );
    await expect(api.syncPush(body, bound)).rejects.toThrow("已切换");
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("uses captured original headers for the unchanged current session", async () => {
  storage();
  const bound = bindSessionRequest({ projectId: "A", revision: "same-login" });
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  await api.syncPush(body, bound);
  expect(
    new Headers(fetcher.mock.calls[0][1].headers).get("X-Project-Id"),
  ).toBe("A");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(body);
});
