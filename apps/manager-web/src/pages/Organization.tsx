import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { Building2, ClipboardCheck, ShieldCheck, UserCog, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { WorkbenchStats } from "./shared/workbenchUi";
import { AccessReviewModule } from "./organization/AccessReviewModule";
import { BusinessLinesModule } from "./organization/BusinessLinesModule";
import { ProjectMembersModule } from "./organization/ProjectMembersModule";
import { RolePolicyModule } from "./organization/RolePolicyModule";
import { TenantUsersModule } from "./organization/TenantUsersModule";
import type { OrgTab, ProjectRow, UserRow } from "./organization/types";

const tabs = [
  { key: "users", icon: UserCog },
  { key: "businesses", icon: Building2 },
  { key: "projectMembers", icon: Users },
  { key: "rolePolicy", icon: ShieldCheck },
  { key: "accessReview", icon: ClipboardCheck },
] as const;

export function Organization({ initialTab = "users", focused = false }: { initialTab?: OrgTab; focused?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [tab, setTab] = useState<OrgTab>(initialTab);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newMember, setNewMember] = useState({ user_id: "", role: "developer" });

  useEffect(() => setTab(initialTab), [initialTab]);

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, enabled: authed });
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: api.businesses, enabled: authed });
  const users = useQuery({ queryKey: ["users"], queryFn: api.authUsers, enabled: authed });
  const roles = useQuery({ queryKey: ["roleConstants"], queryFn: api.roleConstants, enabled: authed });
  const orgSummary = useQuery({ queryKey: ["organizationSummary"], queryFn: api.organizationSummary, enabled: authed });
  const orgPolicy = useQuery({ queryKey: ["organizationPolicy"], queryFn: api.organizationPolicy, enabled: authed && tab === "rolePolicy" });
  const orgPolicyHistory = useQuery({ queryKey: ["organizationPolicyHistory"], queryFn: () => api.organizationPolicyHistory(30), enabled: authed && tab === "rolePolicy" });
  const orgAccessReview = useQuery({ queryKey: ["organizationAccessReview"], queryFn: api.organizationAccessReview, enabled: authed && tab === "accessReview" });

  const projectMembers = useQuery({
    queryKey: ["projectMembers", selectedProjectId],
    queryFn: () => api.projectMembers(selectedProjectId),
    enabled: authed && Boolean(selectedProjectId) && tab === "projectMembers",
  });
  const memberCandidates = useQuery({
    queryKey: ["projectMemberCandidates", selectedProjectId],
    queryFn: () => api.projectMemberCandidates(selectedProjectId),
    enabled: authed && Boolean(selectedProjectId) && tab === "projectMembers",
  });

  useEffect(() => {
    const first = (projects.data ?? [])[0]?.id;
    if (!selectedProjectId && first) setSelectedProjectId(first);
  }, [projects.data, selectedProjectId]);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["businesses"] });
    void qc.invalidateQueries({ queryKey: ["users"] });
    void qc.invalidateQueries({ queryKey: ["roleConstants"] });
    void qc.invalidateQueries({ queryKey: ["organizationSummary"] });
    void qc.invalidateQueries({ queryKey: ["organizationPolicy"] });
    void qc.invalidateQueries({ queryKey: ["organizationPolicyHistory"] });
    void qc.invalidateQueries({ queryKey: ["organizationAccessReview"] });
    if (selectedProjectId) {
      void qc.invalidateQueries({ queryKey: ["projectMembers", selectedProjectId] });
      void qc.invalidateQueries({ queryKey: ["projectMemberCandidates", selectedProjectId] });
    }
  };

  const createUser = useMutation({
    mutationFn: api.authCreateUser,
    onSuccess: refreshAll,
  });
  const updateUser = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { email?: string; role?: string; status?: string; password?: string } }) => api.authUpdateUser(id, patch),
    onSuccess: refreshAll,
  });
  const deleteUser = useMutation({
    mutationFn: api.authDeleteUser,
    onSuccess: refreshAll,
  });
  const createBusiness = useMutation({
    mutationFn: api.createBusiness,
    onSuccess: refreshAll,
  });
  const updateBusiness = useMutation({
    mutationFn: ({ businessId, body }: { businessId: string; body: { name?: string; description?: string } }) => api.updateBusiness(businessId, body),
    onSuccess: refreshAll,
  });
  const deleteBusiness = useMutation({
    mutationFn: api.deleteBusiness,
    onSuccess: refreshAll,
  });
  const addProjectMember = useMutation({
    mutationFn: () => api.projectAddMember(selectedProjectId, newMember),
    onSuccess: () => {
      setNewMember({ user_id: "", role: "developer" });
      refreshAll();
    },
  });
  const updateProjectMember = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api.projectUpdateMember(selectedProjectId, userId, { role }),
    onSuccess: refreshAll,
  });
  const removeProjectMember = useMutation({
    mutationFn: (userId: string) => api.projectRemoveMember(selectedProjectId, userId),
    onSuccess: refreshAll,
  });
  const updateOrgPolicy = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.organizationPolicyUpdate(body),
    onSuccess: refreshAll,
  });
  const resetOrgPolicy = useMutation({
    mutationFn: api.organizationPolicyReset,
    onSuccess: refreshAll,
  });
  const checkOrgPolicy = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.organizationPolicyCheck(body),
  });
  const accessReviewTasks = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.organizationAccessReviewTasks(body),
    onSuccess: (data) => {
      if (!data?.dry_run) refreshAll();
    },
  });

  const busy = projects.isFetching || businesses.isFetching || users.isFetching || roles.isFetching || orgSummary.isFetching || projectMembers.isFetching || memberCandidates.isFetching;
  const userRoles = useMemo(() => roles.data?.user_roles?.length ? roles.data.user_roles : ["developer", "devops", "project_admin", "tenant_admin"], [roles.data]);
  const projectRoles = useMemo(() => roles.data?.project_member_roles?.length ? roles.data.project_member_roles : ["viewer", "developer", "project_admin"], [roles.data]);
  const activeUsers = (users.data ?? []).filter((u: UserRow) => (u.status || "active") === "active").length;
  const tenantAdmins = (users.data ?? []).filter((u: UserRow) => String(u.role || "").includes("admin")).length;
  const projectMemberCount = orgSummary.data?.project_members_total ?? (projectMembers.data ?? []).length;

  if (!authed) return <NeedLogin />;

  return (
      <WorkbenchShell
      title={t("page.organization.workspaceGovernance")}
      description={focused ? t(`page.organization.tabHint.${tab}`) : t("page.organization.workspaceGovernanceHint")}
      actions={<RefreshButton onClick={refreshAll} pending={busy} />}
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.organization.metricUsers"), value: orgSummary.data?.users_total ?? users.data?.length ?? 0 },
            { label: t("page.organization.metricActiveUsers"), value: orgSummary.data?.users_active ?? activeUsers },
            { label: t("page.organization.metricAdmins"), value: orgSummary.data?.tenant_admins ?? tenantAdmins },
            { label: t("page.organization.metricProjectMembers"), value: projectMemberCount },
          ]}
        />
      }
    >
      {!focused ? (
        <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <Button
                key={item.key}
                type={active ? "primary" : "default"}
                icon={<Icon className="h-4 w-4" />}
                onClick={() => setTab(item.key)}
              >
                {t(`page.organization.tab.${item.key}`)}
              </Button>
            );
          })}
        </div>
      ) : null}

      {tab === "users" ? (
        <TenantUsersModule
          users={users.data ?? []}
          roles={userRoles}
          loading={users.isLoading}
          errors={[users.error as Error | null, createUser.error as Error | null, updateUser.error as Error | null, deleteUser.error as Error | null]}
          createPending={createUser.isPending}
          updatePending={updateUser.isPending}
          deletePending={deleteUser.isPending}
          onCreate={(body) => createUser.mutate(body)}
          onUpdate={(id, patch) => updateUser.mutate({ id, patch })}
          onDelete={(id) => deleteUser.mutate(id)}
        />
      ) : null}

      {tab === "businesses" ? (
        <BusinessLinesModule
          businesses={businesses.data ?? []}
          projects={projects.data ?? []}
          loading={businesses.isLoading}
          errors={[businesses.error as Error | null, createBusiness.error as Error | null, updateBusiness.error as Error | null, deleteBusiness.error as Error | null]}
          createPending={createBusiness.isPending}
          updatePending={updateBusiness.isPending}
          deletePending={deleteBusiness.isPending}
          onCreate={(body) => createBusiness.mutate(body)}
          onUpdate={(businessId, body) => updateBusiness.mutate({ businessId, body })}
          onDelete={(businessId) => deleteBusiness.mutate(businessId)}
        />
      ) : null}

      {tab === "projectMembers" ? (
        <ProjectMembersModule
          projects={(projects.data ?? []) as ProjectRow[]}
          selectedProjectId={selectedProjectId}
          setSelectedProjectId={setSelectedProjectId}
          members={projectMembers.data ?? []}
          candidates={memberCandidates.data ?? []}
          roles={projectRoles}
          loading={projectMembers.isLoading}
          candidateLoading={memberCandidates.isLoading}
          errors={[projectMembers.error as Error | null, memberCandidates.error as Error | null, addProjectMember.error as Error | null, updateProjectMember.error as Error | null, removeProjectMember.error as Error | null]}
          newMember={newMember}
          setNewMember={setNewMember}
          addPending={addProjectMember.isPending}
          updatePending={updateProjectMember.isPending}
          removePending={removeProjectMember.isPending}
          onAdd={() => addProjectMember.mutate()}
          onUpdateRole={(userId, role) => updateProjectMember.mutate({ userId, role })}
          onRemove={(userId) => removeProjectMember.mutate(userId)}
        />
      ) : null}

      {tab === "rolePolicy" ? (
        <RolePolicyModule
          policy={orgPolicy.data}
          loading={orgPolicy.isLoading}
          error={orgPolicy.error as Error | null}
          savePending={updateOrgPolicy.isPending}
          resetPending={resetOrgPolicy.isPending}
          saveError={updateOrgPolicy.error as Error | null}
          resetError={resetOrgPolicy.error as Error | null}
          history={orgPolicyHistory.data?.items ?? []}
          historyLoading={orgPolicyHistory.isLoading}
          checkPending={checkOrgPolicy.isPending}
          checkError={checkOrgPolicy.error as Error | null}
          checkResult={checkOrgPolicy.data}
          onSave={(body) => updateOrgPolicy.mutate(body)}
          onReset={() => resetOrgPolicy.mutate()}
          onCheck={(body) => checkOrgPolicy.mutate(body)}
        />
      ) : null}

      {tab === "accessReview" ? (
        <AccessReviewModule
          review={orgAccessReview.data}
          loading={orgAccessReview.isLoading}
          error={orgAccessReview.error as Error | null}
          taskPreview={accessReviewTasks.data}
          taskPending={accessReviewTasks.isPending}
          taskError={accessReviewTasks.error as Error | null}
          onPreviewTasks={() => accessReviewTasks.mutate({ dry_run: true, limit: 20, assigned_to: "tenant_admin", priority: "P1" })}
          onCreateTasks={() => accessReviewTasks.mutate({ dry_run: false, limit: 20, assigned_to: "tenant_admin", priority: "P1" })}
        />
      ) : null}
    </WorkbenchShell>
  );
}
