import { fetchTaskDetail, fetchRequirementDetail } from "./deliveryQuery";
import { fetchDeliveryIssue } from "./deliveryIssue";
import { safeCollaborationReturn } from "./deliveryCollaboration";
import {
  discussionHash,
  type DiscussionScope,
  type DiscussionSourceLink,
} from "./deliveryDiscussions";
export function currentDiscussionHash() {
  return typeof location === "undefined" ? "" : location.hash;
}
export function discussionThreadHref(
  projectId: string,
  threadId: string,
  messageId = "",
  revision?: number,
  background = currentDiscussionHash(),
) {
  const params = new URLSearchParams({
    project_id: projectId,
    view: "discussions",
    discussion_thread: threadId,
  });
  if (messageId) params.set("discussion_message", messageId);
  if (revision) params.set("discussion_revision", String(revision));
  const back = safeCollaborationReturn(background, projectId);
  if (back) params.set("collaboration_return", back);
  return `#/dev-flow?${params}`;
}
export async function discussionObjectHref(
  projectId: string,
  target: DiscussionScope,
  background: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ project_id: projectId });
  if (target.kind === "task") {
    const detail = await fetchTaskDetail(projectId, target.id, signal);
    if (detail.project_id !== projectId || detail.task.id !== target.id)
      throw new Error("discussion_scope_changed");
    params.set("task", detail.task.id);
    params.set("view", detail.task.req_id ? "list" : "timeline");
    if (detail.task.req_id) {
      params.set("requirement", detail.task.req_id);
      params.set("detail", "tasks");
    }
  } else if (target.kind === "requirement") {
    const detail = await fetchRequirementDetail(projectId, target.id, signal);
    if (detail.project_id !== projectId || detail.requirement.id !== target.id)
      throw new Error("discussion_scope_changed");
    params.set("view", "list");
    params.set("requirement", target.id);
    params.set("detail", "details");
  } else {
    const detail = await fetchDeliveryIssue(projectId, target.id, signal);
    if (detail.project_id !== projectId || detail.issue.id !== target.id)
      throw new Error("discussion_scope_changed");
    params.set("view", "issues");
    params.set("issue", target.id);
  }
  const back = safeCollaborationReturn(background, projectId);
  if (back) params.set("collaboration_return", back);
  return `#/dev-flow?${params}`;
}
export function sourceLinkHref(
  projectId: string,
  link: DiscussionSourceLink,
  background = currentDiscussionHash(),
) {
  return discussionThreadHref(
    projectId,
    link.thread_id,
    link.message_id,
    link.message_revision,
    background,
  );
}
export function updateDiscussionHash(
  patch: Parameters<typeof discussionHash>[1],
) {
  const href = discussionHash(location.hash, patch);
  history.pushState(null, "", href);
  window.dispatchEvent(new Event("hashchange"));
  return href;
}
