import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  discussionSource,
  fetchDiscussionReference,
  fetchDiscussionPage,
  fetchDiscussionMessage,
  prepareDiscussionCommand,
  submitDiscussionCommand,
  discussionHash,
  parseDiscussionRoute,
  type DiscussionThread,
  type DiscussionMessage,
} from "./deliveryDiscussions";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());
const thread = {
  id: "D",
  state: "resolved",
  version: 3,
  subject: { kind: "task", id: "T", missing: false },
  current_resolution: {
    event_id: "E",
    message_id: "M",
    message_revision: 2,
    note: "",
  },
} as DiscussionThread;
const message = {
  id: "M",
  thread_id: "D",
  revision: 2,
  state: "active",
} as DiscussionMessage;
describe("bounded exact object discussions", () => {
  it("does not create an adoption reference from a message belonging to another thread", () => {
    expect(discussionSource(thread, message)).toMatchObject({
      thread_id: "D",
      message_revision: 2,
    });
    expect(() =>
      discussionSource(thread, { ...message, thread_id: "other" }),
    ).toThrow("discussion_source_changed");
  });
  it("validates the exact reference returned by the server before selecting its trusted basis", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      reference: {
        kind: "task",
        id: "other",
        field: "description",
        status: "available",
        source_content_basis: "a".repeat(64),
        text: "secret",
      },
    });
    await expect(
      fetchDiscussionReference("P", {
        kind: "task",
        id: "T",
        field: "description",
      }),
    ).rejects.toThrow("discussion_scope_changed");
  });
  it("reads only the current window and keeps explicit scope and opaque cursor", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      scope: { subject_kind: "task", subject_id: "T", state: "open" },
      items: [],
    });
    await fetchDiscussionPage(
      "P",
      { kind: "task", id: "T" },
      "open",
      "opaque/+?",
    );
    expect(vi.mocked(request).mock.calls[0]).toEqual([
      "/api/v1/delivery/discussions?limit=20&cursor=opaque%2F%2B%3F&state=open&subject_kind=task&subject_id=T",
      { headers: { "X-Project-Id": "P" }, signal: undefined },
    ]);
  });
  it("rejects mismatched exact message responses", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "P",
      thread_id: "D",
      thread_version: 3,
      message: { ...message, thread_id: "other" },
    });
    await expect(fetchDiscussionMessage("P", "D", "M")).rejects.toThrow(
      "discussion_scope_changed",
    );
  });
  it("freezes submitted text and replays the same request key only for the same input", async () => {
    const body = { body: "first", parent_message_id: "parent" };
    const pending = prepareDiscussionCommand(
      { operation: "reply", threadId: "D", body },
      4,
    );
    body.body = "typed later";
    expect(pending.command.body.body).toBe("first");
    expect(prepareDiscussionCommand(pending.command, 4, pending).key).toBe(
      pending.key,
    );
    expect(
      prepareDiscussionCommand(
        { operation: "reply", threadId: "D", body },
        5,
        pending,
      ).key,
    ).not.toBe(pending.key);
    vi.mocked(request).mockResolvedValue({ project_id: "P", thread_id: "D" });
    await submitDiscussionCommand("P", pending);
    expect(
      JSON.parse(vi.mocked(request).mock.calls[0][1]!.body as string),
    ).toEqual({
      body: "first",
      parent_message_id: "parent",
      idempotency_key: pending.key,
    });
  });
  it("keeps exact thread/message deep links and explicitly resets changed filter windows", () => {
    const source =
      "#/dev-flow?project_id=P&view=discussions&discussion_state=open&discussion_page=3&discussion_cursor=older%2F%2B&discussion_thread=D&discussion_message=M&discussion_message_page=2";
    expect(
      parseDiscussionRoute(discussionHash(source, { state: "resolved" })),
    ).toMatchObject({
      thread: "D",
      message: "M",
      state: "resolved",
      cursor: "",
      page: 1,
    });
    expect(
      parseDiscussionRoute(discussionHash(source, { thread: "E" })),
    ).toMatchObject({ thread: "E", message: "", messagePage: 1 });
  });
});
