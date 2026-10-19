import {
  collaborationHash,
  safeCollaborationReturn,
  type CollaborationRoute,
} from "./deliveryCollaboration";
import {
  discussionSource,
  fetchDiscussion,
  fetchDiscussionMessage,
  type DiscussionAdoption,
} from "./deliveryDiscussions";
export function requirementEditSourcePatch(
  source?: DiscussionAdoption,
): Partial<CollaborationRoute> {
  return {
    sourceThread: source?.reference.thread_id || "",
    sourceMessage: source?.reference.message_id || "",
    sourceThreadVersion: source
      ? String(source.reference.expected_thread_version)
      : "",
    sourceMessageRevision: source
      ? String(source.reference.message_revision)
      : "",
    sourceResolution: source?.reference.resolution_event_id || "",
    sourceField: source?.field || "",
  };
}
export function requirementAdoptionHref(
  projectId: string,
  source: DiscussionAdoption,
  background: string,
) {
  if (
    source.thread.subject.kind !== "requirement" ||
    source.thread.subject.missing
  )
    throw new Error("discussion_subject_missing");
  const params = new URLSearchParams({
    project_id: projectId,
    view: "list",
    requirement: source.thread.subject.id,
    detail: "details",
  });
  const back = safeCollaborationReturn(background, projectId);
  if (back) params.set("collaboration_return", back);
  return collaborationHash(`#/dev-flow?${params}`, {
    edit: "1",
    ...requirementEditSourcePatch(source),
  });
}
export function hasRequirementAdoption(route: CollaborationRoute) {
  return !!(
    route.sourceThread ||
    route.sourceMessage ||
    route.sourceThreadVersion ||
    route.sourceMessageRevision ||
    route.sourceResolution ||
    route.sourceField
  );
}
export async function fetchRequirementAdoption(
  projectId: string,
  id: string,
  route: CollaborationRoute,
  signal?: AbortSignal,
): Promise<DiscussionAdoption> {
  if (
    !route.sourceThread ||
    !route.sourceMessage ||
    !route.sourceResolution ||
    !/^\d+$/.test(route.sourceThreadVersion) ||
    !/^\d+$/.test(route.sourceMessageRevision) ||
    !["description", "acceptance_criteria"].includes(route.sourceField)
  )
    throw new Error("discussion_source_changed");
  const detail = await fetchDiscussion(projectId, route.sourceThread, signal);
  if (
    detail.thread.subject.kind !== "requirement" ||
    detail.thread.subject.id !== id ||
    detail.thread.subject.missing
  )
    throw new Error("discussion_scope_changed");
  const message = await fetchDiscussionMessage(
    projectId,
    route.sourceThread,
    route.sourceMessage,
    signal,
  );
  const reference = discussionSource(detail.thread, message.message);
  if (
    message.thread_version !== detail.thread.version ||
    reference.expected_thread_version !== Number(route.sourceThreadVersion) ||
    reference.message_revision !== Number(route.sourceMessageRevision) ||
    reference.resolution_event_id !== route.sourceResolution
  )
    throw new Error("discussion_source_changed");
  return {
    reference,
    thread: detail.thread,
    message: message.message,
    field: route.sourceField as DiscussionAdoption["field"],
  };
}
