import { bindRequirementPlanningBack, requirementPlanningReturn } from "@/lib/requirementPlanning";
import { requirementEditSourcePatch } from "@/lib/deliveryRequirementAdoption";
import { currentEventHash, safeEventReturn } from "@/lib/eventReceipts";
import {
  fetchDeliveryContext,
  fetchDeliveryReferences,
  fetchRequirementDetail,
  fetchEditableRequirement,
  type RequirementDetail,
  invalidateDeliveryQueries,
  rebuildDeliveryQuery,
} from "@/lib/deliveryQuery";
import {
  DeliveryRequirementIndex,
  DeliveryRequirementTasks,
  DeliveryQueryError,
} from "./DeliveryQueryViews";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Skeleton,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { agentExecutionReturn } from "@/lib/executionCommands";
import { getProjectId, getToken } from "@/lib/authStorage";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  deliveryStages,
  prepareDeliveryIntent,
  saveDelivery,
  type DeliveryAction,
  type DeliveryIntent,
  type DeliveryMember,
  type DeliveryMilestone,
  type DeliveryContext,
  type DeliveryCommandAck,
  type DeliveryInboxTarget,
} from "@/lib/delivery";
import {
  DeliveryEditor,
  type EditorField,
  type EditorSpec,
} from "./DeliveryEditor";
import "./delivery-workbench.css";
import { DeliveryIssueWorkbench } from "./DeliveryIssueWorkbench";
import { DeliveryTaskPlanEditor } from "./DeliveryTaskPlanEditor";
import { DeliveryDesignContextPanel } from "./DeliveryDesignContextPanel";
import { planError } from "@/lib/deliveryTaskPlan";
import {
  deliveryInboxHash,
  deliveryInboxHref,
  deliveryViews,
  parseDeliveryRoute,
  normalizeInboxTarget,
  projectUpdatePayload,
  type DeliveryRoute,
  type InboxCategory,
  type InboxScope,
  type ResourceKindFilter,
} from "@/lib/deliveryProjectInbox";
import { DeliveryProjectResources } from "./DeliveryProjectResources";
import { DeliveryInbox } from "./DeliveryInbox";
import {
  useDeliveryInboxQuery,
  useDeliveryInboxNavigation,
} from "@/lib/deliveryAttention";
import { DeliveryProjectOverview } from "./DeliveryProjectOverview";
import { DeliveryProgress, DeliveryProgressSummary } from "./DeliveryProgress";
import { preserveProgressRoute } from "@/lib/deliveryProgress";
import { preserveSchedulingRoute } from "@/lib/deliveryScheduling";
import { DeliveryScheduling } from "./DeliveryScheduling";
import { DeliveryTaskDetail } from "./DeliveryTaskDetail";
import { TaskDefinitionRecoveryOwner } from "./DeliveryTaskDefinitionHost";
import { discoverTaskEditRecovery, taskEditRecoveryPending } from "@/lib/taskEditCommand";
import { taskDefinitionCopy } from "@/i18n/task-definition";
import { discoverSubmissionRecovery, externalDeliveryRecoveryPending } from "@/lib/deliveryTaskSubmission";
import { discoverWorkOrderRecovery, workOrderRecoveryPending } from "@/lib/externalWorkOrderCommand";
import { TaskExternalRecoveryOwner } from "./TaskExternalRecovery";
import { deliveryOperationRecoveryCopy } from "@/i18n/delivery-operation-recovery";
import {
  DeliveryActivityFeed,
  DeliveryActivityDetail,
} from "./DeliveryActivityFeed";
import { DeliveryCollaboration } from "./DeliveryDiscussionAdoption";
import { DeliverySourceSummary } from "./DeliverySourceSummary";
import { DeliveryRequirementChangeHost } from "./DeliveryRequirementChangeHost";
import {
  DeliveryRequirementDefinition,
  DeliveryRequirementRecords,
} from "./DeliveryRequirementReads";
import type {
  RequirementHead,
  RequirementEditable,
} from "@/lib/deliveryRequirementReads";
import { beginProgressExactRead } from "@/lib/deliveryProgress";
import { DeliveryRequirementHistory } from "./DeliveryRequirementHistory";
import {
  preserveCollaborationRoute,
  useCollaborationRoute,
  safeCollaborationReturn,
} from "@/lib/deliveryCollaboration";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { ProjectContextGate } from "@/components/ProjectContextGate";
import { preserveProjectContext } from "@/lib/projectPortfolioRoute";
import { DeliveryExecutionInspector } from "./DeliveryExecutionInspector";
import { ExecutionRouteRecoveryGate } from "./ExecutionRouteRecoveryGate";
import { TaskExecutionHandoffRecovery, TaskQueueOriginalRecovery } from "./TaskExecutionHandoffRecovery";
import { ExecutionOperationRecovery, executionOperationPending } from "./ExecutionOperationRecovery";
import { executionDispatchRecoveryPending } from "@/lib/executionDispatchCommand";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";
import { deliveryDraftCopy } from "@/i18n/delivery-drafts";
import { parseExecutionSelection } from "@/lib/executionRuntime";
import { DeliveryReleaseWorkbench } from "./DeliveryReleaseWorkbench";
import {
  parseReleaseRoute,
  releaseHash,
  releaseReturnFromHash,
} from "@/lib/deliveryReleaseRoute";

const subscribe = (cb: () => void) => {
  window.addEventListener("sop-session", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("sop-session", cb);
    window.removeEventListener("storage", cb);
  };
};
const sessionSnapshot = projectSessionKey;
const views = deliveryViews;
const lines = (value: unknown) =>
  String(value || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const dateValue = (value: unknown) => value || null;

export function DeliveryWorkbench() {
  const scope = useSyncExternalStore(subscribe, sessionSnapshot);
  return (
    <ProjectContextGate>
      <ExecutionRouteRecoveryGate key={scope}>
        <ProjectDelivery key={scope} />
      </ExecutionRouteRecoveryGate>
    </ProjectContextGate>
  );
}

function ProjectDelivery() {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`delivery.${key}`);
  const identityLabel = useMemberIdentity();
  const taskEditCopy = taskDefinitionCopy(i18n?.language);
  const [, refreshTaskRecovery] = useState(0);
  const [, refreshExternalRecovery] = useState(0), externalRecoveryCopy = deliveryOperationRecoveryCopy(i18n?.language);
  const tp = (key: string) => t(`deliveryProject.${key}`);
  const projectId = getProjectId() || "";
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const originScope = useRef(sessionSnapshot());
  const qc = useQueryClient();
  const queryKey = ["delivery-context", projectId, sessionId];
  const executionExit = useExecutionExitGuard();
  const draftExit = useExecutionExitGuard();
  const canNavigate = useCallback(() => executionExit.canNavigate() && draftExit.canNavigate(), [executionExit.canNavigate, draftExit.canNavigate]);
  const navigationPending = executionExit.pending || draftExit.pending;
  const [executionPinnedWorkspace, setExecutionPinnedWorkspace] =
    useState<DeliveryContext>();
  const executionPending = (identity: string, value: boolean) => {
    const pending = executionExit.setPending(identity, value);
    const current = qc.getQueryData<DeliveryContext>(queryKey);
    if (pending && current)
      setExecutionPinnedWorkspace(
        (previous) => previous || structuredClone(current),
      );
    else if (!pending) setExecutionPinnedWorkspace(undefined);
  };
  const [executionSelection, setExecutionSelection] = useState(() =>
    parseExecutionSelection(location.hash),
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchDeliveryContext(projectId, signal),
    enabled: Boolean(projectId && getToken()),
    gcTime: 0,
    refetchInterval: 5000,
  });
  const [view, setView] = useState(
    () => parseDeliveryRoute(location.hash).view,
  );
  const [selectedId, setSelectedId] = useState(
    () => parseDeliveryRoute(location.hash).requirement,
  );
  const [detailTab, setDetailTab] = useState(
    () => parseDeliveryRoute(location.hash).detail,
  );
  const [selectedTaskId, setSelectedTaskId] = useState(
    () => parseDeliveryRoute(location.hash).task,
  );
  type LocatedRecovery = { kind: "queue" | "execution"; taskId: string; executionId: string };
  const [locatedRecovery, setLocatedRecovery] = useState<LocatedRecovery | null>(null);
  const locatedRecoveryLive = useRef("");
  const contextReadAccess = useRef({ failed: false });
  const knownTaskRecovery = useRef<{ taskId: string; executionId: string }>();
  const taskRouteLive = useRef(selectedTaskId); taskRouteLive.current = selectedTaskId;
  const requestedTaskId =
    !selectedId && ["team", "timeline"].includes(view) ? selectedTaskId : "";
  const taskInspector = useDrawerIdentity(
    `${projectId}:${sessionId}`,
    requestedTaskId,
  );
  const inspectorDraftChanged = useCallback((value: boolean) => { draftExit.setPending(`${projectId}:${sessionId}:inspector:${taskInspector.displayId}`, value); }, [projectId, sessionId, taskInspector.displayId, draftExit.setPending]);
  const requirementTaskDraftChanged = useCallback((value: boolean) => { draftExit.setPending(`${projectId}:${sessionId}:requirement:${selectedId}:task:${selectedTaskId}`, value); }, [projectId, sessionId, selectedId, selectedTaskId, draftExit.setPending]);
  const [selectedIssueId, setSelectedIssueId] = useState(
    () => parseDeliveryRoute(location.hash).issue,
  );
  const [selectedExecutionId, setSelectedExecutionId] = useState(
    () =>
      new URLSearchParams(location.hash.split("?")[1]).get("execution_id") ||
      "",
  );
  const [inboxScope, setInboxScope] = useState<InboxScope>(
    () => parseDeliveryRoute(location.hash).inboxScope,
  );
  const [inboxCategory, setInboxCategory] = useState<InboxCategory>(
    () => parseDeliveryRoute(location.hash).inboxCategory,
  );
  const [resourceKind, setResourceKind] = useState<ResourceKindFilter>(
    () => parseDeliveryRoute(location.hash).resourceKind,
  );
  const [showArchived, setShowArchived] = useState(
    () => parseDeliveryRoute(location.hash).showArchived,
  );
  const taskNodes = useRef(new Map<string, HTMLElement>());
  const focusedTask = useRef("");
  useEffect(() => {
    const syncRoute = () => {
      const route = parseDeliveryRoute(location.hash);
      setSelectedExecutionId(
        new URLSearchParams(location.hash.split("?")[1]).get("execution_id") ||
          "",
      );
      setExecutionSelection(parseExecutionSelection(location.hash));
      setView(route.view);
      setSelectedId(route.requirement);
      setDetailTab(route.detail);
      setSelectedTaskId(route.task);
      setSelectedIssueId(route.issue);
      setInboxScope(route.inboxScope);
      setInboxCategory(route.inboxCategory);
      setResourceKind(route.resourceKind);
      setShowArchived(route.showArchived);
      setRoute(route);
    };
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);
  const [route, setRoute] = useState(() => parseDeliveryRoute(location.hash));
  const detailQuery = useQuery({
    queryKey: [
      "delivery-requirement-detail",
      projectId,
      sessionId,
      selectedId,
      query.data?.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchRequirementDetail(
        projectId,
        selectedId,
        signal,
        query.data?.query_generation,
      ),
    enabled: Boolean(selectedId) && !executionExit.pending,
    retry: false,
    gcTime: 0,
    refetchInterval: 5000,
  });
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [planRequirement, setPlanRequirement] =
    useState<RequirementEditable | null>(null);
  const [actionError, setActionError] = useState("");
  const lastRequest = useRef<{ signature: string; key: string }>();
  const editorIntent = useRef<DeliveryIntent>();
  const mutation = useMutation({
    mutationFn: async ({
      action,
      payload,
      form = true,
    }: {
      action: DeliveryAction;
      payload: Record<string, unknown>;
      form?: boolean;
    }) => {
      if (originScope.current !== sessionSnapshot())
        throw new Error(tr("scopeChanged"));
      if (!executionExit.canNavigate())
        throw new Error(t("deliveryExecutionRuntime.pendingNavigation"));
      const current = qc.getQueryData<DeliveryContext>(queryKey);
      if (!current) throw new Error(tr("refresh"));
      if (form && editorIntent.current) {
        const intent = prepareDeliveryIntent(
          editorIntent.current,
          action,
          payload,
        );
        editorIntent.current = intent;
        return saveDelivery(
          projectId,
          action,
          payload,
          intent.version,
          intent.key,
        );
      }
      const signature = JSON.stringify([action, payload, current.version]);
      if (lastRequest.current?.signature !== signature)
        lastRequest.current = { signature, key: crypto.randomUUID() };
      return saveDelivery(
        projectId,
        action,
        payload,
        current.version,
        lastRequest.current.key,
      );
    },
    onSuccess: (data) => {
      if (data.project_id === projectId)
        void invalidateDeliveryQueries(qc, projectId);
      for (const key of ["delivery-activity", "delivery-requirement-history"])
        void qc.invalidateQueries({ queryKey: [key, projectId, sessionId] });
      void qc.invalidateQueries({
        queryKey: ["delivery-inbox", projectId, sessionId],
      });
      setActionError("");
    },
    onError: (error) => {
      if (error.message.includes("409")) void query.refetch();
    },
  });
  const commit = async (
    action: DeliveryAction,
    payload: Record<string, unknown>,
    form = true,
  ) => {
    try {
      await mutation.mutateAsync({ action, payload, form });
    } catch (e) {
      const failure = planError(e);
      const error = new Error(
        failure.conflict ? tr("conflict") : failure.message,
      );
      error.name = failure.conflict ? "DeliveryConflict" : "Error";
      throw error;
    }
  };
  const navigate = (
    nextView: string,
    id = selectedId,
    detail = detailTab,
    taskId = "",
    push = false,
    filters: Partial<DeliveryRoute> = {},
    deliverySelection?: Pick<DeliveryInboxTarget, "submission_id" | "work_order_id">,
  ) => {
    if (!canNavigate()) return;
    if (["quality", "releases", "discussions"].includes(nextView)) {
      id = "";
      detail = "details";
      taskId = "";
    }
    const hash = deliveryInboxHash(
      {
        view: nextView,
        requirement_id: id,
        detail,
        task_id: taskId,
        issue_id: filters.issue,
        ...(deliverySelection && Object.hasOwn(deliverySelection, "submission_id") ? { submission_id: deliverySelection.submission_id } : {}),
        ...(deliverySelection && Object.hasOwn(deliverySelection, "work_order_id") ? { work_order_id: deliverySelection.work_order_id } : {}),
      },
      { inboxScope, inboxCategory, resourceKind, showArchived, ...filters },
      location.hash,
      projectId,
    );
    const targetHash = ["quality", "releases"].includes(nextView)
      ? releaseHash({ ...parseReleaseRoute(location.hash), view: nextView as "quality" | "releases", releaseId: "", evidenceId: "", qualityId: "" }, location.hash)
      : nextView === "progress" ? preserveProgressRoute(hash, location.hash) : preserveSchedulingRoute(hash, location.hash);
    const scopedHash = preserveProjectContext(targetHash, location.hash, projectId);
    setView(nextView);
    setSelectedId(id);
    setDetailTab(detail);
    setSelectedTaskId(taskId);
    setSelectedIssueId(filters.issue || "");
    history[push ? "pushState" : "replaceState"](
      null,
      "",
      `${location.pathname}${location.search}${preserveCollaborationRoute(scopedHash, location.hash)}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const setIssueRoute = (id: string) => {
    if (!canNavigate()) return;
    const destination = deliveryInboxHash({ view: "issues", requirement_id: "", detail: "details", issue_id: id }, {}, location.hash, projectId);
    const params = new URLSearchParams(destination.split("?")[1]);
    params.delete("diagnosis_id");
    if (id) params.set("issue", id);
    else params.delete("issue");
    history.pushState(
      null,
      "",
      `${location.pathname}${location.search}#/dev-flow?${params}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const data = executionPinnedWorkspace || query.data;
  const inboxQuery = useDeliveryInboxQuery({
    projectId,
    sessionId,
    queryGeneration: data?.query_generation,
    view,
    scope: inboxScope,
    category: inboxCategory,
    cursor: route.inboxCursor,
    enabled: Boolean(
      projectId && getToken() && data?.query_state.status === "ready",
    ),
  });
  const saveWorkspace = (updated: DeliveryCommandAck) => {
    if (
      originScope.current !== sessionSnapshot() ||
      updated.project_id !== projectId
    )
      return;
    void invalidateDeliveryQueries(qc, projectId);
    for (const key of ["delivery-activity", "delivery-requirement-history"])
      void qc.invalidateQueries({ queryKey: [key, projectId, sessionId] });
    void qc.invalidateQueries({
      queryKey: ["delivery-inbox", projectId, sessionId],
    });
  };
  const contextFailed = Boolean(query.error) || query.isPending || !data || data.query_state.status !== "ready";
  contextReadAccess.current = { failed: contextFailed };
  const recoveryKey = (value: LocatedRecovery) => JSON.stringify([value.kind, value.taskId, value.executionId]);
  let failedRecovery: LocatedRecovery | null = null;
  if (contextFailed && selectedTaskId && executionDispatchRecoveryPending(projectId, "execution.queue", selectedTaskId))
    failedRecovery = { kind: "queue", taskId: selectedTaskId, executionId: "" };
  else if (contextFailed && selectedExecutionId && executionOperationPending(projectId, selectedExecutionId))
    failedRecovery = { kind: "execution", taskId: selectedTaskId, executionId: selectedExecutionId };
  else if (contextFailed && knownTaskRecovery.current?.taskId === selectedTaskId && executionOperationPending(projectId, knownTaskRecovery.current.executionId))
    failedRecovery = { kind: "execution", ...knownTaskRecovery.current };
  const displayedRecovery = locatedRecovery || failedRecovery;
  locatedRecoveryLive.current = displayedRecovery ? recoveryKey(displayedRecovery) : "";
  useEffect(() => {
    if (failedRecovery && !locatedRecovery) { setLocatedRecovery(failedRecovery); executionPending("task-locator-recovery", true); }
  }, [failedRecovery?.kind, failedRecovery?.taskId, failedRecovery?.executionId, locatedRecovery]);
  const rememberTaskRecovery = (taskId: string, executionId: string) => {
    if (originScope.current !== sessionSnapshot() || taskRouteLive.current !== taskId || !executionOperationPending(projectId, executionId)) return;
    knownTaskRecovery.current = { taskId, executionId };
  };
  const recoveryPending = (value: boolean) => {
    if (!displayedRecovery || originScope.current !== sessionSnapshot() || locatedRecoveryLive.current !== recoveryKey(displayedRecovery)) return;
    const retained = displayedRecovery.kind === "queue" ? executionDispatchRecoveryPending(projectId, "execution.queue", displayedRecovery.taskId) : executionOperationPending(projectId, displayedRecovery.executionId);
    if (!value && !retained) {
      if (displayedRecovery.kind === "execution") executionExit.setPending(`execution:${displayedRecovery.executionId}`, false);
      const queueRemains = displayedRecovery.taskId && executionDispatchRecoveryPending(projectId, "execution.queue", displayedRecovery.taskId);
      const known = knownTaskRecovery.current;
      const next: LocatedRecovery | null = queueRemains ? { kind: "queue", taskId: displayedRecovery.taskId, executionId: "" } :
        known && executionOperationPending(projectId, known.executionId) ? { kind: "execution", ...known } :
        selectedExecutionId && executionOperationPending(projectId, selectedExecutionId) ? { kind: "execution", taskId: displayedRecovery.taskId, executionId: selectedExecutionId } : null;
      if (next) {
        locatedRecoveryLive.current = recoveryKey(next); setLocatedRecovery(next); executionPending("task-locator-recovery", true); return;
      }
      executionExit.setPending(`task:${displayedRecovery.taskId}`, false);
      knownTaskRecovery.current = undefined; locatedRecoveryLive.current = ""; setLocatedRecovery(null);
    }
    executionPending("task-locator-recovery", value || retained);
  };
  const openTarget = (target: DeliveryInboxTarget) => {
    if (!canNavigate()) return;
    target = normalizeInboxTarget(target);
    if (
      target.task_id &&
      !target.requirement_id &&
      !["team", "timeline"].includes(target.view)
    ) {
      location.hash = deliveryInboxHref(target, {}, location.hash, projectId);
      return;
    }
    navigate(
      target.view,
      target.requirement_id,
      target.detail,
      target.task_id || "",
      true,
      { issue: target.issue_id || "" },
      target,
    );
  };
  const locateTask = () => {
    const identity = `${selectedId}:${selectedTaskId}`;
    if (
      !selectedTaskId ||
      detailTab !== "tasks" ||
      focusedTask.current === identity
    )
      return;
    const node = taskNodes.current.get(selectedTaskId);
    if (node) {
      node.scrollIntoView({ block: "center" });
      node.focus({ preventScroll: true });
      focusedTask.current = identity;
    }
  };
  useEffect(() => {
    if (!selectedTaskId) focusedTask.current = "";
    const frame = requestAnimationFrame(locateTask);
    return () => cancelAnimationFrame(frame);
  }, [selectedId, selectedTaskId, detailTab]);
  const retainedRequirement = useRef<RequirementDetail>();
  const detailDenied =
    detailQuery.isError &&
    /^HTTP (403|404):/.test(detailQuery.error?.message || "");
  if (
    detailDenied ||
    retainedRequirement.current?.requirement.id !== selectedId
  )
    retainedRequirement.current = undefined;
  if (
    !detailQuery.isError &&
    !detailQuery.isPending &&
    detailQuery.data?.project_id === projectId &&
    detailQuery.data.requirement.id === selectedId
  )
    retainedRequirement.current = detailQuery.data;
  const selected =
    !detailQuery.isError && originScope.current === sessionSnapshot()
      ? retainedRequirement.current?.requirement
      : undefined;
  const selectedOwner = useQuery({
    queryKey: [
      "delivery-requirement-owner",
      projectId,
      sessionId,
      selected?.flow.owner_id,
      query.data?.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryReferences<DeliveryMember>(
        projectId,
        "member",
        { ids: [selected!.flow.owner_id] },
        signal,
        query.data?.query_generation,
      ),
    enabled: Boolean(selected?.flow.owner_id),
    retry: false,
    gcTime: 0,
  });
  const selectedMilestone = useQuery({
    queryKey: [
      "delivery-requirement-milestone",
      projectId,
      sessionId,
      selected?.flow.milestone_id,
      query.data?.query_generation,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryReferences<DeliveryMilestone>(
        projectId,
        "milestone",
        { ids: [selected!.flow.milestone_id] },
        signal,
        query.data?.query_generation,
      ),
    enabled: Boolean(selected?.flow.milestone_id),
    retry: false,
    gcTime: 0,
  });
  const changeQueryRoute = (patch: Partial<DeliveryRoute>, push = false) => {
    navigate(
      view,
      patch.requirement ?? selectedId,
      detailTab,
      patch.task ?? selectedTaskId,
      push,
      patch,
    );
  };
  const inboxNavigation = useDeliveryInboxNavigation({
    projectId,
    sessionId,
    view,
    scope: inboxScope,
    category: inboxCategory,
    cursor: route.inboxCursor,
    canNavigate,
    onOpen: openTarget,
  });
  const releaseReturn = releaseReturnFromHash(location.hash);
  const agentReturn = agentExecutionReturn(location.hash, projectId);
  const requirementReturn = requirementPlanningReturn(location.hash, projectId);
  const returnToRequirements = bindRequirementPlanningBack(canNavigate);
  const requirementBack = requirementReturn ? (
    <Button
      icon={<ArrowLeft size={14} />}
      disabled={navigationPending}
      onClick={returnToRequirements}
    >
      {t("nav.requirements")}
    </Button>
  ) : null;
  const eventReturn = safeEventReturn(
    new URLSearchParams(currentEventHash().split("?")[1]).get("event_return") ||
      "",
    projectId,
  );
  const collaborationReturn = safeCollaborationReturn(
    new URLSearchParams(location.hash.split("?")[1]).get(
      "collaboration_return",
    ) || "",
    projectId,
  );
  const collaborationNavigate = (href: string) => {
    if (!canNavigate()) return;
    const [path, query] = href.split("?");
    if (!["#/dev-flow", "#/tasks/execution", "#/tasks/board"].includes(path)) return;
    const params = new URLSearchParams(query);
    if (params.has("project_id") && params.get("project_id") !== projectId)
      return;
    params.set("project_id", projectId);
    location.hash = `${path}?${params}`;
  };
  const date = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, {
          month: "short",
          day: "numeric",
        }).format(new Date(value.length === 10 ? value + "T12:00:00" : value))
      : tr("unscheduled");
  const name = (id: string) =>
    identityLabel(selectedOwner.data?.items.map((item) => item.data) || [], id);
  const field = (
    key: string,
    label: string,
    extra: Partial<EditorField> = {},
  ): EditorField => ({ key, label: tr(label), ...extra });
  const ownerField = field("owner_id", "owner", {
    members: [],
  });
  const edit = (
    title: string,
    fields: EditorField[],
    values: Record<string, unknown>,
    submit: EditorSpec["submit"],
    hint?: string,
    hooks?: {
      loadLatest?: EditorSpec["loadLatest"];
      adoptVersion?: EditorSpec["adoptVersion"];
    },
  ) => {
    editorIntent.current = {
      version: ["addEvidence", "advance", "reopen"].includes(title)
        ? detailQuery.data?.version || 0
        : data?.version || 0,
      key: crypto.randomUUID(),
    };
    setEditor({
      title: title === "project" ? tp("projectDetails") : tr(title),
      fields,
      values,
      submit,
      hint: hint ? tr(hint) : undefined,
      loadLatest: async () => {
        if (originScope.current !== sessionSnapshot())
          throw new Error(tr("scopeChanged"));
        if (hooks?.loadLatest) return hooks.loadLatest();
        const fresh = await fetchDeliveryContext(projectId);
        qc.setQueryData(queryKey, fresh);
        const [action, payload] = JSON.parse(
          editorIntent.current?.signature || '["",{}]',
        ) as [string, Record<string, string>];
        const req = selectedId
          ? (await fetchRequirementDetail(projectId, selectedId)).requirement
          : undefined;
        let current: Record<string, unknown> = { name: fresh.project.name };
        if (action === "project.update") current = fresh.project;
        else if (action === "member.save")
          current = payload.id
            ? (
                await fetchDeliveryReferences<DeliveryMember>(
                  projectId,
                  "member",
                  { ids: [payload.id] },
                )
              ).items[0]?.data || {}
            : {};
        else if (action === "milestone.save")
          current = payload.id
            ? (
                await fetchDeliveryReferences<DeliveryMilestone>(
                  projectId,
                  "milestone",
                  { ids: [payload.id] },
                )
              ).items[0]?.data || {}
            : {};
        else if (req)
          current = {
            ...req,
            ...req.flow,
          };
        const items = [
          {
            label: tr("requirements"),
            value: String(fresh.summary?.requirements ?? "—"),
          },
        ];
        if (req)
          items.push(
            { label: tr("titleField"), value: req.title },
            { label: tr("current"), value: tr(`stages.${req.flow.stage}`) },
          );
        for (const f of fields) {
          if (current[f.key] === undefined) continue;
          const value = current[f.key];
          items.push({
            label: f.label,
            value:
              (f.members
                ? String(value || tr("unassigned"))
                : f.options?.find((o) => o.value === value)?.label) ||
              String(value ?? tr("none")),
          });
        }
        return { version: fresh.version, items };
      },
      adoptVersion: (version, draft) => {
        editorIntent.current = { version, key: crypto.randomUUID() };
        return hooks?.adoptVersion?.(version, draft);
      },
    });
  };
  const { route: collaborationRoute, change: changeCollaboration } =
    useCollaborationRoute(collaborationNavigate);
  const reqEditor = (r?: RequirementHead) => {
    if (r) {
      changeCollaboration({ edit: "1", ...requirementEditSourcePatch() });
      return;
    }
    edit(
      "create",
      [
        field("title", "titleField", { required: true }),
        field("description", "description", { type: "area" }),
        field("criteria", "criteria", { type: "area" }),
        field("priority", "priority", {
          options: ["P0", "P1", "P2", "P3"].map((value) => ({
            label: value,
            value,
          })),
        }),
        ownerField,
        field("due_on", "due", { type: "date" }),
        field("milestone_id", "milestone", {
          referenceKind: "milestone",
          options: [{ label: tr("none"), value: "" }],
        }),
      ],
      { priority: "P1", owner_id: "", milestone_id: "" },
      async (v) => {
        const { criteria, ...rest } = v;
        await commit("requirement.create", {
          ...rest,
          description: rest.description || "",
          due_on: dateValue(v.due_on),
          acceptance_criteria: lines(criteria),
        });
      },
      undefined,
    );
  };
  const projectEditor = () =>
    edit(
      "project",
      [
        ...(data?.permissions.configure
          ? [
              field("name", "name", { required: true, max: 128 }),
              field("description", "description", { type: "area", max: 20000 }),
            ]
          : []),
        field("goal", "goal", { type: "area" }),
        ownerField,
        field("starts_on", "starts", { type: "date" }),
        field("ends_on", "ends", { type: "date" }),
      ],
      { owner_id: "", ...data?.project },
      async (v) => {
        const current = qc.getQueryData<DeliveryContext>(queryKey);
        if (!current?.permissions.write) throw new Error(tp("noPermission"));
        if (
          data?.permissions.configure &&
          !current.permissions.configure &&
          (v.name !== data.project.name ||
            v.description !== data.project.description)
        )
          throw new Error(tp("noPermission"));
        const payload = projectUpdatePayload(
          v,
          data?.project || {},
          current.permissions.configure,
        );
        if (Object.keys(payload).length)
          await commit("project.update", payload);
      },
    );
  const milestoneEditor = (m?: DeliveryMilestone) =>
    edit(
      m ? "editMilestone" : "addMilestone",
      [
        field("title", "titleField", { required: true, max: 200 }),
        ownerField,
        field("starts_on", "starts", { type: "date" }),
        field("ends_on", "ends", { type: "date" }),
      ],
      m ? { ...m } : { owner_id: "" },
      async (v) => {
        await commit("milestone.save", {
          ...v,
          ...(m ? { id: m.id } : {}),
          starts_on: dateValue(v.starts_on),
          ends_on: dateValue(v.ends_on),
        });
      },
    );
  const memberEditor = (m?: DeliveryMember) =>
    edit(
      m ? "editMember" : "addMember",
      [
        field("name", "name", { required: true, max: 120 }),
        ...(!m
          ? [
              field("kind", "kind", {
                options: ["agent", "tool"].map((value) => ({
                  value,
                  label: tr(`kinds.${value}`),
                })),
              }),
            ]
          : []),
        field("role", "role", { max: 80 }),
        field("tool", "tool", { max: 80 }),
        field("active", "active", { type: "boolean" }),
      ],
      m
        ? { ...m }
        : {
            kind: "agent",
            role: "developer",
            active: true,
            tool: "",
          },
      async (v) => {
        await commit("member.save", {
          ...v,
          ...(m ? { id: m.id, kind: m.kind } : {}),
        });
      },
      "toolsHint",
    );
  const planVersion = useRef(0);
  const planEditor = async (r: RequirementHead) => {
    const ticket = beginProgressExactRead();
    setActionError("");
    try {
      const fresh = await fetchEditableRequirement(projectId, r.id);
      if (ticket.current()) {
        planVersion.current = fresh.version;
        setPlanRequirement(fresh.requirement);
      }
    } catch (error) {
      if (ticket.current()) setActionError((error as Error).message);
    } finally {
      ticket.finish();
    }
  };
  const evidenceEditor = (r: RequirementHead) =>
    edit(
      "addEvidence",
      [
        field("kind", "kind", {
          options: [
            "prd",
            "prototype",
            "architecture",
            "code",
            "test",
            "runbook",
          ].map((value) => ({ value, label: tr(`kinds.${value}`) })),
        }),
        field("title", "titleField", { required: true, max: 200 }),
        field("content", "content", { type: "area" }),
        field("url", "url", { max: 2000 }),
        field("result", "result", {
          options: ["recorded", "passed", "failed"].map((value) => ({
            value,
            label: tr(`statuses.${value}`),
          })),
        }),
      ],
      {
        kind:
          data?.stages.find((s) => s.id === r.flow.stage)?.artifact || "prd",
        result: "recorded",
        content: "",
        url: "",
      },
      async (v) => {
        await commit("artifact.add", { ...v, requirement_id: r.id });
      },
      "manual",
    );
  const reviewEditor = (r: RequirementHead, reopen = false) =>
    edit(
      reopen ? "reopen" : "advance",
      [
        field("comment", "comment", {
          type: "area",
          required: true,
          max: 4000,
        }),
      ],
      {},
      async (v) => {
        await commit(reopen ? "stage.reopen" : "stage.advance", {
          ...v,
          requirement_id: r.id,
        });
      },
    );

  const requirementDesign = selectedId && projectId && getToken() ? <DeliveryDesignContextPanel key={`${projectId}:${sessionId}:${selectedId}:design`} projectId={projectId} target={{ kind: "requirement", id: selectedId }} sessionId={sessionId}
    disabled={executionExit.pending} isActive={() => originScope.current === sessionSnapshot() && !locatedRecoveryLive.current}
    canSubmit={() => executionExit.canNavigate() && originScope.current === sessionSnapshot() && !locatedRecoveryLive.current}
    onSaved={saveWorkspace} onUnresolvedChange={(value) => executionPending(`requirement-design:${selectedId}`, value)} /> : null;
  const requirementRecovery =
    selectedId && collaborationRoute.edit === "1" && projectId && getToken() ? (
      <DeliveryRequirementChangeHost
        key={`${projectId}:${sessionId}:${selectedId}`}
        projectId={projectId}
        requirementId={selectedId}
        sessionId={sessionId}
        onClose={() =>
          changeCollaboration({ edit: "", ...requirementEditSourcePatch() })
        }
        onSaved={saveWorkspace}
        onUnresolvedChange={(value) =>
          executionPending(`requirement:${selectedId}`, value)
        }
      />
    ) : null;
  const independentHistory =
    selectedId && (detailTab === "history" || collaborationRoute.versionId) ? (
      <DeliveryRequirementHistory
        key={`${projectId}:${sessionId}:${selectedId}`}
        projectId={projectId}
        sessionId={sessionId}
        requirementId={selectedId}
        onNavigate={collaborationNavigate}
      />
    ) : null;
  const historyFallback = independentHistory ? (
    <Drawer
      open
      title={selectedId}
      onClose={() => navigate(view, "")}
      className="delivery-inspector"
    >
      {independentHistory}
    </Drawer>
  ) : null;
  // A current/context read can disappear during a write. Keep its original owner outside those reads.
  let taskEditIds: string[] = [], taskEditDiscoveryFailed = false;
  try { taskEditIds = discoverTaskEditRecovery(projectId, true); } catch { taskEditDiscoveryFailed = true; }
  const normalTaskHost = !contextFailed && !displayedRecovery ? !selectedId ? taskInspector.displayId : selected && detailTab === "tasks" ? selectedTaskId : "" : "";
  const taskEditFallbackIds = taskEditIds.filter((id) => id !== normalTaskHost);
  useEffect(() => { executionExit.setPending("task-definition-discovery", taskEditDiscoveryFailed); }, [taskEditDiscoveryFailed, executionExit.setPending]);
  const taskEditFallback = <>
    {taskEditDiscoveryFailed && <Alert type="error" title={taskEditCopy.unavailable} action={<Button onClick={() => refreshTaskRecovery((value) => value + 1)}>{taskEditCopy.retryRecovery}</Button>} />}
    {taskEditFallbackIds.map((taskId) => <TaskDefinitionRecoveryOwner key={`${projectId}:${sessionId}:task-edit:${taskId}`} projectId={projectId} taskId={taskId} sessionId={sessionId} onSaved={saveWorkspace}
      onPending={(value) => { if (originScope.current === sessionSnapshot()) executionPending(`task-definition:${taskId}`, value || taskEditRecoveryPending(projectId, taskId)); }}
      onResolved={() => refreshTaskRecovery((value) => value + 1)} />)}
  </>;
  let submissionRecovery: string[] = [], workOrderRecovery: string[] = [], externalDiscoveryFailed = false;
  try { submissionRecovery = discoverSubmissionRecovery(projectId, true); workOrderRecovery = discoverWorkOrderRecovery(projectId, true); } catch { externalDiscoveryFailed = true; }
  useEffect(() => { executionExit.setPending("task-external-discovery", externalDiscoveryFailed); }, [externalDiscoveryFailed, executionExit.setPending]);
  const externalFallback = <>
    {externalDiscoveryFailed && <Alert type="error" title={externalRecoveryCopy.unavailable} action={<Button onClick={() => refreshExternalRecovery((value) => value + 1)}>{externalRecoveryCopy.retry}</Button>} />}
    {([ ["submission", submissionRecovery], ["work-order", workOrderRecovery] ] as const).flatMap(([kind, ids]) => ids.filter((id) => id !== normalTaskHost).map((taskId) =>
      <TaskExternalRecoveryOwner key={`${projectId}:${kind}:${taskId}`} kind={kind} projectId={projectId} taskId={taskId} sessionId={sessionId} onSaved={saveWorkspace}
        isActive={() => originScope.current === sessionSnapshot()}
        onPending={(value) => { if (originScope.current === sessionSnapshot()) executionPending(`task-${kind}:${taskId}`, value || (kind === "submission" ? externalDeliveryRecoveryPending(projectId, taskId) : workOrderRecoveryPending(projectId, taskId))); }}
        onResolved={() => { if (originScope.current === sessionSnapshot()) refreshExternalRecovery((value) => value + 1); }} />))}
  </>;
  const taskHandoffFallback = displayedRecovery ? displayedRecovery.kind === "queue" ?
    <TaskQueueOriginalRecovery key={`${projectId}:${sessionId}:queue:${displayedRecovery.taskId}`} projectId={projectId} taskId={displayedRecovery.taskId} sessionId={sessionId}
      isActive={() => originScope.current === sessionSnapshot() && locatedRecoveryLive.current === recoveryKey(displayedRecovery)} onPending={recoveryPending} onSaved={saveWorkspace} /> :
    <ExecutionOperationRecovery key={`${projectId}:${sessionId}:${displayedRecovery.executionId}`} projectId={projectId} executionId={displayedRecovery.executionId} sessionId={sessionId}
      isActive={() => originScope.current === sessionSnapshot() && locatedRecoveryLive.current === recoveryKey(displayedRecovery)} onSaved={saveWorkspace} onUnresolvedChange={recoveryPending} /> :
    contextFailed && selectedTaskId && !selectedExecutionId ? <TaskExecutionHandoffRecovery key={`${projectId}:${sessionId}:${selectedTaskId}`} projectId={projectId} taskId={selectedTaskId} sessionId={sessionId}
      isActive={() => originScope.current === sessionSnapshot() && contextReadAccess.current.failed && taskRouteLive.current === selectedTaskId && !locatedRecoveryLive.current}
      onLocated={(executionId) => {
        if (originScope.current !== sessionSnapshot() || !contextReadAccess.current.failed || taskRouteLive.current !== selectedTaskId || locatedRecoveryLive.current || executionDispatchRecoveryPending(projectId, "execution.queue", selectedTaskId) || !executionOperationPending(projectId, executionId)) return;
        const next: LocatedRecovery = { kind: "execution", taskId: selectedTaskId, executionId };
        knownTaskRecovery.current = { taskId: selectedTaskId, executionId }; locatedRecoveryLive.current = recoveryKey(next); setLocatedRecovery(next);
        executionPending("task-locator-recovery", true);
      }} /> : null;
  if (!projectId || !getToken())
    return (
      <Empty description={tr("noProject")}>
        <Button href="#/projects">{tr("chooseProject")}</Button>
      </Empty>
    );
  if (displayedRecovery) return <section className="delivery-workbench space-y-4">
    {taskHandoffFallback}
    {taskEditFallback}
    {externalFallback}
    {query.error && <Alert type="warning" title={t("deliveryQuery.readFailed")} description={query.error.message} />}
  </section>;
  if (query.isPending)
    return (
      <>
        {requirementBack}
        {taskHandoffFallback}
        {taskEditFallback}
        {externalFallback}
        <Skeleton active paragraph={{ rows: 12 }} />
        {requirementRecovery}
        {requirementDesign}
        {historyFallback}
      </>
    );
  if (query.error || !data)
    return (
      <>
        {requirementBack}
        {taskHandoffFallback}
        {taskEditFallback}
        {externalFallback}
        <Alert
          type="error"
          showIcon
          title={query.error?.message || tr("empty")}
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void query.refetch()}>
                {tr("refresh")}
              </Button>
              <Button href="#/projects/portfolio">
                {tr("chooseProject")}
              </Button>
            </div>
          }
        />
        {requirementRecovery}
        {requirementDesign}
        {historyFallback}
      </>
    );
  if (data.query_state.status !== "ready")
    return (
      <>
        {requirementBack}
        {taskHandoffFallback}
        {taskEditFallback}
        {externalFallback}
        <Alert
          type="warning"
          showIcon
          title={t("deliveryQuery.rebuildRequired")}
          action={
            data.permissions.query_rebuild ? (
              <Button
                onClick={() =>
                  void rebuildDeliveryQuery(projectId)
                    .then(() => query.refetch())
                    .catch((failure) => setActionError(failure.message))
                }
              >
                {t("deliveryQuery.rebuild")}
              </Button>
            ) : undefined
          }
          description={actionError || undefined}
        />
        {requirementRecovery}
        {requirementDesign}
        {historyFallback}
      </>
    );
  const canWrite = data.permissions.write && !query.isError;
  const canWriteRequirement =
    canWrite && !detailQuery.isPending && !detailQuery.isError;
  const stageTag = (r: RequirementHead) => (
    <Tag
      color={r.flow.closed ? "green" : r.flow.blocked_reason ? "red" : "cyan"}
    >
      {r.flow.closed ? tr("closed") : tr(`stages.${r.flow.stage}`)}
    </Tag>
  );
  return (
    <section className="delivery-workbench" aria-label={tr("title")}>
      {taskEditFallback}
      {externalFallback}
      {data.project.status === "archived" && (
        <Alert
          type="info"
          title={t("projectPortfolio.archivedReadOnly")}
          description={t("projectPortfolio.archivedHint")}
          action={
            <Button
              href={`#/projects/portfolio?project_id=${encodeURIComponent(projectId)}`}
            >
              {t("projectPortfolio.inspect")}
            </Button>
          }
        />
      )}
      {["planning", "paused"].includes(data.project.status || "") && (
        <Alert type="info" title={t("projectPortfolio.pausedHint")} />
      )}
      <header className="delivery-header">
        <div>
          <div className="delivery-eyebrow">
            <GitBranch size={14} /> {tr("title")}
          </div>
          <h1>{data.project.name}</h1>
          <p>{data.project.goal || tr("subtitle")}</p>
        </div>
        <div className="delivery-actions">
          <Tooltip title={tr("refresh")}>
            <Button
              aria-label={tr("refresh")}
              icon={<RefreshCw size={16} />}
              loading={query.isFetching}
              onClick={() => {
                void query.refetch();
                void invalidateDeliveryQueries(qc, projectId);
              }}
            />
          </Tooltip>
          <Button
            icon={<Settings2 size={15} />}
            onClick={projectEditor}
            disabled={!canWrite}
          >
            {tp("projectDetails")}
          </Button>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            disabled={!canWrite}
            onClick={() => reqEditor()}
          >
            {tr("create")}
          </Button>
        </div>
      </header>
      {requirementBack}
      {(query.error || actionError) && (
        <Alert
          type="error"
          showIcon
          title={actionError || query.error?.message}
          closable
          onClose={() => setActionError("")}
        />
      )}
      {!canWrite && <Alert type="info" title={tr("readOnly")} />}
      {executionExit.blocked && (
        <Alert
          type="warning"
          role="status"
          title={t("deliveryExecutionRuntime.pendingNavigation")}
        />
      )}
      {draftExit.blocked && <Alert type="warning" role="status" title={deliveryDraftCopy(i18n?.language).navigationBlocked} />}
      <div className="delivery-metrics">
        {(
          [
            "requirements",
            "accepted",
            "released",
            "blocked",
            "openIssues",
          ] as const
        ).map((key, idx) => (
          <div key={key}>
            <span>{tr(key)}</span>
            <strong>
              {
                [
                  data.summary?.requirements,
                  data.summary?.accepted,
                  data.summary?.released,
                  data.summary?.blocked,
                  data.summary?.open_issues,
                ][idx]
              }
            </strong>
            {idx === 1 && <small>{data.summary?.acceptance_rate}%</small>}
          </div>
        ))}
      </div>
      {agentReturn && (
        <Button disabled={navigationPending} onClick={() => {
          if (canNavigate()) location.hash = agentReturn;
        }}>{t("deliveryExecutionRuntime.backAgentOps")}</Button>
      )}
      {releaseReturn && (
        <Button href={releaseReturn}>
          {t(
            parseReleaseRoute(releaseReturn).view === "quality"
              ? "deliveryRelease.backQuality"
              : "deliveryRelease.releases",
          )}
        </Button>
      )}
      {eventReturn && (
        <Button
          onClick={() => {
            if (canNavigate()) location.hash = eventReturn;
          }}
        >
          {t("eventReceipts.back")}
        </Button>
      )}
      {collaborationReturn && (
        <Button onClick={() => collaborationNavigate(collaborationReturn)}>
          {t("deliveryCollaboration.backActivity")}
        </Button>
      )}
      <Tabs
        className="delivery-tabs"
        activeKey={view}
        onChange={(v) => navigate(v)}
        items={views.map((key) => ({
          key,
          label:
            key === "discussions"
              ? t("deliveryDiscussion.title")
              : key === "quality" || key === "releases"
                ? t(`deliveryRelease.${key}`)
                : key === "progress"
                  ? t("deliveryProgress.title")
                  : ["resources", "inbox"].includes(key)
                    ? tp(key)
                    : tr(key),
          icon:
            key === "list" ? (
              <List size={15} />
            ) : key === "board" ? (
              <LayoutGrid size={15} />
            ) : key === "team" ? (
              <Users size={15} />
            ) : undefined,
        }))}
      />
      {["list", "board"].includes(view) && (
        <DeliveryRequirementIndex
          projectId={projectId}
          sessionId={sessionId}
          view={view as "list" | "board"}
          route={route}
          queryGeneration={data.query_generation}
          onRefreshContext={() => void query.refetch()}
          onRoute={changeQueryRoute}
          onOpen={(id) => navigate(view, id, "details", "", true)}
        />
      )}
      {view === "overview" && (
        <>
          <DeliveryProjectOverview
            onMilestone={(id) => {
              location.hash = preserveProjectContext(
                `#/dev-flow?view=timeline&milestone_id=${encodeURIComponent(id)}`,
                location.hash,
              );
            }}
            data={data}
            inbox={inboxQuery.data}
            inboxError={inboxQuery.error?.message}
            inboxLoading={inboxQuery.isPending}
            onRefreshInbox={() => {
              void query.refetch();
              void inboxQuery.refetch();
            }}
            onInboxCategory={(category) => {
              if (!canNavigate()) return;
              setInboxScope("mine");
              setInboxCategory(category);
              navigate("inbox", "", "details", "", true, {
                inboxScope: "mine",
                inboxCategory: category,
                inboxPage: 1,
                inboxCursor: "",
              });
            }}
            onView={(nextView) => navigate(nextView, "")}
          />
          <div className="delivery-section-heading">
            <h2>{tr("current")}</h2>
            <span>
              {tr("tasksDone")} {data.summary?.tasks_done}/{data.summary?.tasks}
            </span>
          </div>
          <div className="delivery-stage-rail">
            {deliveryStages.map((s, i) => (
              <button
                key={s}
                onClick={() => {
                  navigate("list", "", "details", "", true, {
                    stage: s,
                    page: 1,
                    cursor: "",
                  });
                }}
              >
                <small>{String(i + 1).padStart(2, "0")}</small>
                <strong>
                  {data.metrics?.requirement_stage_counts?.[s] ?? "—"}
                </strong>
                <span>{tr(`stages.${s}`)}</span>
              </button>
            ))}
          </div>
          <div className="delivery-overview-grid">
            <DeliveryProgressSummary
              projectId={projectId}
              sessionId={sessionId}
              queryGeneration={data.query_generation}
              onRefreshContext={() => query.refetch()}
              onOpen={() => navigate("progress", "")}
            />
            <section className="delivery-panel">
              <h2>{tr("activity")}</h2>
              <DeliveryActivityFeed
                projectId={projectId}
                sessionId={sessionId}
                onNavigate={collaborationNavigate}
              />
            </section>
          </div>
        </>
      )}
      {(view === "quality" || view === "releases") && (
        <DeliveryReleaseWorkbench
          view={view}
          workspace={data}
          sessionId={sessionId}
          onSaved={saveWorkspace}
          onUnresolvedChange={(identity, value) =>
            executionPending("release:" + identity, value)
          }
        />
      )}
      {view === "discussions" && (
        <DeliveryCollaboration
          key={`${projectId}:${sessionId}:project`}
          projectId={projectId}
          sessionId={sessionId}
          readOnly={!data.permissions.write}
          onSaved={saveWorkspace}
          onNavigate={collaborationNavigate}
          onUnresolvedChange={(value) =>
            executionPending("discussion:project", value)
          }
        />
      )}
      {view === "resources" && (
        <DeliveryProjectResources
          projectId={projectId}
          data={data}
          kind={resourceKind}
          showArchived={showArchived}
          onSaved={saveWorkspace}
          onFilter={(kind, archived) => {
            setResourceKind(kind);
            setShowArchived(archived);
            navigate("resources", "", "details", "", false, {
              resourceKind: kind,
              showArchived: archived,
            });
          }}
        />
      )}
      {view === "progress" && (
        <DeliveryProgress
          projectId={projectId}
          sessionId={sessionId}
          workspace={data}
          onWorkspace={saveWorkspace}
          onOpenTask={openTarget}
          onPending={(identity, pending) =>
            executionPending(`progress:${identity}`, pending)
          }
        />
      )}
      {view === "inbox" && (
        <DeliveryInbox
          data={inboxQuery.data}
          workspace={data}
          scope={inboxScope}
          category={inboxCategory}
          page={route.inboxPage}
          cursor={route.inboxCursor}
          loading={inboxQuery.isPending}
          refreshing={inboxQuery.isFetching}
          error={inboxQuery.error?.message}
          onRefresh={() => {
            void query.refetch();
            void inboxQuery.refetch();
          }}
          onScope={(scope) => {
            if (!canNavigate()) return;
            setInboxScope(scope);
            navigate("inbox", "", "details", "", true, {
              inboxScope: scope,
              inboxPage: 1,
              inboxCursor: "",
            });
          }}
          onCategory={(category) => {
            if (!canNavigate()) return;
            setInboxCategory(category);
            navigate("inbox", "", "details", "", true, {
              inboxCategory: category,
              inboxPage: 1,
              inboxCursor: "",
            });
          }}
          onFirstPage={() => {
            if (!canNavigate()) return;
            navigate("inbox", "", "details", "", true, {
              inboxPage: 1,
              inboxCursor: "",
            });
            void query.refetch();
            void inboxQuery.refetch();
          }}
          onNextPage={(cursor) =>
            changeQueryRoute(
              { inboxPage: route.inboxPage + 1, inboxCursor: cursor },
              true,
            )
          }
          onOpen={(target) => void inboxNavigation.open(target)}
          navigationBusy={inboxNavigation.busy}
          navigationError={inboxNavigation.error}
          onRetryOpen={() => void inboxNavigation.retry()}
        />
      )}
      {["team", "timeline"].includes(view) && (
        <DeliveryScheduling
          projectId={projectId}
          sessionId={sessionId}
          view={view as "team" | "timeline"}
          workspace={data}
          onSaved={saveWorkspace}
          onOpenTask={openTarget}
          onEditMember={memberEditor}
          onEditMilestone={milestoneEditor}
        />
      )}
      {view === "issues" && (
        <DeliveryIssueWorkbench
          workspace={data}
          projectId={projectId}
          sessionId={sessionId}
          issueId={selectedIssueId}
          background={location.hash}
          readOnly={data.project.status === "archived"}
          onSaved={saveWorkspace}
          onOpenIssue={(id) => setIssueRoute(id)}
          onCloseIssue={() => setIssueRoute("")}
        />
      )}
      <Drawer
        open={Boolean(requestedTaskId)}
        closable={!navigationPending}
        maskClosable={!navigationPending}
        keyboard={!navigationPending}
        afterOpenChange={taskInspector.afterOpenChange}
        onClose={() =>
          collaborationReturn
            ? collaborationNavigate(collaborationReturn)
            : navigate(view, "", "details", "")
        }
        title={t("deliveryTaskAcceptance.details")}
        width={680}
        className="delivery-inspector"
        destroyOnHidden
      >
        {taskInspector.displayId && (
          <DeliveryTaskDetail
            key={`${projectId}:${taskInspector.displayId}`}
            projectId={projectId}
            sessionId={sessionId}
            taskId={taskInspector.displayId}
            onDraftChange={inspectorDraftChanged}
            onDefinitionPending={(value) => executionPending(`task-definition:${taskInspector.displayId}`, value)}
            onExternalPending={(kind, value) => executionPending(`task-${kind}:${taskInspector.displayId}`, value)}
            onUnresolvedChange={(value) =>
              executionPending(`task:${taskInspector.displayId}`, value)
            }
            onRecoveryIdentity={(executionId) => rememberTaskRecovery(taskInspector.displayId, executionId)}
            isActive={() => originScope.current === sessionSnapshot() && !contextReadAccess.current.failed && !locatedRecoveryLive.current}
          />
        )}
      </Drawer>
      <DeliveryExecutionInspector
        executionId={selectedExecutionId}
        sessionId={sessionId}
        workspace={data}
        onSaved={saveWorkspace}
        isActive={() => originScope.current === sessionSnapshot() && !contextReadAccess.current.failed && !locatedRecoveryLive.current}
        nodeId={executionSelection.nodeId}
        attempt={executionSelection.attempt}
        stream={executionSelection.stream}
        onUnresolvedChange={(value) =>
          executionPending(`execution:${selectedExecutionId}`, value)
        }
        onCommand={(action, payload) => commit(action, payload, false)}
        onClose={() => {
          if (!canNavigate()) return;
          if (agentReturn) { location.hash = agentReturn; return; }
          if (collaborationReturn) {
            collaborationNavigate(collaborationReturn);
            return;
          }
          const params = new URLSearchParams(location.hash.split("?")[1]);
          params.delete("execution_id");
          params.delete("execution_node");
          params.delete("execution_attempt");
          params.delete("execution_stream");
          location.hash = `#/dev-flow?${params}`;
        }}
      />
      <Drawer
        open={Boolean(selectedId)}
        closable={!navigationPending}
        maskClosable={!navigationPending}
        keyboard={!navigationPending}
        onClose={() => {
          if (canNavigate()) {
            if (collaborationReturn) collaborationNavigate(collaborationReturn);
            else if (releaseReturn) location.hash = releaseReturn;
            else if (requirementReturn) returnToRequirements();
            else navigate(view, "");
          }
        }}
        size="min(680px, 100vw)"
        title={selected?.title}
        className="delivery-inspector"
        destroyOnHidden
        afterOpenChange={(open) => {
          if (open) locateTask();
        }}
      >
        {detailQuery.isPending && <Skeleton active />}
        {detailQuery.error && (
          <DeliveryQueryError
            error={detailQuery.error}
            onRetry={() => {
              void query.refetch();
              void detailQuery.refetch();
            }}
          />
        )}
        {!selected && independentHistory}
        {requirementDesign}
        {selected && (
          <>
            <div className="delivery-inspector-meta">
              {stageTag(selected)}
              <Tag>{selected.priority}</Tag>
              <span>
                {t("delivery.revision", { number: selected.flow.revision })}
              </span>
              <small>{selected.id}</small>
            </div>
            {selected.flow.legacy_completed && (
              <Alert type="warning" title={tr("legacy")} />
            )}
            <Tabs
              activeKey={detailTab}
              onChange={(key) => {
                navigate(
                  view,
                  selectedId,
                  key,
                  key === "tasks" ? selectedTaskId : "",
                );
              }}
              items={[
                {
                  key: "details",
                  label: tr("details"),
                  children: (
                    <>
                      <DeliveryRequirementDefinition
                        key={`${selected.id}:${detailQuery.data?.query_generation}:${selected.basis}`}
                        projectId={projectId}
                        sessionId={sessionId}
                        head={detailQuery.data!}
                      />
                      <div className="delivery-facts">
                        <span>
                          {tr("owner")}
                          <strong>{name(selected.flow.owner_id)}</strong>
                        </span>
                        <span>
                          {tr("due")}
                          <strong>{date(selected.flow.due_on)}</strong>
                        </span>
                        <span>
                          {tr("milestone")}
                          <strong>
                            {selectedMilestone.data?.items[0]?.label ||
                              selected.flow.milestone_id ||
                              tr("none")}
                          </strong>
                        </span>
                      </div>
                      <DeliverySourceSummary
                        key={`${projectId}:${sessionId}:${selected.id}`}
                        projectId={projectId}
                        sessionId={sessionId}
                        target={{ kind: "requirement", id: selected.id }}
                        onNavigate={collaborationNavigate}
                      />
                      {selected.flow.blocked_reason && (
                        <Alert
                          type="warning"
                          title={selected.flow.blocked_reason}
                        />
                      )}
                      <Button
                        onClick={() => reqEditor(selected)}
                        disabled={!canWriteRequirement}
                      >
                        {tr("edit")}
                      </Button>
                      <section className="delivery-gates">
                        <h3>{tr("gateTitle")}</h3>
                        <p>
                          {selected.flow.gates.every((g) => g.ok)
                            ? tr("gateReady")
                            : tr("gateMissing")}
                        </p>
                        {selected.flow.gates.map((g) => (
                          <div key={g.id} className={g.ok ? "is-ready" : ""}>
                            {g.ok ? (
                              <CheckCircle2 size={16} />
                            ) : (
                              <Circle size={16} />
                            )}
                            <span>
                              {tr(`gates.${g.id}`)}
                              {!g.ok && g.id === "task_acceptance" && (
                                <small className="runtime-help">
                                  {t("deliveryTaskAcceptance.gateHint")}
                                </small>
                              )}
                            </span>
                          </div>
                        ))}
                      </section>
                      <div className="delivery-actions">
                        <Button
                          type="primary"
                          disabled={
                            !data.permissions.approve ||
                            query.isError ||
                            detailQuery.isError ||
                            detailQuery.isPending ||
                            selected.flow.closed ||
                            selected.flow.gates.some((g) => !g.ok)
                          }
                          onClick={() => reviewEditor(selected)}
                        >
                          {tr(
                            selected.flow.stage === "operations"
                              ? "close"
                              : "advance",
                          )}
                        </Button>
                        <Button
                          disabled={
                            !data.permissions.approve ||
                            query.isError ||
                            detailQuery.isError ||
                            detailQuery.isPending
                          }
                          onClick={() => reviewEditor(selected, true)}
                        >
                          {tr("reopen")}
                        </Button>
                      </div>
                    </>
                  ),
                },
                {
                  key: "discussion",
                  label: t("deliveryDiscussion.title"),
                  children: (
                    <DeliveryCollaboration
                      key={`${projectId}:${sessionId}:${selected.id}`}
                      projectId={projectId}
                      sessionId={sessionId}
                      subject={{ kind: "requirement", id: selected.id }}
                      readOnly={!canWriteRequirement}
                      onSaved={saveWorkspace}
                      onNavigate={collaborationNavigate}
                      onUnresolvedChange={(value) =>
                        executionPending(`discussion:${selected.id}`, value)
                      }
                    />
                  ),
                },
                {
                  key: "tasks",
                  label: tr("tasks"),
                  children: (
                    <>
                      <p className="delivery-hint">{tr("assignmentHint")}</p>
                      <div className="delivery-actions">
                        <Button
                          onClick={() => planEditor(selected)}
                          disabled={
                            !canWriteRequirement ||
                            ["release", "operations"].includes(
                              selected.flow.stage,
                            )
                          }
                        >
                          {tr("plan")}
                        </Button>
                        <Button href="#/tasks/agent-feed">
                          {tr("dispatch")}
                        </Button>
                      </div>
                      <DeliveryRequirementTasks
                        projectId={projectId}
                        sessionId={sessionId}
                        requirementId={selected.id}
                        route={route}
                        queryGeneration={data.query_generation}
                        onRoute={changeQueryRoute}
                        onDraftChange={requirementTaskDraftChanged}
                        onDefinitionPending={(value) => executionPending(`task-definition:${selectedTaskId}`, value)}
                        onExternalPending={(kind, value) => executionPending(`task-${kind}:${selectedTaskId}`, value)}
                        onUnresolvedChange={(value) =>
                          executionPending(`task:${selectedTaskId}`, value)
                        }
                        onRecoveryIdentity={(executionId) => rememberTaskRecovery(selectedTaskId, executionId)}
                        isActive={() => originScope.current === sessionSnapshot() && !contextReadAccess.current.failed && !locatedRecoveryLive.current}
                      />
                    </>
                  ),
                },
                {
                  key: "evidence",
                  label: tr("evidence"),
                  children: (
                    <>
                      <Button
                        disabled={!canWriteRequirement || selected.flow.closed}
                        onClick={() => evidenceEditor(selected)}
                      >
                        {tr("addEvidence")}
                      </Button>
                      <DeliveryRequirementRecords
                        projectId={projectId}
                        sessionId={sessionId}
                        head={detailQuery.data!}
                        collection="artifacts"
                        onNavigate={collaborationNavigate}
                      />
                    </>
                  ),
                },
                {
                  key: "release",
                  label: tr("release"),
                  children: (
                    <>
                      <Alert
                        type="info"
                        showIcon
                        title={t("deliveryRelease.historicalManual")}
                        description={t("deliveryRelease.historicalHint")}
                      />
                      <Button onClick={() => navigate("releases", "")}>
                        {t("deliveryRelease.releases")}
                      </Button>
                      <DeliveryRequirementRecords
                        projectId={projectId}
                        sessionId={sessionId}
                        head={detailQuery.data!}
                        collection="releases"
                        onNavigate={collaborationNavigate}
                      />
                    </>
                  ),
                },
                {
                  key: "history",
                  label: t("deliveryCollaboration.historyTab"),
                  children: (
                    <DeliveryRequirementHistory
                      key={selected.id}
                      projectId={projectId}
                      sessionId={sessionId}
                      requirementId={selected.id}
                      onNavigate={collaborationNavigate}
                    />
                  ),
                },
                {
                  key: "activity",
                  label: tr("activity"),
                  children: (
                    <>
                      <DeliveryRequirementRecords
                        projectId={projectId}
                        sessionId={sessionId}
                        head={detailQuery.data!}
                        collection="reviews"
                        onNavigate={collaborationNavigate}
                      />
                      <DeliveryActivityFeed
                        key={selected.id}
                        projectId={projectId}
                        sessionId={sessionId}
                        requirementId={selected.id}
                        onNavigate={collaborationNavigate}
                      />
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      <DeliveryActivityDetail
        projectId={projectId}
        sessionId={sessionId}
        onNavigate={collaborationNavigate}
      />
      {requirementRecovery}
      {editor && (
        <DeliveryEditor spec={editor} onClose={() => setEditor(null)} />
      )}
      {planRequirement && data && (
        <DeliveryTaskPlanEditor
          key={planRequirement.id}
          data={data}
          requirement={planRequirement}
          requirementVersion={planVersion.current}
          onUnresolvedChange={(value) => executionPending(`plan:${planRequirement.id}`, value)}
          onClose={() => {
            if (canNavigate()) setPlanRequirement(null);
          }}
          onSaved={(updated) => {
            if (originScope.current !== sessionSnapshot()) return;
            saveWorkspace(updated);
            setPlanRequirement(null);
            navigate("list", planRequirement.id, "tasks");
          }}
        />
      )}
    </section>
  );
}
