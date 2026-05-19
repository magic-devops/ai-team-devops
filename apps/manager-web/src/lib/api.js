/**
 * @ai_safe_edit
 *  - 改 BASE_URL：仅改本文件常量
 *  - 新接口：在末尾加导出 async 函数；TanStack Query 的 hooks 在 hooks/ 目录
 */
import { clearSession, getToken, getWorkspaceScope, setUserSession, setWorkspaceScope } from "./authStorage";
const BASE = import.meta.env.VITE_API_BASE ?? "";
function authHeaders() {
    const h = { "Content-Type": "application/json" };
    const token = getToken();
    if (token)
        h.Authorization = `Bearer ${token}`;
    const scope = getWorkspaceScope();
    if (scope.tenantCode)
        h["X-Tenant-Code"] = scope.tenantCode;
    if (scope.businessCode)
        h["X-Business-Code"] = scope.businessCode;
    if (scope.projectId)
        h["X-Project-Id"] = scope.projectId;
    if (scope.projectCode)
        h["X-Project-Code"] = scope.projectCode;
    return h;
}
function isMissingProjectScopeError(status, body) {
    return status === 400 && (body.includes("X-Project-Id") ||
        body.includes("绑定同步分区") ||
        body.includes("绑定项目作用域"));
}
function isSessionUnauthorized(status, body) {
    return status === 401 && (body.includes("Token 已过期") ||
        body.includes("Token 无效") ||
        body.includes("Token 用户标识无效") ||
        body.includes("Token 用户加载失败") ||
        body.includes("用户不存在或已禁用"));
}
function isAuthProbePath(path) {
    return path === "/api/v1/auth/me";
}
function clearStaleSessionOnUnauthorized(path, status, body) {
    if (isAuthProbePath(path) && isSessionUnauthorized(status, body) && getToken())
        clearSession();
}
function redirectToLogin() {
    if (typeof window === "undefined" || !window.location)
        return;
    if (window.location.pathname.endsWith("/login.html"))
        return;
    const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`/login.html?redirect=${encodeURIComponent(redirect)}`);
}
async function bindDefaultProjectScope() {
    if (getWorkspaceScope().projectId || !getToken())
        return false;
    const hydrated = await hydrateSessionScope();
    if (hydrated)
        return true;
    const r = await fetch(BASE + "/api/v1/projects", { headers: authHeaders() });
    if (!r.ok)
        return false;
    const projects = await r.json().catch(() => []);
    const first = Array.isArray(projects) ? projects.find((item) => item?.id) : undefined;
    if (!first?.id)
        return false;
    setWorkspaceScope({
        tenantCode: first.tenant_code || null,
        businessCode: first.business_code || first.business_id || null,
        projectId: first.id,
        projectCode: first.project_code || first.id,
    });
    return true;
}
let sessionHydration = null;
async function hydrateSessionScope() {
    if (getWorkspaceScope().projectId || !getToken())
        return false;
    if (!sessionHydration) {
        sessionHydration = (async () => {
            const token = getToken();
            if (!token)
                return false;
            const r = await fetch(BASE + "/api/v1/auth/me", {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            if (!r.ok) {
                const txt = await r.text().catch(() => r.statusText);
                clearStaleSessionOnUnauthorized("/api/v1/auth/me", r.status, txt);
                return false;
            }
            const data = await r.json().catch(() => null);
            if (!data)
                return false;
            setUserSession(data);
            return Boolean(data.workspace_scope?.project_id || data.default_project_id);
        })().finally(() => {
            sessionHydration = null;
        });
    }
    return sessionHydration;
}
async function request(path, init, retriedProjectScope = false) {
    if (!path.startsWith("/api/v1/auth/") && getToken() && !getWorkspaceScope().projectId) {
        await hydrateSessionScope();
    }
    const baseHeaders = authHeaders();
    const extra = (init?.headers || {});
    const r = await fetch(BASE + path, {
        ...init,
        headers: { ...baseHeaders, ...extra },
    });
    if (!r.ok) {
        const txt = await r.text().catch(() => r.statusText);
        const shouldRedirectLogin = isAuthProbePath(path) && isSessionUnauthorized(r.status, txt);
        clearStaleSessionOnUnauthorized(path, r.status, txt);
        if (shouldRedirectLogin)
            redirectToLogin();
        if (!retriedProjectScope && path !== "/api/v1/projects" && isMissingProjectScopeError(r.status, txt)) {
            const bound = await bindDefaultProjectScope();
            if (bound)
                return request(path, init, true);
        }
        throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    return r.json();
}
export const api = {
    health: () => request("/api/v1/health"),
    dashboardSummary: () => request("/api/v1/dashboard/summary"),
    dashboardCharts: () => request("/api/v1/dashboard/charts"),
    hermesBlueprint: () => request("/api/v1/hermes/blueprint"),
    hermesBlueprintTasks: (body) => request("/api/v1/hermes/blueprint/tasks", { method: "POST", body: JSON.stringify(body) }),
    tenants: () => request("/api/v1/tenants"),
    createTenant: (body) => request("/api/v1/tenants", { method: "POST", body: JSON.stringify(body) }),
    updateTenant: (tenantId, body) => request(`/api/v1/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    deleteTenant: (tenantId) => request(`/api/v1/tenants/${encodeURIComponent(tenantId)}`, { method: "DELETE" }),
    projects: () => request("/api/v1/projects"),
    projectsSummary: () => request("/api/v1/projects/summary"),
    createProject: (body) => request("/api/v1/projects", { method: "POST", body: JSON.stringify(body) }),
    updateProject: (projectId, body) => request(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    deleteProject: (projectId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
    projectTemplates: () => request("/api/v1/projects/templates"),
    projectSetTemplate: (projectId, isTemplate) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/set-template?is_template=${isTemplate ? "true" : "false"}`, {
        method: "PATCH",
    }),
    cloneProject: (templateId, body) => request(`/api/v1/projects/${encodeURIComponent(templateId)}/clone`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    cloneProjectPreview: (templateId, body) => request(`/api/v1/projects/${encodeURIComponent(templateId)}/clone-preview`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    projectOnboarding: (projectId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/onboarding`),
    projectReview: (projectId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/review`),
    projectOpsPlan: (projectId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/ops-plan`),
    projectOpsTasks: (projectId, body) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/ops-tasks`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    projectBootstrapTasks: (projectId, body) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/bootstrap-tasks`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    requirements: (params = {}) => {
        const qs = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value)
                qs.set(key, String(value));
        }
        const suffix = qs.toString() ? `?${qs}` : "";
        return request(`/api/v1/requirements${suffix}`);
    },
    requirementsSummary: () => request("/api/v1/requirements/summary"),
    requirementOpsPlan: () => request("/api/v1/requirements/ops-plan"),
    requirementOpsTasks: (body) => request("/api/v1/requirements/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
    parseRequirementsDocument: (body) => request("/api/v1/requirements/parse-document", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    batchCreateRequirements: (body) => request("/api/v1/requirements/batch", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    createRequirement: (body) => request("/api/v1/requirements", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    updateRequirement: (id, patch) => request(`/api/v1/requirements/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    }),
    bulkUpdateRequirements: (body) => request("/api/v1/requirements/bulk", {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    deleteRequirement: (id) => request(`/api/v1/requirements/${encodeURIComponent(id)}`, { method: "DELETE" }),
    generateRequirementTasks: (id, body) => request(`/api/v1/requirements/${encodeURIComponent(id)}/generate-tasks`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    reviewRequirement: (id) => request(`/api/v1/requirements/${encodeURIComponent(id)}/review`, { method: "POST" }),
    applyRequirementReview: (id, body) => request(`/api/v1/requirements/${encodeURIComponent(id)}/apply-review`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    contextMe: () => request("/api/v1/context/me"),
    tasks: (params = {}) => {
        const normalized = typeof params === "string" ? { sprint_id: params } : params;
        const qs = new URLSearchParams();
        for (const [key, value] of Object.entries(normalized)) {
            if (value)
                qs.set(key, String(value));
        }
        const suffix = qs.toString() ? `?${qs}` : "";
        return request(`/api/v1/tasks${suffix}`);
    },
    tasksSummary: () => request("/api/v1/tasks/summary"),
    tasksCharts: () => request("/api/v1/tasks/charts"),
    copilotSummarize: (items) => request("/api/v1/copilot/summarize", {
        method: "POST",
        body: JSON.stringify({ items }),
    }),
    copilotSuggest: (goal, context = "") => request("/api/v1/copilot/suggest", {
        method: "POST",
        body: JSON.stringify({ goal, context }),
    }),
    updateTask: (id, patch) => request(`/api/v1/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    }),
    bulkUpdateTasks: (body) => request("/api/v1/tasks/bulk", {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    dispatchTasks: (body) => request("/api/v1/tasks/dispatch-plan", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskSchedulerPlan: (body) => request("/api/v1/tasks/scheduler/plan", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskSchedulerRuns: (limit = 20, q = "", includeArchived = false) => {
        const qs = new URLSearchParams({ limit: String(limit), include_archived: includeArchived ? "true" : "false" });
        if (q)
            qs.set("q", q);
        return request(`/api/v1/tasks/scheduler/runs?${qs}`);
    },
    taskSchedulerRunAction: (scheduleId, body) => request(`/api/v1/tasks/scheduler/runs/${encodeURIComponent(scheduleId)}/action`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskSchedulerOpsSummary: () => request("/api/v1/tasks/scheduler/ops-summary"),
    taskSchedulerRunbook: (body) => request("/api/v1/tasks/scheduler/runbook", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskSchedulerInsights: (body) => request("/api/v1/tasks/scheduler/insights", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskSchedulerInsightTasks: (body) => request("/api/v1/tasks/scheduler/insights/tasks", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskAgentFeed: (limit = 10, agent = "", includeBlocked = false) => {
        const qs = new URLSearchParams({ limit: String(limit), include_blocked: includeBlocked ? "true" : "false" });
        if (agent)
            qs.set("agent", agent);
        return request(`/api/v1/tasks/agent-feed?${qs}`);
    },
    taskAgentClaims: (status = "active", limit = 50) => request(`/api/v1/tasks/agent-feed/claims?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(String(limit))}`),
    taskAgentClaim: (body) => request("/api/v1/tasks/agent-feed/claim", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskAgentExecutionPlan: (body) => request("/api/v1/tasks/agent-feed/execution-plan", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskAgentPlan: (taskId, claimId = "", agent = "", includeContext = true) => {
        const qs = new URLSearchParams({ include_context: includeContext ? "true" : "false" });
        if (claimId)
            qs.set("claim_id", claimId);
        if (agent)
            qs.set("agent", agent);
        return request(`/api/v1/tasks/${encodeURIComponent(taskId)}/agent-plan?${qs.toString()}`);
    },
    taskAgentHeartbeat: (body) => request("/api/v1/tasks/agent-feed/heartbeat", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskAgentReport: (id, body) => request(`/api/v1/tasks/${encodeURIComponent(id)}/agent-report`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskAgentReports: (limit = 100, status = "", agent = "", taskId = "", q = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (status)
            qs.set("status", status);
        if (agent)
            qs.set("agent", agent);
        if (taskId)
            qs.set("task_id", taskId);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/tasks/agent-feed/reports?${qs.toString()}`);
    },
    taskQualityPolicy: () => request("/api/v1/tasks/quality/policy"),
    taskQualityPolicyUpdate: (body) => request("/api/v1/tasks/quality/policy", {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    taskQualitySummary: (limit = 100) => request(`/api/v1/tasks/quality/summary?limit=${encodeURIComponent(String(limit))}`),
    taskQualityTasks: (body) => request("/api/v1/tasks/quality/tasks", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskQuality: (id) => request(`/api/v1/tasks/${encodeURIComponent(id)}/quality`),
    taskQualityEvaluate: (body) => request("/api/v1/tasks/quality/evaluate", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    taskDependencies: () => request("/api/v1/tasks/dependencies"),
    taskDependencyTasks: (body) => request("/api/v1/tasks/dependencies/tasks", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    addTaskDependency: (id, body) => request(`/api/v1/tasks/${encodeURIComponent(id)}/dependencies`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    deleteTaskDependency: (id, targetId, type = "") => {
        const qs = type ? `?type=${encodeURIComponent(type)}` : "";
        return request(`/api/v1/tasks/${encodeURIComponent(id)}/dependencies/${encodeURIComponent(targetId)}${qs}`, { method: "DELETE" });
    },
    reorderTasksBoard: (groups) => request("/api/v1/tasks/reorder-board", {
        method: "POST",
        body: JSON.stringify({ groups }),
    }),
    createTask: (body) => request("/api/v1/tasks", { method: "POST", body: JSON.stringify(body) }),
    deleteTask: (id) => request(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    sprints: () => request("/api/v1/sprints").then((r) => r.items ?? []),
    sprintProgress: (id) => request(`/api/v1/sprints/${encodeURIComponent(id)}/progress`),
    sprintsSummary: (projectId) => {
        const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
        return request(`/api/v1/sprints/summary${qs}`);
    },
    sprintBurndown: (sprintId) => request(`/api/v1/sprints/${encodeURIComponent(sprintId)}/burndown`),
    sprintOpsPlan: (sprintId = "") => {
        const qs = sprintId ? `?sprint_id=${encodeURIComponent(sprintId)}` : "";
        return request(`/api/v1/sprints/ops-plan${qs}`);
    },
    sprintOpsTasks: (body) => request("/api/v1/sprints/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
    workflowTypes: () => request("/api/v1/workflows/types"),
    workflowSummary: () => request("/api/v1/workflows/summary"),
    workflowCharts: () => request("/api/v1/workflows/charts"),
    workflowInstances: (limit = 100, status = "", type = "", q = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (status)
            qs.set("status", status);
        if (type)
            qs.set("type", type);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/workflows/instances?${qs}`);
    },
    workflowEvents: (limit = 100, workflowId = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (workflowId)
            qs.set("workflow_id", workflowId);
        return request(`/api/v1/workflows/events?${qs}`);
    },
    workflowEngineStatus: () => request("/api/v1/workflows/engine/status"),
    workflowOpsPlan: () => request("/api/v1/workflows/ops-plan"),
    workflowOpsTasks: (body) => request("/api/v1/workflows/ops-tasks", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    workflowDetail: (workflowId, eventsLimit = 80) => request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/detail?events_limit=${eventsLimit}`),
    startWorkflow: (body) => request("/api/v1/workflows/start", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    signalWorkflow: (workflowId, body) => request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/signal`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    cancelWorkflow: (workflowId) => request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/cancel`, { method: "POST" }),
    bulkCancelWorkflows: (workflowIds) => request("/api/v1/workflows/bulk-cancel", {
        method: "POST",
        body: JSON.stringify({ workflow_ids: workflowIds }),
    }),
    marketplaceList: (q = "", type = "", sort = "rating") => {
        const qs = new URLSearchParams({ q, sort, size: "60" });
        if (type)
            qs.set("type", type);
        return request(`/api/v1/marketplace/packages?${qs}`);
    },
    marketplaceSummary: () => request("/api/v1/marketplace/summary"),
    marketplaceInstalled: () => request("/api/v1/marketplace/installed"),
    marketplaceRefresh: () => request("/api/v1/marketplace/refresh", { method: "POST" }),
    marketplaceVerify: (name) => request(`/api/v1/marketplace/packages/${encodeURIComponent(name)}/verify`),
    marketplaceRatings: (name, limit = 20) => request(`/api/v1/marketplace/packages/${encodeURIComponent(name)}/ratings?limit=${encodeURIComponent(String(limit))}`),
    marketplaceInstall: (body) => request("/api/v1/marketplace/install", { method: "POST", body: JSON.stringify(body) }),
    marketplaceUninstall: (name) => request(`/api/v1/marketplace/installed/${encodeURIComponent(name)}`, { method: "DELETE" }),
    marketplaceRate: (body) => request("/api/v1/marketplace/rate", { method: "POST", body: JSON.stringify(body) }),
    marketplaceLegacyList: (q = "") => request(`/api/v1/marketplace/packages?q=${encodeURIComponent(q)}`),
    auditState: () => request("/api/v1/audit/chain/state"),
    auditVerify: () => request("/api/v1/audit/chain/verify"),
    auditSummary: () => request("/api/v1/audit/summary"),
    auditCharts: () => request("/api/v1/audit/charts"),
    auditTimeline: (limit = 80, projectId) => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (projectId)
            qs.set("project_id", projectId);
        return request(`/api/v1/audit/timeline?${qs}`);
    },
    auditEvents: (q = "", page = 1, size = 100) => {
        const qs = new URLSearchParams({ q, page: String(page), size: String(size) });
        return request(`/api/v1/audit/events?${qs}`);
    },
    auditRecord: (body) => request("/api/v1/audit/record", { method: "POST", body: JSON.stringify(body) }),
    auditEventTask: (auditId, body) => request(`/api/v1/audit/events/${encodeURIComponent(auditId)}/task`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    auditExportCsvUrl: () => "/api/v1/audit/export.csv",
    copilotAsk: (query, context, session_id = "", run_id = "") => request("/api/v1/copilot/ask", {
        method: "POST",
        body: JSON.stringify({ query, session_id, run_id, ...(context ? { context } : {}) }),
    }),
    copilotSessions: (limit = 100) => request(`/api/v1/copilot/sessions?limit=${encodeURIComponent(String(limit))}`),
    copilotSession: (sessionId, limit = 100) => request(`/api/v1/copilot/sessions/${encodeURIComponent(sessionId)}?limit=${encodeURIComponent(String(limit))}`),
    copilotCommands: (q = "", limit = 30) => {
        const qs = new URLSearchParams({ q, limit: String(limit) });
        return request(`/api/v1/copilot/commands?${qs}`);
    },
    copilotResolveCommand: (query, limit = 8) => request("/api/v1/copilot/commands/resolve", {
        method: "POST",
        body: JSON.stringify({ query, limit }),
    }),
    copilotPlan: (body) => request("/api/v1/copilot/plan", { method: "POST", body: JSON.stringify(body) }),
    copilotPlanTasks: (body) => request("/api/v1/copilot/plan/tasks", { method: "POST", body: JSON.stringify(body) }),
    knowledgeSearch: (q, category) => {
        const qs = new URLSearchParams({ q });
        if (category)
            qs.set("category", category);
        return request(`/api/v1/knowledge/search?${qs}`);
    },
    knowledgeCreate: (body) => request("/api/v1/knowledge", { method: "POST", body: JSON.stringify(body) }),
    rules: () => request("/api/v1/rules"),
    ruleCreate: (body) => request("/api/v1/rules", { method: "POST", body: JSON.stringify(body) }),
    reflectionDistill: (body) => request("/api/v1/reflections/distill", { method: "POST", body: JSON.stringify(body) }),
    reflectionProposals: (limit = 100) => request(`/api/v1/reflections/proposals?limit=${encodeURIComponent(String(limit))}`),
    reflectionReviewProposal: (proposalId, body) => request(`/api/v1/reflections/proposals/${encodeURIComponent(proposalId)}/review`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    memoryHealth: () => request("/api/v1/memory/health"),
    memoryRecent: (limit = 30) => request(`/api/v1/memory/recent?limit=${encodeURIComponent(String(limit))}`),
    memorySearch: (q, limit = 20) => request(`/api/v1/memory/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`),
    memoryAdd: (body) => request("/api/v1/memory", { method: "POST", body: JSON.stringify(body) }),
    dbDrivers: () => request("/api/v1/db-config/drivers"),
    dbConnections: () => request("/api/v1/db-config/connections"),
    dbUpsertConnection: (name, body) => request(`/api/v1/db-config/connections/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    dbTestConnection: (name, url = "") => {
        const qs = url ? `?url=${encodeURIComponent(url)}` : "";
        return request(`/api/v1/db-config/connections/${encodeURIComponent(name)}/test${qs}`, {
            method: "POST",
        });
    },
    dbDeleteConnection: (name) => request(`/api/v1/db-config/connections/${encodeURIComponent(name)}`, { method: "DELETE" }),
    eventsList: (limit = 100, since = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (since)
            qs.set("since", since);
        return request(`/api/v1/events?${qs}`);
    },
    usageCharts: (limit = 5000) => request(`/api/v1/usage/charts?limit=${encodeURIComponent(String(limit))}`),
    usageSummary: (limit = 5000, since = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (since)
            qs.set("since", since);
        return request(`/api/v1/usage/summary?${qs}`);
    },
    usageQuota: () => request("/api/v1/usage/quota"),
    usageSetQuota: (limits) => request("/api/v1/usage/quota", { method: "PUT", body: JSON.stringify({ limits }) }),
    usageAlerts: (limit = 5000) => request(`/api/v1/usage/alerts?limit=${encodeURIComponent(String(limit))}`),
    usageAlertTasks: (body) => request("/api/v1/usage/alerts/tasks", { method: "POST", body: JSON.stringify(body) }),
    billingSubscription: () => request("/api/v1/billing/subscription"),
    billingPlans: () => request("/api/v1/billing/plans"),
    billingAlerts: () => request("/api/v1/billing/alerts"),
    billingSummary: () => request("/api/v1/billing/summary"),
    billingInvoice: (period = "") => {
        const qs = period ? `?period=${encodeURIComponent(period)}` : "";
        return request(`/api/v1/billing/invoice${qs}`);
    },
    billingInvoiceCsvUrl: (period = "") => `/api/v1/billing/invoice/export.csv${period ? `?period=${encodeURIComponent(period)}` : ""}`,
    billingInvoices: (limit = 20) => request(`/api/v1/billing/invoices?limit=${encodeURIComponent(String(limit))}`),
    billingSnapshotInvoice: (period = "") => {
        const qs = period ? `?period=${encodeURIComponent(period)}` : "";
        return request(`/api/v1/billing/invoice/snapshot${qs}`, { method: "POST" });
    },
    billingUpdateInvoiceStatus: (invoiceId, status, note = "") => request(`/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, note }),
    }),
    billingPayments: (invoiceId = "", limit = 50) => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (invoiceId)
            qs.set("invoice_id", invoiceId);
        return request(`/api/v1/billing/payments?${qs}`);
    },
    billingRecordPayment: (body) => request("/api/v1/billing/payments", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    billingUpdateSubscription: (body) => request("/api/v1/billing/subscription", {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    systemPages: (params = {}) => {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value && value !== "all")
                qs.set(key, value);
        });
        return request(`/api/v1/system/pages${qs.toString() ? `?${qs}` : ""}`);
    },
    systemPagesValidate: () => request("/api/v1/system/pages/validate"),
    systemPagesManifest: () => request("/api/v1/system/pages/manifest"),
    systemPagesManifestMe: () => request("/api/v1/system/pages/manifest/me"),
    systemPagesActions: () => request("/api/v1/system/pages/actions"),
    systemPagesActionsMe: () => request("/api/v1/system/pages/actions/me"),
    systemPagesActionPolicy: () => request("/api/v1/system/pages/actions/policy"),
    systemPagesActionPolicyUpdate: (body) => request("/api/v1/system/pages/actions/policy", {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    systemPagesActionApprovals: (status = "pending", limit = 100) => request(`/api/v1/system/pages/actions/approvals?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(String(limit))}`),
    systemPagesActionApprovalReview: (approvalId, body) => request(`/api/v1/system/pages/actions/approvals/${encodeURIComponent(approvalId)}/review`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    systemPagesActionRuns: (limit = 50, moduleId = "", actionId = "", riskLevel = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (moduleId)
            qs.set("module_id", moduleId);
        if (actionId)
            qs.set("action_id", actionId);
        if (riskLevel && riskLevel !== "all")
            qs.set("risk_level", riskLevel);
        return request(`/api/v1/system/pages/actions/runs?${qs}`);
    },
    systemPagesActionPlan: (body) => request("/api/v1/system/pages/actions/plan", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    systemPagesActionExecute: (body) => request("/api/v1/system/pages/actions/execute", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    systemPagesCapabilities: () => request("/api/v1/system/pages/capabilities"),
    systemPagesCapabilitiesMe: () => request("/api/v1/system/pages/capabilities/me"),
    systemPagesHealth: () => request("/api/v1/system/pages/health"),
    systemPagesMenuPreferencesMe: () => request("/api/v1/system/pages/menu/preferences/me"),
    systemPagesMenuPreferencesUpdate: (body) => request("/api/v1/system/pages/menu/preferences/me", {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    systemPagesLegacyMigrationPlan: () => request("/api/v1/system/pages/legacy/migration-plan"),
    systemLegacyPage: (consoleId) => request(`/api/v1/system/pages/legacy/${encodeURIComponent(consoleId)}`),
    systemPagesCapabilityCheck: (body) => request("/api/v1/system/pages/capabilities/check", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    systemPagesBacklogTasks: (body) => request("/api/v1/system/pages/backlog/tasks", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    businesses: () => request("/api/v1/businesses"),
    createBusiness: (body) => request("/api/v1/businesses", { method: "POST", body: JSON.stringify(body) }),
    updateBusiness: (businessId, body) => request(`/api/v1/businesses/${encodeURIComponent(businessId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    deleteBusiness: (businessId) => request(`/api/v1/businesses/${encodeURIComponent(businessId)}`, { method: "DELETE" }),
    platformsList: () => request("/api/v1/platforms"),
    platformsSummary: () => request("/api/v1/platforms/summary"),
    platformsCharts: () => request("/api/v1/platforms/charts"),
    platformsInstallShims: (id) => request(`/api/v1/platforms/install-shims/${encodeURIComponent(id)}`, { method: "POST" }),
    platformsOpsPlan: () => request("/api/v1/platforms/ops-plan"),
    platformsOpsTasks: (body) => request("/api/v1/platforms/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
    agents: () => request("/api/v1/agents"),
    agentsBuiltin: () => request("/api/v1/agents/builtin"),
    agentsSummary: () => request("/api/v1/agents/summary"),
    agentRunsSummary: () => request("/api/v1/agents/runs/summary"),
    agentRuns: (agent = "", status = "", limit = 100) => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (agent)
            qs.set("agent", agent);
        if (status)
            qs.set("status", status);
        return request(`/api/v1/agents/runs?${qs}`);
    },
    agentRunsSlo: () => request("/api/v1/agents/runs/slo"),
    agentRunsRebalanceTasks: (body) => request("/api/v1/agents/runs/rebalance-tasks", { method: "POST", body: JSON.stringify(body) }),
    agentGroups: () => request("/api/v1/agents/groups"),
    agentProfile: (id) => request(`/api/v1/agents/${encodeURIComponent(id)}/profile`),
    agentBootstrapBuiltin: (overwrite = false) => request(`/api/v1/agents/bootstrap-builtin?overwrite=${overwrite ? "true" : "false"}`, { method: "POST" }),
    agentCreate: (body) => request("/api/v1/agents", { method: "POST", body: JSON.stringify(body) }),
    agentDelete: (id) => request(`/api/v1/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    agentGroupCreate: (body) => request("/api/v1/agents/groups", { method: "POST", body: JSON.stringify(body) }),
    agentGroupDelete: (id) => request(`/api/v1/agents/groups/${encodeURIComponent(id)}`, { method: "DELETE" }),
    mcpServers: () => request("/api/v1/mcp"),
    mcpSummary: () => request("/api/v1/mcp/summary"),
    mcpBuiltin: () => request("/api/v1/mcp/builtin"),
    mcpProfile: () => request("/api/v1/mcp/profile"),
    mcpUpsert: (body) => request("/api/v1/mcp", { method: "POST", body: JSON.stringify(body) }),
    mcpDelete: (name) => request(`/api/v1/mcp/${encodeURIComponent(name)}`, { method: "DELETE" }),
    mcpInstallBuiltin: (name) => request(`/api/v1/mcp/install-builtin/${encodeURIComponent(name)}`, { method: "POST" }),
    mcpInstallAllBuiltin: () => request("/api/v1/mcp/install-builtin", { method: "POST" }),
    models: () => request("/api/v1/models"),
    modelsSetDefault: (modelId) => request(`/api/v1/models/default?model_id=${encodeURIComponent(modelId)}`, { method: "PUT" }),
    modelsUpsertProvider: (name, body) => request(`/api/v1/models/providers/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    modelsDeleteProvider: (name) => request(`/api/v1/models/providers/${encodeURIComponent(name)}`, { method: "DELETE" }),
    modelsTestProvider: (name) => request(`/api/v1/models/providers/${encodeURIComponent(name)}/test`, { method: "POST" }),
    modelsAddCustom: (body) => request("/api/v1/models/custom", { method: "POST", body: JSON.stringify(body) }),
    modelsDeleteCustom: (modelId) => request(`/api/v1/models/custom/${encodeURIComponent(modelId)}`, { method: "DELETE" }),
    modelsSetRole: (body) => request("/api/v1/models/role-model", { method: "PUT", body: JSON.stringify(body) }),
    authUsers: () => request("/api/v1/auth/users"),
    authCreateUser: (body) => request("/api/v1/auth/users", { method: "POST", body: JSON.stringify(body) }),
    authUpdateUser: (userId, body) => request(`/api/v1/auth/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    authDeleteUser: (userId) => request(`/api/v1/auth/users/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    projectMembers: (projectId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/members`),
    projectMemberCandidates: (projectId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/member-candidates`),
    projectAddMember: (projectId, body) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/members`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    projectUpdateMember: (projectId, userId, body) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    projectRemoveMember: (projectId, userId) => request(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
    }),
    roleConstants: () => request("/api/v1/auth/role-constants"),
    notifyChannels: () => request("/api/v1/notify/channels"),
    notifyConnectors: () => request("/api/v1/notify/connectors"),
    notifyConnectorCallbackTemplate: (connectorType) => request(`/api/v1/notify/connectors/${encodeURIComponent(connectorType)}/callback-template`),
    notifyConnectorVerify: (connectorType, body) => request(`/api/v1/notify/connectors/${encodeURIComponent(connectorType)}/verify`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    notifyTemplates: () => request("/api/v1/notify/templates"),
    notifySummary: () => request("/api/v1/notify/summary"),
    notifyTimeline: (limit = 80, direction = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (direction)
            qs.set("direction", direction);
        return request(`/api/v1/notify/timeline?${qs}`);
    },
    organizationSummary: () => request("/api/v1/organization/summary"),
    organizationPolicy: () => request("/api/v1/organization/policy"),
    organizationPolicyUpdate: (body) => request("/api/v1/organization/policy", {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    organizationPolicyReset: () => request("/api/v1/organization/policy/reset", { method: "POST" }),
    organizationPolicyCheck: (body) => request("/api/v1/organization/policy/check", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    organizationPolicyHistory: (limit = 50) => request(`/api/v1/organization/policy/history?limit=${encodeURIComponent(String(limit))}`),
    organizationAccessReview: () => request("/api/v1/organization/access-review"),
    organizationAccessReviewTasks: (body) => request("/api/v1/organization/access-review/tasks", {
        method: "POST",
        body: JSON.stringify(body),
    }),
    notifyMessages: (limit = 100, direction = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (direction)
            qs.set("direction", direction);
        return request(`/api/v1/notify/messages?${qs}`);
    },
    notifyAddChannel: (body) => request("/api/v1/notify/channels", { method: "POST", body: JSON.stringify(body) }),
    notifyPatchChannel: (name, body) => request(`/api/v1/notify/channels/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    notifyDeleteChannel: (name) => request(`/api/v1/notify/channels/${encodeURIComponent(name)}`, { method: "DELETE" }),
    notifyTestChannel: (name) => request(`/api/v1/notify/test/${encodeURIComponent(name)}`, { method: "POST" }),
    notifySend: (body) => request("/api/v1/notify/send", { method: "POST", body: JSON.stringify(body) }),
    notifyInbound: (body) => request("/api/v1/notify/inbound", { method: "POST", body: JSON.stringify(body) }),
    notifyInboundAction: (messageId, body) => request(`/api/v1/notify/inbound/${encodeURIComponent(messageId)}/action`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    analyticsOverview: () => request("/api/v1/analytics/overview"),
    analyticsCharts: () => request("/api/v1/analytics/charts"),
    analyticsCatalog: () => request("/api/v1/analytics/catalog"),
    analyticsGovernanceHub: () => request("/api/v1/analytics/governance/hub"),
    analyticsGovernanceDomainSummary: (domain) => request(`/api/v1/analytics/governance/domains/${encodeURIComponent(domain)}/summary`),
    analyticsGovernanceDomainCharts: (domain) => request(`/api/v1/analytics/governance/domains/${encodeURIComponent(domain)}/charts`),
    analyticsAssets: (type = "", status = "", q = "") => {
        const qs = new URLSearchParams();
        if (type)
            qs.set("type", type);
        if (status)
            qs.set("status", status);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/assets${qs.toString() ? `?${qs}` : ""}`);
    },
    analyticsPatchAsset: (assetId, body) => request(`/api/v1/analytics/assets/${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    analyticsMetricsCenter: (domain = "", q = "") => {
        const qs = new URLSearchParams();
        if (domain)
            qs.set("domain", domain);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/metrics/center${qs.toString() ? `?${qs}` : ""}`);
    },
    analyticsUpsertMetric: (body) => request("/api/v1/analytics/metrics/center", { method: "POST", body: JSON.stringify(body) }),
    analyticsTags: (category = "", q = "") => {
        const qs = new URLSearchParams();
        if (category)
            qs.set("category", category);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/tags${qs.toString() ? `?${qs}` : ""}`);
    },
    analyticsUpsertTag: (body) => request("/api/v1/analytics/tags", { method: "POST", body: JSON.stringify(body) }),
    analyticsDataServices: (status = "", q = "") => {
        const qs = new URLSearchParams();
        if (status)
            qs.set("status", status);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/services${qs.toString() ? `?${qs}` : ""}`);
    },
    analyticsUpsertDataService: (body) => request("/api/v1/analytics/services", { method: "POST", body: JSON.stringify(body) }),
    analyticsPublishDataService: (serviceId, body) => request(`/api/v1/analytics/services/${encodeURIComponent(serviceId)}/publish`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    analyticsDevTemplates: (status = "", q = "") => {
        const qs = new URLSearchParams();
        if (status)
            qs.set("status", status);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/development/templates${qs.toString() ? `?${qs}` : ""}`);
    },
    analyticsUpsertDevTemplate: (body) => request("/api/v1/analytics/development/templates", { method: "POST", body: JSON.stringify(body) }),
    analyticsDevTemplateTasks: (body) => request("/api/v1/analytics/development/tasks", { method: "POST", body: JSON.stringify(body) }),
    analyticsDevSchedule: (body) => request("/api/v1/analytics/development/schedule", { method: "POST", body: JSON.stringify(body) }),
    analyticsDevOpsSummary: () => request("/api/v1/analytics/development/ops-summary"),
    analyticsDevRunbook: (body) => request("/api/v1/analytics/development/runbook", { method: "POST", body: JSON.stringify(body) }),
    analyticsDevSchedules: (limit = 20, q = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/development/schedules?${qs}`);
    },
    analyticsDevScheduleDetail: (scheduleId) => request(`/api/v1/analytics/development/schedules/${encodeURIComponent(scheduleId)}`),
    analyticsDevScheduleAction: (scheduleId, body) => request(`/api/v1/analytics/development/schedules/${encodeURIComponent(scheduleId)}/action`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    analyticsDevAgentFeed: (limit = 20, scheduleId = "", agent = "", includeBlocked = false) => {
        const qs = new URLSearchParams({ limit: String(limit), include_blocked: String(includeBlocked) });
        if (scheduleId)
            qs.set("schedule_id", scheduleId);
        if (agent)
            qs.set("agent", agent);
        return request(`/api/v1/analytics/development/agent-feed?${qs}`);
    },
    analyticsDevAgentFeedAction: (body) => request("/api/v1/analytics/development/agent-feed/action", { method: "POST", body: JSON.stringify(body) }),
    analyticsDevEvidence: (limit = 20, scheduleId = "", packetId = "", decision = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (scheduleId)
            qs.set("schedule_id", scheduleId);
        if (packetId)
            qs.set("packet_id", packetId);
        if (decision)
            qs.set("decision", decision);
        return request(`/api/v1/analytics/development/evidence?${qs}`);
    },
    analyticsDevEvidenceTasks: (body) => request("/api/v1/analytics/development/evidence/tasks", { method: "POST", body: JSON.stringify(body) }),
    analyticsDevEvidenceNotify: (body) => request("/api/v1/analytics/development/evidence/notify", { method: "POST", body: JSON.stringify(body) }),
    analyticsQualityRules: () => request("/api/v1/analytics/quality/rules"),
    analyticsQualityEvaluate: (body) => request("/api/v1/analytics/quality/evaluate", { method: "POST", body: JSON.stringify(body) }),
    analyticsQualityAlerts: (severity = "", q = "") => {
        const qs = new URLSearchParams();
        if (severity)
            qs.set("severity", severity);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/quality/alerts${qs.toString() ? `?${qs}` : ""}`);
    },
    analyticsQualityAlertTasks: (body) => request("/api/v1/analytics/quality/alerts/tasks", { method: "POST", body: JSON.stringify(body) }),
    analyticsQualityAlertNotify: (body) => request("/api/v1/analytics/quality/alerts/notify", { method: "POST", body: JSON.stringify(body) }),
    analyticsGovernanceTasks: (body) => request("/api/v1/analytics/governance/tasks", { method: "POST", body: JSON.stringify(body) }),
    analyticsLineage: () => request("/api/v1/analytics/lineage"),
    analyticsLineageImpact: (nodeId) => request(`/api/v1/analytics/lineage/impact?node_id=${encodeURIComponent(nodeId)}`),
    analyticsExportCsvUrl: () => "/api/v1/analytics/export.csv",
    analyticsNlq: (question) => request("/api/v1/analytics/nlq", { method: "POST", body: JSON.stringify({ question }) }),
    analyticsBlueprint: () => request("/api/v1/analytics/blueprint"),
    analyticsBlueprintSummary: () => request("/api/v1/analytics/blueprint/summary"),
    analyticsBlueprintCharts: () => request("/api/v1/analytics/blueprint/charts"),
    analyticsBlueprintTasks: (body) => request("/api/v1/analytics/blueprint/tasks", { method: "POST", body: JSON.stringify(body) }),
    analyticsReports: (limit = 30, status = "", source = "", q = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (status)
            qs.set("status", status);
        if (source)
            qs.set("source", source);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/analytics/reports?${qs}`);
    },
    analyticsReportsSummary: () => request("/api/v1/analytics/reports/summary"),
    analyticsReportsCharts: () => request("/api/v1/analytics/reports/charts"),
    marketplaceCharts: () => request("/api/v1/marketplace/charts"),
    notifyCharts: () => request("/api/v1/notify/charts"),
    copilotHub: () => request("/api/v1/copilot/hub"),
    platformsHub: () => request("/api/v1/platforms/hub"),
    auditHub: () => request("/api/v1/audit/hub"),
    systemPagesHub: () => request("/api/v1/system/pages/hub"),
    skillsHub: () => request("/api/v1/skills/hub"),
    projectsHub: () => request("/api/v1/projects/hub"),
    organizationHub: () => request("/api/v1/organization/hub"),
    requirementsHub: () => request("/api/v1/requirements/hub"),
    requirementsCharts: () => request("/api/v1/requirements/charts"),
    tasksHub: () => request("/api/v1/tasks/hub"),
    workflowsHub: () => request("/api/v1/workflows/hub"),
    searchHub: () => request("/api/v1/search/hub"),
    vibeHub: () => request("/api/v1/vibe/hub"),
    analyticsDataHub: () => request("/api/v1/analytics/hub"),
    orchestrationHub: () => request("/api/v1/orchestration/hub"),
    envOpsHub: () => request("/api/v1/system/ops/hub"),
    settingsHub: () => request("/api/v1/settings/hub"),
    dashboardHub: () => request("/api/v1/dashboard/hub"),
    devFlowHub: () => request("/api/v1/dev-flow/hub"),
    issuesHub: () => request("/api/v1/issues/hub"),
    issuesCharts: () => request("/api/v1/issues/charts"),
    issuesSummary: () => request("/api/v1/issues/summary"),
    marketplaceHub: () => request("/api/v1/marketplace/hub"),
    notifyHub: () => request("/api/v1/notify/hub"),
    analyticsReportSubscription: () => request("/api/v1/analytics/report-subscription"),
    analyticsUpdateReportSubscription: (body) => request("/api/v1/analytics/report-subscription", { method: "PUT", body: JSON.stringify(body) }),
    analyticsTestReportSubscription: () => request("/api/v1/analytics/report-subscription/test", { method: "POST" }),
    analyticsCreateReport: (body) => request("/api/v1/analytics/reports", { method: "POST", body: JSON.stringify(body) }),
    analyticsUpdateReportStatus: (reportId, status) => request(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
    }),
    analyticsUpdateReportMeta: (reportId, body) => request(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/meta`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    analyticsDeleteReport: (reportId) => request(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" }),
    analyticsReportMarkdownUrl: (reportId) => `/api/v1/analytics/reports/${encodeURIComponent(reportId)}.md`,
    analyticsNotifyReport: (reportId, body) => request(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/notify`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    analyticsReportActionTasks: (reportId, body) => request(`/api/v1/analytics/reports/${encodeURIComponent(reportId)}/action-tasks`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    dataExchangeSummary: () => request("/api/v1/data-exchange/summary"),
    dataExchangeCharts: () => request("/api/v1/data-exchange/charts"),
    intelligenceHub: () => request("/api/v1/intelligence/hub"),
    dataExchangeExportUrl: (modules = []) => {
        const qs = modules.length ? `?modules=${encodeURIComponent(modules.join(","))}` : "";
        return `/api/v1/data-exchange/export${qs}`;
    },
    dataExchangePreview: (body) => request("/api/v1/data-exchange/preview", { method: "POST", body: JSON.stringify(body) }),
    dataExchangeImport: (body) => request("/api/v1/data-exchange/import", { method: "POST", body: JSON.stringify(body) }),
    dataExchangeJobs: (limit = 30) => request(`/api/v1/data-exchange/jobs?limit=${encodeURIComponent(String(limit))}`),
    dataExchangeExportJob: (modules = []) => request("/api/v1/data-exchange/export-job", {
        method: "POST",
        body: JSON.stringify({ modules }),
    }),
    ragSearch: (query, limit = 8) => request("/api/v1/rag/search", {
        method: "POST",
        body: JSON.stringify({ query, limit, hybrid: true, rerank: true }),
    }),
    workerEnqueue: (type, payload = {}) => request("/api/v1/worker/jobs", {
        method: "POST",
        body: JSON.stringify({ type, payload }),
    }),
    workerHealth: () => request("/api/v1/worker/health"),
    workerTypes: () => request("/api/v1/worker/types"),
    workerSummary: () => request("/api/v1/worker/summary"),
    workerJobs: (limit = 100, status = "", type = "") => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (status)
            qs.set("status", status);
        if (type)
            qs.set("type", type);
        return request(`/api/v1/worker/jobs?${qs}`);
    },
    workerCancel: (jobId) => request(`/api/v1/worker/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
    workerRetry: (jobId) => request(`/api/v1/worker/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }),
    syncHealth: () => request("/api/v1/sync/health"),
    syncModules: () => request("/api/v1/sync/modules"),
    syncSummary: () => request("/api/v1/sync/summary"),
    syncPull: (modules = "tasks,requirements,issues,sprints,rules,specs,templates", cursor = "", limit = 50) => {
        const qs = new URLSearchParams({ modules, cursor, limit: String(limit) });
        return request(`/api/v1/sync/pull?${qs}`);
    },
    syncJournal: (since = "", limit = 100) => {
        const qs = new URLSearchParams({ since, limit: String(limit) });
        return request(`/api/v1/sync/journal?${qs}`);
    },
    syncPush: (body) => request("/api/v1/sync/push", { method: "POST", body: JSON.stringify(body) }),
    login: (body) => request("/api/v1/auth/login", { method: "POST", body: JSON.stringify(body) }),
    authMe: () => request("/api/v1/auth/me"),
    tenantOptions: () => request("/api/v1/auth/tenant-options"),
    logout: () => request("/api/v1/auth/logout", { method: "POST" }),
    ssoConfig: () => request("/api/v1/sso/config"),
    ssoUpsertProvider: (provider, body) => request(`/api/v1/sso/providers/${encodeURIComponent(provider)}`, {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    ssoDeleteProvider: (provider) => request(`/api/v1/sso/providers/${encodeURIComponent(provider)}`, { method: "DELETE" }),
    ssoTestProvider: (provider) => request(`/api/v1/sso/providers/${encodeURIComponent(provider)}/test`, { method: "POST" }),
    ssoRolePreview: (provider, body) => request(`/api/v1/sso/providers/${encodeURIComponent(provider)}/role-preview`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    opsProfiles: () => request("/api/v1/system/ops/profiles"),
    opsUpsertProfile: (profile, body) => request(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}`, {
        method: "PUT",
        body: JSON.stringify(body),
    }),
    opsActivateProfile: (profile) => request(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/activate`, { method: "POST" }),
    opsDeleteProfile: (profile) => request(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}`, { method: "DELETE" }),
    opsProfileEnv: (profile) => request(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/env`),
    opsProfileBundle: (profile) => request(`/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/bundle`),
    opsProfileComposeUrl: (profile) => `/api/v1/system/ops/profiles/${encodeURIComponent(profile)}/compose.override.yml`,
    opsDoctor: () => request("/api/v1/system/ops/doctor"),
    opsObservability: () => request("/api/v1/system/ops/observability"),
    opsLogs: (name = "sop.app.log", limit = 200, level = "", q = "") => {
        const qs = new URLSearchParams({ name, limit: String(limit) });
        if (level)
            qs.set("level", level);
        if (q)
            qs.set("q", q);
        return request(`/api/v1/system/ops/logs?${qs}`);
    },
    metrics: () => fetch(BASE + "/metrics").then((r) => r.text()),
    workspaceSearch: (q) => request(`/api/v1/search?q=${encodeURIComponent(q)}`),
    semanticSearchStatus: () => request("/api/v1/semantic-search/status"),
    semanticSearch: (q, tables = "tasks,requirements,issues,knowledge,design_docs,specs", mode = "hybrid", limit = 8) => request(`/api/v1/semantic-search?q=${encodeURIComponent(q)}&tables=${encodeURIComponent(tables)}&mode=${mode}&limit=${limit}`),
    issues: (params = {}) => {
        const qs = new URLSearchParams();
        if (params.status)
            qs.set("status", params.status);
        if (params.severity)
            qs.set("severity", params.severity);
        if (params.q)
            qs.set("q", params.q);
        if (params.page)
            qs.set("page", String(params.page));
        if (params.size)
            qs.set("size", String(params.size));
        const suffix = qs.toString() ? `?${qs}` : "";
        return request(`/api/v1/issues${suffix}`);
    },
    createIssue: (body) => request("/api/v1/issues", { method: "POST", body: JSON.stringify(body) }),
    updateIssue: (id, patch) => request(`/api/v1/issues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    }),
    resolveIssue: (id, resolution) => request(`/api/v1/issues/${encodeURIComponent(id)}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ resolution }),
    }),
    deleteIssue: (id) => request(`/api/v1/issues/${encodeURIComponent(id)}`, { method: "DELETE" }),
    issueOpsPlan: () => request("/api/v1/issues/ops-plan"),
    issueOpsTasks: (body) => request("/api/v1/issues/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
    specsList: () => request("/api/v1/specs"),
    specsSummary: () => request("/api/v1/specs/summary"),
    specsContent: (path) => request(`/api/v1/specs/content?path=${encodeURIComponent(path)}`),
    specsSaveContent: (path, content) => request(`/api/v1/specs/content?path=${encodeURIComponent(path)}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
    }),
    designDocsList: () => request("/api/v1/design-docs"),
    designDocGet: (docId) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}`),
    designDocCreate: (body) => request("/api/v1/design-docs", { method: "POST", body: JSON.stringify(body) }),
    designDocVersions: (docId) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}/versions`),
    designDocVersionGet: (docId, version) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}/versions/${version}`),
    designDocAddVersion: (docId, content, note = "编辑保存") => request(`/api/v1/design-docs/${encodeURIComponent(docId)}/versions`, {
        method: "POST",
        body: JSON.stringify({ content, note }),
    }),
    designDocRestore: (docId, version) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}/restore`, {
        method: "POST",
        body: JSON.stringify({ version }),
    }),
    designDocPatchMeta: (docId, patch) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    }),
    designDocDelete: (docId) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}`, { method: "DELETE" }),
    designDocAiImprove: (docId, body) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}/ai-improve`, {
        method: "POST",
        body: JSON.stringify(body),
    }),
    designDocCompare: (docId, fromVersion, toVersion) => request(`/api/v1/design-docs/${encodeURIComponent(docId)}/compare?from=${fromVersion}&to=${toVersion}`),
    devFlowTemplates: () => request("/api/v1/dev-flow/templates"),
    devFlowOpsPlan: () => request("/api/v1/dev-flow/ops-plan"),
    devFlowOpsTasks: (body) => request("/api/v1/dev-flow/ops-tasks", { method: "POST", body: JSON.stringify(body) }),
    devFlowBurndown: (sprintId) => {
        const qs = sprintId ? `?sprint_id=${encodeURIComponent(sprintId)}` : "";
        return request(`/api/v1/dev-flow/burndown${qs}`);
    },
    skillsList: () => request("/api/v1/skills"),
    skillCreate: (body) => request("/api/v1/skills", { method: "POST", body: JSON.stringify(body) }),
    skillDelete: (skillId) => request(`/api/v1/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" }),
    skillRepoList: () => request("/api/v1/skill-repo/repos"),
    skillRepoAdd: (body) => request("/api/v1/skill-repo/repos", { method: "POST", body: JSON.stringify(body) }),
    skillRepoSync: (repoId) => request(`/api/v1/skill-repo/repos/${encodeURIComponent(repoId)}/sync`, { method: "POST" }),
    skillRepoInstalled: () => request("/api/v1/skill-repo/installed"),
    devFlowSummary: () => request("/api/v1/dev-flow/summary"),
    devFlowCharts: () => request("/api/v1/dev-flow/charts"),
    vibeSessions: () => request("/api/v1/vibe/sessions"),
    vibeSession: (id) => request(`/api/v1/vibe/sessions/${encodeURIComponent(id)}`),
    vibeCreateSession: (body) => request("/api/v1/vibe/sessions", { method: "POST", body: JSON.stringify(body) }),
    vibeDeleteSession: (id) => request(`/api/v1/vibe/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    vibeTemplates: () => request("/api/v1/vibe/templates"),
    vibeRun: (body) => request("/api/v1/vibe/run", { method: "POST", body: JSON.stringify(body) }),
    cliTools: () => request("/api/v1/cli"),
    cliRun: (body) => request("/api/v1/cli/run", { method: "POST", body: JSON.stringify(body) }),
    cliUpsertTool: (toolId, body) => request(`/api/v1/cli/tools/${encodeURIComponent(toolId)}`, { method: "POST", body: JSON.stringify(body) }),
    envCheckFull: () => request("/api/v1/env/check/full"),
    dockerPs: () => request("/api/v1/env/docker/ps"),
    orchestrationTools: () => request("/api/v1/orchestration/tools"),
    orchestrationWorkflows: () => request("/api/v1/orchestration/workflows"),
    orchestrationWorkflow: (wfId) => request(`/api/v1/orchestration/workflows/${encodeURIComponent(wfId)}`),
    orchestrationConfig: () => request("/api/v1/orchestration/config"),
    orchestrationEnvironmentChecks: () => request("/api/v1/orchestration/environment-checks"),
    webhooks: () => request("/api/v1/webhooks"),
    webhookEvents: () => request("/api/v1/webhooks/events"),
    createWebhook: (body) => request("/api/v1/webhooks", { method: "POST", body: JSON.stringify(body) }),
    deleteWebhook: (id) => request(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    testWebhook: (id) => request(`/api/v1/webhooks/${encodeURIComponent(id)}/test`, { method: "POST" }),
    patchWebhook: (id, body) => request(`/api/v1/webhooks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    }),
    webhookDeliveries: (hookId, limit = 50) => request(`/api/v1/webhooks/${encodeURIComponent(hookId)}/deliveries?limit=${limit}`),
    // ── Agent Runs ──────────────────────────────────────────────────────────
    agentRunsList: (agentId = "", status = "", limit = 100) => request(`/api/v1/agent-runs?agent_id=${agentId}&status=${status}&limit=${limit}`),
    agentRunCreate: (body) => request("/api/v1/agent-runs", { method: "POST", body: JSON.stringify(body) }),
    agentRunHeartbeat: (runId) => request(`/api/v1/agent-runs/${encodeURIComponent(runId)}/heartbeat`, { method: "PUT" }),
    agentRunStatus: (runId, body) => request(`/api/v1/agent-runs/${encodeURIComponent(runId)}/status`, { method: "PUT", body: JSON.stringify(body) }),
    agentRunEvidence: (runId, body) => request(`/api/v1/agent-runs/${encodeURIComponent(runId)}/evidence`, { method: "POST", body: JSON.stringify(body) }),
    agentRunDelete: (runId) => request(`/api/v1/agent-runs/${encodeURIComponent(runId)}`, { method: "DELETE" }),
    agentRunProfiles: () => request("/api/v1/agent-runs/profiles"),
    agentRunsSummaryV2: () => request("/api/v1/agent-runs/summary"),
    // ── Data Quality ────────────────────────────────────────────────────────
    dataQualityRules: (domain = "", status = "") => request(`/api/v1/data-quality/rules?domain=${domain}&status=${status}`),
    dataQualityRuleCreate: (body) => request("/api/v1/data-quality/rules", { method: "POST", body: JSON.stringify(body) }),
    dataQualityRuleUpdate: (id, body) => request(`/api/v1/data-quality/rules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    dataQualityRuleDelete: (id) => request(`/api/v1/data-quality/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
    dataQualityRuns: (ruleId = "", limit = 50) => request(`/api/v1/data-quality/runs?rule_id=${ruleId}&limit=${limit}`),
    dataQualityRunCreate: (body) => request("/api/v1/data-quality/runs", { method: "POST", body: JSON.stringify(body) }),
    dataQualityRunFinish: (id) => request(`/api/v1/data-quality/runs/${encodeURIComponent(id)}/finish`, { method: "POST" }),
    dataQualityAlerts: (severity = "", status = "") => request(`/api/v1/data-quality/alerts?severity=${severity}&status=${status}`),
    dataQualityAlertResolve: (id) => request(`/api/v1/data-quality/alerts/${encodeURIComponent(id)}/resolve`, { method: "POST" }),
    dataQualitySummary: () => request("/api/v1/data-quality/summary"),
    // ── Metrics Service ─────────────────────────────────────────────────────
    metricsCatalog: (domain = "", metricType = "") => request(`/api/v1/metrics-service/catalog?domain=${domain}&metric_type=${metricType}`),
    metricCreate: (body) => request("/api/v1/metrics-service/catalog", { method: "POST", body: JSON.stringify(body) }),
    metricUpdate: (id, body) => request(`/api/v1/metrics-service/catalog/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    metricDelete: (id) => request(`/api/v1/metrics-service/catalog/${encodeURIComponent(id)}`, { method: "DELETE" }),
    metricPublishApi: (metricId) => request(`/api/v1/metrics-service/api-publish?metric_id=${encodeURIComponent(metricId)}`, { method: "POST" }),
    metricsPublished: () => request("/api/v1/metrics-service/api-publish"),
    metricValues: (metricId, grain = "day") => request(`/api/v1/metrics-service/catalog/${encodeURIComponent(metricId)}/values?grain=${encodeURIComponent(grain)}`),
    metricsSummary: () => request("/api/v1/metrics-service/summary"),
    // ── Tag Service ─────────────────────────────────────────────────────────
    tagCatalog: (category = "") => request(`/api/v1/tag-service/catalog?category=${category}`),
    tagCreate: (body) => request("/api/v1/tag-service/catalog", { method: "POST", body: JSON.stringify(body) }),
    tagUpdate: (id, body) => request(`/api/v1/tag-service/catalog/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    tagDelete: (id) => request(`/api/v1/tag-service/catalog/${encodeURIComponent(id)}`, { method: "DELETE" }),
    tagRules: () => request("/api/v1/tag-service/rules"),
    tagRuleCreate: (body) => request("/api/v1/tag-service/rules", { method: "POST", body: JSON.stringify(body) }),
    tagRuleDelete: (id) => request(`/api/v1/tag-service/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
    tagOntology: () => request("/api/v1/tag-service/ontology"),
    tagEntityCreate: (body) => request("/api/v1/tag-service/ontology/entities", { method: "POST", body: JSON.stringify(body) }),
    tagEntityDelete: (id) => request(`/api/v1/tag-service/ontology/entities/${encodeURIComponent(id)}`, { method: "DELETE" }),
    tagSummary: () => request("/api/v1/tag-service/summary"),
    // ── Data Ingest ─────────────────────────────────────────────────────────
    dataIngestConnectors: (connectorType = "") => request(`/api/v1/data-ingest/connectors?connector_type=${connectorType}`),
    dataIngestConnectorCreate: (body) => request("/api/v1/data-ingest/connectors", { method: "POST", body: JSON.stringify(body) }),
    dataIngestConnectorUpdate: (id, body) => request(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    dataIngestConnectorDelete: (id) => request(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}`, { method: "DELETE" }),
    dataIngestConnectorTest: (id) => request(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}/test`, { method: "POST" }),
    dataIngestConnectorSchema: (id) => request(`/api/v1/data-ingest/connectors/${encodeURIComponent(id)}/schema`),
    dataIngestJobs: (connectorId = "", status = "") => request(`/api/v1/data-ingest/jobs?connector_id=${connectorId}&status=${status}`),
    dataIngestJobCreate: (body) => request("/api/v1/data-ingest/jobs", { method: "POST", body: JSON.stringify(body) }),
    dataIngestJobUpdate: (id, body) => request(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    dataIngestJobRun: (id) => request(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}/run`, { method: "POST" }),
    dataIngestJobStatus: (id, body) => request(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify(body) }),
    dataIngestJobDelete: (id) => request(`/api/v1/data-ingest/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
    dataIngestSummary: () => request("/api/v1/data-ingest/summary"),
    // ── A2A Gateway ─────────────────────────────────────────────────────────
    a2aRegistry: (agentType = "") => request(`/api/v1/a2a/registry?agent_type=${agentType}`),
    a2aRegister: (body) => request("/api/v1/a2a/registry", { method: "POST", body: JSON.stringify(body) }),
    a2aDeregister: (id) => request(`/api/v1/a2a/registry/${encodeURIComponent(id)}`, { method: "DELETE" }),
    a2aAgentStatus: (id, status) => request(`/api/v1/a2a/registry/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
    a2aNegotiate: (body) => request("/api/v1/a2a/negotiate", { method: "POST", body: JSON.stringify(body) }),
    a2aDispatch: (body) => request("/api/v1/a2a/dispatch", { method: "POST", body: JSON.stringify(body) }),
    a2aDispatches: (agentId = "", status = "") => request(`/api/v1/a2a/dispatch?agent_id=${agentId}&status=${status}`),
    a2aEvidence: (agentId = "") => request(`/api/v1/a2a/evidence?agent_id=${agentId}`),
    a2aReceiveEvidence: (body) => request("/api/v1/a2a/evidence", { method: "POST", body: JSON.stringify(body) }),
    a2aSummary: () => request("/api/v1/a2a/summary"),
    // ── LLM Gateway v2 ──────────────────────────────────────────────────────
    llmRoutes: () => request("/api/v1/llm-gateway/routes"),
    llmRouteCreate: (body) => request("/api/v1/llm-gateway/routes", { method: "POST", body: JSON.stringify(body) }),
    llmRouteUpdate: (id, body) => request(`/api/v1/llm-gateway/routes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    llmRouteDelete: (id) => request(`/api/v1/llm-gateway/routes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    llmResolveRoute: (taskType = "general") => request(`/api/v1/llm-gateway/resolve?task_type=${encodeURIComponent(taskType)}`, { method: "POST" }),
    llmCostStats: (modelId = "", period = "7d") => request(`/api/v1/llm-gateway/cost?model_id=${modelId}&period=${period}`),
    llmRecordCost: (body) => request("/api/v1/llm-gateway/cost", { method: "POST", body: JSON.stringify(body) }),
    llmThrottle: () => request("/api/v1/llm-gateway/throttle"),
    llmThrottleCreate: (body) => request("/api/v1/llm-gateway/throttle", { method: "POST", body: JSON.stringify(body) }),
    llmThrottleUpdate: (id, body) => request(`/api/v1/llm-gateway/throttle/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    llmThrottleDelete: (id) => request(`/api/v1/llm-gateway/throttle/${encodeURIComponent(id)}`, { method: "DELETE" }),
    llmGatewaySummary: () => request("/api/v1/llm-gateway/summary"),
    // ── Ops Center ──────────────────────────────────────────────────────────
    opsPipelines: () => request("/api/v1/ops-center/pipelines"),
    opsPipelineCreate: (body) => request("/api/v1/ops-center/pipelines", { method: "POST", body: JSON.stringify(body) }),
    opsPipelineTrigger: (id) => request(`/api/v1/ops-center/pipelines/${encodeURIComponent(id)}/trigger`, { method: "PUT" }),
    opsPipelineStatus: (id, body) => request(`/api/v1/ops-center/pipelines/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify(body) }),
    opsPipelineDelete: (id) => request(`/api/v1/ops-center/pipelines/${encodeURIComponent(id)}`, { method: "DELETE" }),
    opsRca: () => request("/api/v1/ops-center/rca"),
    opsRcaCreate: (body) => request("/api/v1/ops-center/rca", { method: "POST", body: JSON.stringify(body) }),
    opsRcaResolve: (id) => request(`/api/v1/ops-center/rca/${encodeURIComponent(id)}/resolve`, { method: "PUT" }),
    opsRunbooks: () => request("/api/v1/ops-center/runbooks"),
    opsRunbookCreate: (body) => request("/api/v1/ops-center/runbooks", { method: "POST", body: JSON.stringify(body) }),
    opsRunbookDelete: (id) => request(`/api/v1/ops-center/runbooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    opsSelfHeal: () => request("/api/v1/ops-center/self-heal"),
    opsSelfHealCreate: (body) => request("/api/v1/ops-center/self-heal", { method: "POST", body: JSON.stringify(body) }),
    opsSelfHealUpdate: (id, body) => request(`/api/v1/ops-center/self-heal/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    opsSelfHealApply: (id) => request(`/api/v1/ops-center/self-heal/${encodeURIComponent(id)}/apply`, { method: "POST" }),
    opsSelfHealDelete: (id) => request(`/api/v1/ops-center/self-heal/${encodeURIComponent(id)}`, { method: "DELETE" }),
    opsCenterSummary: () => request("/api/v1/ops-center/summary"),
};
