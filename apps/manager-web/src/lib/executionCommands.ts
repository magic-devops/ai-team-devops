export type ExecutionCommandDraft = {
  id: string;
  title: string;
  executable: string;
  arguments: string[];
  expected_exit_code: number;
  timeout_seconds: number;
  test: boolean;
};
export type ExecutionCommand = {
  id: string;
  title: string;
  kind: "command";
  argv: string[];
  expected_exit_code: number;
  timeout_seconds: number;
};
export const commandDraft = (
  id: string,
  executable = "",
): ExecutionCommandDraft => ({
  id,
  title: "",
  executable,
  arguments: [],
  expected_exit_code: 0,
  timeout_seconds: 60,
  test: true,
});
export function commandNodes(
  drafts: ExecutionCommandDraft[],
): ExecutionCommand[] {
  if (!drafts.length || drafts.length > 32) throw new Error("commandCount");
  const ids = new Set<string>();
  return drafts.map((row) => {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(row.id) ||
      row.id.startsWith("agent_") ||
      ids.has(row.id)
    )
      throw new Error("commandId");
    ids.add(row.id);
    if (
      !row.executable.trim() ||
      row.executable.includes("\0") ||
      row.arguments.length > 127 ||
      row.arguments.some((arg) => !arg || arg.includes("\0"))
    )
      throw new Error("commandExecutable");
    if (
      !Number.isInteger(row.timeout_seconds) ||
      row.timeout_seconds < 1 ||
      row.timeout_seconds > 3600 ||
      !Number.isInteger(row.expected_exit_code) ||
      row.expected_exit_code < 0 ||
      row.expected_exit_code > 255
    )
      throw new Error("commandBounds");
    return {
      id: row.id,
      title: row.title,
      kind: "command",
      argv: [row.executable.trim(), ...row.arguments],
      expected_exit_code: row.expected_exit_code,
      timeout_seconds: row.timeout_seconds,
    };
  });
}
export function safeExecutionReturn(value: string): string | null {
  if (
    !/^#\/(dev-flow|tasks\/execution)(?:\?|$)/.test(value) ||
    value.length > 4000
  )
    return null;
  const params = new URLSearchParams(value.split("?")[1]);
  return params.has("return_to") ? null : value;
}
export function executionIssueHref(issueId: string, background: string) {
  const params = new URLSearchParams({ view: "issues", issue: issueId });
  const safe = safeExecutionReturn(background);
  if (safe) params.set("return_to", safe);
  return `#/dev-flow?${params}`;
}
