import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  LayoutGrid,
  Layers3,
  Sparkles,
  Terminal,
  UserCog,
  Users,
} from "lucide-react";
import { NeedLogin, RefreshButton } from "../../../../src/components/PageStates";
import { api } from "../../../../src/lib/api";
import { getProjectId, getToken, setProjectId } from "../../../../src/lib/authStorage";
import { BusinessModule } from "./projects/BusinessModule";
import { GovernanceModule, type GovernancePanelKey } from "./projects/GovernanceModule";
import { MembersModule } from "./projects/MembersModule";
import { OnboardingModule, type OnboardingPanelKey } from "./projects/OnboardingModule";
import { PortfolioModule } from "./projects/PortfolioModule";
import { ProjectHero } from "./projects/ProjectHero";
import { ProjectInspector } from "./projects/ProjectInspector";
import { TenantModule } from "./projects/TenantModule";
import { TemplatesModule, type TemplatePanelKey } from "./projects/TemplatesModule";
import { UsersModule } from "./projects/UsersModule";
import {
  governanceSubNav,
  isDeliveryTab,
  onboardingSubNav,
  parseProjectsDeliveryHash,
  templateSubNav,
} from "./projects/deliveryKitNav";
import { ProjectDeliveryKitShell, type DeliveryPhase } from "./projects/ProjectDeliveryKitShell";
import { defaultDraft, type Project, type ProjectTab, type TabKey } from "./projects/types";

const coreTabs: ProjectTab[] = [
  { key: "portfolio", icon: LayoutGrid },
  { key: "tenants", icon: Layers3 },
  { key: "users", icon: UserCog },
  { key: "members", icon: Users },
];

const deliveryTabs: ProjectTab[] = [
  { key: "templates", icon: Copy },
  { key: "onboarding", icon: Terminal },
  { key: "governance", icon: Sparkles },
];

export function Projects({
  initialTab = "portfolio",
  focused = false,
  onboardingPanel = "overview",
  templatePanel = "overview",
  governancePanel = "review",
}: {
  initialTab?: TabKey;
  focused?: boolean;
  onboardingPanel?: OnboardingPanelKey;
  templatePanel?: TemplatePanelKey;
  governancePanel?: GovernancePanelKey;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [activeProjectId, setActiveProjectId] = useState(getProjectId() ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState(getProjectId() ?? "");
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [onboardingPanelState, setOnboardingPanelState] = useState<OnboardingPanelKey>(onboardingPanel);
  const [templatePanelState, setTemplatePanelState] = useState<TemplatePanelKey>(templatePanel);
  const [governancePanelState, setGovernancePanelState] = useState<GovernancePanelKey>(governancePanel);
  const [routeFocused, setRouteFocused] = useState(focused);
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState(defaultDraft);
  const [businessDraft, setBusinessDraft] = useState({ name: "", description: "" });
  const [tenantDraft, setTenantDraft] = useState({ name: "", slug: "", plan: "free" });
  const [userDraft, setUserDraft] = useState({ username: "", email: "", password: "", role: "developer" });
  const [cloneDraft, setCloneDraft] = useState({
    template_id: "",
    name: "",
    description: "",
    business_id: "",
    project_path: "",
    clone_requirements: true,
    clone_tasks: false,
    clone_knowledge: true,
    clone_rules: true,
  });
  const [newMember, setNewMember] = useState({ user_id: "", role: "developer" });
  const [copied, setCopied] = useState("");
  const [bootstrapResult, setBootstrapResult] = useState<any>(null);
  const [clonePreviewResult, setClonePreviewResult] = useState<any>(null);

  const applyRoute = (next: ReturnType<typeof parseProjectsDeliveryHash>) => {
    setTab(next.tab);
    setOnboardingPanelState(next.onboardingPanel);
    setTemplatePanelState(next.templatePanel);
    setGovernancePanelState(next.governancePanel);
    setRouteFocused(next.focused);
  };

  useEffect(() => {
    applyRoute(parseProjectsDeliveryHash(window.location.hash));
    const onHash = () => applyRoute(parseProjectsDeliveryHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    applyRoute({
      tab: initialTab,
      onboardingPanel,
      templatePanel,
      governancePanel,
      focused,
    });
  }, [initialTab, onboardingPanel, templatePanel, governancePanel, focused]);

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, enabled: authed });
  const me = useQuery({ queryKey: ["authMe"], queryFn: api.authMe, enabled: authed, retry: false });
  const summary = useQuery({ queryKey: ["projectsSummary"], queryFn: api.projectsSummary, enabled: authed });
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: api.businesses, enabled: authed });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: api.tenants, enabled: authed && me.data?.role === "super_admin" });
  const users = useQuery({ queryKey: ["users"], queryFn: api.authUsers, enabled: authed && tab === "users" });
  const roles = useQuery({ queryKey: ["roleConstants"], queryFn: api.roleConstants, enabled: authed });
  const templates = useQuery({ queryKey: ["projectTemplates"], queryFn: api.projectTemplates, enabled: authed });

  const selectedProject = useMemo(
    () => (projects.data ?? []).find((p: Project) => p.id === selectedProjectId) as Project | undefined,
    [projects.data, selectedProjectId],
  );

  const projectMembers = useQuery({
    queryKey: ["projectMembers", selectedProjectId],
    queryFn: () => api.projectMembers(selectedProjectId),
    enabled: authed && Boolean(selectedProjectId) && (tab === "members" || tab === "portfolio"),
  });

  const memberCandidates = useQuery({
    queryKey: ["projectMemberCandidates", selectedProjectId],
    queryFn: () => api.projectMemberCandidates(selectedProjectId),
    enabled: authed && Boolean(selectedProjectId) && tab === "members",
  });

  const deliveryKitActive = isDeliveryTab(tab);
  const showFocusedChrome = routeFocused;
  const prefetchDelivery = authed && Boolean(selectedProjectId) && deliveryKitActive;

  const onboarding = useQuery({
    queryKey: ["projectOnboarding", selectedProjectId],
    queryFn: () => api.projectOnboarding(selectedProjectId),
    enabled: prefetchDelivery || (authed && Boolean(selectedProjectId) && tab === "onboarding"),
  });

  const review = useQuery({
    queryKey: ["projectReview", selectedProjectId],
    queryFn: () => api.projectReview(selectedProjectId),
    enabled: prefetchDelivery || (authed && Boolean(selectedProjectId) && tab === "governance"),
  });
  const opsPlan = useQuery({
    queryKey: ["projectOpsPlan", selectedProjectId],
    queryFn: () => api.projectOpsPlan(selectedProjectId),
    enabled: prefetchDelivery || (authed && Boolean(selectedProjectId) && tab === "governance"),
  });

  const filtered = useMemo(() => {
    const list = (projects.data ?? []) as Project[];
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter((p) =>
      [p.id, p.name, p.description, p.business_name, p.status, p.vector_db]
        .map((x) => String(x ?? "").toLowerCase())
        .some((x) => x.includes(k)),
    );
  }, [projects.data, keyword]);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["projectsSummary"] });
    void qc.invalidateQueries({ queryKey: ["projectTemplates"] });
    void qc.invalidateQueries({ queryKey: ["tenants"] });
    void qc.invalidateQueries({ queryKey: ["users"] });
    if (selectedProjectId) {
      void qc.invalidateQueries({ queryKey: ["projectMembers", selectedProjectId] });
      void qc.invalidateQueries({ queryKey: ["projectMemberCandidates", selectedProjectId] });
      void qc.invalidateQueries({ queryKey: ["projectOnboarding", selectedProjectId] });
      void qc.invalidateQueries({ queryKey: ["projectReview", selectedProjectId] });
      void qc.invalidateQueries({ queryKey: ["projectOpsPlan", selectedProjectId] });
    }
  };

  const createProject = useMutation({
    mutationFn: () => api.createProject({ ...draft, business_id: draft.business_id || null }),
    onSuccess: (res) => {
      setDraft(defaultDraft);
      setSelectedProjectId(res.id);
      setActiveProjectId(res.id);
      setProjectId(res.id);
      refreshAll();
    },
  });

  const updateProject = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.updateProject(selectedProjectId, patch),
    onSuccess: refreshAll,
  });

  const createBusiness = useMutation({
    mutationFn: () => api.createBusiness(businessDraft),
    onSuccess: () => {
      setBusinessDraft({ name: "", description: "" });
      refreshAll();
    },
  });

  const updateBusiness = useMutation({
    mutationFn: ({ businessId, body }: { businessId: string; body: { name?: string; description?: string } }) => api.updateBusiness(businessId, body),
    onSuccess: refreshAll,
  });

  const deleteBusiness = useMutation({
    mutationFn: (businessId: string) => api.deleteBusiness(businessId),
    onSuccess: refreshAll,
  });

  const createTenant = useMutation({
    mutationFn: () => api.createTenant(tenantDraft),
    onSuccess: () => {
      setTenantDraft({ name: "", slug: "", plan: "free" });
      refreshAll();
    },
  });

  const updateTenant = useMutation({
    mutationFn: ({ tenantId, body }: { tenantId: string; body: { name?: string; plan?: string; status?: string } }) => api.updateTenant(tenantId, body),
    onSuccess: refreshAll,
  });

  const deleteTenant = useMutation({
    mutationFn: (tenantId: string) => api.deleteTenant(tenantId),
    onSuccess: refreshAll,
  });

  const createUser = useMutation({
    mutationFn: () => api.authCreateUser(userDraft),
    onSuccess: () => {
      setUserDraft({ username: "", email: "", password: "", role: "developer" });
      refreshAll();
    },
  });

  const updateUser = useMutation({
    mutationFn: ({ userId, patch }: { userId: string; patch: { email?: string; role?: string; status?: string; password?: string } }) => api.authUpdateUser(userId, patch),
    onSuccess: refreshAll,
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => api.authDeleteUser(userId),
    onSuccess: refreshAll,
  });

  const deleteProject = useMutation({
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: () => {
      setSelectedProjectId("");
      refreshAll();
    },
  });

  const toggleTemplate = useMutation({
    mutationFn: ({ projectId, value }: { projectId: string; value: boolean }) => api.projectSetTemplate(projectId, value),
    onSuccess: refreshAll,
  });

  const cloneProject = useMutation({
    mutationFn: () =>
      api.cloneProject(cloneDraft.template_id, {
        name: cloneDraft.name,
        description: cloneDraft.description,
        business_id: cloneDraft.business_id || null,
        project_path: cloneDraft.project_path,
        clone_requirements: cloneDraft.clone_requirements,
        clone_tasks: cloneDraft.clone_tasks,
        clone_knowledge: cloneDraft.clone_knowledge,
        clone_rules: cloneDraft.clone_rules,
      }),
    onSuccess: (res) => {
      setCloneDraft({
        template_id: "",
        name: "",
        description: "",
        business_id: "",
        project_path: "",
        clone_requirements: true,
        clone_tasks: false,
        clone_knowledge: true,
        clone_rules: true,
      });
      setClonePreviewResult(null);
      setSelectedProjectId(res.id);
      setActiveProjectId(res.id);
      setProjectId(res.id);
      refreshAll();
    },
  });
  const clonePreview = useMutation({
    mutationFn: () =>
      api.cloneProjectPreview(cloneDraft.template_id, {
        name: cloneDraft.name,
        description: cloneDraft.description,
        business_id: cloneDraft.business_id || null,
        project_path: cloneDraft.project_path,
        clone_requirements: cloneDraft.clone_requirements,
        clone_tasks: cloneDraft.clone_tasks,
        clone_knowledge: cloneDraft.clone_knowledge,
        clone_rules: cloneDraft.clone_rules,
      }),
    onSuccess: (res) => setClonePreviewResult(res),
  });

  const addMember = useMutation({
    mutationFn: () => api.projectAddMember(selectedProjectId, newMember),
    onSuccess: () => {
      setNewMember({ user_id: "", role: "developer" });
      refreshAll();
    },
  });

  const updateMember = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api.projectUpdateMember(selectedProjectId, userId, { role }),
    onSuccess: refreshAll,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.projectRemoveMember(selectedProjectId, userId),
    onSuccess: refreshAll,
  });

  const bootstrapTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.projectBootstrapTasks(selectedProjectId, { dry_run: dryRun, priority: "P1", assigned_to: "Coder" }),
    onSuccess: (data) => {
      setBootstrapResult(data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["projectReview", selectedProjectId] });
    },
  });
  const opsTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.projectOpsTasks(selectedProjectId, { dry_run: dryRun, priority: "P1", assigned_to: "Coder" }),
    onSuccess: (data) => {
      setBootstrapResult(data);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["projectOpsPlan", selectedProjectId] });
    },
  });

  const copyText = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  };

  if (!authed) return <NeedLogin />;

  const busy = projects.isFetching || summary.isFetching || templates.isFetching;
  const projectRoles = roles.data?.project_member_roles?.length
    ? roles.data.project_member_roles
    : ["project_admin", "developer", "devops", "product_manager", "analyst", "viewer"];
  const userRoles = roles.data?.user_roles?.length
    ? roles.data.user_roles
    : ["developer", "devops", "project_admin", "tenant_admin"];
  const fullWidthTabs = new Set<TabKey>(["tenants", "users"]);
  const showInspector = !fullWidthTabs.has(tab) && !deliveryKitActive;

  const onboardingReady = (onboarding.data?.readiness ?? []).filter((item: { ok?: boolean }) => item.ok).length;
  const onboardingTotal = (onboarding.data?.readiness ?? []).length;
  const templateCount = (templates.data ?? []).length;

  const selectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveProjectId(projectId);
    if (projectId) setProjectId(projectId);
  };

  const renderDeliveryKit = (phase: DeliveryPhase, body: ReactNode) => (
    <ProjectDeliveryKitShell
      phase={phase}
      projects={(projects.data ?? []) as Project[]}
      selectedProjectId={selectedProjectId}
      onSelectProject={selectProject}
      templateCount={templateCount}
      onboardingReady={onboardingReady}
      onboardingTotal={onboardingTotal}
      governanceScore={review.data?.score}
      governanceGrade={review.data?.grade}
      subNav={
        phase === "onboarding"
          ? onboardingSubNav(onboardingPanelState, t)
          : phase === "templates"
            ? templateSubNav(templatePanelState, t)
            : governanceSubNav(governancePanelState, t)
      }
    >
      {body}
    </ProjectDeliveryKitShell>
  );

  const deliveryDefaultHash: Record<DeliveryPhase, string> = {
    templates: "#/projects/templates/overview",
    onboarding: "#/projects/onboarding/overview",
    governance: "#/projects/governance/review",
  };

  const tabButton = (item: ProjectTab) => {
    const Icon = item.icon;
    const active = tab === item.key;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          if (isDeliveryTab(item.key)) {
            window.location.hash = deliveryDefaultHash[item.key];
            return;
          }
          setTab(item.key);
        }}
        className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${
          active
            ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
            : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)] hover:bg-[var(--surface-muted)]"
        }`}
      >
        <Icon className="h-4 w-4" />
        {t(`page.projects.module.${item.key}`)}
      </button>
    );
  };

  return (
    <div className="w-full space-y-5">
      {!deliveryKitActive || !showFocusedChrome ? (
        <ProjectHero summary={summary.data} onRefresh={refreshAll} busy={busy} />
      ) : null}

      <div className={showInspector ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]" : "grid gap-4"}>
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            {!showFocusedChrome ? (
              <div className="flex flex-wrap gap-2">
                <div className="flex w-full flex-col gap-2">
                  <div className="flex flex-wrap gap-2">{coreTabs.map(tabButton)}</div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
                    <span className="text-xs font-semibold text-[var(--muted)]">{t("page.projects.deliveryKit.badge")}</span>
                    {deliveryTabs.map(tabButton)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm font-semibold text-[var(--text)]">
                {deliveryKitActive ? t("page.projects.deliveryKit.badge") : t(`page.projects.module.${tab}`)}
              </div>
            )}
            <RefreshButton onClick={refreshAll} pending={busy} />
          </div>

          {tab === "portfolio" ? (
            <PortfolioModule
              projects={filtered}
              keyword={keyword}
              setKeyword={setKeyword}
              loading={projects.isLoading}
              error={projects.error as Error | null}
              activeProjectId={activeProjectId}
              selectedProjectId={selectedProjectId}
              setSelectedProject={(projectId) => {
                setSelectedProjectId(projectId);
                setActiveProjectId(projectId);
                setProjectId(projectId);
              }}
              draft={draft}
              setDraft={setDraft}
              businesses={businesses.data ?? []}
              createPending={createProject.isPending}
              createError={createProject.error as Error | null}
              onCreate={() => createProject.mutate()}
            />
          ) : null}

          {tab === "business" ? (
            <BusinessModule
              businesses={businesses.data ?? []}
              projects={projects.data ?? []}
              draft={businessDraft}
              setDraft={setBusinessDraft}
              createPending={createBusiness.isPending}
              createError={createBusiness.error as Error | null}
              deletePending={deleteBusiness.isPending}
              onCreate={() => createBusiness.mutate()}
              onUpdate={(businessId, body) => updateBusiness.mutate({ businessId, body })}
              onDelete={(businessId) => deleteBusiness.mutate(businessId)}
              onSelectProject={(projectId) => {
                setSelectedProjectId(projectId);
                setActiveProjectId(projectId);
                setProjectId(projectId);
              }}
            />
          ) : null}

          {tab === "tenants" ? (
            <TenantModule
              role={String(me.data?.role || "")}
              tenants={tenants.data ?? []}
              loading={tenants.isLoading}
              error={tenants.error as Error | null}
              draft={tenantDraft}
              setDraft={setTenantDraft}
              createPending={createTenant.isPending}
              createError={createTenant.error as Error | null}
              updatePending={updateTenant.isPending}
              deletePending={deleteTenant.isPending}
              onCreate={() => createTenant.mutate()}
              onUpdate={(tenantId, body) => updateTenant.mutate({ tenantId, body })}
              onDelete={(tenantId) => deleteTenant.mutate(tenantId)}
            />
          ) : null}

          {tab === "users" ? (
            <UsersModule
              users={users.data ?? []}
              roles={userRoles}
              loading={users.isLoading}
              error={users.error as Error | null}
              draft={userDraft}
              setDraft={setUserDraft}
              createPending={createUser.isPending}
              createError={createUser.error as Error | null}
              updatePending={updateUser.isPending}
              updateError={updateUser.error as Error | null}
              deletePending={deleteUser.isPending}
              deleteError={deleteUser.error as Error | null}
              onCreate={() => createUser.mutate()}
              onUpdate={(userId, patch) => updateUser.mutate({ userId, patch })}
              onDelete={(userId, username) => {
                if (window.confirm(t("page.projects.confirmDeleteUser", { name: username }))) deleteUser.mutate(userId);
              }}
            />
          ) : null}

          {tab === "members" ? (
            <MembersModule
              project={selectedProject}
              members={projectMembers.data ?? []}
              loading={projectMembers.isLoading}
              users={memberCandidates.data ?? []}
              roles={projectRoles}
              newMember={newMember}
              setNewMember={setNewMember}
              addPending={addMember.isPending}
              removePending={removeMember.isPending}
              addError={addMember.error as Error | null}
              onAdd={() => addMember.mutate()}
              onUpdateRole={(userId, role) => updateMember.mutate({ userId, role })}
              onRemove={(userId) => removeMember.mutate(userId)}
            />
          ) : null}

          {tab === "onboarding"
            ? renderDeliveryKit(
                "onboarding",
                <OnboardingModule
                  selectedProjectId={selectedProjectId}
                  data={onboarding.data}
                  loading={onboarding.isLoading}
                  error={onboarding.error as Error | null}
                  copied={copied}
                  initialPanel={onboardingPanelState}
                  embedded
                  copyText={copyText}
                />,
              )
            : null}

          {tab === "templates"
            ? renderDeliveryKit(
                "templates",
                <TemplatesModule
                  projects={projects.data ?? []}
                  templates={templates.data ?? []}
                  businesses={businesses.data ?? []}
                  selectedProject={selectedProject}
                  cloneDraft={cloneDraft}
                  setCloneDraft={setCloneDraft}
                  clonePending={cloneProject.isPending}
                  cloneError={cloneProject.error as Error | null}
                  clonePreview={clonePreviewResult}
                  clonePreviewPending={clonePreview.isPending}
                  clonePreviewError={clonePreview.error as Error | null}
                  togglePending={toggleTemplate.isPending}
                  initialPanel={templatePanelState}
                  embedded
                  onToggle={(projectId, value) => toggleTemplate.mutate({ projectId, value })}
                  onPreviewClone={() => clonePreview.mutate()}
                  onClone={() => cloneProject.mutate()}
                />,
              )
            : null}

          {tab === "governance"
            ? renderDeliveryKit(
                "governance",
                <GovernanceModule
                  selectedProjectId={selectedProjectId}
                  data={review.data}
                  loading={review.isLoading}
                  error={review.error as Error | null}
                  opsPlan={opsPlan.data}
                  opsLoading={opsPlan.isLoading}
                  opsError={opsPlan.error as Error | null}
                  copied={copied}
                  initialPanel={governancePanelState}
                  embedded
                  copyText={copyText}
                  onSelectTab={setTab}
                  bootstrapResult={bootstrapResult}
                  bootstrapPending={bootstrapTasks.isPending || opsTasks.isPending}
                  onBootstrapPreview={() => bootstrapTasks.mutate(true)}
                  onBootstrapCreate={() => bootstrapTasks.mutate(false)}
                  onOpsPreview={() => opsTasks.mutate(true)}
                  onOpsCreate={() => opsTasks.mutate(false)}
                />,
              )
            : null}

        </section>

        {showInspector ? (
          <ProjectInspector
            project={selectedProject}
            membersCount={(projectMembers.data ?? []).length || selectedProject?.counts?.members || 0}
            onSelectTab={setTab}
            onPatch={(patch) => updateProject.mutate(patch)}
            patchPending={updateProject.isPending}
            patchError={updateProject.error as Error | null}
            onDelete={() => {
              if (selectedProject && window.confirm(t("page.projects.confirmDelete", { name: selectedProject.name }))) {
                deleteProject.mutate(selectedProject.id);
              }
            }}
            deletePending={deleteProject.isPending}
            businesses={businesses.data ?? []}
          />
        ) : null}
      </div>
    </div>
  );
}
