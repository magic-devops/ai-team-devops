import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDeliveryQuality,
  fetchDeliveryReleases,
  fetchDeliveryRelease,
  previewDeliveryRelease,
  prepareReleaseCandidate,
  submitReleaseCommand,
  releaseInput,
  type ReleaseDraft,
} from "./deliveryRelease";
import { request } from "./http";
import { releasePreview, releaseForm } from "./deliveryReleaseFixtures";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());
describe("fixed release API and candidate intent", () => {
  it("uses repeated explicit scope fields and overrides conflicting project headers", async () => {
    const signal = new AbortController().signal;
    await fetchDeliveryQuality(
      "P",
      { requirement_ids: ["R-1", "R-2"], task_ids: ["T-one"] },
      signal,
    );
    const [url, init] = vi.mocked(request).mock.calls[0];
    expect(
      new URLSearchParams(String(url).split("?")[1]).getAll("requirement_ids"),
    ).toEqual(["R-1", "R-2"]);
    expect(init).toEqual({
      signal,
      headers: {
        "X-Project-Id": "P",
        "X-Project-Code": "P",
        "X-Business-Code": "",
      },
    });
    await fetchDeliveryQuality("P", { requirement_ids: [], task_ids: [] });
    expect(vi.mocked(request).mock.calls[1][0]).toBe(
      "/api/v1/delivery/quality",
    );
    await fetchDeliveryReleases("P", signal);
    await fetchDeliveryRelease("P", "REL&1", signal);
    expect(vi.mocked(request).mock.calls.at(-1)?.[0]).toBe(
      "/api/v1/delivery/releases/REL%261",
    );
  });
  it("keeps original signed envelope bytes intact and pins CAS and key", async () => {
    const envelope = '{"payload":"one","payload":"two", "signatures":[]}';
    await submitReleaseCommand(
      "P",
      "release.ci.import",
      { envelope, requirement_ids: ["R-1"], task_ids: [] },
      { version: 7, key: "original" },
    );
    const body = JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      action: "release.ci.import",
      expected_version: 7,
      idempotency_key: "original",
      payload: { envelope },
    });
  });
  it("submits only the exact previewed candidate and reuses identity for unknown results", async () => {
    const draft: ReleaseDraft = {
      projectId: "P",
      form: structuredClone(releaseForm),
      preview: releasePreview,
      intent: { version: 7, key: "candidate-key" },
    };
    const first = prepareReleaseCandidate(draft);
    expect(first.payload).toEqual({
      ...releaseInput(releaseForm),
      preview_basis: "a".repeat(64),
    });
    expect(prepareReleaseCandidate(first.draft)).toMatchObject({
      key: "candidate-key",
      version: 7,
    });
    for (const patch of [
      { version: "v2" },
      { environment: "production" },
      { artifact_url: "https://ci.example/other.zip" },
      { ci_evidence_id: "CI-other" },
      { task_ids: [] },
      { rollback_plan: "Other rollback" },
    ])
      expect(() =>
        prepareReleaseCandidate({
          ...draft,
          form: { ...draft.form, ...patch },
        }),
      ).toThrow();
    expect(() =>
      prepareReleaseCandidate({ ...draft, projectId: "other" }),
    ).toThrow();
    expect(() =>
      prepareReleaseCandidate({
        ...draft,
        preview: {
          ...releasePreview,
          permissions: { ...releasePreview.permissions, can_create: false },
        },
      }),
    ).toThrow();
  });
  it("requires explicit nonempty scope and a credential-free HTTPS artifact location", async () => {
    for (const form of [
      { ...releaseForm, requirement_ids: [], task_ids: [] },
      { ...releaseForm, artifact_url: "http://ci.example/pkg" },
      { ...releaseForm, artifact_url: "https://user:password@ci.example/pkg" },
      { ...releaseForm, version: " " },
    ])
      expect(() => releaseInput(form)).toThrow();
    await previewDeliveryRelease("P", releaseForm);
    expect(vi.mocked(request).mock.calls.at(-1)?.[0]).toBe(
      "/api/v1/delivery/release-preview",
    );
  });
});
