import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import { prepareDeliveryIntent, saveDelivery } from "./delivery";
import {
  prepareRequirementChange,
  saveRequirementChange,
} from "./deliveryCollaboration";

vi.mock("./http", () => ({ request: vi.fn() }));
const source = {
  thread_id: "D",
  expected_thread_version: 3,
  resolution_event_id: "E",
  message_id: "M",
  message_revision: 2,
};
beforeEach(() => vi.mocked(request).mockReset());
describe("fixed discussion source business intents", () => {
  it("rotates the request key when only the selected source changes", () => {
    const first = prepareDeliveryIntent(
      { version: 7, key: "original" },
      "task.update",
      { id: "T", description: "same" },
      source,
    );
    const same = prepareDeliveryIntent(
      first,
      "task.update",
      { id: "T", description: "same" },
      { ...source },
    );
    expect(same.key).toBe("original");
    expect(
      prepareDeliveryIntent(
        same,
        "task.update",
        { id: "T", description: "same" },
        { ...source, message_revision: 3 },
      ).key,
    ).not.toBe("original");
    expect(
      prepareDeliveryIntent(same, "task.update", {
        id: "T",
        description: "same",
      }).key,
    ).not.toBe("original");
  });
  it("sends the source only as a root command field for all five business actions", async () => {
    for (const action of [
      "requirement.update",
      "task.update",
      "tasks.plan",
      "issue.promote",
      "issue.diagnosis.adopt",
    ] as const) {
      await saveDelivery("P", action, { id: "target" }, 7, "fixed-key", source);
      const body = JSON.parse(
        vi.mocked(request).mock.calls.at(-1)![1]!.body as string,
      );
      expect(body).toEqual({
        action,
        payload: { id: "target" },
        expected_version: 7,
        idempotency_key: "fixed-key",
        source_reference: source,
      });
    }
  });
  it("keeps requirement previews and submission tied to the same source", async () => {
    const command = prepareRequirementChange(
      { version: 7, key: "key" },
      "business-basis",
      { id: "R", description: "draft" },
      true,
      "preview-basis",
      source,
    );
    expect(command.source_reference).toEqual(source);
    await saveRequirementChange(
      "P",
      command.intent,
      command.payload,
      command.source_reference,
    );
    expect(
      JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string),
    ).toMatchObject({
      source_reference: source,
      payload: {
        requirement_basis: "business-basis",
        change_preview_basis: "preview-basis",
      },
    });
  });
});
