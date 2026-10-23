import { routeProjectId } from "./projectPortfolioRoute";

export function projectMembersHash(projectId: string) {
  return `#/projects/members?${new URLSearchParams({ project_id: projectId })}`;
}
export function projectTeamHash(projectId: string) {
  return `#/dev-flow?${new URLSearchParams({ view: "team", project_id: projectId })}`;
}
export function requestedMemberProject(hash: string): string {
  const path = hash.split("?")[0];
  if (path !== "#/projects/members" && path !== "#/organization/project-members") return "";
  if (new URLSearchParams(hash.split("?")[1]).getAll("project_id").length !== 1) return "";
  return routeProjectId(hash);
}
