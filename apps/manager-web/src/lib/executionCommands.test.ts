import { describe, expect, it } from "vitest";
import {
  commandDraft,
  commandNodes,
  executionIssueHref,
  safeExecutionReturn,
} from "./executionCommands";

describe("explicit external execution drafts", () => {
  it("preserves argument boundaries without invoking shell syntax", () => {
    const nodes = commandNodes([
      {
        ...commandDraft("tests"),
        executable: "python",
        arguments: ["-c", "print('a b')", "$(no-shell)"],
      },
    ]);
    expect(nodes[0].argv).toEqual([
      "python",
      "-c",
      "print('a b')",
      "$(no-shell)",
    ]);
    expect(nodes[0]).toMatchObject({
      id: "tests",
      kind: "command",
      expected_exit_code: 0,
      timeout_seconds: 60,
    });
  });
  it("rejects duplicate, reserved, empty and oversized commands before preview", () => {
    for (const drafts of [
      [],
      [commandDraft("tests")],
      [commandDraft("agent_1", "python")],
      [commandDraft("tests", "python"), commandDraft("tests", "python")],
      [{ ...commandDraft("tests", "python"), timeout_seconds: 0 }],
      [{ ...commandDraft("tests", "python"), expected_exit_code: 0.5 }],
    ])
      expect(() => commandNodes(drafts)).toThrow();
    expect(commandNodes([commandDraft("tests", "python")])[0].argv).toEqual([
      "python",
    ]);
    expect(() =>
      commandNodes([{ ...commandDraft("tests", "python"), arguments: [""] }]),
    ).toThrow();
  });
  it("links the exact issue and restores a local delivery background only", () => {
    const background = "#/dev-flow?view=team&member_id=lead&task=T-one";
    const href = executionIssueHref("ISS-one", background);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("issue")).toBe("ISS-one");
    expect(safeExecutionReturn(params.get("return_to") || "")).toBe(background);
    for (const unsafe of [
      "https://example.test",
      "javascript:alert(1)",
      "#/settings",
      "#/dev-flow?return_to=bad",
    ])
      expect(safeExecutionReturn(unsafe)).toBeNull();
  });
  it("keeps the standalone task and its safe list return when opening a failure issue", () => {
    const list = "#/tasks/execution?q=verify&status=pending";
    const task = `#/tasks/execution?task_id=T-one&return_to=${encodeURIComponent(list)}`;
    const params = new URLSearchParams(executionIssueHref("ISS-one", task).split("?")[1]);
    expect(params.get("return_to")).toBe(task);
    expect(safeExecutionReturn(task)).toBe(task);
    expect(safeExecutionReturn(`#/tasks/execution?task_id=T-one&return_to=${encodeURIComponent("https://example.test")}`)).toBeNull();
  });
});
