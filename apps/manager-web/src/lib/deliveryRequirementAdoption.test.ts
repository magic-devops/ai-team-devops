import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requirementAdoptionHref,
  fetchRequirementAdoption,
} from "./deliveryRequirementAdoption";
import { parseCollaborationRoute } from "./deliveryCollaboration";
import {
  fetchDiscussion,
  fetchDiscussionMessage,
  type DiscussionAdoption,
} from "./deliveryDiscussions";
vi.mock("./deliveryDiscussions", async () => ({
  ...(await vi.importActual<typeof import("./deliveryDiscussions")>(
    "./deliveryDiscussions",
  )),
  fetchDiscussion: vi.fn(),
  fetchDiscussionMessage: vi.fn(),
}));
const source = {
  reference: {
    thread_id: "D",
    expected_thread_version: 3,
    resolution_event_id: "E",
    message_id: "M",
    message_revision: 2,
  },
  field: "description",
  thread: {
    id: "D",
    version: 3,
    state: "resolved",
    subject: { kind: "requirement", id: "R", missing: false },
    current_resolution: { event_id: "E", message_id: "M", message_revision: 2 },
  },
  message: {
    id: "M",
    thread_id: "D",
    revision: 2,
    state: "active",
    body: "ADOPTED_PRIVATE_BODY",
  },
} as unknown as DiscussionAdoption;
beforeEach(() => {
  vi.mocked(fetchDiscussion).mockReset();
  vi.mocked(fetchDiscussionMessage).mockReset();
  vi.mocked(fetchDiscussion).mockResolvedValue({
    project_id: "P",
    thread: source.thread,
  } as any);
  vi.mocked(fetchDiscussionMessage).mockResolvedValue({
    project_id: "P",
    thread_id: "D",
    thread_version: 3,
    message: source.message,
  });
});
describe("one requirement adoption route and exact source review", () => {
  const href = () =>
    requirementAdoptionHref(
      "P",
      source,
      "#/dev-flow?project_id=P&view=discussions&discussion_thread=D",
    );
  it("routes to the single recovery host with only exact source metadata and a legal return", () => {
    const target = href(),
      params = new URLSearchParams(target.split("?")[1]);
    expect(params.get("requirement")).toBe("R");
    expect(params.get("requirement_edit")).toBe("1");
    expect(params.get("collaboration_return")).toContain("discussion_thread=D");
    expect(target).not.toContain("ADOPTED_PRIVATE_BODY");
    expect(parseCollaborationRoute(target).sourceMessageRevision).toBe("2");
  });
  it("rereads the exact chosen conclusion before using it as a draft source", async () => {
    const result = await fetchRequirementAdoption(
      "P",
      "R",
      parseCollaborationRoute(href()),
    );
    expect(result.reference).toEqual(source.reference);
    expect(result.message.body).toBe("ADOPTED_PRIVATE_BODY");
    expect(fetchDiscussionMessage).toHaveBeenCalledWith(
      "P",
      "D",
      "M",
      undefined,
    );
  });
  it("rejects changed resolution and another requirement without silently dropping source", async () => {
    vi.mocked(fetchDiscussion).mockResolvedValueOnce({
      project_id: "P",
      thread: { ...source.thread, version: 4 },
    } as any);
    await expect(
      fetchRequirementAdoption("P", "R", parseCollaborationRoute(href())),
    ).rejects.toThrow("discussion_source_changed");
    await expect(
      fetchRequirementAdoption("P", "other", parseCollaborationRoute(href())),
    ).rejects.toThrow("discussion_scope_changed");
  });
});
