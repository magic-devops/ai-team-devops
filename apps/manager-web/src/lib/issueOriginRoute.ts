import { safeExecutionReturn } from "./executionCommands";

export function safeIssueOriginReturn(
  hash: string,
  projectId: string,
): string | null {
  if (
    !safeExecutionReturn(hash) ||
    !/^#\/dev-flow\?/.test(hash) ||
    /[\u0000-\u001f\u007f\\]/.test(hash)
  )
    return null;
  const params = new URLSearchParams(hash.split("?")[1]);
  if (
    params.getAll("project_id").length !== 1 ||
    params.get("project_id") !== projectId ||
    params.getAll("view").length !== 1 ||
    params.get("view") !== "issues" ||
    params.getAll("issue").length !== 1 ||
    !params.get("issue") ||
    params.get("issue")!.length > 200
  )
    return null;
  return hash;
}
