import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { appShellApi } from "../lib/appShellApi";
import { getBusinessCode, getProjectId, getTenantCode, getToken, setWorkspaceScope } from "../lib/authStorage";

type ProjectRow = {
  id: string;
  name: string;
  tenant_code?: string;
  business_id?: string;
  business_code?: string;
  business_name?: string;
  project_code?: string;
};

type BusinessRow = {
  id: string;
  name: string;
  tenant_code?: string;
  business_code?: string;
};

export function ProjectSelector() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const currentProjectId = getProjectId();

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: appShellApi.projects,
    enabled: authed,
  });
  const businesses = useQuery({
    queryKey: ["businesses"],
    queryFn: appShellApi.businesses,
    enabled: authed,
  });
  const me = useQuery({
    queryKey: ["authMe"],
    queryFn: appShellApi.authMe,
    enabled: authed,
    retry: false,
  });

  const projectItems = (projects.data ?? []) as ProjectRow[];
  const businessItems = (businesses.data ?? []) as BusinessRow[];
  const currentProject = projectItems.find((item) => item.id === currentProjectId);
  const tenantCode = String(currentProject?.tenant_code || getTenantCode() || me.data?.tenant_slug || me.data?.tenant_id || "").trim();
  const currentBusinessCode = String(currentProject?.business_code || currentProject?.business_id || getBusinessCode() || "").trim();
  const visibleProjects = useMemo(
    () => projectItems.filter((item) => !currentBusinessCode || item.business_id === currentBusinessCode || item.business_code === currentBusinessCode),
    [currentBusinessCode, projectItems],
  );

  const syncProjectScope = (project: ProjectRow | null, businessCode = "") => {
    const nextBusinessCode = String(project?.business_code || project?.business_id || businessCode || "").trim();
    setWorkspaceScope({
      tenantCode: String(project?.tenant_code || tenantCode || "").trim() || null,
      businessCode: nextBusinessCode || null,
      projectId: project?.id || null,
      projectCode: String(project?.project_code || project?.id || "").trim() || null,
    });
    void qc.invalidateQueries();
  };

  useEffect(() => {
    if (!authed || projects.isLoading || !projectItems.length) return;
    const next = currentProject ?? projectItems[0];
    const nextTenantCode = String(next.tenant_code || tenantCode || "").trim();
    const nextBusinessCode = String(next.business_code || next.business_id || "").trim();
    const inSync =
      currentProjectId === next.id &&
      getTenantCode() === (nextTenantCode || null) &&
      getBusinessCode() === (nextBusinessCode || null);
    if (!inSync) syncProjectScope(next);
  }, [authed, currentProject?.id, currentProjectId, projectItems, projects.isLoading, tenantCode]);

  const chooseBusiness = (businessCode: string) => {
    const candidates = projectItems.filter((item) => !businessCode || item.business_id === businessCode || item.business_code === businessCode);
    syncProjectScope(candidates[0] ?? null, businessCode);
  };

  const chooseProject = (projectId: string) => {
    syncProjectScope(projectItems.find((item) => item.id === projectId) ?? null, currentBusinessCode);
  };

  if (!authed) return null;

  return (
    <div className="flex max-w-full flex-wrap items-center gap-1.5 text-sm">
      {projects.isFetching || businesses.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted)]" /> : null}
      <span
        className="hidden max-w-[8rem] truncate rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1.5 font-mono text-xs text-[var(--muted-strong)] 2xl:inline-flex"
        title={tenantCode || t("projectSelector.tenantPlaceholder")}
      >
        {tenantCode || t("projectSelector.tenantPlaceholder")}
      </span>
      <select
        className="max-w-[11rem] truncate rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-sm text-[var(--text)] shadow-sm"
        value={currentBusinessCode}
        onChange={(e) => chooseBusiness(e.target.value)}
        aria-label={t("projectSelector.businessLabel")}
        title={t("projectSelector.hint")}
        disabled={businesses.isLoading || projects.isLoading}
      >
        <option value="">{t("projectSelector.businessPlaceholder")}</option>
        {businessItems.map((b) => (
          <option key={b.id} value={b.business_code || b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <select
        className="max-w-[13rem] truncate rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-sm text-[var(--text)] shadow-sm"
        value={currentProjectId ?? ""}
        onChange={(e) => chooseProject(e.target.value)}
        aria-label={t("projectSelector.label")}
        title={t("projectSelector.hint")}
        disabled={projects.isLoading}
      >
        <option value="">{t("projectSelector.placeholder")}</option>
        {visibleProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
