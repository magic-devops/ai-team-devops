import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AssetSyncForm,
  AssetSyncWorkbench,
} from "../../subapps/ai-foundation/src/pages/intelligence/sync/AssetSyncWorkbench";
import { assetSyncTranslations } from "../i18n/asset-sync";
import {
  assetSyncBlocksExit,
  createAssetSyncController,
  emptyAssetDraft,
  type AssetCommand,
} from "./assetSync";
import { installExecutionExitGuard } from "./executionExitGuard";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
async function form() {
  let saved: string | null = null;
  const send = vi.fn<(body: AssetCommand["body"]) => Promise<unknown>>();
  const controller = createAssetSyncController({
    identity: {
      tenantId: "tenant",
      userId: "actor",
      projectId: "P",
      revision: "login1",
    },
    scope: "A",
    currentScope: () => "A",
    load: () => saved,
    save: (value) => {
      saved = value;
    },
    send,
  });
  controller.patch({
    ...emptyAssetDraft(),
    version: "7",
    sha: "a".repeat(64),
    content: "original reviewed content",
  });
  return {
    controller,
    send,
    render: () =>
      renderToStaticMarkup(
        createElement(AssetSyncForm, { controller, projectId: "P" }),
      ),
  };
}
function result(
  command: AssetCommand,
  state: "pending" | "processed" | "failed",
) {
  return {
    id: command.eventId,
    digest: "b".repeat(64),
    outcome: "stored",
    receipt_id: "R",
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
    },
  };
}
describe("advanced asset sync actual consumer", () => {
  it("connects the actual Intelligence entry and guards local tab exits", () => {
    const source = readFileSync(
      new URL(
        "../../subapps/ai-foundation/src/pages/Intelligence.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain(
      "<AssetSyncWorkbench onPending={(pending, canNavigate)",
    );
    expect(source).toContain("if (syncCanLeave.current()) setTab(key)");
    expect(source).toContain("if (syncCanLeave.current()) setTab(initialTab)");
    expect(source).toContain("syncCanLeave.current === canNavigate");
    expect(source).not.toContain("syncAssetDraft");
    expect(source).not.toContain("web-${");
  });
  it("renders without browser globals and requires session identity", () => {
    expect(typeof window).toBe("undefined");
    expect(renderToStaticMarkup(createElement(AssetSyncWorkbench))).toContain(
      "assetSync.identityRequired",
    );
  });
  it("labels explicit bases, original bytes guidance and full content before review", async () => {
    const h = await form(),
      html = h.render();
    for (const key of [
      "version",
      "sha",
      "fileBasis",
      "content",
      "path",
      "basisHint",
    ])
      expect(html).toContain("assetSync." + key);
    expect(html).toContain('aria-label="assetSync.version"');
    expect(html).toContain('aria-label="assetSync.sha"');
    expect(html).not.toContain("assetSync.confirm");
  });
  it("shows every frozen field during review and offers an explicit confirmation", async () => {
    const h = await form();
    await h.controller.review();
    const html = h.render();
    for (const field of [
      "module",
      "path",
      "content",
      "expected_version",
      "expected_sha256",
      "idempotency_key",
    ])
      expect(html).toContain(field);
    expect(html).toContain("original reviewed content");
    expect(html).toContain("assetSync.confirm");
    expect(html).not.toContain("<textarea");
  });
  it("unknown delivery offers the same original replay and no editable or replacement controls", async () => {
    const h = await form();
    await h.controller.review();
    h.send.mockRejectedValue(new Error("lost response"));
    await h.controller.submit();
    const html = h.render();
    expect(html).toContain("assetSync.unknownHint");
    expect(html).toContain("assetSync.replay");
    expect(html).toContain("original reviewed content");
    for (const key of ["confirm", "edit", "newBasis"])
      expect(html).not.toContain("assetSync." + key);
    expect(html).not.toContain("<textarea");
  });
  it.each(["pending", "failed", "processed"] as const)(
    "renders stored vs %s processing distinctly",
    async (state) => {
      const h = await form();
      await h.controller.review();
      h.send.mockResolvedValue(result(h.controller.snapshot().command!, state));
      await h.controller.submit();
      const html = h.render();
      expect(html).toContain("assetSync.deliveryState");
      expect(html).toContain("assetSync.processingState");
      expect(html).toContain("assetSync.stored");
      expect(html).toContain(
        state === "pending"
          ? "assetSync.processingPending"
          : "assetSync." + state,
      );
      if (state !== "processed")
        expect(html).not.toContain("assetSync.processedHint");
    },
  );
  it("uses the existing exit guard for an unknown original until matching confirmation", async () => {
    const h = await form();
    await h.controller.review();
    h.send.mockRejectedValueOnce(new Error("lost"));
    await h.controller.submit();
    const target = new EventTarget(),
      location = { href: "http://local/#/intelligence/sync" };
    const browser = Object.assign(target, {
      location,
      document: new EventTarget(),
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, href: string) => {
          location.href = href;
        },
      },
    }) as unknown as Window;
    let blocked = 0;
    const dispose = installExecutionExitGuard(
      browser,
      () => assetSyncBlocksExit(h.controller.snapshot().phase),
      () => {
        blocked++;
      },
    );
    location.href = "http://local/#/projects";
    target.dispatchEvent(new Event("hashchange"));
    expect(location.href).toBe("http://local/#/intelligence/sync");
    expect(blocked).toBe(1);
    const unload = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(unload, "returnValue", { writable: true, value: "" });
    target.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    h.send.mockResolvedValueOnce(
      result(h.controller.snapshot().command!, "processed"),
    );
    await h.controller.submit();
    location.href = "http://local/#/projects";
    target.dispatchEvent(new Event("hashchange"));
    expect(location.href).toBe("http://local/#/projects");
    dispose();
  });
  it("has complete matching Chinese, English and Japanese labels with actual basis guidance", () => {
    const keys = Object.keys(assetSyncTranslations["zh-CN"]).sort();
    for (const language of ["en-US", "ja-JP"] as const) {
      expect(Object.keys(assetSyncTranslations[language]).sort()).toEqual(keys);
      expect(
        Object.values(assetSyncTranslations[language]).every(Boolean),
      ).toBe(true);
    }
    expect(assetSyncTranslations["zh-CN"].basisHint).toContain("字节");
    expect(assetSyncTranslations["en-US"].basisHint).toContain("partial pull");
    expect(assetSyncTranslations["ja-JP"].unknownHint).toContain("画面移動");
  });
});
