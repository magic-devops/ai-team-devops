import { describe, expect, it, vi } from "vitest";
import {
  dailyDeliveryHistory,
  filterRequirements,
  prepareDeliveryIntent,
  requirementProgress,
  safeEvidenceUrl,
  saveDelivery,
  type DeliveryRequirement,
} from "./delivery";
import { request } from "./http";
import { deliveryTranslations } from "../i18n/delivery";
vi.mock("./http", () => ({ request: vi.fn() }));

describe("delivery interactions", () => {
  it("pins form revision and retry identity across refreshes, while changed input gets a new identity", () => {
    const first = prepareDeliveryIntent(
      { version: 4, key: "original-key" },
      "requirement.create",
      { title: "Search" },
    );
    const retry = prepareDeliveryIntent(first, "requirement.create", {
      title: "Search",
    });
    expect(retry).toEqual(first);
    const changed = prepareDeliveryIntent(retry, "requirement.create", {
      title: "Search v2",
    });
    expect(changed.version).toBe(4);
    expect(changed.key).not.toBe(first.key);
  });
  it("sends project, expected revision and idempotency in the actual request", async () => {
    await saveDelivery(
      "p-one",
      "tasks.plan",
      { requirement_id: "r-one", items: [{ title: "Build" }] },
      7,
      "retry-key",
    );
    const [, init] = vi.mocked(request).mock.calls.at(-1)!;
    expect(init?.headers).toEqual({ "X-Project-Id": "p-one" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expected_version: 7,
      idempotency_key: "retry-key",
      action: "tasks.plan",
    });
  });
  it("combines filters and distinguishes task completion from acceptance", () => {
    const item = {
      id: "r",
      title: "Search",
      description: "Find tasks",
      tasks_total: 2,
      tasks_done: 1,
      flow: { stage: "testing", owner_id: "agent" },
    } as DeliveryRequirement;
    expect(filterRequirements([item], "SEARCH", "testing", "agent")).toEqual([
      item,
    ]);
    expect(filterRequirements([item], "Search", "release", "agent")).toEqual(
      [],
    );
    expect(requirementProgress(item)).toBe(50);
    expect(
      requirementProgress({ ...item, tasks_total: 0, tasks_done: 0 }),
    ).toBe(0);
  });
  it("does not render executable or credential-bearing evidence links", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "https://user:pass@example.org/report",
      "//example.org",
    ])
      expect(safeEvidenceUrl(url)).toBeUndefined();
    expect(safeEvidenceUrl("https://example.org/report")).toBe(
      "https://example.org/report",
    );
  });
  it("shows only observed dates and takes the last observation per day", () => {
    const point = { requirements: 3, accepted: 1, released: 0 };
    const history = [
      { ...point, at: "2026-10-10T10:00:00Z" },
      { ...point, at: "2026-10-10T11:00:00Z", accepted: 2 },
      { ...point, at: "2026-10-12T11:00:00Z" },
    ];
    const result = dailyDeliveryHistory(history);
    expect(result).toEqual([history[1], history[2]]);
  });
  it("provides the same UI vocabulary in all supported languages", () => {
    const keys = (o: object): string[] =>
      Object.entries(o)
        .flatMap(([k, v]) =>
          typeof v === "object" ? keys(v).map((child) => `${k}.${child}`) : [k],
        )
        .sort();
    expect(keys(deliveryTranslations["en-US"])).toEqual(
      keys(deliveryTranslations["zh-CN"]),
    );
    expect(keys(deliveryTranslations["ja-JP"])).toEqual(
      keys(deliveryTranslations["zh-CN"]),
    );
  });
});
