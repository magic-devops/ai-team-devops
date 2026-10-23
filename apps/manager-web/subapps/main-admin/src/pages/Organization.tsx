import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { Building2, ClipboardCheck, ShieldCheck, UserCog, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NeedLogin, RefreshButton } from "../../../../src/components/PageStates";
import { api } from "../../../../src/lib/api";
import { getSessionRevision, getToken } from "../../../../src/lib/authStorage";
import { projectSessionKey } from "../../../../src/lib/projectPortfolio";
import { projectMembersHash, requestedMemberProject } from "../../../../src/lib/projectTeamNavigation";
import { invalidateDeliveryQueries } from "../../../../src/lib/deliveryQuery";
import { WorkbenchShell } from "../../../../src/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "../../../../src/pages/shared/workbenchUi";
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
const emptyMemberAccess = (projectId: string) => ({
  projectId, ready: false, candidateIds: [] as string[], memberIds: [] as string[], roles: [] as string[],
  draft: { user_id: "", role: "developer" },
});

export function Organization({ initialTab = "users", focused = false }: { initialTab?: OrgTab; focused?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [tab, setTab] = useState<OrgTab>(initialTab);
  const [selectedProjectId, setSelectedProjectId] = useState(() => requestedMemberProject(location.hash));
  const [newMember, setNewMember] = useState({ user_id: "", role: "developer" });
  const memberOwner = useRef(projectSessionKey()), memberWriteBusy = useRef(false);
  const memberMounted = useRef(true);
  const memberAccess = useRef(emptyMemberAccess(selectedProjectId));

  useEffect(() => setTab(initialTab), [initialTab]);

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, enabled: authed });
  const selectedProject = !projects.isError && projects.data?.find((project: ProjectRow) => project.id === selectedProjectId);
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: api.businesses, enabled: authed && (!focused || tab === "businesses") });
  const users = useQuery({ queryKey: ["users"], queryFn: api.authUsers, enabled: authed && (!focused || tab === "users") });
  const roles = useQuery({ queryKey: ["roleConstants"], queryFn: api.roleConstants, enabled: authed });
  const orgSummary = useQuery({ queryKey: ["organizationSummary"], queryFn: api.organizationSummary, enabled: authed && (!focused || tab !== "projectMembers") });
  const orgPolicy = useQuery({ queryKey: ["organizationPolicy"], queryFn: api.organizationPolicy, enabled: authed && tab === "rolePolicy" });
  const orgPolicyHistory = useQuery({ queryKey: ["organizationPolicyHistory"], queryFn: () => api.organizationPolicyHistory(30), enabled: authed && tab === "rolePolicy" });
  const orgAccessReview = useQuery({ queryKey: ["organizationAccessReview"], queryFn: api.organizationAccessReview, enabled: authed && tab === "accessReview" });

  const projectMembers = useQuery({
    queryKey: ["projectMembers", selectedProjectId, getSessionRevision()],
    queryFn: () => api.projectMembers(selectedProjectId),
    enabled: authed && Boolean(selectedProject) && tab === "projectMembers",
    retry: false,
  });
  const memberCandidates = useQuery({
    queryKey: ["projectMemberCandidates", selectedProjectId, getSessionRevision()],
    queryFn: () => api.projectMemberCandidates(selectedProjectId),
    enabled: authed && Boolean(selectedProject) && tab === "projectMembers",
    retry: false,
  });

  useEffect(() => {
    memberMounted.current = true;
    const sync = () => {
      if (memberWriteBusy.current) return;
      setSelectedProjectId(requestedMemberProject(location.hash));
      setNewMember({ user_id: "", role: "developer" });
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      memberMounted.current = false;
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  memberAccess.current = { projectId: selectedProjectId,
    ready: tab === "projectMembers" && Boolean(selectedProject) && !projectMembers.isError && !projectMembers.isFetching && Boolean(projectMembers.data) &&
      !roles.isError && !roles.isPending && !roles.isFetching && Boolean(roles.data?.project_member_roles?.length) &&
      !memberCandidates.isError && !memberCandidates.isFetching && Boolean(memberCandidates.data),
    candidateIds: !memberCandidates.isError ? (memberCandidates.data ?? []).map((user: UserRow) => user.id) : [],
    memberIds: !projectMembers.isError ? (projectMembers.data ?? []).map((member) => member.user_id) : [],
    roles: !roles.isError ? roles.data?.project_member_roles ?? [] : [],
    draft: { ...newMember },
  };
  const selectMemberProject = (projectId: string) => {
    if (!memberMounted.current || memberWriteBusy.current || memberOwner.current !== projectSessionKey()) return;
    memberAccess.current = emptyMemberAccess(projectId);
    setSelectedProjectId(projectId);
    setNewMember({ user_id: "", role: "developer" });
    history.replaceState(history.state, "", projectMembersHash(projectId));
  };
  const finishMemberWrite = () => {
    memberWriteBusy.current = false;
    memberAccess.current.ready = false;
    if (!memberMounted.current || memberOwner.current !== projectSessionKey()) return;
    const requested = requestedMemberProject(location.hash);
    if (requested !== memberAccess.current.projectId) {
      memberAccess.current = emptyMemberAccess(requested);
      setSelectedProjectId(requested);
      setNewMember({ user_id: "", role: "developer" });
    }
  };
  const beginMemberWrite = (projectId: string, action: () => void) => {
    if (!memberMounted.current || memberWriteBusy.current || memberOwner.current !== projectSessionKey() ||
      !memberAccess.current.ready || memberAccess.current.projectId !== projectId ||
      requestedMemberProject(location.hash) !== projectId) return;
    memberWriteBusy.current = true;
    action();
  };
  const refreshMemberProject = (projectId: string) => {
    void qc.invalidateQueries({ queryKey: ["projectMembers", projectId] });
    void qc.invalidateQueries({ queryKey: ["projectMemberCandidates", projectId] });
    void invalidateDeliveryQueries(qc, projectId);
    refreshAll();
  };

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
    mutationFn: ({ projectId, body }: { projectId: string; body: typeof newMember }) => api.projectAddMember(projectId, body),
    onSuccess: (_result, command) => {
      if (memberMounted.current && memberOwner.current === projectSessionKey() && memberAccess.current.projectId === command.projectId)
        setNewMember({ user_id: "", role: "developer" });
      refreshMemberProject(command.projectId);
    },
    onSettled: finishMemberWrite,
  });
  const updateProjectMember = useMutation({
    mutationFn: ({ projectId, userId, role }: { projectId: string; userId: string; role: string }) => api.projectUpdateMember(projectId, userId, { role }),
    onSuccess: (_result, command) => refreshMemberProject(command.projectId),
    onSettled: finishMemberWrite,
  });
  const removeProjectMember = useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) => api.projectRemoveMember(projectId, userId),
    onSuccess: (_result, command) => refreshMemberProject(command.projectId),
    onSettled: finishMemberWrite,
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
  const projectRoles = useMemo(() => !roles.isError ? roles.data?.project_member_roles ?? [] : [], [roles.data, roles.isError]);
  const activeUsers = (users.data ?? []).filter((u: UserRow) => (u.status || "active") === "active").length;
  const tenantAdmins = (users.data ?? []).filter((u: UserRow) => String(u.role || "").includes("admin")).length;
  const projectMemberCount = orgSummary.data?.project_members_total ?? (projectMembers.data ?? []).length;

  if (!authed) return <NeedLogin />;

  return (
      <WorkbenchShell
      title={t(focused && tab === "projectMembers" ? "page.organization.projectMembers" : "page.organization.workspaceGovernance")}
      description={focused ? t(`page.organization.tabHint.${tab}`) : t("page.organization.workspaceGovernanceHint")}
      actions={<RefreshButton onClick={refreshAll} pending={busy} />}
      metrics={
        focused && tab === "projectMembers" ? undefined : <WorkbenchStats
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
          projects={(!projects.isError ? projects.data ?? [] : []) as ProjectRow[]}
          selectedProjectId={selectedProjectId}
          setSelectedProjectId={selectMemberProject}
          members={selectedProject && !projectMembers.isError ? projectMembers.data ?? [] : []}
          candidates={selectedProject && !memberCandidates.isError ? memberCandidates.data ?? [] : []}
          roles={projectRoles}
          loading={projects.isLoading || (Boolean(selectedProject) && projectMembers.isPending)}
          candidateLoading={memberCandidates.isLoading}
          readFailed={projects.isError || projectMembers.isError}
          disabled={!memberAccess.current.ready || memberCandidates.isError}
          errors={[projects.error as Error | null, roles.error as Error | null, projectMembers.error as Error | null, memberCandidates.error as Error | null, addProjectMember.error as Error | null, updateProjectMember.error as Error | null, removeProjectMember.error as Error | null]}
          newMember={newMember}
          setNewMember={setNewMember}
          addPending={addProjectMember.isPending}
          updatePending={updateProjectMember.isPending}
          removePending={removeProjectMember.isPending}
          onAdd={() => {
            const current = memberAccess.current;
            if (!current.candidateIds.includes(current.draft.user_id) || !current.roles.includes(current.draft.role)) return;
            beginMemberWrite(selectedProjectId, () => addProjectMember.mutate({ projectId: current.projectId, body: { ...current.draft } }));
          }}
          onUpdateRole={(userId, role) => {
            const current = memberAccess.current;
            if (!current.memberIds.includes(userId) || !current.roles.includes(role)) return;
            beginMemberWrite(selectedProjectId, () => updateProjectMember.mutate({ projectId: selectedProjectId, userId, role }));
          }}
          onRemove={(userId) => {
            if (!memberAccess.current.memberIds.includes(userId)) return;
            beginMemberWrite(selectedProjectId, () => removeProjectMember.mutate({ projectId: selectedProjectId, userId }));
          }}
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
          onPreviewTasks={() => accessReviewTasks.mutate({ dry_run: true, limit: 20, owner_id: "", priority: "P1" })}
          onCreateTasks={() => accessReviewTasks.mutate({ dry_run: false, limit: 20, owner_id: "", priority: "P1" })}
        />
      ) : null}
    </WorkbenchShell>
  );
}
