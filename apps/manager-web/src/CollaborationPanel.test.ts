import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  CollaborationPanel,
  canEditMessage,
  collaborationFingerprint,
} from "./pages/CollaborationPanel";
import { createHermesClient, type HermesEntity } from "./lib/hermes";
import { collaborationTranslations } from "./i18n/collaboration";
import "./i18n";

afterEach(() => vi.restoreAllMocks());

describe("collaboration interaction boundaries", () => {
  const client = createHermesClient({
    baseUrl: "http://127.0.0.1:8787",
    token: "test",
    workspaceId: "ws",
  });
  const entity: HermesEntity = {
    id: "m",
    kind: "messages",
    version: 3,
    status: "active",
    data: { author: "alice" },
    created_at: "",
    updated_at: "",
  };

  it("allows editing only to an authorized author or configuration principal", () => {
    expect(canEditMessage(entity, "alice", new Set(["read"]))).toBe(false);
    expect(canEditMessage(entity, "bob", new Set(["write"]))).toBe(false);
    expect(canEditMessage(entity, "alice", new Set(["write"]))).toBe(true);
    expect(canEditMessage({ ...entity, status: "archived" }, "alice", new Set(["write", "config"]))).toBe(false);
    expect(canEditMessage(entity, "bob", new Set(["write", "config"]))).toBe(
      true,
    );
  });

  it("binds preview to exact message, recipients, version and idempotency key", () => {
    const draft = {
      kind: "edit" as const,
      id: "m",
      body: {
        body: "Review evidence",
        mentions: ["alice"],
        expected_version: 3,
        idempotency_key: "stable",
        dry_run: true,
      },
    };
    expect(collaborationFingerprint(draft)).toBe(
      collaborationFingerprint({
        ...draft,
        body: { ...draft.body, dry_run: false },
      }),
    );
    for (const patch of [
      { body: "Changed" },
      { expected_version: 4 },
      { mentions: ["bob"] },
      { idempotency_key: "other" },
    ]) {
      expect(collaborationFingerprint(draft)).not.toBe(
        collaborationFingerprint({
          ...draft,
          body: { ...draft.body, ...patch },
        }),
      );
    }
  });

  it.each([false, true])(
    "renders an offline or permission state without requesting data (%s)",
    (connected) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      const html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(
            App,
            null,
            createElement(CollaborationPanel, {
              client,
              workspaceReady: true,
              connected,
              permissions: new Set<string>(),
              scopeKey: "scope",
            }),
          ),
        ),
      );
      expect(html).toContain(
        connected ? "需要读取权限" : "连接工作空间后查看团队消息",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("has complete Chinese, English and Japanese labels", () => {
    const keys = Object.keys(collaborationTranslations["en-US"]).sort();
    for (const labels of Object.values(collaborationTranslations)) {
      expect(Object.keys(labels).sort()).toEqual(keys);
      expect(
        Object.values(labels).every((value) => value.trim().length > 0),
      ).toBe(true);
    }
  });

  it("uses scoped canonical message endpoints and preserves preview/apply bodies", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ ok: true, items: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
      );
    await client.collaborationMessages("thread 1", 42);
    expect(fetch).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8787/api/hermes/v1/collaboration/threads/thread%201/messages?after=42&limit=100",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Id": "ws" }),
      }),
    );
    await client.collaborationThreads("channel 1", { include_archived: true });
    expect(fetch).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8787/api/hermes/v1/collaboration/channels/channel%201/threads?include_archived=true",
      expect.anything(),
    );
    const body = {
      channel_id: "channel",
      thread_id: "thread",
      body: "Message",
      mentions: ["alice"],
      dry_run: true,
      idempotency_key: "stable",
    };
    await client.collaborationSendMessage(body);
    await client.collaborationSendMessage({ ...body, dry_run: false });
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/collaboration/messages"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ...body, dry_run: false }),
      }),
    );
    await client.collaborationArchive("messages", "m", {
      expected_version: 3,
      idempotency_key: "archive",
      dry_run: true,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/collaboration/messages/m/archive"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
