import type { OrganizationAccessFinding } from "./types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

type AccessFindingField = "title" | "description";

export function translateAccessFinding(t: Translate, finding: OrganizationAccessFinding, field: AccessFindingField) {
  return t(`page.organization.accessFinding.${finding.kind}.${field}`, {
    defaultValue: finding[field],
    projectName: finding.params?.projectName || finding.project_name || finding.project_id || "-",
    username: finding.params?.username || finding.owner || "-",
    role: finding.params?.role || "-",
    status: finding.params?.status || "-",
    count: finding.params?.count ?? "-",
    userRoles: finding.params?.userRoles || "-",
    projectRoles: finding.params?.projectRoles || "-",
  });
}

export function translateAccessKind(t: Translate, kind: string) {
  return t(`page.organization.accessKindMap.${kind}`, { defaultValue: kind });
}

export function translateAccessSeverity(t: Translate, severity: string) {
  return t(`page.organization.accessSeverityMap.${severity}`, { defaultValue: severity });
}

export function translateAccessRecommendation(t: Translate, recommendation: string, index: number) {
  return t(`page.organization.accessRecommendation.${index}`, { defaultValue: recommendation });
}
