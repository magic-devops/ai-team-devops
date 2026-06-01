import { describe, expect, it } from "vitest";
import { flattenCapabilityGrants, type CapabilityGrant } from "./lib/capabilities";

describe("flattenCapabilityGrants", () => {
  it("flattens page-level capability actions for permission gates and agents", () => {
    const items: CapabilityGrant[] = [
      {
        id: "vibe",
        name: "AI 会话",
        domain: "ai",
        path: "#/vibe",
        capability: "ai.vibe",
        permission: {
          read: ["developer"],
          write: ["developer"],
          admin: ["super_admin"],
        },
        allowed: {
          read: true,
          write: true,
          admin: false,
        },
        visible: true,
        actions: [
          { id: "read", name: "查看", capability: "ai.vibe.read", roles: ["developer"] },
          { id: "write", name: "编辑", capability: "ai.vibe.write", roles: ["developer"] },
          { id: "admin", name: "管理", capability: "ai.vibe.admin", roles: ["super_admin"] },
        ],
      },
    ];

    const grants = flattenCapabilityGrants(items, "developer");

    expect(grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "ai.vibe.write",
          parent_capability: "ai.vibe",
          action_id: "write",
          source: "action",
          allowed: { write: true },
        }),
        expect.objectContaining({
          capability: "ai.vibe.admin",
          parent_capability: "ai.vibe",
          action_id: "admin",
          source: "action",
          allowed: { admin: false },
        }),
      ]),
    );
  });
});
