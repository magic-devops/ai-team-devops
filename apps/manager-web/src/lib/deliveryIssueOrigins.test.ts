import { beforeEach, describe, expect, it, vi } from "vitest";
import * as issueApi from "./deliveryIssue";
import {
  issueDetailFixture,
  issueOriginFixture as origin,
} from "./deliveryIssueFixtures";
import { request } from "./http";

vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());

describe("bounded issue origin API", () => {
  it("reads an independent origin page with a fixed limit and explicit project", async () => {
    const page = {
      project_id: "P",
      issue_id: "ISS-one",
      issue_available: true,
      as_of: "2026-10-19T00:00:00Z",
      items: [origin],
      total: 21,
      limit: 20,
      next_cursor: "next",
    };
    vi.mocked(request).mockResolvedValue(page);
    expect(typeof issueApi.fetchIssueOrigins).toBe("function");
    expect(await issueApi.fetchIssueOrigins("P", "ISS-one")).toEqual(page);
    expect(vi.mocked(request).mock.calls[0]).toEqual([
      "/api/v1/delivery/issues/ISS-one/origins?limit=20",
      {
        signal: undefined,
        headers: {
          "X-Project-Id": "P",
          "X-Project-Code": "P",
          "X-Business-Code": "",
        },
      },
    ]);
    await issueApi.fetchIssueOrigins("P", "ISS-one", {
      cursor: "fixed window",
      limit: 100,
    });
    expect(vi.mocked(request).mock.calls[1][0]).toBe(
      "/api/v1/delivery/issues/ISS-one/origins?limit=100&cursor=fixed+window",
    );
    expect(
      vi.mocked(request).mock.calls.every(([, init]) => !init?.method),
    ).toBe(true);
  });
  it("rejects a foreign origin response and never falls back from an unavailable exact ID", async () => {
    expect(typeof issueApi.fetchIssueOrigin).toBe("function");
    vi.mocked(request).mockResolvedValue({
      project_id: "other",
      issue_id: "ISS-one",
      origin,
    });
    await expect(
      issueApi.fetchIssueOrigin("P", "ISS-one", origin.id),
    ).rejects.toThrow("scopeChanged");
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      issue_id: "ISS-one",
      origin: { ...origin, id: "another" },
    });
    await expect(
      issueApi.fetchIssueOrigin("P", "ISS-one", origin.id),
    ).rejects.toThrow("scopeChanged");
    expect(vi.mocked(request).mock.calls).toHaveLength(2);
    for (const limit of [0, 101, 1.5])
      await expect(
        issueApi.fetchIssueOrigins("P", "ISS-one", { limit }),
      ).rejects.toThrow();
  });
});

describe("exact selected origins", () => {
  it("freezes a selected page-two origin even when it is absent from default issue evidence", () => {
    const first = issueApi.prepareDiagnosisGeneration(
      issueDetailFixture,
      {
        generator: "rules",
        selected_evidence_ids: [origin.evidence.id, "issue:ISS-one"],
        instructions: "Compare actual operation",
      },
      undefined,
      false,
      () => "original-origin-request",
      [structuredClone(origin.evidence)],
    );
    expect(first.body.selected_evidence_ids).toEqual([
      origin.evidence.id,
      "issue:ISS-one",
    ]);
    expect(first.body.idempotency_key).toBe("original-origin-request");
    expect(first.evidence.map((item) => item.id)).toEqual([
      origin.evidence.id,
      "issue:ISS-one",
    ]);
    expect(first.evidence[0].target.receipt_id).toBe("receipt-one");
    expect(first.evidence[0]).not.toHaveProperty("event_json");
  });
  it("keeps the 32-item total limit and refuses foreign or unavailable origin evidence", () => {
    const generate = (
      evidence: any[],
      ids = ["issue:ISS-one", origin.evidence.id],
    ) =>
      issueApi.prepareDiagnosisGeneration(
        issueDetailFixture,
        { generator: "rules", selected_evidence_ids: ids, instructions: "" },
        undefined,
        false,
        () => "key",
        evidence,
      );
    expect(() => generate([{ ...origin.evidence, missing: true }])).toThrow(
      "evidenceRequired",
    );
    expect(() =>
      generate([
        {
          ...origin.evidence,
          target: { ...origin.evidence.target, project_id: "other" },
        },
      ]),
    ).toThrow("evidenceRequired");
    const thirtyTwo = Array.from({ length: 32 }, (_, index) => ({
      ...origin.evidence,
      id: `event:origin-${index}`,
      target: { ...origin.evidence.target, origin_id: `origin-${index}` },
    }));
    expect(() =>
      generate(thirtyTwo, [
        "issue:ISS-one",
        ...thirtyTwo.map((item) => item.id),
      ]),
    ).toThrow("evidenceRequired");
  });
  it("navigates to the exact receipt with project and issue return context, never the source string", () => {
    const background =
      "#/dev-flow?view=issues&project_id=P&issue=ISS-one&issue_origins=1&issue_origin_cursor=page-two";
    const href = issueApi.issueEvidenceHref(
      "P",
      origin.evidence.target,
      background,
    );
    expect(href).toBeTruthy();
    const params = new URLSearchParams(href!.split("?")[1]);
    expect(href!.startsWith("#/intelligence/events?")).toBe(true);
    expect(params.get("event_receipt")).toBe("receipt-one");
    expect(params.get("project_id")).toBe("P");
    expect(params.get("issue_return")).toBe(background);
    expect(href).not.toContain("untrusted.example");
  });
});
