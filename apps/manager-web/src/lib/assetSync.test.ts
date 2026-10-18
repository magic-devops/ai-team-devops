import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assetBody,
  assetDraftKey,
  assetEventId,
  createAssetSyncController,
  emptyAssetDraft,
  parseAssetAck,
  restoreAssetState,
  type AssetCommand,
  type AssetIdentity,
} from "./assetSync";
import { api } from "./api";
import { projectSessionKey } from "./projectPortfolio";
afterEach(() => vi.unstubAllGlobals());
const identity: AssetIdentity = {
  tenantId: "tenant",
  userId: "actor",
  projectId: "project",
  revision: "login-1",
};
const draft = () => ({
  ...emptyAssetDraft(),
  content: "line1\r\nline2\r\n",
  version: "7",
  sha: "a".repeat(64),
});
function harness() {
  let saved: string | null = null,
    scope = "A";
  const send = vi.fn<(body: AssetCommand["body"]) => Promise<unknown>>();
  const save = vi.fn((value: string) => {
    saved = value;
  });
  const options = {
    identity,
    scope,
    currentScope: () => scope,
    load: () => saved,
    save,
    send,
  };
  return {
    controller: createAssetSyncController(options),
    send,
    save,
    options,
    saved: () => saved,
    switchScope: (value: string) => {
      scope = value;
    },
  };
}
function ack(
  command: AssetCommand,
  state: "pending" | "processed" | "failed" = "processed",
) {
  return {
    id: command.eventId,
    digest: "b".repeat(64),
    outcome: "stored",
    receipt_id: "receipt",
    processing: {
      state,
      revision: 2,
      result:
        state === "processed"
          ? {
              kind: "asset_materialized",
              target_kind: "asset",
              target_id: ".ai-memory/rules/RULES.md",
            }
          : null,
      reason_code: state === "failed" ? "version_conflict" : null,
    },
  };
}
async function reviewed(h = harness()) {
  h.controller.patch(draft());
  await h.controller.review();
  expect(h.controller.snapshot().phase).toBe("review");
  return h;
}

it("retains the authenticated Manager canonical target when its casing differs from the input", async () => {
  const h = await reviewed();
  const response = ack(h.controller.snapshot().command!);
  response.processing.result!.target_id = ".ai-memory/rules/Rules.md";
  h.send.mockResolvedValue(response);
  await h.controller.submit();
  expect(h.controller.snapshot().phase).toBe("processed");
  expect(h.controller.snapshot().ack!.processing!.result!.target_id).toBe(
    ".ai-memory/rules/Rules.md",
  );
});

it.each(["", "../outside.md", "C:/outside.md", ".ai-memory/../outside.md"])(
  "does not accept an unsafe actual target %s",
  async (target) => {
    const h = await reviewed();
    const response = ack(h.controller.snapshot().command!);
    response.processing.result!.target_id = target;
    expect(() =>
      parseAssetAck(response, h.controller.snapshot().command!),
    ).toThrow("ackMismatch");
  },
);
describe("actual advanced asset request contract", () => {
  it("requires explicit version and original byte SHA and preserves CRLF and whitespace", () => {
    const body = assetBody(draft(), "operation-one");
    expect(body).toEqual({
      module: "rules",
      action: "upsert",
      expected_version: 7,
      idempotency_key: "operation-one",
      record: {
        path: "RULES.md",
        content: "line1\r\nline2\r\n",
        expected_sha256: "a".repeat(64),
      },
    });
    expect(() => assetBody({ ...draft(), version: "" }, "K")).toThrow(
      "invalidVersion",
    );
    expect(() => assetBody({ ...draft(), sha: "" }, "K")).toThrow("invalidSha");
    expect(
      assetBody({ ...draft(), content: "", basis: "absent", sha: "" }, "K")
        .record,
    ).toEqual({ path: "RULES.md", content: "", expected_sha256: null });
  });
  it.each(["-1", "1.5", "01", "1e2", " 7", "9007199254740992"])(
    "rejects invalid version %s",
    (version) => {
      expect(() => assetBody({ ...draft(), version }, "K")).toThrow(
        "invalidVersion",
      );
    },
  );
  it.each([
    "../file.md",
    "C:/file.md",
    "/file.md",
    "dir\\file.md",
    "dir//file.md",
    "file.exe",
  ])("rejects unsafe target %s", (path) => {
    expect(() => assetBody({ ...draft(), path }, "K")).toThrow("invalidPath");
  });
  it("requires the canonical templates namespace and module-relative rules/specs paths", () => {
    expect(() =>
      assetBody({ ...draft(), module: "templates", path: "review.md" }, "K"),
    ).toThrow("invalidPath");
    expect(
      assetBody(
        { ...draft(), module: "templates", path: "templates/review.md" },
        "K",
      ).record.path,
    ).toBe("templates/review.md");
    expect(() =>
      assetBody(
        { ...draft(), module: "rules", path: ".ai-memory/rules/RULES.md" },
        "K",
      ),
    ).toThrow("invalidPath");
    expect(() =>
      assetBody(
        { ...draft(), module: "specs", path: "sop/custom/specs/design.md" },
        "K",
      ),
    ).toThrow("invalidPath");
  });
  it("bounds actual UTF-8 content to the shared 60 KiB asset snapshot limit", () => {
    expect(() =>
      assetBody({ ...draft(), content: "汉".repeat(20481) }, "K"),
    ).toThrow("invalidContent");
    expect(
      assetBody({ ...draft(), content: "a".repeat(60 * 1024) }, "K").record
        .content,
    ).toHaveLength(60 * 1024);
  });
  it("matches the server event ID formula and isolates retained originals by real identity", async () => {
    // Independently generated with hashlib.sha256(json.dumps([...]).encode()).
    expect(await assetEventId(identity, "K")).toBe(
      "sync-4e1cb9acfc8796a926216fe501e155f5d0db6c463824ddfb8ec53552dd7829be",
    );
    expect(
      await assetEventId(
        { ...identity, tenantId: "租户", projectId: "项目", userId: "用户" },
        "K",
      ),
    ).toBe(
      "sync-476b230dd789c2645b0550d0382b48b079e8754b2156bf9c94f003797c9a8693",
    );
    const keys = [
      identity,
      { ...identity, tenantId: "other" },
      { ...identity, userId: "other" },
      { ...identity, projectId: "other" },
      { ...identity, revision: "login-2" },
    ].map(assetDraftKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("prevents a new review from reusing a path as a permanent operation key", async () => {
    const h = await reviewed();
    const first = h.controller.snapshot().command!;
    expect(Object.isFrozen(first.body.record)).toBe(true);
    h.send.mockResolvedValue(ack(first));
    await h.controller.submit();
    h.controller.newDraft();
    expect(h.controller.snapshot().draft).toMatchObject({
      content: draft().content,
      version: "",
      sha: "",
    });
    h.controller.patch({
      version: "8",
      sha: "c".repeat(64),
      content: "different",
    });
    await h.controller.review();
    expect(h.controller.snapshot().command!.body.idempotency_key).not.toBe(
      first.body.idempotency_key,
    );
  });
});
describe("fixed originals, uncertain delivery and current scope", () => {
  it("saves the full original before sending, freezes unknown input and exactly replays after reload", async () => {
    const h = await reviewed();
    const original = h.controller.snapshot().command!;
    h.send.mockImplementation(async (body) => {
      expect(JSON.parse(h.saved()!).phase).toBe("sending");
      expect(JSON.parse(h.saved()!).command.body).toEqual(body);
      throw new Error("connection lost after commit");
    });
    await h.controller.submit();
    expect(h.controller.snapshot().phase).toBe("unknown");
    h.controller.patch({ content: "edited", version: "8" });
    h.controller.newDraft();
    h.controller.editReview();
    await h.controller.review();
    expect(h.controller.snapshot().command).toEqual(original);
    const resumed = createAssetSyncController(h.options);
    h.send.mockResolvedValue(ack(original));
    await resumed.submit();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[0][0]).toEqual(h.send.mock.calls[1][0]);
    expect(resumed.snapshot().phase).toBe("processed");
  });
  it("never treats a 403 after a lost reply as proof that the first original did not commit", async () => {
    const h = await reviewed();
    h.send.mockRejectedValueOnce(new Error("network failure"));
    await h.controller.submit();
    h.send.mockRejectedValueOnce(
      new Error('HTTP 403: {"detail":"permission changed"}'),
    );
    await h.controller.submit();
    expect(h.controller.snapshot().phase).toBe("unknown");
    const original = h.controller.snapshot().command;
    h.controller.newDraft();
    expect(h.controller.snapshot().command).toEqual(original);
  });
  it("keeps explicit refusals and requires deliberately entering new bases", async () => {
    const h = await reviewed();
    h.send.mockRejectedValue(
      new Error(
        'HTTP 409: {"detail":{"code":"event_id_conflict","message":"conflict"}}',
      ),
    );
    await h.controller.submit();
    expect(h.controller.snapshot().phase).toBe("rejected");
    expect(h.controller.snapshot().command).toBeDefined();
    h.controller.patch({ version: "8" });
    expect(h.controller.snapshot().draft.version).toBe("7");
    h.controller.newDraft();
    expect(h.controller.snapshot().phase).toBe("editing");
    expect(h.controller.snapshot().draft).toMatchObject({
      version: "",
      sha: "",
    });
  });
  it.each(["pending", "failed"] as const)(
    "stored acknowledgement with %s processing is not business success",
    async (state) => {
      const h = await reviewed();
      h.send.mockResolvedValue(ack(h.controller.snapshot().command!, state));
      await h.controller.submit();
      expect(h.controller.snapshot().phase).toBe(
        state === "pending" ? "stored" : "failed",
      );
      expect(h.controller.snapshot().phase).not.toBe("processed");
    },
  );
  it("keeps malformed or unrelated acknowledgements unresolved", async () => {
    const h = await reviewed();
    h.send.mockResolvedValue({
      ...ack(h.controller.snapshot().command!),
      id: "wrong",
    });
    await h.controller.submit();
    expect(h.controller.snapshot().phase).toBe("unknown");
    expect(() =>
      parseAssetAck(
        { ...ack(h.controller.snapshot().command!), digest: "" },
        h.controller.snapshot().command!,
      ),
    ).toThrow("ackMismatch");
  });
  it("does not submit twice during an in-flight original", async () => {
    const h = await reviewed();
    let finish!: (result: unknown) => void;
    h.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = h.controller.submit();
    await h.controller.submit();
    expect(h.send).toHaveBeenCalledTimes(1);
    finish(ack(h.controller.snapshot().command!));
    await pending;
  });
  it("ignores late results and old actions after project A → B → A, retaining the unknown original", async () => {
    const h = await reviewed();
    const original = h.controller.snapshot().command!;
    let finish!: (result: unknown) => void;
    h.send.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = h.controller.submit();
    h.switchScope("B");
    h.controller.invalidate();
    h.switchScope("A");
    finish(ack(original));
    await pending;
    expect(h.controller.snapshot().phase).toBe("unknown");
    expect(JSON.parse(h.saved()!).phase).toBe("unknown");
    await h.controller.submit();
    expect(h.send).toHaveBeenCalledTimes(1);
    const current = createAssetSyncController(h.options);
    expect(current.snapshot().command).toEqual(original);
  });
  it("does not replace the original bases when replaying an already stored event", async () => {
    const h = await reviewed();
    const original = h.controller.snapshot().command!;
    h.send.mockResolvedValueOnce(ack(original, "pending"));
    await h.controller.submit();
    h.send.mockResolvedValueOnce({ ...ack(original), outcome: "duplicate" });
    await h.controller.submit();
    expect(h.send.mock.calls[1][0]).toEqual(original.body);
    expect(h.controller.snapshot().phase).toBe("processed");
  });
  it("refuses sending when session storage cannot preserve the original, keeping the current draft", async () => {
    const h = await reviewed();
    h.save.mockImplementation(() => {
      throw new Error("quota");
    });
    await h.controller.submit();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.controller.snapshot().phase).toBe("review");
    expect(h.controller.snapshot().draft.content).toBe(draft().content);
  });
  it("restores an interrupted send as unknown and refuses corrupt retained originals", async () => {
    const h = await reviewed();
    const state = h.controller.snapshot();
    expect(
      restoreAssetState(JSON.stringify({ ...state, phase: "sending" })).phase,
    ).toBe("unknown");
    expect(() =>
      restoreAssetState(
        JSON.stringify({
          ...state,
          draft: { ...state.draft, content: "replaced" },
        }),
      ),
    ).toThrow("storageInvalid");
  });
  it("keeps the real API request bytes and scope headers identical across lost reply replay", async () => {
    const data = new Map<string, string>([
      ["sop-token", "actual-token"],
      ["sop-session-revision", "login-1"],
      ["sop-current-project-id", "project"],
      ["sop-current-project-code", "project"],
      ["sop-current-tenant-code", "tenant-code"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) || null,
    });
    let saved: string | null = null;
    const controller = createAssetSyncController({
      identity,
      scope: projectSessionKey(),
      currentScope: projectSessionKey,
      load: () => saved,
      save: (value) => {
        saved = value;
      },
      send: (body) => api.syncPush(body),
    });
    controller.patch(draft());
    await controller.review();
    const original = controller.snapshot().command!;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("reply lost"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(ack(original)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await controller.submit();
    expect(controller.snapshot().phase).toBe("unknown");
    await controller.submit();
    expect(controller.snapshot().phase).toBe("processed");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = fetcher.mock.calls[0],
      second = fetcher.mock.calls[1];
    expect(first[0]).toBe("/api/v1/sync/push");
    expect(first[1]?.body).toBe(second[1]?.body);
    expect(JSON.parse(first[1]?.body as string)).toEqual(original.body);
    expect(new Headers(first[1]?.headers).get("X-Project-Id")).toBe("project");
    expect(new Headers(first[1]?.headers).get("Authorization")).toBe(
      "Bearer actual-token",
    );
    expect(new Headers(first[1]?.headers).get("X-Tenant-Code")).toBe(
      "tenant-code",
    );
  });
  it("survives effect cleanup/setup while invalidating pre-cleanup asynchronous results", async () => {
    const h = await reviewed();
    h.controller.invalidate();
    h.controller.activate();
    h.send.mockResolvedValue(ack(h.controller.snapshot().command!));
    await h.controller.submit();
    expect(h.controller.snapshot().phase).toBe("processed");
  });
});
